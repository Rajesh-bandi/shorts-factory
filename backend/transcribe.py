"""Stage 2 — obtain a transcript.

English captions are fetched from YouTube first, then cached. Local Whisper
(on CPU) is only used when no English captions are available. Audio is decoded
with ffmpeg so transcription does not depend on PyAV's version-specific API.
"""
import glob
import json
import os
import re
import subprocess
import tempfile
import time
import wave

from . import db, downloader, gpu, settings

_model_cache = {}
_ENGLISH_LANGS = ("en", "en-US", "en-GB", "en-orig")


def _cache_path(job_id, user_id, tag=None):
    suffix = f"_{tag}" if tag else ""
    return os.path.join(
        downloader.user_media_dir(user_id), f"job{job_id}_transcript{suffix}.json"
    )


def _load_cache(job_id, user_id, tag=None):
    path = _cache_path(job_id, user_id, tag)
    if not os.path.exists(path):
        return None
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        items = data.get("segments") if isinstance(data, dict) else data
        source = data.get("source", "unknown") if isinstance(data, dict) else "unknown"
        segments = _normalize(items or [])
        return {"source": source, "segments": segments} if segments else None
    except (OSError, ValueError, TypeError, json.JSONDecodeError):
        return None


def _save_cache(job_id, user_id, source, segments, tag=None):
    try:
        os.makedirs(downloader.user_media_dir(user_id), exist_ok=True)
        path = _cache_path(job_id, user_id, tag)
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump({"source": source, "segments": segments}, f, ensure_ascii=False)
        os.replace(tmp, path)
    except OSError:
        pass


def _merge_words(*groups):
    """Combine per-word caption timings without duplicating or overlapping."""
    merged = []
    for group in groups:
        for word in group or []:
            if not isinstance(word, dict):
                continue
            try:
                start = float(word.get("start"))
                end = float(word.get("end"))
            except (TypeError, ValueError):
                continue
            text = str(word.get("word") or word.get("text") or "").strip()
            if not text or end <= start:
                continue
            if merged:
                prev = merged[-1]
                if text == prev["text"] and abs(start - prev["start"]) < 0.25:
                    prev["end"] = max(prev["end"], end)
                    continue
                if start < prev["end"]:
                    start = prev["end"]
                if end <= start:
                    continue
            merged.append({"text": text, "start": round(start, 2), "end": round(end, 2)})
    return merged


def _normalize(segments):
    """Clean, de-duplicate, and coalesce caption/Whisper cues."""
    cleaned = []
    for item in segments or []:
        if not isinstance(item, dict):
            continue
        try:
            start = float(item.get("start"))
            end = float(item.get("end"))
        except (TypeError, ValueError):
            continue
        text = re.sub(r"\s+", " ", str(item.get("text") or "")).strip()
        if not text:
            continue
        if end <= start:
            end = start + 1.0
        words = _merge_words(item.get("words") or [])
        if (
            cleaned
            and text == cleaned[-1]["text"]
            and start - cleaned[-1]["start"] < 1.0
        ):
            cleaned[-1]["end"] = max(cleaned[-1]["end"], end)
            cleaned[-1]["words"] = _merge_words(cleaned[-1].get("words"), words)
            continue
        if cleaned and start < cleaned[-1]["start"]:
            continue
        seg = {"start": round(start, 2), "end": round(end, 2), "text": text}
        if words:
            seg["words"] = words
        cleaned.append(seg)

    out = []
    for seg in cleaned:
        if not out:
            out.append(dict(seg))
            continue
        last = out[-1]
        gap = seg["start"] - last["end"]
        if (
            gap <= 1.0
            and seg["end"] - last["start"] <= 12.0
            and len(last["text"]) + len(seg["text"]) <= 320
        ):
            last["text"] = (last["text"] + " " + seg["text"]).strip()
            last["end"] = max(last["end"], seg["end"])
            last["words"] = _merge_words(last.get("words"), seg.get("words"))
        else:
            out.append(dict(seg))
    return out


