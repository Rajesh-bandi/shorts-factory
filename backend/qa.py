"""Lightweight pre-upload QA for rendered clips."""
import json
import os
import re
import subprocess


def _probe(path):
    try:
        proc = subprocess.run(
            [
                "ffprobe", "-v", "error", "-show_streams", "-show_format",
                "-of", "json", path,
            ],
            capture_output=True,
            text=True,
            timeout=45,
        )
        if proc.returncode != 0:
            return {}
        return json.loads(proc.stdout or "{}")
    except (OSError, ValueError, subprocess.SubprocessError):
        return {}


def _volume(path):
    try:
        proc = subprocess.run(
            ["ffmpeg", "-hide_banner", "-nostdin", "-i", path, "-af", "volumedetect", "-f", "null", "-"],
            capture_output=True,
            text=True,
            timeout=90,
        )
        text = (proc.stderr or "") + (proc.stdout or "")
        mean = re.search(r"mean_volume:\s*(-?[\d.]+) dB", text)
        peak = re.search(r"max_volume:\s*(-?[\d.]+) dB", text)
        return (
            float(mean.group(1)) if mean else None,
            float(peak.group(1)) if peak else None,
        )
    except (OSError, ValueError, subprocess.SubprocessError):
        return None, None


def check_clip(path):
    checks = {
        "exists": bool(path and os.path.isfile(path) and os.path.getsize(path) > 1024),
        "duration": False,
        "aspect": False,
        "audio": False,
        "loudness": False,
        "no_clipping": False,
    }
    details = {}
    if not checks["exists"]:
        return {"status": "failed", "checks": checks, "details": {"error": "missing or empty file"}}

    info = _probe(path)
    streams = info.get("streams") or []
    video = next((s for s in streams if s.get("codec_type") == "video"), {})
    audio = next((s for s in streams if s.get("codec_type") == "audio"), None)
    try:
        width = int(video.get("width") or 0)
        height = int(video.get("height") or 0)
        duration = float((info.get("format") or {}).get("duration") or video.get("duration") or 0)
    except (TypeError, ValueError):
        width = height = 0
        duration = 0.0
    details.update({"width": width, "height": height, "duration": round(duration, 2), "audio": bool(audio)})
    checks["duration"] = 1.0 <= duration <= 181.0
    checks["aspect"] = bool(width and height and abs((width / height) - (9 / 16)) < 0.02)
    checks["audio"] = bool(audio)
    mean, peak = _volume(path)
    details["mean_volume_db"] = mean
    details["max_volume_db"] = peak
    if mean is None:
        checks["loudness"] = not audio  # silent files are allowed, but not unreadable audio
        checks["no_clipping"] = True
    else:
        checks["loudness"] = mean > -45.0
        checks["no_clipping"] = peak is None or peak < -0.1

    failed = [k for k in ("exists", "duration", "aspect") if not checks[k]]
    warnings = [k for k in ("audio", "loudness", "no_clipping") if not checks[k]]
    status = "failed" if failed else ("warning" if warnings else "pass")
    return {"status": status, "checks": checks, "details": details, "failed": failed, "warnings": warnings}
