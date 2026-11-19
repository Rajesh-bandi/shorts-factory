"""Stage 3 — clip + reframe to 9:16 + burn captions with ffmpeg."""
import os
import re
import signal
import subprocess
import time

from . import config, db, gpu

MEDIA_DIR = str(config.MEDIA_DIR)


def user_media_dir(user_id):
    path = os.path.join(MEDIA_DIR, str(int(user_id)))
    os.makedirs(path, exist_ok=True)
    return path

# Keep in sync with CAPTION_STYLES in frontend/app.js.
CAPTION_PRESETS = {
    "gruvbox": {
        "label": "Gruvbox", "blurb": "warm · terminal",
        "size": 46, "color": "#fabd2f", "highlight": "#fe8019",
        "outline": 3, "shadow": 2, "box": False, "uppercase": True,
        "bold": True, "animation": "word",
    },
    "omarchy": {
        "label": "Omarchy green", "blurb": "sage · terminal",
        "size": 46, "color": "#b8bb26", "highlight": "#d79921",
        "outline": 3, "shadow": 1, "box": False, "uppercase": True,
        "bold": True, "animation": "word",
    },
    "classic": {
        "label": "Classic", "blurb": "clean broadcast",
        "size": 44, "color": "#ffffff", "highlight": "#fabd2f",
        "outline": 2, "shadow": 0, "box": False, "uppercase": False,
        "bold": True, "animation": "static",
    },
    "boxed": {
        "label": "Boxed", "blurb": "solid plate",
        "size": 42, "color": "#fbf1c7", "highlight": "#fe8019",
        "outline": 0, "shadow": 0, "box": True, "uppercase": False,
        "bold": False, "animation": "pop",
    },
    "clean": {
        "label": "Clean", "blurb": "minimal white",
        "size": 40, "color": "#ffffff", "highlight": "#ffffff",
        "outline": 0, "shadow": 1, "box": False, "uppercase": False,
        "bold": False, "animation": "static",
    },
    "neon": {
        "label": "Neon", "blurb": "aqua glow",
        "size": 46, "color": "#8ec07c", "highlight": "#fb4934",
        "outline": 2, "shadow": 3, "box": False, "uppercase": True,
        "bold": True, "animation": "word",
    },
    "outline": {
        "label": "Outline", "blurb": "heavy contrast",
        "size": 48, "color": "#ffffff", "highlight": "#fabd2f",
        "outline": 5, "shadow": 0, "box": False, "uppercase": True,
        "bold": True, "animation": "pop",
    },
    "impact": {
        "label": "Impact", "blurb": "loud & punchy",
        "size": 52, "color": "#ffffff", "highlight": "#fb4934",
        "outline": 4, "shadow": 0, "box": False, "uppercase": True,
        "bold": True, "animation": "word",
    },
    "shadow": {
        "label": "Shadow", "blurb": "soft depth",
        "size": 44, "color": "#fbf1c7", "highlight": "#8ec07c",
        "outline": 0, "shadow": 6, "box": False, "uppercase": False,
        "bold": False, "animation": "static",
    },
    "karaoke": {
        "label": "Karaoke", "blurb": "word focus",
        "size": 46, "color": "#ebdbb2", "highlight": "#fb4934",
        "outline": 3, "shadow": 1, "box": False, "uppercase": True,
        "bold": True, "animation": "word",
    },
    "minimal": {
        "label": "Minimal", "blurb": "small & quiet",
        "size": 34, "color": "#ffffff", "highlight": "#b8bb26",
        "outline": 0, "shadow": 0, "box": False, "uppercase": False,
        "bold": False, "animation": "static",
    },
    "terminal": {
        "label": "Terminal", "blurb": "green bar",
        "size": 40, "color": "#b8bb26", "highlight": "#fabd2f",
        "outline": 0, "shadow": 0, "box": True, "uppercase": True,
        "bold": True, "animation": "static",
    },
}

QUALITY = {"high": 18, "balanced": 21, "small": 25}


def _video_codec_args(options, crf):
    """NVENC when explicitly enabled and present; libx264 otherwise."""
    if options.get("gpu_enabled") and gpu.nvenc_available():
        return [
            "-c:v", "h264_nvenc", "-preset", "p1", "-tune", "ll",
            "-rc", "vbr", "-cq", str(crf), "-b:v", "0", "-pix_fmt", "yuv420p",
        ]
    return [
        "-c:v", "libx264", "-preset", "veryfast", "-crf", str(crf),
        "-pix_fmt", "yuv420p",
    ]


