"""Fast media acquisition.

Analysis uses metadata and captions first. Video is only downloaded when a
clip is rendered, and then only the selected sections. A full source download
remains as a fallback for sources where section extraction is unsupported.
"""
import glob
import os
import signal
import shutil
import subprocess
import sys
import tempfile
import time
from urllib.parse import urlparse

import yt_dlp

from . import config, db

DATA_DIR = str(config.DATA_DIR)
MEDIA_DIR = str(config.MEDIA_DIR)
SOURCE_EXTS = (".mp4", ".mkv", ".webm", ".mov", ".m4v")
AUDIO_EXTS = (".m4a", ".opus", ".webm", ".mp3", ".ogg", ".wav")
PARTIAL_EXTS = (".part", ".ytdl", ".temp")

# Prefer streams that can be merged without a second video encode.
VIDEO_FORMAT = (
    "bv*[height<=1080][ext=mp4][vcodec^=avc1]+ba[ext=m4a]/"
    "b[height<=1080][ext=mp4]/"
    "bv*[height<=1080]+ba/b"
)
AUDIO_FORMAT = "ba[ext=m4a]/ba/b"


def ytdlp_command():
    """Locate the yt-dlp runner for both normal Python and frozen desktop builds."""
    override = os.getenv("YTDLP_BIN", "").strip()
    candidates = [override] if override else []
    here = os.path.dirname(os.path.abspath(sys.executable))
    candidates.extend([
        os.path.join(here, "yt-dlp"),
        os.path.join(here, "yt-dlp.exe"),
        os.path.join(os.path.dirname(here), "bin", "yt-dlp"),
        os.path.join(os.path.dirname(here), "bin", "yt-dlp.exe"),
    ])
    for path in candidates:
        if path and os.path.isfile(path):
            return [path]
    found = shutil.which("yt-dlp")
    if found:
        return [found]
    return [sys.executable, "-m", "yt_dlp"]


def _writable_cookies():
    """Return a writable copy of YTDLP_COOKIES_FILE, or "".

    yt-dlp saves its cookie jar when it closes, so pointing it at a read-only
    secrets mount fails *after* a successful extraction. Keep a refreshed copy
    in the container's temp dir; the source is only re-read when it changes.
    """
    source = os.getenv("YTDLP_COOKIES_FILE", "").strip()
    if not source or not os.path.isfile(source):
        return ""
    target = os.path.join(tempfile.gettempdir(), "shorts-youtube-cookies.txt")
    try:
        if (not os.path.exists(target)
                or os.path.getmtime(target) < os.path.getmtime(source)):
            fd, temp_path = tempfile.mkstemp(
                prefix="shorts-cookies-", suffix=".txt",
                dir=tempfile.gettempdir(),
            )
            os.close(fd)
            shutil.copyfile(source, temp_path)
            os.chmod(temp_path, 0o600)
            os.replace(temp_path, target)
    except OSError:
        return source
    return target


def ytdlp_common_args():
    """Shared auth and networking flags for every yt-dlp subprocess.

    YouTube blocks many datacenter IPs with "Sign in to confirm you're not a
    bot". Point YTDLP_COOKIES_FILE at a Netscape-format cookies.txt exported
    from a signed-in browser to authenticate. YTDLP_PROXY optionally routes
    yt-dlp through an HTTP/SOCKS proxy.
    """
    args = []
    cookies = _writable_cookies()
    if cookies:
        args += ["--cookies", cookies]
    proxy = os.getenv("YTDLP_PROXY", "").strip()
    if proxy:
        args += ["--proxy", proxy]
    return args


def ytdlp_common_opts(opts=None):
    """Apply cookies/proxy to a yt-dlp Python API options dict."""
    opts = dict(opts or {})
    cookies = _writable_cookies()
    if cookies:
        opts["cookiefile"] = cookies
    proxy = os.getenv("YTDLP_PROXY", "").strip()
    if proxy:
        opts["proxy"] = proxy
    return opts


