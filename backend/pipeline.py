"""Durable, user-scoped analysis and render pipeline.

The web layer only enqueues work. A database-backed worker claims queued jobs
and calls the synchronous run_* functions below, so a restart can resume work
instead of silently losing an in-process thread.
"""
import json
import os
import threading

from . import clipper, db, downloader, highlights, qa, settings as s, transcribe

_analyze_lock = threading.Lock()
_events_lock = threading.Lock()
_cancel_events: dict[int, threading.Event] = {}


class JobCanceled(Exception):
    pass


def _meta_path(job_id, user_id):
    return os.path.join(downloader.user_media_dir(user_id), f"job{job_id}_meta.json")


def _load_meta(job_id, user_id):
    try:
        with open(_meta_path(job_id, user_id), encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError, json.JSONDecodeError):
        return {}


def _save_meta(job_id, user_id, data):
    path = _meta_path(job_id, user_id)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
    os.replace(tmp, path)


def _event(job_id):
    with _events_lock:
        return _cancel_events.setdefault(job_id, threading.Event())


def _check(ev):
    if ev.is_set():
        raise JobCanceled()


def _stage_cb(job_id, ev):
    def cb(stage, progress):
        _check(ev)
        db.update_job(job_id, stage=stage, progress=progress, status="running")

    return cb


def request_cancel(job_id, user_id=None):
    """Ask a job to stop; the worker checks this event between steps."""
    job = db.get_job(job_id, user_id)
    if not job:
        return False
    ev = _event(job_id)
    ev.set()
    if job["status"] in ("queued", "review"):
        db.update_job(job_id, status="canceled", stage="canceled", error=None)
        db.log(job_id, "Job canceled", "warn")
    elif job["status"] == "running":
        db.update_job(job_id, stage="canceling")
        db.log(job_id, "Canceling — finishing the current step…", "warn")
    return True


def clear_cancel(job_id):
    _event(job_id).clear()


def _as_bool(value, default=False):
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in ("1", "true", "yes", "on")
    if value is None:
        return default
    return bool(value)


def _options(user_id, job=None, extra=None):
    opts = {
        "privacy": s.get(user_id, "default_privacy", "private") or "private",
        "caption_preset": s.get(user_id, "caption_preset", "gruvbox") or "gruvbox",
        "caption_size": int(s.get(user_id, "caption_size", 46) or 46),
        "caption_position": s.get(user_id, "caption_position", "bottom") or "bottom",
        "caption_color": s.get(user_id, "caption_color", "") or "",
        "caption_uppercase": _as_bool(s.get(user_id, "caption_uppercase", True), True),
        "caption_box": _as_bool(s.get(user_id, "caption_box", False), False),
        "caption_animation": s.get(user_id, "caption_animation", "static") or "static",
        "caption_highlight": s.get(user_id, "caption_highlight", "#fabd2f") or "#fabd2f",
        "caption_align": _as_bool(s.get(user_id, "caption_align", True), True),
        "clip_duration": int(s.get(user_id, "short_length", 45) or 45),
        "clip_mode": s.get(user_id, "clip_mode", "separate") or "separate",
        "gpu_enabled": _as_bool(s.get(user_id, "gpu_enabled", True), True),
        "reframe": s.get(user_id, "reframe", "crop") or "crop",
        "resolution": str(s.get(user_id, "resolution", "1080") or "1080"),
        "quality": s.get(user_id, "quality", "balanced") or "balanced",
        "tags": s.get(user_id, "upload_tags", "shorts, clips") or "shorts, clips",
        "category_id": str(s.get(user_id, "category_id", "") or ""),
        "auto_upload": False,
    }
    if job:
        try:
            stored = json.loads(job.get("options") or "{}")
        except (json.JSONDecodeError, TypeError):
            stored = {}
        if isinstance(stored, dict):
            opts.update({k: v for k, v in stored.items() if v is not None})
    if extra:
        opts.update({k: v for k, v in extra.items() if v is not None})
    if opts.get("privacy") not in ("public", "unlisted", "private"):
        opts["privacy"] = "private"
    if str(opts.get("resolution")) not in ("1080", "720"):
        opts["resolution"] = "1080"
    if opts.get("reframe") not in ("crop", "blur"):
        opts["reframe"] = "crop"
    if opts.get("clip_mode") not in ("separate", "multi_cut"):
        opts["clip_mode"] = "separate"
    if opts.get("caption_animation") not in ("static", "word", "pop"):
        opts["caption_animation"] = "static"
    if opts.get("caption_position") not in ("bottom", "center", "top"):
        opts["caption_position"] = "bottom"
    try:
        opts["clip_duration"] = max(10, min(120, int(opts.get("clip_duration") or 45)))
    except (TypeError, ValueError):
        opts["clip_duration"] = 45
    try:
        opts["caption_size"] = max(20, min(80, int(opts.get("caption_size") or 46)))
    except (TypeError, ValueError):
        opts["caption_size"] = 46
    return opts


