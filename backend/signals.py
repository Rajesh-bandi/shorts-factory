"""Cheap multimodal signals used to rank highlight candidates.

Everything in this module is CPU-only and bounded:

* YouTube's public "most replayed" heatmap (already present in yt-dlp metadata)
* per-second RMS audio energy (streamed, never loads a whole file into RAM)
* transcript speech coverage
* word/segment boundary snapping so clips do not start or end mid-sentence

The pipeline treats these as *evidence*. The LLM still writes the final
editorial pick, but it now sees the signal hotspots and can no longer return a
clip that starts in the middle of a word.
"""
import bisect
import math
import os
import statistics
import subprocess
import time

# Audio analysis is deliberately small: 8 kHz mono is plenty for loudness
# peaks and keeps a four-hour stream well under 250 MB of streamed PCM.
AUDIO_RATE = 8000
AUDIO_SAMPLE_SECONDS = 1.0


def _num(value, default=0.0):
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _clamp(value, low, high):
    return max(low, min(high, value))


# ---------------------------------------------------------------- heatmap
def heatmap_series(info, duration):
    """Return a per-second 0..1 series from yt-dlp's ``heatmap`` metadata.

    YouTube emits contiguous ~2 s bins. Missing bins are linearly filled so
    later window math can index the list by second without gaps.
    """
    raw = (info or {}).get("heatmap") or []
    duration = max(1.0, _num(duration))
    size = int(math.ceil(duration))
    values = [0.0] * size
    weights = [0] * size
    for item in raw:
        if not isinstance(item, dict):
            continue
        start = _num(item.get("start_time"))
        end = _num(item.get("end_time"), start + 2.0)
        value = _clamp(_num(item.get("value")), 0.0, 1.0)
        if end <= start:
            end = start + 1.0
        for index in range(max(0, int(start)), min(size, int(math.ceil(end)))):
            values[index] += value
            weights[index] += 1
    for index, count in enumerate(weights):
        if count:
            values[index] /= count
    # Linear fill for any gaps.
    known = [i for i, count in enumerate(weights) if count]
    if not known:
        return []
    for index in range(size):
        if weights[index]:
            continue
        before = max((i for i in known if i < index), default=None)
        after = min((i for i in known if i > index), default=None)
        if before is None:
            values[index] = values[after]
        elif after is None:
            values[index] = values[before]
        else:
            span = after - before
            values[index] = values[before] + (values[after] - values[before]) * ((index - before) / span)
    return [round(value, 4) for value in values]


def _smooth(series, window):
    window = max(1, int(window))
    if not series:
        return []
    prefix = [0.0]
    for value in series:
        prefix.append(prefix[-1] + value)
    out = []
    half = window // 2
    for index in range(len(series)):
        left = max(0, index - half)
        right = min(len(series), index + half + 1)
        out.append((prefix[right] - prefix[left]) / max(1, right - left))
    return out


def heatmap_peaks(info, duration, count=2, target=45):
    """Turn the most-replayed graph into candidate clip windows."""
    series = heatmap_series(info, duration)
    return heatmap_peaks_series(series, duration, count, target)


