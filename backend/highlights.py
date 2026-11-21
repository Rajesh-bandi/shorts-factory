"""Stage 3 — pick highlight moments.

Primary: OpenAI-compatible LLM over the transcript.
Fallback: audio-energy heuristic (no transcript needed).
"""
import json
import math
import re
import statistics
import subprocess

from . import db, settings, signals


def _window_text(segments, start, end):
    return " ".join(s["text"] for s in segments if s["end"] > start and s["start"] < end)


def _signal_tag(segment, energy, heatmap, chat_events, energy_baseline=None, offsets=None):
    """Compact evidence suffix appended to one transcript line."""
    try:
        start = float(segment["start"])
        end = float(segment["end"])
    except (KeyError, TypeError, ValueError):
        return ""
    data = signals.window_signals(
        [], start, end, energy=energy, heatmap=heatmap, chat_events=chat_events,
        energy_baseline=energy_baseline, chat_offsets=offsets,
    )
    bits = []
    if data["heat"]:
        bits.append(f"heat {data['heat'] * 100:.0f}%")
    if data["energy"] and data["energy"] > 1.1:
        bits.append(f"audio {data['energy']:.1f}x")
    if data["chat"]:
        bits.append(f"chat {data['chat']}")
    return f"  {{{', '.join(bits)}}}" if bits else ""


def _annotated_lines(segments, energy=None, heatmap=None, chat_events=None):
    baseline = statistics.median(energy) if energy else None
    offsets = signals.chat_offsets(chat_events)
    return [
        f"[{int(segment['start'])}-{int(segment['end'])}] {segment['text']}"
        f"{_signal_tag(segment, energy, heatmap, chat_events, baseline, offsets)}"
        for segment in segments or []
    ]


def _hotspot_lines(energy, heatmap, chat_events, target, duration, limit=12,
                   window_start=0.0, window_end=None):
    """Pre-computed signal peaks handed to the LLM as a hint, not a verdict."""
    window_end = float(duration) if window_end is None else float(window_end)
    pool = []
    if heatmap:
        pool.extend(signals.heatmap_peaks_series(heatmap, duration, limit, target))
    if energy:
        pool.extend(signals.audio_peaks(energy, duration, limit, target))
    if chat_events:
        from . import chat

        pool.extend(chat.spike_candidates(chat_events, duration, limit, target))
    pool = [
        item for item in pool
        if float(item.get("end") or 0) > window_start and float(item.get("start") or 0) < window_end
    ]
    pool = signals.dedupe(pool, threshold=0.35)[:limit]
    lines = []
    for item in pool:
        sources = "+".join(item.get("sources") or ["signal"])
        lines.append(f"- {int(item['start'])}-{int(item['end'])}s ({sources}) {item.get('reason') or ''}")
    return lines


def _title_from_window(segments, start, end, fallback="Highlight"):
    text = _window_text(segments, start, end).strip()
    words = text.split()[:6]
    title = " ".join(words).strip(".,!?;:—- ")
    return title[:80] or fallback