def _set_options(job_id, options):
    db.update_job(job_id, options=json.dumps(options or {}))


def _source_info(source, job):
    return {
        "path": source,
        "title": job.get("title") or "video",
        "duration": downloader.probe_duration(source),
        "channel": "",
    }


def run_analyze(job_id):
    """Transcript-first analysis. Called by the durable worker."""
    job = db.get_job(job_id)
    if not job:
        return
    user_id = job["user_id"]
    ev = _event(job_id)
    ev.clear()
    try:
        with _analyze_lock:
            _check(ev)
            merged = _options(user_id, job)
            _set_options(job_id, merged)
            db.update_job(job_id, status="running", stage="downloading", progress=0.02, error=None)
            cb = _stage_cb(job_id, ev)
            source = downloader.existing_source(job_id, user_id)
            analysis_media = None
            segments = None
            raw_info = None

            if source:
                info = _source_info(source, job)
                if info["duration"] <= 0:
                    db.log(job_id, "Existing source could not be read — switching to transcript-first mode", "warn")
                    source = None
                else:
                    db.log(job_id, "Reusing downloaded source video — skipping download")
                    db.update_job(job_id, stage="downloading", progress=0.24)
                    segments = transcribe.transcribe(
                        source, job_id, user_id, cb, job["url"], cancel_cb=ev.is_set
                    )
                    analysis_media = source

            if not source:
                db.update_job(job_id, stage="downloading", progress=0.06)
                db.log(job_id, "Reading video metadata and caption tracks (no video downloaded)…")
                try:
                    raw_info = downloader.probe(job["url"])
                except Exception as e:
                    raise RuntimeError(f"Could not read this YouTube video: {e}") from e
                duration = float(raw_info.get("duration") or 0)
                if duration <= 0:
                    raise RuntimeError("This video reports no duration (a live stream?)")
                info = {
                    "path": None,
                    "title": raw_info.get("title") or "video",
                    "duration": duration,
                    "channel": raw_info.get("uploader") or raw_info.get("channel") or "",
                }
                db.update_job(job_id, title=info["title"], stage="downloading", progress=0.16)
                _check(ev)
                segments, label = transcribe.fetch_online(
                    job_id, job["url"], user_id, info=raw_info, cancel_cb=ev.is_set
                )
                _check(ev)
                if segments:
                    db.log(job_id, f"Timed transcript ready ({len(segments)} segments) — video still not downloaded")
                    db.update_job(job_id, stage="transcribing", progress=0.46)
                else:
                    db.log(job_id, f"{label} — trying audio-only analysis", "warn")
                    try:
                        audio = downloader.download_audio(job["url"], job_id, user_id, cancel_cb=ev.is_set)
                        analysis_media = audio
                        segments = transcribe.transcribe(
                            audio, job_id, user_id, cb, None, cancel_cb=ev.is_set,
                            try_online=False,
                        )
                    except JobCanceled:
                        raise
                    except Exception as e:
                        db.log(job_id, f"Audio-only analysis failed: {e}", "warn")
                        segments = None

            _check(ev)
            db.update_job(job_id, stage="analyzing", progress=0.66)
            clip_mode = str(merged.get("clip_mode") or "separate")
            target_length = int(merged.get("clip_duration") or 45)
            wanted = 1 if clip_mode == "multi_cut" else max(1, int(job["short_count"]))
            cands = highlights.pick_highlights(
                analysis_media, info["title"], info["duration"], segments,
                wanted, job_id, user_id, target_length, clip_mode,
            )
            _check(ev)

        if not cands:
            raise RuntimeError(
                "No highlight candidates found. Add an AI provider or install faster-whisper."
            )
        _save_meta(job_id, user_id, {
            "path": source,
            "duration": info["duration"],
            "segments": segments or [],
            "title": info["title"],
            "channel": info.get("channel") or "",
            "url": job["url"],
            "analysis": "captions" if (segments and not analysis_media) else "media",
        })
        db.update_job(
            job_id, status="review", stage="review", progress=1.0,
            candidates=json.dumps(cands),
        )
        db.log(job_id, f"Found {len(cands)} candidates — video not downloaded yet; render only the selected ranges")
    except JobCanceled:
        db.update_job(job_id, status="canceled", stage="canceled", error=None)
        db.log(job_id, "Job canceled", "warn")
    except Exception as e:
        if ev.is_set():
            db.update_job(job_id, status="canceled", stage="canceled", error=None)
            db.log(job_id, "Job canceled", "warn")
        else:
            db.log(job_id, f"Failed: {e}", "error")
            db.update_job(job_id, status="error", error=str(e))


