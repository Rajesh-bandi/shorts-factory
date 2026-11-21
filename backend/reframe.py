"""Subject-aware 16:9 → 9:16 crop planning.

The final encode still runs in ffmpeg. This module only decides *where* the
vertical window should sit. It samples a short section at 2 fps, runs a small
Haar face detector when OpenCV is available, and returns one stable crop
fraction for the whole clip.

A stable static crop is intentional: per-frame tracking on a CPU-only box
produces jitter and costs more than it is worth. If no usable face is found
(gaming, screen share, wide shot), the plan falls back to the centre crop.
"""
import os
import statistics
import subprocess

from . import db


def _probe(path):
    try:
        proc = subprocess.run(
            [
                "ffprobe", "-v", "error", "-select_streams", "v:0",
                "-show_entries", "stream=width,height,duration",
                "-of", "default=noprint_wrappers=1:nokey=1", path,
            ],
            capture_output=True,
            text=True,
            timeout=30,
        )
        lines = [line.strip() for line in (proc.stdout or "").splitlines() if line.strip()]
        if proc.returncode != 0 or len(lines) < 2:
            return 0, 0
        return int(float(lines[0])), int(float(lines[1]))
    except (OSError, ValueError, subprocess.SubprocessError):
        return 0, 0


def _face_samples(path, start, duration, max_samples=240):
    """Return [(centre_x_fraction, face_width_fraction)] for a clip section."""
    try:
        import cv2
    except ImportError:
        return []
    cap = cv2.VideoCapture(path)
    if not cap or not cap.isOpened():
        return []
    try:
        fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
        step = max(1, int(round(fps * 0.5)))
        cap.set(cv2.CAP_PROP_POS_MSEC, max(0.0, float(start)) * 1000.0)
        cascade_path = os.path.join(cv2.data.haarcascades, "haarcascade_frontalface_default.xml")
        cascade = cv2.CascadeClassifier(cascade_path)
        if cascade.empty():
            return []
        samples = []
        frame_index = 0
        while len(samples) < max_samples:
            ok, frame = cap.read()
            if not ok:
                break
            frame_index += 1
            if frame_index % step:
                continue
            height, width = frame.shape[:2]
            if not width or not height:
                continue
            scale = 480.0 / width
            small = cv2.resize(frame, (480, max(1, int(height * scale))))
            gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
            faces = cascade.detectMultiScale(
                gray, scaleFactor=1.1, minNeighbors=5, minSize=(24, 24),
            )
            if len(faces) == 0:
                continue
            # Largest face is the best guess for the active speaker.
            x, y, w, h = max(faces, key=lambda box: box[2] * box[3])
            samples.append((float(x + w / 2) / small.shape[1], float(w) / small.shape[1]))
            if (frame_index / fps) >= float(duration):
                break
        return samples
    finally:
        cap.release()


def plan_crop(path, start, duration, target_ratio=9 / 16):
    """Return a stable crop plan for one clip.

    ``mode`` is ``face`` when a credible face was found, ``center`` when the
    frame is wide but no usable face exists, and ``none`` when the source is
    already vertical (the caller should use the blurred-background layout).
    """
    width, height = _probe(path)
    if not width or not height:
        return {"mode": "center", "frac": 0.5, "faces": 0, "source": "probe-failed"}
    if width / height <= target_ratio + 0.01:
        return {
            "mode": "none", "frac": 0.5, "faces": 0, "source": "vertical",
            "src_w": width, "src_h": height,
        }

    samples = _face_samples(path, start, duration)
    if len(samples) >= 3:
        widths = [item[1] for item in samples]
        median_width = statistics.median(widths)
        # Tiny faces are usually a webcam overlay on gameplay; huge faces are
        # already filling the frame. Both are better served by a centre crop.
        if 0.10 <= median_width <= 0.55:
            center = statistics.median(item[0] for item in samples)
            crop_width = height * target_ratio
            span = max(1.0, width - crop_width)
            frac = (center * width - crop_width / 2.0) / span
            return {
                "mode": "face",
                "frac": round(max(0.0, min(1.0, frac)), 4),
                "faces": len(samples),
                "face_width": round(median_width, 3),
                "source": "haar",
                "src_w": width,
                "src_h": height,
            }
    return {
        "mode": "center", "frac": 0.5, "faces": len(samples), "source": "fallback",
        "src_w": width, "src_h": height,
    }


def crop_filter(plan, width, height, fps=30, target_ratio=9 / 16):
    """Build the ffmpeg filter segment for a plan returned by :func:`plan_crop`."""
    src_w = int(plan.get("src_w") or 0)
    src_h = int(plan.get("src_h") or 0)
    frac = max(0.0, min(1.0, float(plan.get("frac") or 0.5)))
    if not src_w or not src_h:
        # The plan does not carry dimensions; caller should use a safe centre
        # crop with ffmpeg expressions instead.
        return (
            f"crop=w='min(iw,ih*{target_ratio:.6f})':h='min(ih,iw/{target_ratio:.6f})':"
            f"x='(iw-ow)*{frac:.6f}':y='(ih-oh)/2',scale={width}:{height},fps={fps}"
        )
    crop_w = min(src_w, int(round(src_h * target_ratio)))
    crop_h = min(src_h, int(round(src_w / target_ratio)))
    x = int(round((src_w - crop_w) * frac))
    y = int(round((src_h - crop_h) / 2))
    return f"crop={crop_w}:{crop_h}:{x}:{y},scale={width}:{height},fps={fps}"


def log_plan(job_id, plan, label=""):
    if not plan:
        return
    mode = plan.get("mode")
    if mode == "face":
        db.log(job_id, f"Auto reframe{label}: face-aware crop at {plan.get('frac', 0.5) * 100:.0f}% of frame")
    elif mode == "none":
        db.log(job_id, f"Auto reframe{label}: source is already vertical — using blurred backdrop")
    else:
        db.log(job_id, f"Auto reframe{label}: centre crop")