def user_media_dir(user_id):
    """Every account gets a private media directory."""
    path = os.path.join(MEDIA_DIR, str(int(user_id)))
    os.makedirs(path, exist_ok=True)
    return path


def existing_source(job_id, user_id):
    """Return a completed full source video for a job, if one is already on disk."""
    directory = user_media_dir(user_id)
    patterns = (
        os.path.join(directory, f"job{job_id}_source.*"),
        os.path.join(directory, f"job{job_id}_live.*"),
    )
    paths = [
        p
        for pattern in patterns
        for p in glob.glob(pattern)
        if p.lower().endswith(SOURCE_EXTS)
        and not p.lower().endswith(PARTIAL_EXTS)
        and os.path.isfile(p)
        and os.path.getsize(p) > 1024
    ]
    return max(paths, key=os.path.getsize) if paths else None


def _media_files(prefix):
    return [
        p
        for p in glob.glob(prefix + ".*")
        if os.path.isfile(p)
        and os.path.getsize(p) > 1024
        and not p.lower().endswith(PARTIAL_EXTS)
    ]


def _pick_media(prefix, extensions):
    files = [p for p in _media_files(prefix) if p.lower().endswith(extensions)]
    return max(files, key=os.path.getsize) if files else None


def probe_duration(path):
    """Read a media file's duration with ffprobe; 0.0 means unreadable."""
    try:
        proc = subprocess.run(
            [
                "ffprobe", "-v", "error", "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1", path,
            ],
            capture_output=True,
            text=True,
            timeout=30,
        )
        if proc.returncode != 0:
            return 0.0
        return float((proc.stdout or "").strip() or 0)
    except (OSError, ValueError, subprocess.SubprocessError):
        return 0.0


def _clean_info(info):
    return {
        "title": info.get("title") or "video",
        "duration": float(info.get("duration") or 0),
        "channel": info.get("uploader") or info.get("channel") or "",
        "id": info.get("id") or "",
        "webpage_url": info.get("webpage_url") or "",
        "thumbnail": info.get("thumbnail") or "",
    }


def probe(url: str, timeout: int = 45):
    """Fetch title/duration/caption tracks without downloading the video."""
    opts = ytdlp_common_opts({
        "skip_download": True,
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "socket_timeout": timeout,
    })
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=False)
    if not info:
        raise RuntimeError("YouTube returned no video information")
    return info


def probe_public(url: str):
    return _clean_info(probe(url))


def is_live_info(info) -> bool:
    """True while yt-dlp reports the source as an active live stream."""
    status = str((info or {}).get("live_status") or "").lower()
    return bool((info or {}).get("is_live")) or status in ("is_live", "is_live_starting")