def run_manual(job_id):
    """Download one user-specified range and prepare it for preview/render."""
    job = db.get_job(job_id)
    if not job:
        return
    user_id = job["user_id"]
    ev = _event(job_id)
    ev.clear()
    try:
        merged = _options(user_id, job)
        _set_options(job_id, merged)
        try:
            start = max(0.0, float(merged.get("manual_start")))
            end = float(merged.get("manual_end"))
        except (TypeError, ValueError):
            raise RuntimeError("Enter valid start and end timestamps")
        if end <= start + 1.0:
            raise RuntimeError("Manual cut end must be after its start")
        if end - start > 180:
            raise RuntimeError("Manual cuts are limited to 180 seconds")
        db.update_job(
            job_id, status="running", stage="downloading", progress=0.03,
            error=None, candidates="[]", uploads="[]", selected="[]",
        )
        db.log(job_id, f"Manual cut requested: {start:.1f}s–{end:.1f}s")
        try:
            raw_info = downloader.probe(job["url"])
        except Exception as e:
            raise RuntimeError(f"Could not read this YouTube video: {e}") from e
        duration = float(raw_info.get("duration") or 0)
        if duration and end > duration + 0.5:
            raise RuntimeError(f"End time is past the video duration ({duration:.0f}s)")
        title = raw_info.get("title") or "video"
        db.update_job(job_id, title=title)
        segments, label = transcribe.fetch_online(
            job_id, job["url"], user_id, info=raw_info, cancel_cb=ev.is_set
        )
        _check(ev)
        if segments:
            db.log(job_id, f"Captions ready ({label}) — captions will be burned into the render")
        else:
            db.log(job_id, f"{label} — manual preview will render without captions", "warn")

        db.update_job(job_id, stage="downloading", progress=0.25)
        section = downloader.download_section(
            job["url"], job_id, start, end, user_id, tag="manual", cancel_cb=ev.is_set
        )
        _check(ev)
        candidate = {
            "start": start,
            "end": end,
            "title": "Manual cut",
            "reason": "User-selected range downloaded directly",
            "transcript": " ".join(
                s["text"] for s in (segments or [])
                if s["end"] > start and s["start"] < end
            )[:500],
            "score": None,
        }
        _save_meta(job_id, user_id, {
            "path": None,
            "duration": duration,
            "segments": segments or [],
            "title": title,
            "channel": raw_info.get("uploader") or "",
            "url": job["url"],
            "manual_section": section["path"],
            "manual_start": start,
            "manual_end": end,
            "analysis": "manual",
        })
        merged.update({
            "manual": True,
            "manual_preview": os.path.basename(section["path"]),
            "manual_start": start,
            "manual_end": end,
        })
        _set_options(job_id, merged)
        db.update_job(
            job_id, status="review", stage="manual", progress=1.0,
            candidates=json.dumps([candidate]),
        )
        db.log(job_id, f"Manual section downloaded ({section['duration']:.1f}s) — preview ready")
    except JobCanceled:
        db.update_job(job_id, status="canceled", stage="canceled", error=None)
        db.log(job_id, "Manual cut canceled", "warn")
    except Exception as e:
        if ev.is_set():
            db.update_job(job_id, status="canceled", stage="canceled", error=None)
            db.log(job_id, "Manual cut canceled", "warn")
        else:
            db.log(job_id, f"Manual cut failed: {e}", "error")
            db.update_job(job_id, status="error", error=str(e))