def _cpu_video_codec_args(crf):
    return [
        "-c:v", "libx264", "-preset", "veryfast", "-crf", str(crf),
        "-pix_fmt", "yuv420p",
    ]


def _run_video_encode(cmd, crf, use_gpu, should_cancel=None):
    """Run NVENC and transparently retry with x264 if the GPU encoder fails."""
    try:
        _run(cmd, should_cancel=should_cancel)
    except Exception:
        if not use_gpu or (should_cancel and should_cancel()):
            raise
        start = cmd.index("-c:v")
        end = cmd.index("-pix_fmt", start) + 2
        _run(cmd[:start] + _cpu_video_codec_args(crf) + cmd[end:], should_cancel=should_cancel)
RESOLUTIONS = {"1080": (1080, 1920), "720": (720, 1280)}


def _subtitles_filter(ass_path):
    value = f"subtitles=filename='{_ff_escape(ass_path)}'"
    fontsdir = _hook_fontsdir()
    if fontsdir:
        value += f":fontsdir='{_ff_escape(fontsdir)}'"
    return value


def _ff_escape(text):
    return (
        text.replace("\\", "\\\\")
        .replace(":", "\\:")
        .replace("'", "\\'")
        .replace("%", "\\%")
    )


def _srt_time(t):
    ms = int((t - int(t)) * 1000)
    h, rem = divmod(int(t), 3600)
    m, s = divmod(rem, 60)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def _wrap(text, width, max_lines=4):
    words = text.split()
    lines, cur = [], ""
    for w in words:
        if not cur:
            cur = w
        elif len(cur) + 1 + len(w) <= width:
            cur += " " + w
        else:
            lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    if len(lines) > max_lines:
        head = lines[: max_lines - 1]
        head.append(" ".join(lines[max_lines - 1:]))
        lines = head
    return "\n".join(lines)


def _wrap_lines(text, width):
    words = text.split()
    lines, cur = [], ""
    for word in words:
        if not cur:
            cur = word
        elif len(cur) + 1 + len(word) <= width:
            cur += " " + word
        else:
            lines.append(cur)
            cur = word
    if cur:
        lines.append(cur)
    return lines


def _word_timeline(segments):
    """Approximate word timings inside transcript segments for tighter captions."""
    words = []
    for seg in segments or []:
        raw_words = seg.get("words")
        if raw_words:
            timed = []
            for item in raw_words:
                try:
                    start = float(item.get("start"))
                    end = float(item.get("end"))
                except (TypeError, ValueError):
                    continue
                text = str(item.get("word") or item.get("text") or "").strip()
                if text and end > start and len(text.split()) == 1:
                    timed.append({"text": text, "start": start, "end": end})
            if timed:
                words.extend(timed)
                continue
        text = str(seg.get("text") or "").strip()
        parts = text.split()
        if not parts:
            continue
        try:
            start = float(seg.get("start"))
            end = float(seg.get("end"))
        except (TypeError, ValueError):
            continue
        if end <= start:
            continue
        weights = [max(1, len(part.strip(".,!?;:\"'")) + 1) for part in parts]
        total = sum(weights) or len(parts)
        cursor = start
        for part, weight in zip(parts, weights):
            length = (end - start) * weight / total
            words.append({"text": part, "start": cursor, "end": cursor + length})
            cursor += length
    words.sort(key=lambda item: item["start"])
    return words


def _clip_words(words, offset, duration):
    out = []
    for word in words:
        start = max(0.0, float(word["start"]) - offset)
        end = min(duration, float(word["end"]) - offset)
        if end <= start or start >= duration or end <= 0:
            continue
        # A word crossing the cut boundary belongs to the cut.
        if end > start:
            out.append({"text": word["text"], "start": start, "end": end})
    return out


def _word_chunks(words, max_words=4):
    for i in range(0, len(words), max_words):
        group = words[i:i + max_words]
        if not group:
            continue
        start = group[0]["start"]
        end = group[-1]["end"]
        if end > start:
            yield " ".join(item["text"] for item in group), start, end


def _build_srt(segments, offset, duration, path, uppercase=False, width=36):
    """Write caption cues clipped to this render, using word-ish timings."""
    words = _clip_words(_word_timeline(segments), offset, duration)
    lines = []
    n = 0
    for text, start, end in _word_chunks(words, 5):
        if uppercase:
            text = text.upper()
        text = _wrap(text, width)
        n += 1
        lines.append(f"{n}\n{_srt_time(start)} --> {_srt_time(end)}\n{text}\n")
    with open(path, "w") as f:
        f.write("\n".join(lines))