def heatmap_peaks_series(series, duration, count=2, target=45):
    """Same as :func:`heatmap_peaks` but accepts an already-built series."""
    if not series:
        return []
    duration = max(1.0, _num(duration))
    target = max(8, int(target or 45))
    smoothed = _smooth(series, max(5, target // 2))
    top = max(smoothed) or 0.0
    if top <= 0:
        return []
    candidates = []
    used = []
    for index in sorted(range(len(smoothed)), key=lambda i: smoothed[i], reverse=True):
        value = smoothed[index]
        if value < top * 0.35:
            break
        start = _clamp(index - target / 2.0, 0.0, max(0.0, duration - target))
        end = min(duration, start + target)
        if any(not (end <= a or start >= b) for a, b in used):
            continue
        used.append((start, end))
        candidates.append({
            "start": round(start, 2),
            "end": round(end, 2),
            "title": "Most replayed moment",
            "reason": f"YouTube viewers replayed this section {value * 100:.0f}% as much as the hottest point",
            "transcript": "",
            "score": round(value, 4),
            "sources": ["heatmap"],
            "signals": {"heat": round(value, 3)},
        })
        if len(candidates) >= max(1, int(count)) * 3:
            break
    return candidates


# ------------------------------------------------------------- audio energy
def audio_energy(path, sample_sec=AUDIO_SAMPLE_SECONDS, cancel_cb=None, timeout=1800):
    """Stream mono PCM through ffmpeg and return RMS per sample window.

    The previous implementation decoded the entire file into one ``bytes``
    object. This version reads one window at a time so a long stream cannot
    exhaust the container's memory.
    """
    if not path or not os.path.exists(path):
        return []
    window = max(1, int(AUDIO_RATE * float(sample_sec or 1.0)))
    window_bytes = window * 2
    cmd = [
        "ffmpeg", "-v", "error", "-nostdin", "-i", path,
        "-vn", "-ac", "1", "-ar", str(AUDIO_RATE), "-f", "s16le", "-",
    ]
    try:
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    except OSError:
        return []
    out = []
    started = time.monotonic()
    try:
        import numpy as np
    except ImportError:
        proc.kill()
        proc.wait()
        return []
    try:
        while True:
            if cancel_cb and cancel_cb():
                break
            if time.monotonic() - started > timeout:
                break
            raw = proc.stdout.read(window_bytes)
            if not raw:
                break
            usable = len(raw) - (len(raw) % 2)
            if usable <= 0:
                break
            samples = np.frombuffer(raw[:usable], dtype=np.int16).astype(np.float32) / 32768.0
            if samples.size:
                out.append(round(float(np.sqrt((samples ** 2).mean())), 5))
            if len(raw) < window_bytes:
                break
    finally:
        if proc.poll() is None:
            proc.kill()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            pass
    return out


def audio_peaks(energy, duration, count=2, target=45):
    """Rank high-energy windows, suppressing neighbours so picks differ."""
    if not energy:
        return []
    duration = max(1.0, _num(duration))
    target = max(8, int(target or 45))
    length = min(len(energy), max(3, target))
    if length <= 0:
        return []
    smoothed = _smooth(energy, max(3, length // 3))
    baseline = statistics.median(smoothed) or 1e-6
    top = max(smoothed) or 0.0
    if top <= baseline * 1.08:
        return []
    candidates = []
    used = []
    for index in sorted(range(len(smoothed)), key=lambda i: smoothed[i], reverse=True):
        value = smoothed[index]
        if value < max(baseline * 1.15, top * 0.45):
            break
        start = _clamp(index - length / 2.0, 0.0, max(0.0, duration - length))
        end = min(duration, start + length)
        if any(not (end <= a or start >= b) for a, b in used):
            continue
        used.append((start, end))
        ratio = value / baseline
        candidates.append({
            "start": round(start, 2),
            "end": round(end, 2),
            "title": "Audio peak",
            "reason": f"Loud reaction / excitement peak ({ratio:.1f}× the video's typical audio energy)",
            "transcript": "",
            "score": round(min(3.0, ratio), 4),
            "sources": ["audio"],
            "signals": {"energy": round(ratio, 2)},
        })
        if len(candidates) >= max(1, int(count)) * 3:
            break
    return candidates


# ------------------------------------------------------------- transcript
def _units(segments):
    """Flatten transcript segments into word-level timing units when possible."""
    units = []
    for segment in segments or []:
        words = segment.get("words") or []
        if words:
            for word in words:
                try:
                    start = float(word["start"])
                    end = float(word["end"])
                except (KeyError, TypeError, ValueError):
                    continue
                if end > start:
                    units.append((start, end))
        else:
            try:
                start = float(segment["start"])
                end = float(segment["end"])
            except (KeyError, TypeError, ValueError):
                continue
            if end > start:
                units.append((start, end))
    units.sort()
    return units


def snap_window(segments, start, end, target=45, peak=None, duration=None):
    """Move clip boundaries to speech boundaries and keep the payoff inside.

    Rules, in order:
    1. never start inside a spoken word (move to its start)
    2. prefer the next word start when the requested start is in a short gap
    3. end on a word/segment boundary, not mid-word
    4. keep a supplied chat peak at least two seconds inside the clip
    5. clamp length to roughly 0.55–1.4× target
    """
    start = max(0.0, _num(start))
    end = max(start + 1.0, _num(end))
    target = max(8, int(target or 45))
    units = _units(segments)
    if not units:
        return round(start, 2), round(end, 2)

    # --- start ---
    containing = next(((a, b) for a, b in units if a <= start < b), None)
    if containing:
        start = containing[0]
    else:
        next_unit = next(((a, b) for a, b in units if a > start), None)
        if next_unit and next_unit[0] - start <= 1.6:
            start = next_unit[0]
        else:
            previous = max(((a, b) for a, b in units if b <= start), default=None, key=lambda u: u[1])
            if previous and start - previous[1] > 2.5:
                # Long silence: start just before the next speech, not in dead air.
                if next_unit and next_unit[0] - start <= 4.0:
                    start = next_unit[0]
                else:
                    start = previous[1]

    # --- end ---
    containing = next(((a, b) for a, b in units if a < end <= b), None)
    if containing:
        end = containing[1]
    else:
        previous = max(((a, b) for a, b in units if b <= end), default=None, key=lambda u: u[1])
        if previous and end - previous[1] <= 1.4:
            end = previous[1]
        else:
            next_unit = next(((a, b) for a, b in units if a >= end), None)
            if next_unit and next_unit[0] - end <= 0.8:
                end = next_unit[1]

    # --- keep the reaction peak inside ---
    if peak is not None:
        peak = _num(peak)
        if peak > 0:
            if start > peak - 2.0:
                start = max(0.0, peak - 2.0)
                containing = next(((a, b) for a, b in units if a <= start < b), None)
                if containing:
                    start = containing[0]
            if end < peak + 2.0:
                end = peak + 2.0
                containing = next(((a, b) for a, b in units if a < end <= b), None)
                if containing:
                    end = containing[1]

    # --- length guard ---
    if duration is not None:
        end = min(float(duration), end)
    length = end - start
    if length > target * 1.4:
        trim = length - target * 1.4
        if peak is not None and _num(peak) - start < end - _num(peak):
            start = min(start + trim, _num(peak) - 2.0)
        else:
            end = max(end - trim, _num(peak) + 2.0 if peak is not None else start + 4.0)
    elif length < target * 0.55:
        need = target * 0.55 - length
        if duration is not None and end + need <= float(duration):
            end += need
        else:
            start = max(0.0, start - need)
    if end <= start + 1.0:
        end = start + max(2.0, min(target, 8.0))
    return round(start, 2), round(end, 2)


def speech_ratio(segments, start, end):
    start = _num(start)
    end = _num(end)
    if end <= start:
        return 0.0
    spoken = 0.0
    for segment in segments or []:
        try:
            a = max(start, float(segment["start"]))
            b = min(end, float(segment["end"]))
        except (KeyError, TypeError, ValueError):
            continue
        if b > a:
            spoken += b - a
    return round(min(1.0, spoken / (end - start)), 3)


# ------------------------------------------------------------- window math
def _series_max(series, start, end):
    if not series:
        return 0.0
    a = max(0, int(start))
    b = min(len(series), int(math.ceil(end)))
    if b <= a:
        return 0.0
    return max(series[a:b])


def _series_mean(series, start, end):
    if not series:
        return 0.0
    a = max(0, int(start))
    b = min(len(series), int(math.ceil(end)))
    if b <= a:
        return 0.0
    values = series[a:b]
    return sum(values) / len(values)


def window_signals(segments, start, end, energy=None, heatmap=None, chat_events=None,
                   energy_baseline=None, chat_offsets=None):
    """Compact evidence block attached to every candidate for the UI and LLM.

    ``energy_baseline`` and ``chat_offsets`` let callers that annotate many
    transcript lines reuse one median and one sorted offset list instead of
    recomputing both per line.
    """
    chat_count = 0
    if chat_offsets is not None:
        chat_count = max(0, bisect.bisect_left(chat_offsets, end) - bisect.bisect_left(chat_offsets, start))
    elif chat_events:
        for event in chat_events:
            try:
                offset = float(event.get("offset"))
            except (TypeError, ValueError):
                continue
            if start <= offset < end:
                chat_count += 1
    energy_value = _series_max(energy, start, end) if energy else 0.0
    if energy_baseline is None:
        energy_baseline = statistics.median(energy) if energy else 0.0
    energy_ratio = round(energy_value / energy_baseline, 2) if energy_baseline > 1e-6 else 0.0
    heat_value = _series_max(heatmap, start, end) if heatmap else 0.0
    return {
        "heat": round(heat_value, 3),
        "heat_avg": round(_series_mean(heatmap, start, end), 3),
        "energy": energy_ratio,
        "chat": chat_count,
        "speech": speech_ratio(segments, start, end),
    }


def chat_offsets(chat_events):
    """Sorted chat offsets, suitable for repeated ``window_signals`` calls."""
    offsets = []
    for event in chat_events or []:
        try:
            offsets.append(float(event.get("offset")))
        except (TypeError, ValueError):
            continue
    offsets.sort()
    return offsets


def attach_signals(candidate, segments, energy=None, heatmap=None, chat_events=None):
    start = _num(candidate.get("start"))
    end = _num(candidate.get("end"))
    candidate["signals"] = window_signals(
        segments, start, end, energy=energy, heatmap=heatmap, chat_events=chat_events
    )
    sources = list(candidate.get("sources") or [])
    if heatmap and candidate["signals"]["heat"] >= 0.35 and "heatmap" not in sources:
        sources.append("heatmap")
    if energy and candidate["signals"]["energy"] >= 1.15 and "audio" not in sources:
        sources.append("audio")
    if chat_events and candidate["signals"]["chat"] > 0 and "chat" not in sources:
        sources.append("chat")
    candidate["sources"] = sources
    return candidate


def iou(a, b):
    try:
        a_start, a_end = float(a["start"]), float(a["end"])
        b_start, b_end = float(b["start"]), float(b["end"])
    except (KeyError, TypeError, ValueError):
        return 0.0
    intersection = max(0.0, min(a_end, b_end) - max(a_start, b_start))
    if intersection <= 0:
        return 0.0
    union = max(a_end, b_end) - min(a_start, b_start)
    return intersection / union if union > 0 else 0.0


def dedupe(candidates, threshold=0.5):
    """Keep the strongest candidate when two windows cover the same moment."""
    ranked = sorted(
        candidates or [],
        key=lambda item: _num(item.get("score")) + (0.25 if item.get("chat_peak") is not None else 0.0),
        reverse=True,
    )
    kept = []
    for candidate in ranked:
        if any(iou(candidate, existing) > threshold for existing in kept):
            continue
        kept.append(candidate)
    kept.sort(key=lambda item: _num(item.get("start")))
    return kept


def signal_summary(heatmap=None, energy=None, chat_events=None):
    """Human-readable one-liner used in job logs."""
    bits = []
    if heatmap:
        bits.append("YouTube heatmap")
    if energy:
        bits.append("audio energy")
    if chat_events:
        bits.append(f"{len(chat_events)} chat messages")
    return " + ".join(bits) if bits else "transcript only"