def queue_render(user_id, job_id, clips, options=None):
    """Persist a render request and let the worker pick it up."""
    job = db.get_job(job_id, user_id)
    if not job:
        return False
    merged = _options(user_id, job, options)
    merged["render_clips"] = clips
    db.update_job(
        job_id, status="queued", stage="queued", kind="render", progress=0.0,
        error=None, options=json.dumps(merged),
    )
    db.log(job_id, f"Queued {len(clips)} clip{'' if len(clips) == 1 else 's'} for rendering")
    try:
        from . import worker
        worker.wake()
    except Exception:
        pass
    return True


def candidate_captions(job_id, idx, user_id):
    job = db.get_job(job_id, user_id)
    if not job:
        raise RuntimeError("Job not found")
    try:
        cands = json.loads(job.get("candidates") or "[]")
        cand = cands[int(idx)]
        start, end = float(cand["start"]), float(cand["end"])
    except (IndexError, KeyError, TypeError, ValueError):
        raise RuntimeError("Candidate not found")
    existing = cand.get("caption_segments")
    if existing:
        return {"segments": existing, "custom": True}
    meta = _load_meta(job_id, user_id)
    segments = [
        {"start": float(s["start"]), "end": float(s["end"]), "text": s.get("text") or ""}
        for s in (meta.get("segments") or [])
        if float(s.get("end") or 0) > start and float(s.get("start") or 0) < end
    ]
    return {"segments": segments, "custom": False}


def save_candidate_captions(job_id, idx, user_id, segments):
    job = db.get_job(job_id, user_id)
    if not job:
        raise RuntimeError("Job not found")
    try:
        cands = json.loads(job.get("candidates") or "[]")
        cand = cands[int(idx)]
        start, end = float(cand["start"]), float(cand["end"])
    except (IndexError, KeyError, TypeError, ValueError):
        raise RuntimeError("Candidate not found")
    clean = []
    for item in segments or []:
        try:
            cs, ce = float(item["start"]), float(item["end"])
        except (KeyError, TypeError, ValueError):
            continue
        text = " ".join(str(item.get("text") or "").split())
        if not text or ce <= cs:
            continue
        if ce <= start or cs >= end:
            continue
        clean.append({
            "start": max(start, cs), "end": min(end, ce), "text": text[:320],
        })
    cand["caption_segments"] = clean
    db.update_job(job_id, candidates=json.dumps(cands))
    return clean


