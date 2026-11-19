"""Comment-spike highlights from a live stream's chat.

Chat is captured alongside the live recording, then the whole captured timeline
is scanned for message-rate surges. Ordinary videos are deliberately excluded:
normal YouTube comments have no video-time coordinate, so they cannot identify
where in the video a comment spike happened.
"""
import glob
import json
import os
import statistics
import subprocess
import threading
import time
from bisect import bisect_left, bisect_right

from . import downloader

CHAT_SUFFIX = ".live_chat.json"
_ITEM_KEYS = (
    "liveChatTextMessageRenderer",
    "liveChatPaidMessageRenderer",
    "liveChatMembershipItemRenderer",
    "liveChatPaidStickerRenderer",
)


def _base(job_id, user_id):
    return os.path.join(downloader.user_media_dir(user_id), f"job{job_id}_chat")


def chat_path(job_id, user_id):
    return _base(job_id, user_id) + CHAT_SUFFIX


def _start_path(job_id, user_id):
    return _base(job_id, user_id) + ".start.json"


def set_record_start(job_id, user_id, started_at):
    """Remember the video-recording epoch so live timestamps map correctly."""
    try:
        with open(_start_path(job_id, user_id), "w", encoding="utf-8") as handle:
            json.dump({"record_started_at": float(started_at)}, handle)
    except OSError:
        pass


def _record_start(job_id, user_id):
    try:
        with open(_start_path(job_id, user_id), encoding="utf-8") as handle:
            value = json.load(handle).get("record_started_at")
        return float(value) if value is not None else None
    except (OSError, ValueError, TypeError, json.JSONDecodeError):
        return None


def _chat_paths(job_id, user_id):
    base = _base(job_id, user_id)
    return [base + CHAT_SUFFIX, base + CHAT_SUFFIX + ".part"]


def _cleanup_fragments(prefix):
    for path in glob.glob(prefix + ".*-Frag*"):
        try:
            os.remove(path)
        except OSError:
            pass


def _command(url, prefix):
    return [
        *downloader.ytdlp_command(),
        "--skip-download",
        "--write-subs",
        "--sub-langs", "live_chat",
        "--sub-format", "json",
        "--no-playlist",
        "--no-warnings",
        "--no-part",
        "--retries", "1",
        "--socket-timeout", "30",
        "-o", prefix + ".%(ext)s",
        url,
    ]


def has_chat(info):
    """Chat spikes are only attempted for an active live stream."""
    return downloader.is_live_info(info)


def _text_value(value):
    if isinstance(value, str):
        return value
    if not isinstance(value, dict):
        return ""
    text = value.get("simpleText")
    if text:
        return str(text)
    return "".join(str(run.get("text") or run.get("emoji") or "") for run in value.get("runs") or [])


def _body(action):
    if not isinstance(action, dict):
        return None
    add = action.get("addChatItemAction") or {}
    item = add.get("item") or {}
    for key in _ITEM_KEYS:
        body = item.get(key)
        if isinstance(body, dict):
            return body
    for key in _ITEM_KEYS:
        body = action.get(key)
        if isinstance(body, dict):
            return body
    return None


def _offset_ms(item, replay):
    raw = item.get("videoOffsetTimeMsec")
    if raw is None:
        raw = replay.get("videoOffsetTimeMsec")
    if raw is None:
        return None
    try:
        return float(raw) / 1000.0
    except (TypeError, ValueError):
        return None


def _parse_file(path, duration, shift=0.0, start_epoch=None):
    duration = max(1.0, float(duration or 0))
    start_epoch = float(start_epoch) if start_epoch is not None else None
    events = []
    seen = set()
    try:
        with open(path, encoding="utf-8", errors="replace") as handle:
            for line in handle:
                line = line.strip()
                if not line:
                    continue
                try:
                    item = json.loads(line)
                except (json.JSONDecodeError, TypeError):
                    continue
                if not isinstance(item, dict):
                    continue
                replay = item.get("replayChatItemAction") or {}
                raw_offset = _offset_ms(item, replay)
                if raw_offset is None:
                    continue
                offset = raw_offset - float(shift or 0)
                actions = replay.get("actions") or item.get("actions") or []
                if not actions and item.get("addChatItemAction"):
                    actions = [item]
                for action in actions:
                    body = _body(action)
                    if not body:
                        continue
                    text = _text_value(body.get("message")).strip()
                    author_name = _text_value(body.get("authorName")).strip()
                    author_id = str(body.get("authorExternalChannelId") or author_name or "")
                    # yt-dlp's live pseudo-events carry a wall-clock timestamp;
                    # it maps cleanly onto the video recording even when the
                    # first history batch arrives with offset zero.
                    event_offset = offset
                    timestamp = body.get("timestampUsec")
                    if item.get("isLive") and timestamp is not None and start_epoch is not None:
                        try:
                            event_offset = float(timestamp) / 1_000_000.0 - start_epoch
                        except (TypeError, ValueError):
                            event_offset = offset
                    if event_offset < -1.5 or event_offset > duration + 1.5:
                        continue
                    ident = str(body.get("id") or "")
                    if not ident:
                        ident = f"{event_offset:.3f}|{author_id}|{text[:80]}"
                    if ident in seen:
                        continue
                    seen.add(ident)
                    events.append({
                        "offset": max(0.0, min(duration, event_offset)),
                        "text": text,
                        "author": author_name,
                        "author_id": author_id,
                    })
    except OSError:
        return []
    events.sort(key=lambda event: event["offset"])
    return events


