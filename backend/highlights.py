"""Stage 3 — pick highlight moments.

Primary: OpenAI-compatible LLM over the transcript.
Fallback: audio-energy heuristic (no transcript needed).
"""
import json
import math
import re
import subprocess

from . import db, settings


def _window_text(segments, start, end):
    return " ".join(s["text"] for s in segments if s["end"] > start and s["start"] < end)


def _llm_chat(user_id, messages, timeout=120):
    import requests

    cfg = settings.llm_config(user_id)
    url = cfg["base_url"].rstrip("/") + "/chat/completions"
    resp = requests.post(
        url,
        headers={"Authorization": f"Bearer {cfg['api_key']}"},
        json={"model": cfg["model"], "messages": messages, "temperature": 0.4},
        timeout=timeout,
    )
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]


def _parse_llm_json(text):
    # strip code fences / find first json array
    m = re.search(r"\[.*\]", text, re.DOTALL)
    if not m:
        return []
    try:
        return json.loads(m.group(0))
    except json.JSONDecodeError:
        return []


def _pick_chunked(title, duration, segments, count, job_id, user_id, target=45):
    """Map-reduce AI selection over overlapping transcript windows."""
    window = 600.0
    step = 540.0
    pool = []
    cursor = 0.0
    chunks = 0
    while cursor < duration:
        end = min(float(duration), cursor + window)
        chunk_lines = [
            f"[{int(s['start'])}-{int(s['end'])}] {s['text']}"
            for s in segments if s["end"] > cursor and s["start"] < end
        ]
        if chunk_lines:
            chunks += 1
            prompt = f"""You are picking YouTube Shorts moments from one section of a long video.

Video title: {title}
Full duration: {int(duration)} seconds
This section: {int(cursor)}-{int(end)} seconds

Timed transcript for this section:
{chr(10).join(chunk_lines)}

Return the up to {max(1, count)} strongest self-contained moments from THIS SECTION ONLY.
Rubric: a strong first-second hook, enough context without watching earlier, a clear payoff/reaction, emotional or informational density, and no dead air.
Each clip should be about {int(target)} seconds, between {int(target * 0.6)} and {int(target * 1.4)} seconds, and must lie inside this section.

Reply with ONLY a JSON array:
[{{"start": <seconds>, "end": <seconds>, "title": "<punchy 3-6 word title>", "reason": "<one line hook/payoff>"}}]"""
            try:
                text = _llm_chat(user_id, [{"role": "user", "content": prompt}], timeout=150)
            except Exception as e:
                db.log(job_id, f"LLM chunk {int(cursor)}s failed: {e}", "warn")
                continue
            for p in _parse_llm_json(text):
                try:
                    start = max(0.0, float(p["start"]))
                    end = min(float(duration), float(p["end"]))
                except (KeyError, TypeError, ValueError):
                    continue
                if end <= start + 4 or end < cursor or start > end:
                    continue
                if start < cursor - 1 or start > end + 1:
                    continue
                pool.append({
                    "start": round(start, 2),
                    "end": round(end, 2),
                    "title": str(p.get("title") or "Highlight")[:80],
                    "reason": str(p.get("reason") or "AI-selected moment")[:200],
                    "transcript": _window_text(segments, start, end)[:500],
                    "score": None,
                })
        if end >= duration:
            break
        cursor += step

    def score(item):
        text = (item.get("title", "") + " " + item.get("reason", "") + " " + item.get("transcript", "")).lower()
        hooks = sum(1 for word in HOOK_WORDS if word in text)
        length = item["end"] - item["start"]
        fit = 1.0 - min(1.0, abs(length - target) / max(target, 1))
        words = len(item.get("transcript", "").split())
        return hooks * 2.0 + fit + min(1.5, words / 60.0)

    pool.sort(key=score, reverse=True)
    chosen = []
    for item in pool:
        if any(not (item["end"] <= c["start"] or item["start"] >= c["end"]) for c in chosen):
            continue
        chosen.append(item)
        if len(chosen) >= count:
            break

    if len(chosen) < count:
        extra = pick_transcript_heuristic(segments, duration, count, job_id, target)
        for item in extra:
            if any(not (item["end"] <= c["start"] or item["start"] >= c["end"]) for c in chosen):
                continue
            chosen.append(item)
            if len(chosen) >= count:
                break

    db.log(job_id, f"Map-reduced {chunks} transcript windows into {len(pool)} candidates")
    return chosen[:count]