def _env_seconds(name, default, low, high):
    try:
        value = int(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        value = default
    return max(low, min(high, value))


def live_chat_scan_seconds() -> int:
    """How long to watch chat for the first spike before giving up."""
    return _env_seconds("LIVE_CHAT_SCAN_SECONDS", 300, 30, 1800)


def live_spike_pad_seconds() -> int:
    """How much video to record before and after every chat spike."""
    return _env_seconds("LIVE_SPIKE_PAD_SECONDS", 300, 30, 900)


def live_max_capture_seconds() -> int:
    """Hard cap for a live capture, even when chat keeps spiking."""
    return _env_seconds("LIVE_MAX_CAPTURE_SECONDS", 1800, 120, 7200)


def live_record_stall_seconds() -> int:
    """Abort a live recording when ffmpeg writes nothing for this long."""
    return _env_seconds("LIVE_RECORD_STALL_SECONDS", 120, 60, 600)


def _progress_hook(job_id, stage_cb, cancel_cb=None):
    def hook(d):
        if cancel_cb and cancel_cb():
            raise RuntimeError("canceled")
        if d["status"] == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            done = d.get("downloaded_bytes") or 0
            if total:
                stage_cb("downloading", 0.02 + 0.28 * (done / total))
        elif d["status"] == "finished":
            stage_cb("downloading", 0.30)
    return hook


def download(url: str, job_id: int, user_id: int, stage_cb, cancel_cb=None):
    """Download a full source video. Used only as a fallback or for old jobs."""
    directory = user_media_dir(user_id)
    db.log(job_id, f"Downloading full source: {url}")
    stage_cb("downloading", 0.02)

    def _log(event):
        if isinstance(event, dict):
            name = event.get("postprocessor") or "Post-processing"
            status = event.get("status")
            if status == "started":
                db.log(job_id, f"{name} started…")
            elif status == "finished":
                db.log(job_id, f"{name} finished")
            return
        db.log(job_id, str(event))

    opts = ytdlp_common_opts({
        "outtmpl": os.path.join(directory, f"job{job_id}_source.%(ext)s"),
        "format": VIDEO_FORMAT,
        "merge_output_format": "mp4",
        "restrictfilenames": True,
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "concurrent_fragment_downloads": 8,
        "retries": 3,
        "fragment_retries": 5,
        "progress_hooks": [_progress_hook(job_id, stage_cb, cancel_cb)],
        "postprocessor_hooks": [_log],
    })
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=True)
        path = ydl.prepare_filename(info)
        if not os.path.exists(path):
            base, _ = os.path.splitext(path)
            path = base + ".mp4"
    if not os.path.exists(path):
        raise RuntimeError("Download finished but the source video was not found")
    db.log(job_id, f"Downloaded: {info.get('title')} ({info.get('duration', 0)}s)")
    return {
        "path": path,
        "title": info.get("title") or "video",
        "duration": info.get("duration") or 0,
        "channel": info.get("uploader") or "",
    }


def _stop_process(proc, force=False):
    """Stop a child process and its children on both POSIX and Windows."""
    if proc.poll() is not None:
        return
    try:
        if os.name == "nt":
            subprocess.run(
                ["taskkill", "/pid", str(proc.pid), "/T", "/F"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=15,
                check=False,
            )
        else:
            os.killpg(os.getpgid(proc.pid), signal.SIGKILL if force else signal.SIGTERM)
    except (OSError, ProcessLookupError, subprocess.SubprocessError):
        try:
            if force:
                proc.kill()
            else:
                proc.terminate()
        except OSError:
            pass


def _run_ytdlp(cmd, cancel_cb=None, timeout=1800):
    """Run yt-dlp and allow a render cancel to stop it immediately."""
    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        start_new_session=True,
    )
    started = time.monotonic()
    canceled = False
    try:
        while proc.poll() is None:
            if cancel_cb and cancel_cb():
                canceled = True
                _stop_process(proc, force=True)
                break
            if time.monotonic() - started > timeout:
                _stop_process(proc, force=True)
                raise RuntimeError("yt-dlp timed out")
            time.sleep(0.25)
        stdout, stderr = proc.communicate()
    finally:
        if proc.poll() is None:
            _stop_process(proc, force=True)
    if canceled:
        raise RuntimeError("canceled")
    if proc.returncode != 0:
        tail = (stderr or "").strip().splitlines()[-4:]
        raise RuntimeError("yt-dlp failed: " + (" | ".join(tail) or "unknown error"))
    return stdout or "", stderr or ""


def resolve_stream_urls(url):
    """Resolve the direct video/audio URLs for an active live stream."""
    cmd = [
        *ytdlp_command(),
        *ytdlp_common_args(),
        "--no-playlist", "--no-warnings", "--get-url",
        "--format", VIDEO_FORMAT,
        url,
    ]
    stdout, _ = _run_ytdlp(cmd, timeout=120)
    urls = []
    for line in stdout.splitlines():
        value = line.strip()
        if value.startswith(("http://", "https://")) and value not in urls:
            urls.append(value)
    if not urls:
        raise RuntimeError("Could not resolve the live stream URL")
    return urls