def read_events(job_id, user_id, duration, shift=0.0, start_epoch=None):
    """Read the largest cached chat file for this job, if one exists."""
    if start_epoch is None:
        start_epoch = _record_start(job_id, user_id)
    existing = []
    for path in _chat_paths(job_id, user_id):
        try:
            if os.path.isfile(path) and os.path.getsize(path) > 0:
                existing.append(path)
        except OSError:
            continue
    if not existing:
        return []
    path = max(existing, key=os.path.getsize)
    return _parse_file(path, duration, shift=shift, start_epoch=start_epoch)


class LiveChatCapture:
    """Capture live chat in a thread while the video recorder is running."""

    def __init__(self, url, job_id, user_id):
        self.url = url
        self.job_id = job_id
        self.user_id = user_id
        self.prefix = _base(job_id, user_id)
        self.started_at = None
        self.error = None
        self.proc = None
        self.thread = None
        self._stop = threading.Event()

    def start(self):
        # A retry may reuse the job id; never mix chat from an older recording
        # into the new timeline.
        for path in _chat_paths(self.job_id, self.user_id):
            try:
                os.remove(path)
            except OSError:
                pass
        try:
            os.remove(_start_path(self.job_id, self.user_id))
        except OSError:
            pass
        _cleanup_fragments(self.prefix)
        self.started_at = time.time()
        self.thread = threading.Thread(target=self._run, name=f"live-chat-{self.job_id}", daemon=True)
        self.thread.start()

    def _run(self):
        env = dict(os.environ, PYTHONUNBUFFERED="1")
        try:
            self.proc = subprocess.Popen(
                _command(self.url, self.prefix),
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                start_new_session=True,
                env=env,
            )
        except (OSError, ValueError) as exc:
            self.error = str(exc)
            return
        while self.proc.poll() is None and not self._stop.wait(0.25):
            pass
        if self.proc.poll() is None:
            downloader._stop_process(self.proc, force=False)
            try:
                self.proc.wait(timeout=4)
            except subprocess.TimeoutExpired:
                downloader._stop_process(self.proc, force=True)

    def stop(self):
        self._stop.set()
        if self.proc is not None and self.proc.poll() is None:
            downloader._stop_process(self.proc, force=False)
        if self.thread is not None:
            self.thread.join(timeout=6)
        if self.proc is not None and self.proc.poll() is None:
            downloader._stop_process(self.proc, force=True)
            try:
                self.proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                pass
        _cleanup_fragments(self.prefix)
        return chat_path(self.job_id, self.user_id)


def _window_text(segments, start, end):
    return " ".join(
        str(segment.get("text") or "")
        for segment in (segments or [])
        if float(segment.get("end") or 0) > start and float(segment.get("start") or 0) < end
    )[:500]


def _time_label(seconds):
    total = max(0, int(seconds))
    hours, rest = divmod(total, 3600)
    minutes, secs = divmod(rest, 60)
    return f"{hours}:{minutes:02d}:{secs:02d}" if hours else f"{minutes}:{secs:02d}"


def _authors(events, start, end):
    return {
        event["author_id"] or event["author"]
        for event in events
        if start <= event["offset"] < end
    }