def _llm_chat(user_id, messages, timeout=120):
    import requests

    cfg = settings.llm_config(user_id)
    url = cfg["base_url"].rstrip("/") + "/chat/completions"
    resp = requests.post(
        url,
        headers={"Authorization": f"Bearer {cfg['api_key']}"},
        json=settings.llm_body(cfg, messages, temperature=0.4),
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


def _pick_chunked(title, duration, segments, count, job_id, user_id, target=45,
                  energy=None, heatmap=None, chat_events=None):
    """Map-reduce AI selection over overlapping transcript windows."""
    window = 600.0
    step = 540.0
    pool = []
    cursor = 0.0
    chunks = 0
    while cursor < duration:
        end = min(float(duration), cursor + window)
        chunk_lines = _annotated_lines(
            [s for s in segments if s["end"] > cursor and s["start"] < end],
            energy, heatmap, chat_events,
        )
        if chunk_lines:
            chunks += 1
            hotspots = _hotspot_lines(
                energy, heatmap, chat_events, target, duration,
                limit=8, window_start=cursor, window_end=end,
            )
            hotspot_block = "\n".join(hotspots) or "- none"
            prompt = f"""You are picking YouTube Shorts moments from one section of a long video.

Video title: {title}
Full duration: {int(duration)} seconds
This section: {int(cursor)}-{int(end)} seconds

Signal hotspots in this section (chat spikes, YouTube replays, audio peaks):
{hotspot_block}

Timed transcript for this section. Signal evidence is in braces:
{chr(10).join(chunk_lines)}

Return the up to {max(1, count)} strongest self-contained moments from THIS SECTION ONLY.
Rubric: a strong first-second hook, enough context without watching earlier, a clear payoff/reaction, emotional or informational density, and no dead air.
Treat chat/heat/audio as supporting evidence, not a substitute for a real story.
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
                if start < cursor - 1:
                    continue
                start, end = signals.snap_window(
                    segments, start, end, target, duration=duration,
                )
                item = {
                    "start": round(start, 2),
                    "end": round(end, 2),
                    "title": str(p.get("title") or "Highlight")[:80],
                    "reason": str(p.get("reason") or "AI-selected moment")[:200],
                    "transcript": _window_text(segments, start, end)[:500],
                    "score": None,
                    "sources": ["ai"],
                }
                pool.append(signals.attach_signals(item, segments, energy, heatmap, chat_events))
        if end >= duration:
            break
        cursor += step

    def score(item):
        text = (item.get("title", "") + " " + item.get("reason", "") + " " + item.get("transcript", "")).lower()
        hooks = sum(1 for word in HOOK_WORDS if word in text)
        length = item["end"] - item["start"]
        fit = 1.0 - min(1.0, abs(length - target) / max(target, 1))
        words = len(item.get("transcript", "").split())
        evidence = float(item.get("signals", {}).get("heat") or 0)
        return hooks * 2.0 + fit + min(1.5, words / 60.0) + evidence

    pool.sort(key=score, reverse=True)
    chosen = []
    for item in pool:
        if any(signals.iou(item, c) > 0.5 for c in chosen):
            continue
        chosen.append(item)
        if len(chosen) >= count:
            break

    if len(chosen) < count:
        extra = pick_transcript_heuristic(segments, duration, count, job_id, target)
        for item in extra:
            signals.attach_signals(item, segments, energy, heatmap, chat_events)
            if any(signals.iou(item, c) > 0.5 for c in chosen):
                continue
            chosen.append(item)
            if len(chosen) >= count:
                break

    db.log(job_id, f"Map-reduced {chunks} transcript windows into {len(pool)} candidates")
    return sorted(chosen[:count], key=lambda item: float(item["start"]))



def pick_llm(video_path, title, duration, segments, count, job_id, user_id, target=45,
             energy=None, heatmap=None, chat_events=None):
    """Ask an OpenAI-compatible model to choose highlight windows.

    Long transcripts are processed in overlapping windows and merged locally,
    so the end of a two-hour video is not silently dropped by a prompt cap.
    The model sees chat/heat/audio evidence and every returned boundary is
    snapped to a word/segment edge before it reaches the review UI.
    """
    target = int(target or 45)
    lines = _annotated_lines(segments, energy, heatmap, chat_events)
    transcript = "\n".join(lines)
    if len(transcript) > 60000:
        return _pick_chunked(
            title, duration, segments, count, job_id, user_id, target,
            energy=energy, heatmap=heatmap, chat_events=chat_events,
        )
    max_chars = 90000
    if len(transcript) > max_chars:
        step = math.ceil(len(lines) / (max_chars // 120))
        transcript = "\n".join(lines[::step])
    hotspots = _hotspot_lines(energy, heatmap, chat_events, target, duration, limit=12)
    hotspot_block = "\n".join(hotspots) or "- none"

    prompt = f"""You pick the most viral short-form clips from a long YouTube video.

Video title: {title}
Duration: {int(duration)} seconds

Pre-computed signal hotspots (chat spikes, YouTube replays, audio peaks):
{hotspot_block}

Transcript with [start-end] second timestamps. Signal evidence is in braces:
{transcript}

Select the {count} best moments for YouTube Shorts:
- target duration: about {target} seconds per clip
- peak action, funny chaos, fails, clutch plays, wild reactions
- must be self-contained (a viewer who sees only this clip understands it)
- each clip {int(target * 0.6)}-{int(target * 1.4)} seconds long
- clips must not overlap
- story/payoff comes first; chat/heat/audio are supporting evidence
- avoid windows with mostly silence or music

Reply with ONLY a JSON array, no other text:
[{{"start": <seconds>, "end": <seconds>, "title": "<punchy 3-6 word title>", "reason": "<one line why this will get views>"}}]"""

    db.log(job_id, f"Asking LLM ({settings.llm_config(user_id)['model']}) to pick highlights…")
    text = _llm_chat(user_id, [{"role": "user", "content": prompt}])
    picks = _parse_llm_json(text)
    if not picks:
        clean = re.sub(r"\s+", " ", text).strip()
        db.log(job_id, f"LLM reply wasn't a highlight array: {clean[:180]}", "warn")

    out = []
    for p in picks[:max(count, 1) * 2]:
        try:
            s, e = float(p["start"]), float(p["end"])
        except (KeyError, TypeError, ValueError):
            continue
        if e <= s:
            continue
        s = max(0.0, min(float(duration) - 2.0, s))
        e = max(s + 2.0, min(float(duration), e))
        s, e = signals.snap_window(segments, s, e, target, duration=duration)
        item = {
            "start": round(s, 2),
            "end": round(e, 2),
            "title": str(p.get("title", ""))[:80],
            "reason": str(p.get("reason", ""))[:200],
            "transcript": _window_text(segments, s, e)[:500],
            "score": None,
            "sources": ["ai"],
        }
        out.append(signals.attach_signals(item, segments, energy, heatmap, chat_events))
    return sorted(signals.dedupe(out, threshold=0.5)[:count], key=lambda item: float(item["start"]))


def pick_llm_window(title, segments, count, job_id, user_id, target, window_start,
                    window_end, peak=None, energy=None, heatmap=None, chat_events=None):
    """Ask the LLM for the best self-contained clip inside one spike window."""
    target = max(8, min(180, int(target or 45)))
    try:
        window_start = max(0.0, float(window_start or 0))
        window_end = max(window_start + 4.0, float(window_end or 0))
    except (TypeError, ValueError):
        return []
    window_segments = [
        segment for segment in (segments or [])
        if float(segment.get("end") or 0) > window_start
        and float(segment.get("start") or 0) < window_end
    ]
    if not window_segments:
        return []
    lines = _annotated_lines(window_segments, energy, heatmap, chat_events)
    transcript = "\n".join(lines)
    if len(transcript) > 30000:
        transcript = transcript[:30000]
    peak_line = f"Chat spike peak: {float(peak):.0f}s (recording time)\n" if peak is not None else ""
    prompt = f"""You are cutting ONE YouTube Short from a live-stream moment that chat reacted to.

Video title: {title}
{peak_line}Allowed clip window: {window_start:.0f}-{window_end:.0f} seconds
Target length: about {target} seconds, between {int(target * 0.6)} and {int(target * 1.4)} seconds

Transcript with [start-end] second timestamps. Signal evidence is in braces:
{transcript}

Pick the single strongest self-contained moment INSIDE the allowed window. Prefer the action or payoff that made chat react, keep enough context, and avoid dead air. Do not start or end in the middle of a sentence.
Reply with ONLY a JSON array, no other text:
[{{"start": <seconds>, "end": <seconds>, "title": "<punchy 3-6 word title>", "reason": "<one line why this will get views>"}}]"""
    db.log(job_id, f"Asking AI to cut the selected chat-spike window at {window_start:.0f}-{window_end:.0f}s…")
    try:
        text = _llm_chat(user_id, [{"role": "user", "content": prompt}], timeout=120)
    except Exception as e:
        db.log(job_id, f"AI could not cut the selected spike window: {e}", "warn")
        return []
    picks = _parse_llm_json(text)
    out = []
    for pick in picks[:max(1, int(count or 1))]:
        try:
            start = float(pick["start"])
            end = float(pick["end"])
        except (KeyError, TypeError, ValueError):
            continue
        start = max(window_start, min(window_end - 2.0, start))
        end = max(window_start + 2.0, min(window_end, end))
        if end <= start + 3:
            continue
        start, end = signals.snap_window(
            window_segments, start, end, target,
            peak=peak, duration=window_end,
        )
        start = max(window_start, start)
        end = min(window_end, end)
        if end <= start + 3:
            continue
        item = {
            "start": round(start, 2),
            "end": round(end, 2),
            "title": str(pick.get("title") or "Chat spike moment")[:80],
            "reason": str(pick.get("reason") or "AI picked this moment inside the chat spike")[:200],
            "transcript": _window_text(window_segments, start, end)[:500],
            "score": None,
            "chat_peak": round(float(peak), 2) if peak is not None else None,
            "sources": ["chat", "ai"],
        }
        out.append(signals.attach_signals(item, segments, energy, heatmap, chat_events))
    return out


def _audio_energy(video_path, sample_sec=1.0):
    """Backward-compatible wrapper around the streaming analyser."""
    return signals.audio_energy(video_path, sample_sec)


def pick_heuristic(video_path, duration, count, job_id, target=45):
    """Audio-energy based highlight detection (works without LLM/Whisper)."""
    target = int(target or 45)
    db.log(job_id, "Scanning audio energy for highlight candidates…")
    energy = _audio_energy(video_path)
    picks = signals.audio_peaks(energy, duration, count, target)
    if picks:
        db.log(job_id, f"Audio scan found {len(picks)} high-energy window(s)")
    return picks


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


def _signal_pool(video_path, duration, segments, count, job_id, target, energy=None, heatmap=None):
    """Build candidates from every cheap signal, independent of the LLM."""
    pool = []
    if heatmap:
        pool.extend(signals.heatmap_peaks_series(heatmap, duration, max(count, 1), target))
    if energy:
        pool.extend(signals.audio_peaks(energy, duration, max(count, 1), target))
    elif video_path:
        energy = signals.audio_energy(video_path)
        pool.extend(signals.audio_peaks(energy, duration, max(count, 1), target))
    if segments:
        pool.extend(pick_transcript_heuristic(segments, duration, count, job_id, target))
    for item in pool:
        if segments and not item.get("transcript"):
            item["transcript"] = _window_text(segments, item["start"], item["end"])[:500]
        if segments and (not item.get("title") or item["title"].startswith(("Highlight", "Audio peak", "Most replayed"))):
            item["title"] = _title_from_window(segments, item["start"], item["end"], item.get("title") or "Highlight")
        signals.attach_signals(item, segments, energy, heatmap)
    return signals.dedupe(pool, threshold=0.5)


def pick_highlights(video_path, title, duration, segments, count, job_id, user_id, target=45,
                    energy=None, heatmap=None, chat_events=None):
    """Hybrid ranking: LLM editorial picks first, signal candidates as a safety net.

    Chat replay candidates are added by the pipeline before this call; they are
    accepted here too so a caller can pass them directly.
    """
    count = max(1, int(count or 1))
    pool = _signal_pool(
        video_path, duration, segments, count, job_id, target,
        energy=energy, heatmap=heatmap,
    )
    if chat_events:
        from . import chat

        chat_pool = chat.spike_candidates(chat_events, duration, count, target)
        for item in chat_pool:
            signals.attach_signals(item, segments, energy, heatmap, chat_events)
        pool = signals.dedupe(list(chat_pool) + pool, threshold=0.5)

    if settings.llm_available(user_id) and segments:
        try:
            picks = pick_llm(
                video_path, title, duration, segments, count, job_id, user_id, target,
                energy=energy, heatmap=heatmap, chat_events=chat_events,
            )
            if picks:
                merged = list(picks)
                for item in pool:
                    if len(merged) >= count:
                        break
                    if any(signals.iou(item, existing) > 0.5 for existing in merged):
                        continue
                    merged.append(item)
                return sorted(merged[:count], key=lambda item: float(item["start"]))
            db.log(job_id, "LLM returned no usable highlights — using signal ranking", "warn")
        except Exception as e:
            db.log(job_id, f"LLM highlight pick failed ({e}) — using signal ranking", "warn")

    if not pool and video_path:
        pool = pick_heuristic(video_path, duration, count, job_id, target)
    return sorted(pool[:count], key=lambda item: float(item["start"]))