def preview_candidate(job_id, idx, user_id):
    job = db.get_job(job_id, user_id)
    if not job:
        raise RuntimeError("Job not found")
    try:
        cands = json.loads(job.get("candidates") or "[]")
        cand = cands[int(idx)]
        start = float(cand["start"])
        end = float(cand["end"])
    except (IndexError, KeyError, TypeError, ValueError):
        raise RuntimeError("Candidate not found")
    if end <= start + 0.5 or end - start > 180:
        raise RuntimeError("Invalid candidate range")
    section = downloader.download_section(
        job["url"], job_id, start, end, user_id,
        tag=f"preview{int(idx)}", max_height=360,
    )
    return {"path": section["path"], "filename": os.path.basename(section["path"]), "duration": section["duration"]}


def _download_ranges(job_id, url, user_id, ranges, tag_prefix, ev, log_label):
    sections = []
    for n, (start, end) in enumerate(ranges):
        _check(ev)
        db.log(job_id, f"Downloading selected range {start:.1f}s–{end:.1f}s for {log_label}")
        section = downloader.download_section(
            url, job_id, start, end, user_id, tag=f"{tag_prefix}_{n}", cancel_cb=ev.is_set
        )
        sections.append(section)
    return sections


def _render_clip(job_id, job, user_id, opts, meta, cand, segments, idx, ev):
    start = float(cand["start"])
    end = float(cand["end"])
    cuts = []
    for cut in cand.get("cuts") or []:
        try:
            cs, ce = float(cut["start"]), float(cut["end"])
        except (KeyError, TypeError, ValueError):
            continue
        if ce > cs + 0.5:
            cuts.append((cs, ce))
    ranges = cuts if len(cuts) > 1 else [(start, end)]
    clip_segments = cand.get("caption_segments") or segments

    full_source = meta.get("path")
    if not full_source or not os.path.exists(full_source):
        full_source = downloader.existing_source(job_id, user_id)

    if full_source and os.path.exists(full_source):
        return clipper.make_clip(
            full_source, cand, idx, job_id, clip_segments,
            lambda stage, prog: None, opts, lambda: ev.is_set(),
            log_render=True, user_id=user_id,
        )

    manual_section = meta.get("manual_section")
    manual_start = float(meta.get("manual_start") or 0)
    manual_end = float(meta.get("manual_end") or 0)
    if (
        manual_section and os.path.exists(manual_section)
        and abs(start - manual_start) < 0.2
        and abs(end - manual_end) < 0.2
    ):
        db.log(job_id, "Using the already-downloaded manual section for rendering")
        sections = [{
            "path": manual_section,
            "start": manual_start,
            "end": manual_end,
            "duration": downloader.probe_duration(manual_section) or (manual_end - manual_start),
        }]
    else:
        try:
            sections = _download_ranges(
                job_id, job["url"], user_id, ranges, f"short{idx}", ev, f"short {idx + 1}",
            )
        except JobCanceled:
            raise
        except Exception as e:
            db.log(job_id, f"Section download failed ({e}) — falling back to a full source download", "warn")
            info = downloader.download(job["url"], job_id, user_id, lambda stage, prog: None, cancel_cb=ev.is_set)
            meta["path"] = info["path"]
            _save_meta(job_id, user_id, meta)
            return clipper.make_clip(
                info["path"], cand, idx, job_id, clip_segments,
                lambda stage, prog: None, opts, lambda: ev.is_set(),
                log_render=True, user_id=user_id,
            )

    return clipper.render_sections(
        sections, cand, idx, job_id, clip_segments,
        lambda stage, prog: None, opts, lambda: ev.is_set(), user_id=user_id,
    )