def _ass_color(hex_color, alpha="00"):
    h = (hex_color or "#ffffff").lstrip("#")
    if len(h) != 6:
        h = "ffffff"
    r, g, b = h[0:2], h[2:4], h[4:6]
    return f"&H{alpha}{b}{g}{r}"


def _caption_font():
    """Return a font family that fontconfig can actually resolve.

    A missing family makes fontconfig rescan on every caption event, which
    can stall a long render.
    """
    try:
        family = subprocess.check_output(
            ["fc-match", "-f", "%{family}", "DejaVu Sans"],
            text=True,
            stderr=subprocess.DEVNULL,
            timeout=2,
        ).strip()
        family = family.split(",", 1)[0].strip()
        if family:
            return family
    except (OSError, subprocess.SubprocessError, ValueError):
        pass
    return "DejaVu Sans"


def _ass_time(seconds):
    cs = max(0, int(round(float(seconds) * 100)))
    h, rem = divmod(cs, 360000)
    m, rem = divmod(rem, 6000)
    s, cs = divmod(rem, 100)
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


def _ass_style_line(opts):
    preset = CAPTION_PRESETS.get(opts.get("caption_preset"), CAPTION_PRESETS["gruvbox"])
    size = max(20, min(80, int(opts.get("caption_size") or preset["size"])))
    color = _ass_color(opts.get("caption_color") or preset["color"])
    highlight = _ass_color(opts.get("caption_highlight") or preset["highlight"])
    box = bool(opts.get("caption_box", preset["box"]))
    bold = bool(preset["bold"])
    position = opts.get("caption_position") or "bottom"
    align = {"bottom": 2, "center": 5, "top": 8}.get(position, 2)
    margin_v = 120 if position == "bottom" else 90
    back = "&H90000000" if box else "&H60000000"
    return (
        f"Style: Default,{_caption_font()},{size},{color},{highlight},"
        f"&H00101010,{back},{-1 if bold else 0},0,0,0,100,100,0,0,"
        f"{3 if box else 1},{2 if box else max(0, int(preset['outline']))},"
        f"{0 if box else int(preset['shadow'])},{align},60,60,{margin_v},1"
    )


def _ass_override(hex_color):
    color = _ass_color(hex_color)
    return "\\c&H" + color[4:] + "&"


_HOOK_FONT_DIR = os.path.join(os.path.dirname(__file__), "assets", "fonts")
_HOOK_FONT_FILE = os.path.join(_HOOK_FONT_DIR, "NotoEmoji-Regular.ttf")


def _hook_font():
    """Use the bundled monochrome emoji font so hooks render on every platform."""
    if os.path.isfile(_HOOK_FONT_FILE):
        return "Noto Emoji"
    try:
        families = subprocess.check_output(
            ["fc-list", ":family"], text=True, stderr=subprocess.DEVNULL, timeout=2
        )
        lowered = families.lower()
        for family in ("Noto Emoji", "Noto Color Emoji", "Segoe UI Emoji", "Apple Color Emoji"):
            if family.lower() in lowered:
                return family
    except (OSError, subprocess.SubprocessError, ValueError):
        pass
    return _caption_font()


def _hook_fontsdir():
    return _HOOK_FONT_DIR if os.path.isfile(_HOOK_FONT_FILE) else ""


def _hook_size(opts):
    preset = CAPTION_PRESETS.get(opts.get("caption_preset"), CAPTION_PRESETS["gruvbox"])
    base = int(opts.get("caption_size") or preset["size"])
    return max(44, min(76, base + 12))


def _hook_style_line(opts):
    size = _hook_size(opts)
    return (
        f"Style: Hook,{_caption_font()},{size},&H00FFFFFF,&H00FFFFFF,"
        f"&H00101010,&H90000000,-1,0,0,0,100,100,0,0,1,4,2,8,50,50,70,1"
    )


def _ass_word_pieces(group, active, wrap_width, highlight, normal, uppercase):
    """Build one full caption group with the active word growing in place."""
    pieces = []
    line_len = 0
    for index, part in enumerate(group):
        text = part["text"].upper() if uppercase else part["text"]
        token = _ass_escape_text(text)
        if index == active:
            token = (
                f"{{{highlight}\\fscx100\\fscy100\\t(0,100,\\fscx112\\fscy112)}}"
                f"{token}{{{normal}\\fscx100\\fscy100}}"
            )
            visible = len(text)
        else:
            visible = len(text)
        gap = 1 if pieces else 0
        if pieces and line_len + gap + visible > wrap_width:
            pieces.append("\\N" + token)
            line_len = visible
        else:
            if pieces:
                pieces.append(" " + token)
            else:
                pieces.append(token)
            line_len += gap + visible
    return "".join(pieces)


