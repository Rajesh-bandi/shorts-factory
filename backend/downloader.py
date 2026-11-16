"""Fast media acquisition.

Analysis uses metadata and captions first. Video is only downloaded when a
clip is rendered, and then only the selected sections. A full source download
remains as a fallback for sources where section extraction is unsupported.
"""
import glob
import os
import shutil
import subprocess
import sys
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


def user_media_dir(user_id):
    """Every account gets a private media directory."""
    path = os.path.join(MEDIA_DIR, str(int(user_id)))
    os.makedirs(path, exist_ok=True)
    return path


def existing_source(job_id, user_id):
    """Return a completed full source video for a job, if one is already on disk."""
    directory = user_media_dir(user_id)
    paths = [
        p
        for p in glob.glob(os.path.join(directory, f"job{job_id}_source.*"))
        if p.lower().endswith(SOURCE_EXTS)
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
    opts = {
        "skip_download": True,
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "socket_timeout": timeout,
    }
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=False)
    if not info:
        raise RuntimeError("YouTube returned no video information")
    return info


def probe_public(url: str):
    return _clean_info(probe(url))


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

    opts = {
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
    }
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
                try:
                    os.killpg(os.getpgid(proc.pid), 15)
                except (OSError, ProcessLookupError):
                    proc.terminate()
                break
            if time.monotonic() - started > timeout:
                try:
                    os.killpg(os.getpgid(proc.pid), 9)
                except (OSError, ProcessLookupError):
                    proc.kill()
                raise RuntimeError("yt-dlp timed out")
            time.sleep(0.25)
        _, stderr = proc.communicate()
    finally:
        if proc.poll() is None:
            try:
                os.killpg(os.getpgid(proc.pid), 9)
            except (OSError, ProcessLookupError):
                proc.kill()
    if canceled:
        raise RuntimeError("canceled")
    if proc.returncode != 0:
        tail = (stderr or "").strip().splitlines()[-4:]
        raise RuntimeError("yt-dlp failed: " + (" | ".join(tail) or "unknown error"))
    return stderr or ""


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