def _parse_json3(text):
    data = json.loads(text.lstrip("\ufeff"))
    raw = []
    for event in data.get("events", []):
        pieces = event.get("segs") or []
        words = "".join(str(seg.get("utf8") or "") for seg in pieces).strip()
        if not words:
            continue
        start = float(event.get("tStartMs") or 0) / 1000.0
        duration = float(event.get("dDurationMs") or 0) / 1000.0
        end = start + (duration or 1.0)
        timed = []
        buffer = ""
        buffer_start = None
        for piece in pieces:
            value = str(piece.get("utf8") or "")
            if not value:
                continue
            at = start + float(piece.get("tOffsetMs") or 0) / 1000.0
            if buffer_start is None:
                buffer_start = at
            buffer += value
            if value[-1].isspace():
                clean = re.sub(r"\s+", " ", buffer).strip()
                if clean:
                    timed.append({"text": clean, "start": buffer_start, "end": at})
                buffer = ""
                buffer_start = None
        if buffer.strip():
            timed.append({"text": buffer.strip(), "start": buffer_start or start, "end": end})
        for index, word in enumerate(timed):
            next_start = timed[index + 1]["start"] if index + 1 < len(timed) else end
            if next_start > word["start"]:
                word["end"] = min(next_start, end)
            elif word["end"] <= word["start"]:
                word["end"] = word["start"] + 0.15
        # Manual caption cues often contain a whole phrase in one `segs`
        # entry. Only keep timings that are genuinely per-word; otherwise the
        # caption builder estimates timing across the phrase.
        if len(timed) < 2 or any(len(word["text"].split()) != 1 for word in timed):
            timed = []
        raw.append(
            {
                "start": start,
                "end": end,
                "text": words,
                "words": timed,
            }
        )
    return _normalize(raw)


def _vtt_timestamp(value):
    value = value.strip().split()[0].replace(",", ".")
    parts = value.split(":")
    if len(parts) == 3:
        hours, minutes, seconds = parts
    elif len(parts) == 2:
        hours, minutes, seconds = "0", parts[0], parts[1]
    else:
        return None
    try:
        return int(hours) * 3600 + int(minutes) * 60 + float(seconds)
    except ValueError:
        return None


def _parse_vtt(text):
    raw = []
    lines = text.replace("\r", "").splitlines()
    i = 0
    while i < len(lines):
        line = lines[i]
        if "-->" not in line:
            i += 1
            continue
        left, right = line.split("-->", 1)
        start = _vtt_timestamp(left)
        end = _vtt_timestamp(right)
        i += 1
        cue = []
        while i < len(lines) and lines[i].strip():
            clean = re.sub(r"<[^>]+>", "", lines[i]).strip()
            if clean:
                cue.append(clean)
            i += 1
        if start is not None and end is not None and cue:
            raw.append(
                {
                    "start": start,
                    "end": end,
                    "text": " ".join(cue).replace("&nbsp;", " "),
                }
            )
        i += 1
    return _normalize(raw)


def _pick_track(tracks):
    usable = {}
    for track in tracks or []:
        ext = track.get("ext")
        if ext in ("json3", "vtt") and track.get("url"):
            usable.setdefault(ext, track)
    return usable.get("json3") or usable.get("vtt")


def _fetch_english_captions(url, info=None):
    """Return (segments, label) from YouTube English captions, or (None, reason)."""
    if info is None:
        if not url:
            return None, "No video URL"
        try:
            import yt_dlp
        except ImportError:
            return None, "yt-dlp is unavailable"
        try:
            opts = downloader.ytdlp_common_opts({
                "skip_download": True,
                "quiet": True,
                "no_warnings": True,
                "noplaylist": True,
                "socket_timeout": 45,
            })
            with yt_dlp.YoutubeDL(opts) as ydl:
                info = ydl.extract_info(url, download=False)
        except Exception as e:
            return None, f"YouTube caption lookup failed: {e}"

    manual = info.get("subtitles") or {}
    automatic = info.get("automatic_captions") or {}
    last_error = None
    for label, by_lang in (("manual", manual), ("automatic", automatic)):
        for lang in _ENGLISH_LANGS:
            track = _pick_track(by_lang.get(lang))
            if not track:
                continue
            try:
                import requests

                resp = requests.get(
                    track["url"],
                    headers={"User-Agent": "Mozilla/5.0"},
                    timeout=30,
                )
                if resp.status_code == 429:
                    return None, "YouTube captions are rate-limited (HTTP 429)"
                if resp.status_code != 200:
                    last_error = f"HTTP {resp.status_code}"
                    continue
                segments = (
                    _parse_json3(resp.text)
                    if track.get("ext") == "json3"
                    else _parse_vtt(resp.text)
                )
            except Exception as e:
                last_error = str(e)[:120]
                continue
            if segments:
                return segments, f"YouTube {label} captions ({lang})"
    if last_error:
        return None, f"YouTube captions unavailable ({last_error})"
    return None, "No English captions available"