def pick_llm(video_path, title, duration, segments, count, job_id, user_id, target=45):
    """Ask an OpenAI-compatible model to choose highlight windows.

    Long transcripts are processed in overlapping windows and merged locally,
    so the end of a two-hour video is not silently dropped by a prompt cap.
    """
    target = int(target or 45)
    # compact transcript: ~1 line per 20s window to keep prompt small
    lines = []
    for seg in segments:
        lines.append(f"[{int(seg['start'])}-{int(seg['end'])}] {seg['text']}")
    transcript = "\n".join(lines)
    if len(transcript) > 60000:
        return _pick_chunked(
            title, duration, segments, count, job_id, user_id, target
        )
    max_chars = 90000
    if len(transcript) > max_chars:
        step = math.ceil(len(lines) / (max_chars // 120))
        transcript = "\n".join(lines[::step])

    prompt = f"""You pick the most viral short-form clips from a long YouTube video.

Video title: {title}
Duration: {int(duration)} seconds

Transcript with [start-end] second timestamps:
{transcript}

Select the {count} best moments for YouTube Shorts:
- target duration: about {target} seconds per clip
- peak action, funny chaos, fails, clutch plays, wild reactions
- must be self-contained (a viewer who sees only this clip understands it)
- each clip {int(target * 0.6)}-{int(target * 1.4)} seconds long
- clips must not overlap

Reply with ONLY a JSON array, no other text:
[{{"start": <seconds>, "end": <seconds>, "title": "<punchy 3-6 word title>", "reason": "<one line why this will get views>"}}]"""

    db.log(job_id, f"Asking LLM ({settings.llm_config(user_id)['model']}) to pick highlights…")
    text = _llm_chat(user_id, [{"role": "user", "content": prompt}])
    picks = _parse_llm_json(text)
    if not picks:
        clean = re.sub(r"\s+", " ", text).strip()
        db.log(job_id, f"LLM reply wasn't a highlight array: {clean[:180]}", "warn")

    out = []
    for p in picks[:count]:
        try:
            s, e = float(p["start"]), float(p["end"])
        except (KeyError, TypeError, ValueError):
            continue
        if e <= s:
            continue
        out.append(
            {
                "start": max(0, s),
                "end": min(duration, e),
                "title": str(p.get("title", ""))[:80],
                "reason": str(p.get("reason", ""))[:200],
                "transcript": _window_text(segments, s, e)[:500],
                "score": None,
            }
        )
    return out


def _audio_energy(video_path, sample_sec=1.0):
    """Decode audio to mono pcm and compute RMS per second window."""
    cmd = [
        "ffmpeg", "-v", "quiet", "-i", video_path,
        "-ac", "1", "-ar", "8000", "-f", "s16le", "-",
    ]
    raw = subprocess.run(cmd, capture_output=True, check=True).stdout
    import numpy as np

    samples = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    win = int(8000 * sample_sec)
    n = len(samples) // win
    if n == 0:
        return []
    energy = np.sqrt((samples[: n * win].reshape(n, win) ** 2).mean(axis=1))
    return energy.tolist()


def pick_heuristic(video_path, duration, count, job_id, target=45):
    """Audio-energy based highlight detection (works without LLM/Whisper)."""
    target = int(target or 45)
    db.log(job_id, "Scanning audio energy for highlight candidates…")
    energy = _audio_energy(video_path)
    if not energy:
        return []

    want = max(1, int(count or 1))
    clip_len = max(5, int(target))
    best_spans = []
    used = []

    # sliding window sum, greedily pick highest energy non-overlapping windows
    sums = []
    for i in range(0, len(energy) - clip_len):
        window = energy[i : i + clip_len]
        sums.append((float(sum(window) / len(window)), i))
    sums.sort(reverse=True)

    for val, i in sums[: 200]:
        s, e = i, i + clip_len
        if any(not (e <= us or s >= ue) for us, ue in used):
            continue
        used.append((s, e))
        best_spans.append((val, s, e))
        if len(best_spans) >= want:
            break

    out = []
    for rank, (val, s, e) in enumerate(sorted(best_spans, reverse=True), 1):
        out.append(
            {
                "start": s,
                "end": e,
                "title": f"Highlight #{rank}",
                "reason": f"High audio energy (intensity spike) — score {val:.3f}",
                "transcript": "",
                "score": round(val, 4),
            }
        )
    return out


HOOK_WORDS = (
    "secret", "insane", "crazy", "wild", "never", "best", "worst", "fail",
    "clutch", "unbelievable", "actually", "why", "how", "mistake", "truth",
    "shocking", "finally", "destroyed", "record", "fastest", "huge", "free",
    "warning", "stop", "look", "watch", "happened", "problem", "trick",
)


def pick_transcript_heuristic(segments, duration, count, job_id, target=45):
    """Pick strong transcript windows without downloading video or audio."""
    target = max(8, int(target or 45))
    duration = max(1.0, float(duration or (segments[-1]["end"] if segments else 1)))
    if not segments:
        return []
    db.log(job_id, "Picking highlight windows from the timed transcript (no video download)")

    def score_text(text):
        lower = text.lower()
        words = re.findall(r"[a-z']+", lower)
        if not words:
            return 0.0
        hooks = sum(2.5 for word in words if word in HOOK_WORDS)
        punch = lower.count("!") * 0.8 + lower.count("?") * 0.7
        density = min(1.5, len(words) / max(1.0, len(text) / 5.0))
        return hooks + punch + density + min(1.0, len(words) / 36.0)

    def window(start, length):
        end = min(duration, start + length)
        chunks = [s for s in segments if s["end"] > start and s["start"] < end]
        if not chunks:
            return None
        text = " ".join(s["text"] for s in chunks).strip()
        if len(text) < 24:
            return None
        # Prefer windows that begin and end near spoken segment boundaries.
        snapped_start = max(start, chunks[0]["start"])
        snapped_end = min(end, chunks[-1]["end"])
        if snapped_end <= snapped_start + 4:
            return None
        score = score_text(text) + min(2.0, len(text) / 220.0)
        return {"start": round(snapped_start, 2), "end": round(snapped_end, 2),
                "text": text, "score": round(score, 4)}

    parts = max(1, min(5, int(count)))
    length = target

    starts = []
    last = -1e9
    for seg in segments:
        if seg["start"] - last >= max(2.0, length * 0.25):
            starts.append(seg["start"])
            last = seg["start"]
    if not starts:
        starts = [segments[0]["start"]]

    ranked = []
    for start in starts:
        if start > duration - max(5.0, length * 0.4):
            continue
        item = window(start, length)
        if item:
            ranked.append(item)
    ranked.sort(key=lambda item: item["score"], reverse=True)

    chosen = []
    for item in ranked:
        if any(not (item["end"] <= c["start"] or item["start"] >= c["end"]) for c in chosen):
            continue
        chosen.append(item)
        if len(chosen) >= parts:
            break
    if not chosen:
        return []

    out = []
    for rank, item in enumerate(sorted(chosen, key=lambda c: c["score"], reverse=True), 1):
        words = item["text"].split()[:6]
        out.append({
            "start": item["start"], "end": item["end"],
            "title": " ".join(words).strip(".,!?") or f"Highlight #{rank}",
            "reason": "Strong spoken hook picked from the timed transcript",
            "transcript": item["text"][:500], "score": item["score"],
        })
    return out


def pick_highlights(video_path, title, duration, segments, count, job_id, user_id, target=45):
    """Try AI first, then transcript heuristics, then audio energy."""
    if settings.llm_available(user_id) and segments:
        try:
            picks = pick_llm(video_path, title, duration, segments, count, job_id, user_id, target)
            if picks:
                return picks
            db.log(job_id, "LLM returned no usable highlights — using transcript heuristics", "warn")
        except Exception as e:
            db.log(job_id, f"LLM highlight pick failed ({e}) — using transcript heuristics", "warn")
    if segments:
        picks = pick_transcript_heuristic(segments, duration, count, job_id, target)
        if picks:
            return picks
    if video_path:
        return pick_heuristic(video_path, duration, count, job_id, target)
    return []