def record_live(url, job_id, user_id, seconds, stage_cb, cancel_cb=None, urls=None, stop_cb=None):
    """Record a bounded live segment and stop as soon as chat windows are covered.

    ``stop_cb`` is polled while ffmpeg is running. When it returns True the
    recorder stops and keeps the partial file, which is why the muxer uses
    fragmented MP4: a killed ffmpeg still leaves a readable file.
    """
    if seconds is None:
        seconds = live_max_capture_seconds()
    try:
        seconds = int(seconds)
    except (TypeError, ValueError):
        seconds = live_max_capture_seconds()
    seconds = max(30, min(7200, seconds))
    directory = user_media_dir(user_id)
    path = os.path.join(directory, f"job{job_id}_live.mp4")
    if os.path.exists(path):
        duration = probe_duration(path)
        if duration > 1:
            db.log(job_id, f"Reusing live recording {os.path.basename(path)} ({duration:.0f}s)")
            stage_cb("recording", 0.30)
            return {"path": path, "duration": duration, "recorded": duration, "stopped": False}
        try:
            os.remove(path)
        except OSError:
            pass

    stream_urls = urls or resolve_stream_urls(url)
    if not stream_urls:
        raise RuntimeError("Could not resolve the live stream URL")
    db.log(job_id, f"Watching live chat and recording at most {seconds // 60}m {seconds % 60:02d}s…")
    stage_cb("recording", 0.08)
    tmp = os.path.join(directory, f"job{job_id}_live.part.mp4")
    log_path = os.path.join(directory, f"job{job_id}_live.log")
    try:
        os.remove(tmp)
    except OSError:
        pass

    cmd = ["ffmpeg", "-y", "-nostdin", "-loglevel", "error"]
    for stream_url in stream_urls:
        # A long capture should survive short HLS/network interruptions.
        cmd += [
            "-reconnect", "1", "-reconnect_streamed", "1",
            "-reconnect_delay_max", "5", "-i", stream_url,
        ]
    if len(stream_urls) >= 2:
        cmd += ["-map", "0:v:0?", "-map", "1:a:0?"]
    else:
        cmd += ["-map", "0:v:0?", "-map", "0:a:0?"]
    cmd += [
        "-t", str(seconds),
        "-c", "copy", "-bsf:a", "aac_adtstoasc",
        # Flush every packet so a hard stop still leaves a readable file.
        # Without this the fMP4 header/fragments can stay buffered and a
        # killed ffmpeg leaves a 28-byte file with no moov atom.
        "-flush_packets", "1",
        "-movflags", "+frag_keyframe+empty_moov+default_base_moof",
        "-avoid_negative_ts", "make_zero", tmp,
    ]

    log_handle = open(log_path, "w", encoding="utf-8", errors="replace")
    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.DEVNULL,
        stderr=log_handle,
        start_new_session=True,
    )
    started = time.monotonic()
    stall_seconds = live_record_stall_seconds()
    last_size = 0
    last_growth = started
    canceled = False
    stopped = False
    stalled = False
    try:
        while proc.poll() is None:
            if cancel_cb and cancel_cb():
                canceled = True
                _stop_process(proc, force=True)
                break
            if stop_cb:
                try:
                    if stop_cb():
                        stopped = True
                        _stop_process(proc, force=True)
                        break
                except Exception as exc:
                    db.log(job_id, f"Live stop check failed: {exc}", "warn")
            now = time.monotonic()
            try:
                size = os.path.getsize(tmp)
            except OSError:
                size = 0
            if size > last_size:
                last_size = size
                last_growth = now
            elif now - last_growth >= stall_seconds:
                stalled = True
                _stop_process(proc, force=True)
                break
            elapsed = now - started
            stage_cb("recording", min(0.29, 0.08 + 0.21 * min(1.0, elapsed / max(1, seconds))))
            time.sleep(0.5)
    except BaseException:
        _stop_process(proc, force=True)
        try:
            os.remove(tmp)
        except OSError:
            pass
        raise
    finally:
        if proc.poll() is None:
            _stop_process(proc, force=True)
        log_handle.close()

    if canceled:
        try:
            os.remove(tmp)
        except OSError:
            pass
        raise RuntimeError("canceled")

    if stalled:
        tail = ""
        try:
            with open(log_path, encoding="utf-8", errors="replace") as handle:
                tail = " | ".join(handle.read().strip().splitlines()[-3:])
        except OSError:
            pass
        try:
            os.remove(tmp)
        except OSError:
            pass
        raise RuntimeError(
            f"ffmpeg wrote no live video or audio for {stall_seconds}s; "
            "the stream may have ended or be blocking this server"
            + (f": {tail[:300]}" if tail else "")
        )

    duration = probe_duration(tmp)
    valid = os.path.exists(tmp) and os.path.getsize(tmp) > 1024 and duration > 1
    if not valid:
        tail = ""
        try:
            with open(log_path, encoding="utf-8", errors="replace") as handle:
                tail = " | ".join(handle.read().strip().splitlines()[-3:])
        except OSError:
            pass
        try:
            os.remove(tmp)
        except OSError:
            pass
        raise RuntimeError(
            "ffmpeg could not record this live stream"
            + (f": {tail[:300]}" if tail else "")
        )
    os.replace(tmp, path)
    try:
        os.remove(log_path)
    except OSError:
        pass
    stage_cb("recording", 0.30)
    suffix = " (spike windows covered)" if stopped else ""
    db.log(job_id, f"Recorded {duration:.0f}s of live video{suffix}")
    return {"path": path, "duration": duration, "recorded": duration, "stopped": stopped}