def run_render(job_id):
    job = db.get_job(job_id)
    if not job:
        return
    user_id = job["user_id"]
    ev = _event(job_id)
    ev.clear()
    opts = _options(user_id, job)
    clips = opts.get("render_clips") or []
    uploads = []
    total = max(1, len(clips))
    current = 0
    db.update_job(job_id, status="running", stage="clipping", error=None, progress=0.02, uploads="[]")
    db.log(job_id, "Render started — downloading only the selected ranges")
    try:
        cands = json.loads(job["candidates"] or "[]")
        meta = _load_meta(job_id, user_id)
        if not meta:
            raise RuntimeError("Analysis data is missing — retry the job")
        segments = meta.get("segments") or None
        db.update_job(
            job_id, status="running", stage="clipping", error=None,
            selected=json.dumps([c.get("index") for c in clips]),
            uploads="[]", progress=0.03,
        )

        for n, clip in enumerate(clips, 1):
            _check(ev)
            current = n
            try:
                idx = int(clip.get("index"))
            except (TypeError, ValueError):
                raise RuntimeError("Invalid clip index")
            if idx < 0 or idx >= len(cands):
                raise RuntimeError(f"Clip index {idx} is out of range")

            cand = dict(cands[idx])
            for key in ("start", "end", "title"):
                if clip.get(key) not in (None, ""):
                    cand[key] = clip[key]
            try:
                cand["start"] = max(0.0, float(cand["start"]))
                cand["end"] = float(cand["end"])
            except (TypeError, ValueError):
                raise RuntimeError("Invalid clip timestamps")
            if cand["end"] <= cand["start"] + 1:
                raise RuntimeError("Clip end must be after its start")
            if cand["end"] - cand["start"] > 180:
                raise RuntimeError("A clip cannot be longer than 180 seconds")
            cand["title"] = str(cand.get("title") or "Highlight")[:90]

            slice_start = 0.04 + 0.82 * ((n - 1) / total)
            slice_span = 0.82 / total
            db.update_job(job_id, stage="clipping", progress=round(slice_start, 3))
            cuts = cand.get("cuts") or []
            detail = f" · {len(cuts)} cuts" if len(cuts) > 1 else f" [{cand['start']:.0f}-{cand['end']:.0f}s]"
            db.log(job_id, f"Rendering short {n}: {cand['title']}{detail}")
            result = _render_clip(job_id, job, user_id, opts, meta, cand, segments, idx, ev)
            _check(ev)

            duration = (
                sum(max(0.0, float(c["end"]) - float(c["start"])) for c in cuts)
                if len(cuts) > 1 else cand["end"] - cand["start"]
            )
            qa_result = qa.check_clip(result["path"])
            clip_id = db.add_clip(
                user_id, job_id, cand["title"], result["path"], result.get("thumb"),
                duration, uploaded=False, privacy=opts.get("privacy"),
                qa_status=qa_result["status"], qa_json=json.dumps(qa_result),
                description=cand.get("caption_text") or "",
            )
            entry = {
                "clip_id": clip_id,
                "index": idx,
                "path": result["path"],
                "thumb": result.get("thumb"),
                "title": cand["title"],
                "duration": round(duration, 2),
                "uploaded": False,
                "privacy": opts.get("privacy"),
                "qa_status": qa_result["status"],
            }
            uploads.append(entry)
            db.update_job(
                job_id, uploads=json.dumps(uploads),
                progress=round(slice_start + slice_span, 3),
            )
            db.log(job_id, f"Saved locally: {os.path.basename(result['path'])} · QA {qa_result['status']}")

        _check(ev)
        db.update_job(job_id, status="done", stage="done", progress=1.0, uploads=json.dumps(uploads))
        db.log(job_id, f"Job complete ✅ — {len(uploads)} short{'' if len(uploads) == 1 else 's'} rendered; upload from History when ready")
    except JobCanceled:
        db.update_job(
            job_id, status="canceled", stage="canceled", uploads=json.dumps(uploads),
            progress=round(0.04 + 0.82 * (current / total), 3),
        )
        db.log(job_id, "Render canceled", "warn")
    except Exception as e:
        if ev.is_set():
            db.update_job(job_id, status="canceled", stage="canceled", uploads=json.dumps(uploads))
            db.log(job_id, "Render canceled", "warn")
        else:
            db.log(job_id, f"Failed: {e}", "error")
            db.update_job(job_id, status="error", error=str(e), uploads=json.dumps(uploads))