def _ass_escape_text(text):
    return text.replace("\\", "\\\\").replace("{", "(").replace("}", ")").replace("\n", "\\N")


def _hook_ass_text(text, emoji_font):
    """Keep Latin in the caption font and switch only emoji runs to the emoji font."""
    pattern = re.compile(r"([\U0001F000-\U0001FAFF\u2600-\u27BF\uFE0F\u200D]+)")
    parts = []
    for part in pattern.split(str(text or "")):
        if not part:
            continue
        if pattern.fullmatch(part):
            parts.append(f"{{\\fn{emoji_font}}}{_ass_escape_text(part)}{{\\fn{_caption_font()}}}")
        else:
            parts.append(_ass_escape_text(part))
    return "".join(parts)


def _build_ass(segments, offset, duration, path, style_line, width, height,
               uppercase=False, wrap_width=26, animation="static",
               primary_color="#ffffff", highlight_color="#fabd2f",
               hook=None, hook_style_line=None, hook_size=58):
    """Write clip-local ASS captions from short, timed word groups."""
    lines = [
        "[Script Info]",
        "ScriptType: v4.00+",
        f"PlayResX: {width}",
        f"PlayResY: {height}",
        "WrapStyle: 2",
        "ScaledBorderAndShadow: yes",
        "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
        style_line,
    ]
    hook = " ".join(str(hook or "").split())[:100]
    if hook and hook_style_line:
        lines.append(hook_style_line)
    lines.extend([
        "",
        "[Events]",
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ])
    hook_line = ""
    if hook:
        hook_wrap = max(14, int((width - 140) / (max(1, hook_size) * 0.72)))
        emoji_font = _hook_font()
        hook_body = "\\N".join(
            _hook_ass_text(line, emoji_font) for line in _wrap_lines(hook, hook_wrap)
        )
        hook_line = f"Dialogue: 1,0:00:00.00,{_ass_time(duration)},Hook,,0,0,0,,{hook_body}"
    words = _clip_words(_word_timeline(segments), offset, duration)
    if not words:
        if hook_line:
            lines.append(hook_line)
        with open(path, "w") as f:
            f.write("\n".join(lines) + "\n")
        return
    if uppercase:
        for word in words:
            word["text"] = word["text"].upper()
    normal = _ass_override(primary_color)
    highlight = _ass_override(highlight_color)
    pop = "{\\fad(70,70)\\fscx88\\fscy88\\t(0,140,\\fscx100\\fscy100)}"
    if animation == "word":
        for offset in range(0, len(words), 4):
            group = words[offset:offset + 4]
            for active, word in enumerate(group):
                start = max(0.0, word["start"])
                # Hold the whole group through tiny inter-word gaps instead
                # of blinking the caption off between spoken words.
                next_start = group[active + 1]["start"] if active + 1 < len(group) else None
                end = min(duration, next_start if next_start is not None else word["end"])
                if end <= start:
                    end = min(duration, max(word["end"], start + 0.1))
                if end <= start:
                    continue
                body = _ass_word_pieces(
                    group, active, wrap_width, highlight, normal, uppercase
                )
                lines.append(
                    f"Dialogue: 0,{_ass_time(start)},{_ass_time(end)},Default,,0,0,0,,{body}"
                )
        if hook_line:
            lines.append(hook_line)
        with open(path, "w") as f:
            f.write("\n".join(lines) + "\n")
        return
    for text, start, end in _word_chunks(words, 4):
        wrapped = _wrap_lines(text, wrap_width)
        body = _ass_escape_text("\n".join(wrapped))
        if animation == "pop":
            body = pop + body
        lines.append(f"Dialogue: 0,{_ass_time(start)},{_ass_time(end)},Default,,0,0,0,,{body}")
    if hook_line:
        lines.append(hook_line)
    with open(path, "w") as f:
        f.write("\n".join(lines) + "\n")