def _extract_audio(video_path: str, job_id: int, user_id: int):
    """Decode the first audio stream to 16 kHz mono float32 samples."""
    fd, wav_path = tempfile.mkstemp(
        prefix=f"job{job_id}_audio_",
        suffix=".wav",
        dir=downloader.user_media_dir(user_id),
    )
    os.close(fd)
    try:
        cmd = [
            "ffmpeg", "-y", "-nostdin", "-loglevel", "error",
            "-i", video_path,
            "-vn", "-ac", "1", "-ar", "16000",
            "-acodec", "pcm_s16le", wav_path,
        ]
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=1800)
        if proc.returncode != 0:
            tail = (proc.stderr or proc.stdout or "").strip().splitlines()[-3:]
            raise RuntimeError(
                "ffmpeg audio extraction failed: " + (" | ".join(tail) or "unknown error")
            )
        with wave.open(wav_path, "rb") as wf:
            if wf.getnchannels() != 1 or wf.getsampwidth() != 2 or wf.getframerate() != 16000:
                raise RuntimeError("ffmpeg produced an unexpected audio format")
            frames = wf.readframes(wf.getnframes())
        if not frames:
            raise RuntimeError("No audio samples found in the source video")
        import numpy as np

        return np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0
    finally:
        try:
            os.remove(wav_path)
        except OSError:
            pass


def fetch_online(job_id: int, url: str | None, user_id: int, info=None, cancel_cb=None):
    """Fetch reusable English captions without downloading any media.

    Returns (segments, label). Cached YouTube captions are returned directly.
    """
    if cancel_cb and cancel_cb():
        return None, "canceled"
    cached = _load_cache(job_id, user_id)
    if cached and cached["source"] == "youtube":
        db.log(job_id, f"Reusing cached transcript ({len(cached['segments'])} segments)")
        return cached["segments"], "cached YouTube captions"
    db.log(job_id, "Looking for English captions before downloading any video…")
    segments, label = _fetch_english_captions(url, info=info)
    if segments and not (cancel_cb and cancel_cb()):
        _save_cache(job_id, user_id, "youtube", segments)
        db.log(job_id, f"Using {label} — no video download needed for analysis")
    return segments, label


def load_cached(job_id, user_id):
    return _load_cache(job_id, user_id)


def clear_cache(job_id, user_id, tag=None):
    """Drop cached transcripts when their source recording is discarded.

    Without a tag every transcript for the job is removed, which also clears
    the per-window caches used by interactive live clipping.
    """
    if tag:
        paths = [_cache_path(job_id, user_id, tag)]
    else:
        paths = glob.glob(
            os.path.join(downloader.user_media_dir(user_id), f"job{job_id}_transcript*.json")
        )
    for path in paths:
        try:
            os.remove(path)
        except OSError:
            pass