def spike_candidates(events, duration, count, target=45, clip_mode="separate", segments=None):
    """Turn a chat message timeline into clip candidates around rate spikes."""
    duration = max(1.0, float(duration or 0))
    if not events or duration < 5:
        return []
    try:
        target = max(8, min(180, int(target or 45)))
    except (TypeError, ValueError):
        target = 45
    window = min(float(target), duration)
    if window < 8:
        return []
    offsets = [float(event["offset"]) for event in events if 0 <= event["offset"] <= duration]
    if len(offsets) < 4:
        return []

    # Detect on a short window so a burst is not averaged away by the full
    # 30–90s clip length; then expand each peak to a complete clip.
    scan_window = max(5.0, min(15.0, window / 3.0))
    starts = []
    cursor = 0.0
    while cursor + scan_window <= duration + 0.01:
        starts.append(cursor)
        cursor += 1.0
    if not starts:
        starts = [0.0]

    rows = []
    for start in starts:
        end = start + scan_window
        count_in_window = bisect_right(offsets, end) - bisect_left(offsets, start)
        rows.append((count_in_window, start, end))
    baseline = max(1.0, float(statistics.median([row[0] for row in rows])))
    minimum = max(5, int(round(baseline * 1.5)))

    qualifying = [
        (count_in_window, start, end)
        for count_in_window, start, end in rows
        if count_in_window >= minimum
    ]
    if not qualifying:
        return []

    qualifying.sort(key=lambda row: (-row[0], row[1]))
    wanted = 3 if clip_mode == "multi_cut" else max(1, int(count or 1))
    chosen = []
    for count_in_window, start, end in qualifying:
        unique = len(_authors(events, start, end))
        if unique < max(3, min(12, int(count_in_window * 0.12))):
            continue
        peak = start + scan_window / 2.0
        clip_start = max(0.0, min(duration - window, peak - window * 0.35))
        clip_end = clip_start + window
        if any(clip_start < item["end"] - 1 and clip_end > item["start"] + 1 for item in chosen):
            continue
        chosen.append({
            "start": clip_start,
            "end": clip_end,
            "peak": peak,
            "peak_count": count_in_window,
        })
        if len(chosen) >= wanted:
            break

    if not chosen:
        return []
    if clip_mode == "multi_cut":
        return _multi_cut_candidate(chosen, duration, target, segments, baseline, scan_window)
    return _separate_candidates(chosen, count, segments, baseline, scan_window)


def _separate_candidates(chosen, count, segments, baseline, scan_window):
    out = []
    for item in chosen[:max(1, int(count or 1))]:
        start, end = item["start"], item["end"]
        out.append({
            "start": round(start, 2),
            "end": round(end, 2),
            "title": f"Chat goes wild at {_time_label(item['peak'])}",
            "reason": (
                f"{item['peak_count']} chat messages in {int(scan_window)}s "
                f"({item['peak_count'] / baseline:.1f}× typical chat)"
            ),
            "transcript": _window_text(segments, start, end),
            "score": round(item["peak_count"] / baseline, 2),
        })
    return out


def _multi_cut_candidate(chosen, duration, target, segments, baseline, scan_window):
    cut_count = min(3, len(chosen))
    if cut_count < 2:
        return []
    cut_length = max(8.0, float(target) / cut_count)
    cuts = []
    for item in chosen[:cut_count]:
        start = max(0.0, min(duration - cut_length, item["peak"] - cut_length / 2.0))
        if cuts and start < cuts[-1]["end"] + 1.0:
            start = min(duration - cut_length, cuts[-1]["end"] + 1.0)
        end = min(duration, start + cut_length)
        if end - start >= 2.0:
            cuts.append({
                "start": round(start, 2),
                "end": round(end, 2),
            })
    if len(cuts) < 2:
        return []
    total = sum(cut["end"] - cut["start"] for cut in cuts)
    title = f"Chat spike stack · {len(cuts)} moments"
    reason = (
        f"{sum(item['peak_count'] for item in chosen[:cut_count])} chat messages across "
        f"{len(cuts)} surges ({total:.0f}s total)"
    )
    return [{
        "start": cuts[0]["start"],
        "end": cuts[-1]["end"],
        "cuts": cuts,
        "title": title,
        "reason": reason,
        "transcript": " ".join(
            _window_text(segments, cut["start"], cut["end"]) for cut in cuts
        )[:500],
        "score": round(sum(item["peak_count"] for item in chosen[:cut_count]) / baseline, 2),
    }]


def _overlaps(a, b):
    try:
        return float(a["start"]) < float(b["end"]) and float(a["end"]) > float(b["start"])
    except (KeyError, TypeError, ValueError):
        return False


def merge_candidates(chat_candidates, normal_candidates, count):
    """Prefer chat-spike clips, then fill any remaining slots with normal picks."""
    out = []
    for candidate in chat_candidates or []:
        if len(out) >= count:
            break
        out.append(candidate)
    for candidate in normal_candidates or []:
        if len(out) >= count:
            break
        if not any(_overlaps(candidate, existing) for existing in out):
            out.append(candidate)
    return out