def _style_string(opts):
    preset = CAPTION_PRESETS.get(opts.get("caption_preset"), CAPTION_PRESETS["gruvbox"])
    size = int(opts.get("caption_size") or preset["size"])
    size = max(20, min(80, size))
    color = opts.get("caption_color") or preset["color"]
    box = bool(opts.get("caption_box", preset["box"]))
    bold = bool(preset["bold"])
    position = opts.get("caption_position") or "bottom"
    align = {"bottom": 2, "center": 5, "top": 8}.get(position, 2)
    margin_v = 120 if position == "bottom" else 90

    parts = [
        f"FontName={_caption_font()}",
        f"FontSize={size}",
        f"PrimaryColour={_ass_color(color)}",
        "OutlineColour=&H00101010",
        f"BackColour={'&H90000000' if box else '&H60000000'}",
        f"Bold={1 if bold else 0}",
        "Italic=0",
        "Underline=0",
        "StrikeOut=0",
        "ScaleX=100",
        "ScaleY=100",
        "Spacing=0",
        "Angle=0",
        f"BorderStyle={3 if box else 1}",
        f"Outline={2 if box else max(0, int(preset['outline']))}",
        f"Shadow={0 if box else int(preset['shadow'])}",
        f"Alignment={align}",
        "MarginL=60",
        "MarginR=60",
        f"MarginV={margin_v}",
    ]
    return ",".join(parts)


def _stop_process(proc, force=False):
    if proc.poll() is not None:
        return
    if force:
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
        except (ProcessLookupError, PermissionError, OSError):
            try:
                proc.kill()
            except OSError:
                pass
        try:
            proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            pass
        return
    try:
        os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
    except (ProcessLookupError, PermissionError, OSError):
        try:
            proc.terminate()
        except OSError:
            pass
    try:
        proc.wait(timeout=0.5)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
        except (ProcessLookupError, PermissionError, OSError):
            try:
                proc.kill()
            except OSError:
                pass
        try:
            proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            pass


def _run(cmd, timeout=1800, should_cancel=None):
    """Run ffmpeg, polling so a cancel can terminate the child immediately."""
    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        text=True,
        start_new_session=True,
    )
    started = time.monotonic()
    canceled = False
    try:
        while proc.poll() is None:
            if should_cancel and should_cancel():
                canceled = True
                _stop_process(proc, force=True)
                break
            if time.monotonic() - started > timeout:
                _stop_process(proc, force=True)
                raise RuntimeError("ffmpeg timed out")
            time.sleep(0.2)
        _, stderr = proc.communicate()
    finally:
        if proc.poll() is None:
            _stop_process(proc, force=True)
    if canceled:
        raise RuntimeError("canceled")
    if proc.returncode != 0:
        tail = (stderr or "").strip().splitlines()[-3:]
        raise RuntimeError("ffmpeg failed: " + (" | ".join(tail) or "unknown error"))
    return subprocess.CompletedProcess(cmd, proc.returncode, "", stderr)


def _make_thumb(clip_path, thumb_path, duration):
    try:
        _run(
            [
                "ffmpeg", "-y", "-v", "error",
                "-ss", str(max(0.0, duration / 2)),
                "-i", clip_path,
                "-frames:v", "1",
                "-vf", "scale=480:-2",
                "-q:v", "4",
                thumb_path,
            ],
            timeout=120,
        )
        return thumb_path if os.path.getsize(thumb_path) > 0 else None
    except Exception:
        return None


def _shift_segments(segments, offset, duration):
    out = []
    for seg in segments or []:
        try:
            start = float(seg["start"]) - offset
            end = float(seg["end"]) - offset
        except (KeyError, TypeError, ValueError):
            continue
        if end <= 0 or start >= duration:
            continue
        out.append({
            "start": max(0.0, start),
            "end": min(float(duration), end),
            "text": seg.get("text") or "",
        })
    return out


def render_section(section, cand, index, job_id, segments, stage_cb, options=None, should_cancel=None, user_id=0):
    """Render one Short from a downloaded source range.

    The section starts at 0 locally. Captions are shifted by the section's
    original start so a section downloaded from anywhere still lines up.
    """
    opts = options or {}
    if not section or not section.get("path"):
        raise RuntimeError("No source section was downloaded")
    duration = max(1.0, float(section.get("duration") or (section["end"] - section["start"])))
    local = {
        "start": 0.0,
        "end": duration,
        "title": cand.get("title") or "Short",
        "reason": cand.get("reason") or "",
        "hook": cand.get("hook") or "",
    }
    shifted = _shift_segments(segments, float(section["start"]), duration)
    return make_clip(
        section["path"], local, index, job_id, shifted, stage_cb,
        opts, should_cancel, log_render=True, user_id=user_id,
    )