def transcribe(video_path: str, job_id: int, user_id: int, stage_cb, url: str | None = None,
               cancel_cb=None, info=None, try_online=True, tag=None):
    """Return timestamped segments, preferring cached/online English captions.

    ``tag`` namespaces the cache for live DVR windows so two windows from the
    same job do not reuse each other's Whisper output.
    """
    def canceled():
        return bool(cancel_cb and cancel_cb())

    if canceled():
        return None
    cached = _load_cache(job_id, user_id, tag)
    if cached and cached["source"] == "youtube":
        db.log(job_id, f"Reusing cached transcript ({len(cached['segments'])} segments)")
        stage_cb("transcribing", 0.45)
        return None if canceled() else cached["segments"]

    stage_cb("transcribing", 0.35)
    if try_online:
        segments, label = fetch_online(job_id, url, user_id, info=info, cancel_cb=cancel_cb)
        if segments:
            stage_cb("transcribing", 0.45)
            return None if canceled() else segments
    else:
        label = "Online captions skipped"

    db.log(job_id, f"{label} — using local Whisper", "warn")
    if canceled():
        return None
    if cached and cached["source"] == "whisper":
        db.log(job_id, "Reusing cached Whisper transcript")
        stage_cb("transcribing", 0.45)
        return None if canceled() else cached["segments"]

    try:
        from faster_whisper import WhisperModel
    except ImportError:
        db.log(
            job_id,
            "faster-whisper not installed — falling back to heuristic highlight detection",
            "warn",
        )
        stage_cb("transcribing", 0.45)
        return None

    model_name = settings.get(user_id, "whisper_model", "small")
    want_gpu = bool(settings.get(user_id, "gpu_enabled", True))
    use_gpu = want_gpu and gpu.cuda_available()
    if want_gpu and not use_gpu:
        db.log(job_id, "GPU requested but CUDA is unavailable — using CPU", "warn")
    elif use_gpu:
        db.log(job_id, gpu.cuda_summary())

    def model_for(device, compute_type):
        key = (model_name, device, compute_type)
        if key not in _model_cache:
            db.log(job_id, f"Loading whisper model '{model_name}' on {device.upper()} ({compute_type})…")
            _model_cache[key] = WhisperModel(model_name, device=device, compute_type=compute_type)
        return _model_cache[key]

    try:
        model = model_for("cuda" if use_gpu else "cpu", "float16" if use_gpu else "int8")
    except Exception as first_error:
        if use_gpu:
            db.log(job_id, f"GPU Whisper load failed ({first_error}); using CPU", "warn")
            use_gpu = False
            model = model_for("cpu", "int8")
        else:
            db.log(job_id, f"CPU int8 load failed ({first_error}); trying float32", "warn")
            model = model_for("cpu", "float32")

    if canceled():
        return None
    db.log(job_id, "Extracting audio for transcription…")
    audio = _extract_audio(video_path, job_id, user_id)
    if canceled():
        return None
    duration = len(audio) / 16000.0
    started = time.time()
    last_report = 0.0
    min_sample = max(10.0, min(60.0, duration * 0.02))

    def fmt(seconds):
        seconds = int(max(0, seconds))
        if seconds >= 3600:
            return f"{seconds // 3600}h {(seconds % 3600) // 60}m"
        if seconds >= 60:
            return f"{seconds // 60}m {seconds % 60}s"
        return f"{seconds}s"

    def report(done, final=False):
        nonlocal last_report
        frac = max(0.0, min(1.0, done / max(duration, 0.01)))
        stage_cb("transcribing", 0.35 + 0.30 * frac)
        now = time.time()
        if final or (done >= min_sample and now - started >= 30 and now - last_report >= 30):
            elapsed = now - started
            eta = (elapsed / done) * (duration - done) if done > 0 else 0
            db.log(
                job_id,
                f"Transcribing {done / 60:.1f}/{duration / 60:.1f} min "
                f"({frac * 100:.0f}%) — elapsed {fmt(elapsed)} · "
                f"ETA {fmt(eta) if done >= min_sample else 'estimating'}",
            )
            last_report = now

    def collect(model, gpu_mode):
        if gpu_mode:
            if duration >= 600:
                db.log(job_id, "Long audio — using GPU batched Whisper (beam 5, batch 8)")
                try:
                    from faster_whisper import BatchedInferencePipeline

                    segments_iter, _ = BatchedInferencePipeline(model=model).transcribe(
                        audio,
                        language="en",
                        vad_filter=True,
                        word_timestamps=False,
                        without_timestamps=False,
                        batch_size=8,
                        beam_size=5,
                        best_of=5,
                        temperature=0.0,
                        condition_on_previous_text=False,
                    )
                except Exception as batch_error:
                    db.log(
                        job_id,
                        f"GPU batched Whisper failed ({batch_error}); using GPU standard transcription",
                        "warn",
                    )
                    segments_iter, _ = model.transcribe(
                        audio, language="en", vad_filter=True, word_timestamps=False
                    )
            else:
                # Short GPU jobs keep beam 5 for maximum accuracy.
                segments_iter, _ = model.transcribe(
                    audio, language="en", vad_filter=True, word_timestamps=False
                )
        elif duration >= 600:
            db.log(
                job_id,
                f"Long audio ({duration / 60:.0f} min) — using fast batched CPU Whisper "
                "(beam 1); GPU is off or unavailable",
            )
            try:
                from faster_whisper import BatchedInferencePipeline

                segments_iter, _ = BatchedInferencePipeline(model=model).transcribe(
                    audio,
                    language="en",
                    vad_filter=True,
                    word_timestamps=False,
                    without_timestamps=False,
                    batch_size=8,
                    beam_size=1,
                    best_of=1,
                    temperature=0.0,
                    condition_on_previous_text=False,
                )
            except Exception as batch_error:
                db.log(
                    job_id,
                    f"Batched CPU Whisper failed ({batch_error}); using standard CPU transcription",
                    "warn",
                )
                segments_iter, _ = model.transcribe(
                    audio,
                    language="en",
                    vad_filter=True,
                    word_timestamps=False,
                    beam_size=1,
                    best_of=1,
                    temperature=0.0,
                    condition_on_previous_text=False,
                )
        else:
            segments_iter, _ = model.transcribe(
                audio, language="en", vad_filter=True, word_timestamps=False
            )
        out = []
        for seg in segments_iter:
            if canceled():
                db.log(job_id, "Transcription canceled", "warn")
                return None
            text = seg.text.strip()
            if text:
                out.append({"start": round(seg.start, 2), "end": round(seg.end, 2), "text": text})
            report(float(seg.end))
        return out

    try:
        db.log(
            job_id,
            f"Transcribing {duration / 60:.1f} min on {'GPU' if use_gpu else 'CPU'} — "
            "progress and ETA updates every 30s",
        )
        raw = collect(model, use_gpu)
    except Exception as gpu_error:
        if use_gpu:
            db.log(job_id, f"GPU transcription failed ({gpu_error}); falling back to CPU", "warn")
            use_gpu = False
            model = model_for("cpu", "int8")
            raw = collect(model, False)
        else:
            raise
    if raw is None:
        return None
    report(duration, final=True)
    segments = _normalize(raw)
    if segments:
        _save_cache(job_id, user_id, "whisper", segments, tag=tag)
    db.log(job_id, f"Transcribed {len(segments)} segments")
    stage_cb("transcribing", 0.65)
    return segments
