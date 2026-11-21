"""Chat-spike highlights from a live stream.

Live clipping is deliberately bounded: chat is watched for a rate surge, then
video is recorded around each surge and recording stops once the post-spike
padding is covered. Ordinary videos are excluded because normal YouTube
comments have no video-time coordinate.
"""
import glob
import json
import os
import re
import shutil
import statistics
import subprocess
import threading
import time
from bisect import bisect_left, bisect_right

from . import config, downloader

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


def clear(job_id, user_id):
    """Remove cached live chat for this job so a retry starts clean."""
    for path in _chat_paths(job_id, user_id) + [_start_path(job_id, user_id)]:
        try:
            os.remove(path)
        except OSError:
            pass
    _cleanup_fragments(_base(job_id, user_id))


def _cleanup_fragments(prefix):
    for path in glob.glob(prefix + ".*-Frag*"):
        try:
            os.remove(path)
        except OSError:
            pass


def _command(url, prefix):
    return [
        *downloader.ytdlp_command(),
        *downloader.ytdlp_common_args(),
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


def _emoji_text(emoji):
    if isinstance(emoji, str):
        return emoji
    if not isinstance(emoji, dict):
        return ""
    ident = emoji.get("emojiId")
    if ident:
        return str(ident)
    shortcuts = emoji.get("shortcuts") or []
    return str(shortcuts[0]) if shortcuts else ""


def _text_value(value):
    if isinstance(value, str):
        return value
    if not isinstance(value, dict):
        return ""
    text = value.get("simpleText")
    if text:
        return str(text)
    return "".join(
        str(run.get("text") or _emoji_text(run.get("emoji")) or "")
        for run in value.get("runs") or []
    )


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


def _parse_item(item, duration, shift, start_epoch, seen):
    """Turn one JSONL chat record into events at video-recording offsets."""
    if not isinstance(item, dict):
        return []
    replay = item.get("replayChatItemAction") or {}
    raw_offset = _offset_ms(item, replay)
    actions = replay.get("actions") or item.get("actions") or []
    if not actions and item.get("addChatItemAction"):
        actions = [item]
    out = []
    for action in actions:
        body = _body(action)
        if not body:
            continue
        event_offset = None
        if raw_offset is not None:
            event_offset = raw_offset - float(shift or 0)
        # yt-dlp's live pseudo-events carry a wall-clock timestamp; it maps
        # cleanly onto the video recording even when the first history batch
        # arrives with offset zero, and some live JSONL has no video offset.
        timestamp = body.get("timestampUsec")
        if item.get("isLive") and timestamp is not None and start_epoch is not None:
            try:
                event_offset = float(timestamp) / 1_000_000.0 - float(start_epoch)
            except (TypeError, ValueError):
                pass
        if event_offset is None:
            continue
        if event_offset < -1.5:
            continue
        event_offset = max(0.0, min(duration, event_offset))
        text = _text_value(body.get("message")).strip()
        author_name = _text_value(body.get("authorName")).strip()
        author_id = str(body.get("authorExternalChannelId") or author_name or "")
        ident = str(body.get("id") or "")
        if not ident:
            ident = f"{event_offset:.3f}|{author_id}|{text[:80]}"
        if ident in seen:
            continue
        seen.add(ident)
        out.append({
            "offset": event_offset,
            "text": text,
            "author": author_name,
            "author_id": author_id,
        })
    return out


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
                events.extend(_parse_item(item, duration, shift, start_epoch, seen))
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


def replay_cache_path(video_id):
    safe = re.sub(r"[^\w.-]", "_", str(video_id or "").strip())[:80]
    return os.path.join(str(config.DATA_DIR), "cache", "chat", f"{safe}.live_chat.json")


def fetch_replay(url, video_id, job_id, user_id, duration, cancel_cb=None, timeout=240):
    """Download YouTube's chat replay for a finished live VOD.

    Chat replay is the strongest free signal for past streams. It is cached by
    video id under ``data/cache/chat`` so a second user (or a retry) never
    downloads the same replay twice. Failures are non-fatal: the pipeline keeps
    the transcript and heatmap signals.
    """
    video_id = str(video_id or "").strip()
    if not video_id:
        return []
    cache = replay_cache_path(video_id)
    try:
        if os.path.isfile(cache) and os.path.getsize(cache) > 0:
            events = _parse_file(cache, duration)
            if events:
                return events
    except OSError:
        pass

    os.makedirs(os.path.dirname(cache), exist_ok=True)
    prefix = os.path.join(
        downloader.user_media_dir(user_id), f"job{job_id}_chat_replay"
    )
    try:
        downloader._run_ytdlp(_command(url, prefix), cancel_cb=cancel_cb, timeout=timeout)
    except Exception:
        if cancel_cb and cancel_cb():
            raise
        return []

    files = [
        path for path in glob.glob(prefix + "*")
        if os.path.isfile(path) and os.path.getsize(path) > 0 and "live_chat" in path
    ]
    if not files:
        return []
    source = max(files, key=os.path.getsize)
    try:
        shutil.copyfile(source, cache)
    except OSError:
        pass
    try:
        return _parse_file(source, duration)
    finally:
        # The shared cache is the durable copy; do not keep a duplicate in the
        # user's media directory where retention jobs would have to prune it.
        for path in files:
            try:
                os.remove(path)
            except OSError:
                pass


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


class LiveSpikeMonitor:
    """Follow the growing chat file and decide when recording can stop.

    The recorder polls :meth:`poll`; it returns True once the last detected
    spike has its full post-pad recorded, or once the scan/capture limit is
    reached without a spike. Parsing is incremental, so a busy chat does not
    re-read the whole file on every poll.
    """

    def __init__(self, job_id, user_id, started_at, count=1, target=45, shift=0.0,
                 pad=None, scan_seconds=None, max_seconds=None, capture=None):
        self.job_id = job_id
        self.user_id = user_id
        self.started_at = float(started_at)
        self.shift = float(shift or 0.0)
        self.count = max(1, int(count or 1))
        self.target = max(8, int(target or 45))
        self.pad = float(pad if pad is not None else downloader.live_spike_pad_seconds())
        self.scan_seconds = float(
            scan_seconds if scan_seconds is not None else downloader.live_chat_scan_seconds()
        )
        self.max_seconds = float(
            max_seconds if max_seconds is not None else downloader.live_max_capture_seconds()
        )
        self.capture = capture
        self.events = []
        self.spikes = []
        self.failure = None
        self._path = None
        self._position = 0
        self._pending = b""
        self._seen = set()
        self._last_read = -10.0
        self._last_detect = -10.0

    def elapsed(self):
        return max(0.0, time.time() - self.started_at)

    def _active_path(self):
        paths = []
        for path in _chat_paths(self.job_id, self.user_id):
            try:
                if os.path.isfile(path):
                    paths.append(path)
            except OSError:
                continue
        if not paths:
            return None
        return max(paths, key=os.path.getsize)

    def _read_new(self, elapsed):
        if elapsed - self._last_read < 1.0:
            return
        self._last_read = elapsed
        path = self._active_path()
        if path is None:
            return
        if path != self._path:
            # yt-dlp renames the .part file when a download finishes. The
            # content is preserved, so continue from the current position.
            self._path = path
        try:
            with open(path, "rb") as handle:
                size = os.path.getsize(path)
                if self._position > size:
                    self._position = 0
                    self._pending = b""
                handle.seek(self._position)
                chunk = handle.read()
                self._position = handle.tell()
        except OSError:
            return
        if not chunk:
            return
        data = self._pending + chunk
        lines = data.split(b"\n")
        self._pending = lines.pop()
        added = False
        for raw in lines:
            line = raw.decode("utf-8", "replace").strip()
            if not line:
                continue
            try:
                item = json.loads(line)
            except (json.JSONDecodeError, TypeError):
                continue
            parsed = _parse_item(item, elapsed, self.shift, self.started_at, self._seen)
            if parsed:
                self.events.extend(parsed)
                added = True
        if added:
            self.events.sort(key=lambda event: event["offset"])

    def _detect(self, elapsed):
        if elapsed < 15 or len(self.events) < 8:
            return
        if elapsed - self._last_detect < 2.0:
            return
        self._last_detect = elapsed
        for spike in detect_spikes(self.events, elapsed, self.target):
            if all(
                abs(spike["peak"] - seen["peak"]) > max(10.0, spike["scan_window"])
                for seen in self.spikes
            ):
                self.spikes.append(spike)
        self.spikes.sort(key=lambda spike: spike["peak"])

    def poll(self):
        elapsed = self.elapsed()
        self._read_new(elapsed)
        self._detect(elapsed)
        if self.spikes:
            # Stop once the requested number of spikes has been recorded with
            # its post-pad. Waiting for *every* later spike is what turned a
            # 45-second clip into a 30-minute capture on busy chats.
            needed = self.spikes[: self.count]
            last = max(spike["peak"] for spike in needed)
            return elapsed >= min(self.max_seconds, last + self.pad)
        if (
            self.capture is not None
            and not self.events
            and elapsed >= 20
            and (
                self.capture.error
                or (
                    self.capture.proc is not None
                    and self.capture.proc.poll() is not None
                )
            )
        ):
            # Do not sit through the whole scan when yt-dlp already failed or
            # exited without producing any chat.
            self.failure = "chat-unavailable"
            return True
        if elapsed >= min(self.scan_seconds, self.max_seconds):
            self.failure = "no-spike"
            return True
        return False


def _window_text(segments, start, end):
    return " ".join(
        str(segment.get("text") or "")
        for segment in (segments or [])
        if float(segment.get("end") or 0) > start and float(segment.get("start") or 0) < end
    )[:500]


def window_transcript(segments, start, end):
    """Public helper so callers can fill transcripts after recording ends."""
    return _window_text(segments, start, end)


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


def _sample_texts(events, start, end, limit=3):
    """A few chat lines so the user can recognise what the surge was about."""
    texts = []
    for event in events:
        if not (start <= event["offset"] < end):
            continue
        text = " ".join(str(event.get("text") or "").split())[:90]
        if not text or text in texts:
            continue
        texts.append(text)
        if len(texts) >= limit:
            break
    return texts


def _scan_window(target):
    try:
        target = float(target or 45)
    except (TypeError, ValueError):
        target = 45.0
    return max(5.0, min(15.0, target / 3.0))


def detect_spikes(events, duration, target=45):
    """Return chat-rate surges as chronological peaks with their scan window.

    A surge needs at least five messages in a 5–15 second window, must be at
    least 1.6× the median chat rate, and must come from several people so a
    single spammer cannot trigger a recording.
    """
    duration = max(1.0, float(duration or 0))
    if not events or duration < 15:
        return []
    scan = _scan_window(target)
    offsets = [float(event["offset"]) for event in events if 0 <= event["offset"] <= duration]
    if len(offsets) < 8:
        return []

    rows = []
    cursor = 0.0
    while cursor + scan <= duration + 0.01:
        count_in_window = bisect_right(offsets, cursor + scan) - bisect_left(offsets, cursor)
        rows.append((count_in_window, cursor, cursor + scan))
        cursor += 1.0
    if not rows:
        return []

    baseline = max(1.0, float(statistics.median(row[0] for row in rows)))
    minimum = max(5, int(round(baseline * 1.6)))
    spikes = []
    for count_in_window, start, end in rows:
        if count_in_window < minimum:
            continue
        unique = len(_authors(events, start, end))
        if unique < max(3, min(12, int(count_in_window * 0.12))):
            continue
        peak = start + scan / 2.0
        item = {
            "peak": round(peak, 2),
            "count": count_in_window,
            "scan_window": round(scan, 2),
            "ratio": round(count_in_window / baseline, 2),
            "start": round(start, 2),
            "end": round(end, 2),
            "sample": _sample_texts(events, start, end),
        }
        if spikes and peak - spikes[-1]["peak"] < scan:
            # Overlapping scan windows describe the same surge; keep the peak.
            if count_in_window > spikes[-1]["count"]:
                spikes[-1] = item
            continue
        spikes.append(item)
    return spikes


def _best_window(events, start, end, length, anchor):
    """Find the densest ``length`` window of chat inside ``start``–``end``."""
    start = max(0.0, float(start))
    end = max(start, float(end))
    length = min(float(length), end - start)
    if length < 8:
        return None
    offsets = [float(event["offset"]) for event in events if start <= float(event["offset"]) <= end]
    if not offsets:
        return None
    anchor = max(start, min(end, float(anchor)))
    best = None
    cursor = start
    while cursor + length <= end + 0.01:
        count = bisect_right(offsets, cursor + length) - bisect_left(offsets, cursor)
        score = (count, -abs((cursor + length / 2.0) - anchor))
        if best is None or score > best[0]:
            best = (score, cursor)
        cursor += 1.0
    if not best or best[0][0] < 3:
        return None
    window_start = best[1]
    window_end = window_start + length
    return {
        "start": window_start,
        "end": window_end,
        "count": best[0][0],
        "authors": len(_authors(events, window_start, window_end)),
    }


def spike_candidates(events, duration, count, target=45, segments=None, spikes=None):
    """Turn spike windows into one dense, chat-ranked moment per surge.

    Each candidate sits inside the recorded ±pad window around a surge and is
    the busiest ``target``-second slice there, which keeps the clip on the
    moment viewers actually reacted to instead of averaging the whole window.
    """
    duration = max(1.0, float(duration or 0))
    if not events or duration < 5:
        return []
    try:
        target = max(8, min(180, int(target or 45)))
    except (TypeError, ValueError):
        target = 45
    try:
        wanted = max(1, int(count or 1))
    except (TypeError, ValueError):
        wanted = 1

    found = spikes if spikes is not None else detect_spikes(events, duration, target)
    if not found:
        return []
    pad = float(downloader.live_spike_pad_seconds())
    ranked = sorted(
        found,
        key=lambda item: (item.get("count") or 0, item.get("ratio") or 0),
        reverse=True,
    )
    chosen = []
    for spike in ranked:
        peak = float(spike["peak"])
        left = max(0.0, peak - pad)
        right = min(duration, peak + pad)
        best = _best_window(events, left, right, target, peak)
        if not best:
            continue
        if any(_overlaps(best, other) for other in chosen):
            continue
        seconds = int(round(best["end"] - best["start"]))
        chosen.append({
            "start": round(best["start"], 2),
            "end": round(best["end"], 2),
            "title": f"Chat spike at {_time_label(peak)}",
            "reason": (
                f"{spike['count']} messages in {int(spike['scan_window'])}s "
                f"({spike['ratio']:.1f}× typical chat) — busiest {seconds}s "
                f"inside the {int(round(pad))}s pre/post window"
            ),
            "transcript": _window_text(segments, best["start"], best["end"]),
            "score": spike["ratio"],
            "chat_peak": round(peak, 2),
        })
        if len(chosen) >= wanted:
            break
    chosen.sort(key=lambda item: item["start"])
    return chosen


def _overlaps(a, b):
    try:
        return float(a["start"]) < float(b["end"]) and float(a["end"]) > float(b["start"])
    except (KeyError, TypeError, ValueError):
        return False


def merge_spikes(primary, extra):
    """Combine detected spikes from the live watcher and the final parse."""
    out = []
    for spike in sorted(
        list(primary or []) + list(extra or []),
        key=lambda item: float(item.get("peak") or 0),
    ):
        try:
            peak = float(spike["peak"])
        except (KeyError, TypeError, ValueError):
            continue
        if any(abs(peak - float(existing["peak"])) <= 5.0 for existing in out):
            continue
        out.append(spike)
    return out


def candidate_for_spike(events, duration, spike, target=45, pad=None, segments=None):
    """One dense, chat-ranked candidate inside a user-selected spike window."""
    duration = max(1.0, float(duration or 0))
    try:
        peak = float(spike["peak"])
    except (KeyError, TypeError, ValueError):
        return None
    try:
        target = max(8, min(180, int(target or 45)))
    except (TypeError, ValueError):
        target = 45
    pad = float(pad if pad is not None else downloader.live_spike_pad_seconds())
    left = max(0.0, peak - pad)
    right = min(duration, peak + pad)
    best = _best_window(events, left, right, target, peak)
    if not best:
        start = max(0.0, min(max(0.0, duration - target), peak - target / 2.0))
        end = min(duration, start + target)
        if end <= start + 1:
            return None
        best = {"start": start, "end": end, "count": 0, "authors": 0}
    seconds = int(round(best["end"] - best["start"]))
    count = int(best.get("count") or 0)
    ratio = float(spike.get("ratio") or 0)
    reason = (
        f"{count} chat messages in the busiest {seconds}s near the spike"
        if count
        else f"Chat spike at {_time_label(peak)} — clip centred on the surge"
    )
    if ratio:
        reason += f" ({ratio:.1f}× typical chat)"
    return {
        "start": round(best["start"], 2),
        "end": round(best["end"], 2),
        "title": f"Chat spike at {_time_label(peak)}",
        "reason": reason,
        "transcript": _window_text(segments, best["start"], best["end"]),
        "score": ratio,
        "chat_peak": round(peak, 2),
        "chat_count": count,
        "sample": spike.get("sample") or [],
    }


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