def make_clip(video_path, cand, index, job_id, segments, stage_cb, options=None, should_cancel=None, log_render=False, user_id=0):
    """Produce a vertical mp4 with burned captions. Returns {path, thumb}."""
    opts = options or {}
    if should_cancel and should_cancel():
        raise RuntimeError("canceled")

    width, height = RESOLUTIONS.get(str(opts.get("resolution", "1080")), (1080, 1920))
    directory = user_media_dir(user_id)
    out_name = f"job{job_id}_short{index}.mp4"
    out_path = os.path.join(directory, out_name)
    thumb_path = os.path.join(directory, f"job{job_id}_short{index}.jpg")
    ass_path = os.path.join(directory, f"job{job_id}_short{index}.ass")

    start = float(cand["start"])
    end = float(cand["end"])
    dur = max(1.0, end - start)

    preset = CAPTION_PRESETS.get(opts.get("caption_preset"), CAPTION_PRESETS["gruvbox"])
    uppercase = bool(opts.get("caption_uppercase", preset["uppercase"]))
    size = max(20, min(80, int(opts.get("caption_size") or preset["size"])))
    wrap_width = max(14, int((width - 140) / (size * 0.78)))
    primary_color = str(opts.get("caption_color") or preset["color"])
    highlight_color = str(opts.get("caption_highlight") or preset.get("highlight") or "#fabd2f")
    animation = str(opts.get("caption_animation") or "static")
    if animation not in ("static", "word", "pop"):
        animation = "static"

    has_subs = False
    hook_text = " ".join(str(cand.get("hook") or "").split())[:100]
    caption_segments = segments or []
    if not bool(opts.get("caption_align", True)):
        # Disable word-level timing and let the burner distribute words across
        # each transcript segment instead.
        caption_segments = [{k: v for k, v in seg.items() if k != "words"} for seg in caption_segments]
    if caption_segments or hook_text:
        _build_ass(
            caption_segments, start, dur, ass_path, _ass_style_line(opts), width, height,
            uppercase, wrap_width, animation, primary_color, highlight_color,
            hook=hook_text, hook_style_line=_hook_style_line(opts), hook_size=_hook_size(opts),
        )
        has_subs = os.path.exists(ass_path) and os.path.getsize(ass_path) > 0

    fps = 30
    reframe = str(opts.get("reframe", "crop"))

    if reframe == "blur":
        chain = (
            f"[0:v]scale={width}:{height}:force_original_aspect_ratio=increase,"
            f"crop={width}:{height},boxblur=30:2,eq=brightness=-0.12[bg];"
            f"[0:v]scale={width}:-2[fg];"
            f"[bg][fg]overlay=(W-w)/2:(H-h)/2[base]"
        )
        if has_subs:
            chain += f";[base]{_subtitles_filter(ass_path)}[v]"
        else:
            chain += ";[base]null[v]"
        video_args = ["-filter_complex", chain, "-map", "[v]", "-map", "0:a?"]
    else:
        chain = (
            f"scale={width}:{height}:force_original_aspect_ratio=increase,"
            f"crop={width}:{height},fps={fps}"
        )
        if has_subs:
            chain += f",{_subtitles_filter(ass_path)}"
        video_args = ["-vf", chain, "-map", "0:v:0", "-map", "0:a?"]

    crf = QUALITY.get(str(opts.get("quality", "balanced")), 21)
    cmd = [
        "ffmpeg", "-y", "-v", "error",
        "-ss", f"{start:.3f}", "-t", f"{dur:.3f}",
        "-i", video_path,
        *video_args,
        *_video_codec_args(opts, crf),
        "-c:a", "aac", "-b:a", "160k", "-ar", "44100",
        "-movflags", "+faststart",
        out_path,
    ]
    if log_render:
        db.log(job_id, f"Rendering short {index}: {cand['title']} [{start:.0f}-{end:.0f}s]")
    if stage_cb:
        stage_cb("clipping", 0.5)
    try:
        gpu_used = bool(opts.get("gpu_enabled") and gpu.nvenc_available())
        _run_video_encode(cmd, crf, gpu_used, should_cancel=should_cancel)
    except Exception:
        if should_cancel and should_cancel():
            for path in (out_path, thumb_path, ass_path):
                try:
                    os.remove(path)
                except OSError:
                    pass
        raise
    if should_cancel and should_cancel():
        raise RuntimeError("canceled")

    thumb = _make_thumb(out_path, thumb_path, dur)
    return {"path": out_path, "thumb": thumb}