def trim_local(source, job_id, start, end, user_id, tag="0"):
    """Cut a section from an already-downloaded source without re-encoding."""
    start = max(0.0, float(start))
    end = float(end)
    if end <= start + 0.2:
        raise RuntimeError("Section end must be after its start")
    prefix = _section_prefix(job_id, start, end, str(tag), user_id)
    existing = _pick_media(prefix, SOURCE_EXTS)
    if existing:
        cached_duration = probe_duration(existing)
        if cached_duration > 0.2:
            db.log(job_id, f"Reusing local section {os.path.basename(existing)} ({cached_duration:.1f}s)")
            return {"path": existing, "start": start, "end": end, "duration": cached_duration}
        try:
            os.remove(existing)
        except OSError:
            pass
    if not source or not os.path.exists(source):
        raise RuntimeError("The local source file is missing")
    db.log(job_id, f"Trimming local section {start:.1f}s–{end:.1f}s…")
    cmd = [
        "ffmpeg", "-y", "-nostdin", "-loglevel", "error",
        "-ss", f"{start:.3f}", "-i", source,
        "-t", f"{max(0.2, end - start):.3f}",
        "-map", "0:v:0?", "-map", "0:a:0?",
        "-c", "copy", "-avoid_negative_ts", "make_zero",
        prefix + ".mp4",
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=900)
    path = _pick_media(prefix, SOURCE_EXTS)
    if proc.returncode != 0 or not path:
        tail = (proc.stderr or "").strip().splitlines()[-3:]
        raise RuntimeError("ffmpeg could not cut the local section: " + (" | ".join(tail) or "unknown error"))
    duration = probe_duration(path)
    if duration <= 0.2:
        raise RuntimeError("The local section is unreadable")
    db.log(job_id, f"Local section ready ({duration:.1f}s)")
    return {"path": path, "start": start, "end": end, "duration": duration}


def _section_prefix(job_id, start, end, tag, user_id):
    return os.path.join(
        user_media_dir(user_id),
        f"job{job_id}_sec_{int(round(start * 1000))}_{int(round(end * 1000))}_{tag}",
    )


def download_section(url, job_id, start, end, user_id, tag="0", max_height=1080, cancel_cb=None):
    """Download exactly one short range from a source URL.

    The resulting file starts at 0 locally. yt-dlp asks ffmpeg to force
    keyframes at the cut, which keeps the downloaded range accurate enough to
    burn captions without drift. Lower heights are used for fast review proxies.
    """
    start = max(0.0, float(start))
    end = float(end)
    if end <= start + 0.2:
        raise RuntimeError("Section end must be after its start")
    prefix = _section_prefix(job_id, start, end, str(tag), user_id)
    existing = _pick_media(prefix, SOURCE_EXTS)
    if existing:
        cached_duration = probe_duration(existing)
        if cached_duration > 0.2:
            db.log(job_id, f"Reusing downloaded section {os.path.basename(existing)} ({cached_duration:.1f}s)")
            return {"path": existing, "start": start, "end": end, "duration": cached_duration}
        try:
            os.remove(existing)
        except OSError:
            pass
    db.log(job_id, f"Downloading selected section {start:.1f}s–{end:.1f}s…")
    height = max(240, min(1080, int(max_height or 1080)))
    video_format = (
        f"bv*[height<={height}][ext=mp4][vcodec^=avc1]+ba[ext=m4a]/"
        f"b[height<={height}][ext=mp4]/bv*[height<={height}]+ba/b"
    )
    cmd = [
        *ytdlp_command(),
        *ytdlp_common_args(),
        "--no-playlist", "--no-warnings", "--newline",
        "--format", video_format,
        "--merge-output-format", "mp4",
        "--download-sections", f"*{start:.3f}-{end:.3f}",
        "--force-keyframes-at-cuts",
        "--retries", "3",
        "--fragment-retries", "5",
        "--concurrent-fragments", "8",
        "--output", prefix + ".%(ext)s",
        url,
    ]
    _run_ytdlp(cmd, cancel_cb=cancel_cb)
    path = _pick_media(prefix, SOURCE_EXTS)
    if not path:
        raise RuntimeError("Section download produced no video file")
    duration = probe_duration(path)
    if duration <= 0.2:
        raise RuntimeError("Section download produced an unreadable video")
    db.log(job_id, f"Downloaded section {os.path.basename(path)} ({duration:.1f}s)")
    return {"path": path, "start": start, "end": end, "duration": duration}


def download_audio(url, job_id, user_id, cancel_cb=None):
    """Fetch only the audio stream for local Whisper/energy analysis."""
    prefix = os.path.join(user_media_dir(user_id), f"job{job_id}_audio")
    existing = _pick_media(prefix, AUDIO_EXTS)
    if existing:
        db.log(job_id, f"Reusing downloaded audio: {os.path.basename(existing)}")
        return existing
    db.log(job_id, "No English captions — downloading audio only for local analysis…")
    cmd = [
        *ytdlp_command(),
        *ytdlp_common_args(),
        "--no-playlist", "--no-warnings", "--newline",
        "--format", AUDIO_FORMAT,
        "--retries", "3",
        "--fragment-retries", "5",
        "--concurrent-fragments", "8",
        "--output", prefix + ".%(ext)s",
        url,
    ]
    _run_ytdlp(cmd, cancel_cb=cancel_cb)
    path = _pick_media(prefix, AUDIO_EXTS)
    if not path:
        raise RuntimeError("Audio download produced no audio file")
    db.log(job_id, f"Downloaded audio: {os.path.basename(path)}")
    return path


def source_url_is_youtube(url):
    host = (urlparse(url).hostname or "").lower()
    return "youtube.com" in host or "youtu.be" in host


def job_media_files(user_id, job_id):
    return glob.glob(os.path.join(user_media_dir(user_id), f"job{job_id}_*"))
