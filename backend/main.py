"""Shorts Factory API server.

Runs as a single-workspace desktop app by default and retains the optional
multi-user server mode (APP_MODE=multi).
"""
import glob
import importlib.util
import json
import os
import platform
import shutil
import subprocess
import sys
import threading
import time
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import (
    advisor, analytics, assistant, auth, config, db, downloader, gpu, pipeline,
    qa, settings, storage, updates, uploader, worker,
)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRONTEND_DIR = os.path.join(ROOT, "frontend")


@asynccontextmanager
async def lifespan(_app):
    db.init()
    db.reset_interrupted_uploads()
    if config.LOCAL_MODE:
        owner = db.ensure_local_user(config.LOCAL_USER_EMAIL, config.LOCAL_USER_NAME)
        config.LOCAL_USER_ID = int(owner["id"])
    worker.start()
    yield
    worker.stop()


app = FastAPI(title="Shorts Factory", lifespan=lifespan)
app.add_middleware(GZipMiddleware, minimum_size=900)


# ---------- security / request middleware ----------
_ALLOWED_ORIGINS = {
    config.APP_BASE_URL,
    f"http://127.0.0.1:{config.PORT}",
    f"http://localhost:{config.PORT}",
    "http://127.0.0.1:8787",
    "http://localhost:8787",
}
_STATIC_CACHE_EXTS = (".css", ".js", ".mjs", ".svg", ".png", ".jpg", ".jpeg", ".webp", ".woff2")


@app.middleware("http")
async def security_middleware(request: Request, call_next):
    if request.method not in ("GET", "HEAD", "OPTIONS") and request.url.path.startswith("/api/"):
        origin = (request.headers.get("origin") or "").rstrip("/")
        if origin and origin not in _ALLOWED_ORIGINS:
            return JSONResponse({"detail": "Cross-origin request blocked"}, status_code=403)
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "same-origin"
    response.headers["X-Frame-Options"] = "SAMEORIGIN"
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    elif not request.url.path.startswith("/media/") and request.url.path.lower().endswith(_STATIC_CACHE_EXTS):
        # Every stylesheet/script URL carries a version query; media is handled
        # separately by FileResponse. Keep the shell itself revalidated.
        response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
    return response


def current_user(request: Request):
    if config.LOCAL_MODE:
        user = db.get_user(config.LOCAL_USER_ID) if config.LOCAL_USER_ID else None
        if not user:
            user = db.ensure_local_user(config.LOCAL_USER_EMAIL, config.LOCAL_USER_NAME)
            config.LOCAL_USER_ID = int(user["id"])
        return user
    token = request.cookies.get(config.SESSION_COOKIE, "")
    user = auth.user_for_token(token)
    if not user:
        raise HTTPException(401, "Sign in to continue")
    return user


CurrentUser = Annotated[dict, Depends(current_user)]


def _set_session(response: Response, token: str):
    response.set_cookie(
        config.SESSION_COOKIE,
        token,
        max_age=config.SESSION_TTL_DAYS * 86400,
        httponly=True,
        secure=config.COOKIE_SECURE,
        samesite="lax",
        path="/",
    )


# ---------- auth ----------
class RegisterPayload(BaseModel):
    email: str
    password: str
    display_name: str = ""
    invite: str = ""


class LoginPayload(BaseModel):
    email: str
    password: str


class PasswordPayload(BaseModel):
    current_password: str
    new_password: str


@app.get("/api/auth/config")
def auth_config():
    """Public registration context — no account details are exposed."""
    count = db.count_users()
    if config.LOCAL_MODE:
        return {
            "local": True,
            "first_account": False,
            "invite_required": False,
            "max_users": 1,
            "registration_open": False,
        }
    return {
        "local": False,
        "first_account": count == 0,
        "invite_required": bool(config.REGISTRATION_INVITE_CODE) and count > 0,
        "max_users": config.MAX_USERS,
        "registration_open": count < config.MAX_USERS,
    }


@app.get("/api/auth/me")
def auth_me(user: CurrentUser):
    return {
        "user": auth.public_user(user),
        "local": config.LOCAL_MODE,
        "app_mode": config.APP_MODE,
        "prefs": db.get_ui_prefs(user["id"]),
        "clips": db.count_clips(user["id"]),
        "uploaded": db.count_uploaded(user["id"]),
        "max_users": 1 if config.LOCAL_MODE else config.MAX_USERS,
    }


@app.get("/api/update")
def update_check(user: CurrentUser):
    """Best-effort GitHub release lookup used by the desktop update toast."""
    return updates.check_for_update(
        current_version=config.APP_VERSION,
        api_url=config.UPDATE_API_URL,
        repo=config.UPDATE_REPO,
    )


@app.post("/api/auth/register")
def auth_register(payload: RegisterPayload, response: Response):
    if config.LOCAL_MODE:
        raise HTTPException(400, "This workspace is local — no account is needed")
    try:
        user = auth.register(payload.email, payload.password, payload.display_name, payload.invite)
    except auth.AuthError as e:
        raise HTTPException(400, str(e))
    token = auth.create_session(user["id"])
    _set_session(response, token)
    return {"user": auth.public_user(user)}


@app.post("/api/auth/login")
def auth_login(payload: LoginPayload, response: Response):
    if config.LOCAL_MODE:
        raise HTTPException(400, "This workspace opens directly — sign-in is disabled")
    try:
        user = auth.authenticate(payload.email, payload.password)
    except auth.AuthError as e:
        raise HTTPException(401, str(e))
    token = auth.create_session(user["id"])
    _set_session(response, token)
    return {"user": auth.public_user(user)}


@app.post("/api/auth/logout")
def auth_logout(request: Request, response: Response):
    if config.LOCAL_MODE:
        return {"ok": True}
    auth.delete_session(request.cookies.get(config.SESSION_COOKIE, ""))
    response.delete_cookie(config.SESSION_COOKIE, path="/")
    return {"ok": True}


@app.post("/api/auth/password")
def auth_password(payload: PasswordPayload, user: CurrentUser):
    if config.LOCAL_MODE:
        raise HTTPException(400, "This workspace has no password")
    try:
        auth.authenticate(user["email"], payload.current_password)
    except auth.AuthError:
        raise HTTPException(400, "Current password is incorrect")
    if len(payload.new_password) < 10:
        raise HTTPException(400, "New password must be at least 10 characters")
    from argon2 import PasswordHasher
    db.update_user(user["id"], password_hash=PasswordHasher().hash(payload.new_password))
    return {"ok": True}


# ---------- per-user YouTube OAuth ----------
@app.post("/api/auth/start")
def auth_start(user: CurrentUser):
    try:
        return {"auth_url": uploader.start_oauth(user["id"])}
    except Exception as e:
        raise HTTPException(400, str(e))


@app.get("/api/auth/callback")
def auth_callback(code: str = "", state: str = "", error: str = ""):
    if error:
        return RedirectResponse(f"{config.APP_BASE_URL}/?youtube=error#settings/channel")
    if not code or not state:
        return RedirectResponse(f"{config.APP_BASE_URL}/?youtube=error#settings/channel")
    try:
        uploader.finish_oauth(state, code)
        return RedirectResponse(f"{config.APP_BASE_URL}/?youtube=connected#settings/channel")
    except Exception:
        return RedirectResponse(f"{config.APP_BASE_URL}/?youtube=error#settings/channel")


@app.get("/api/auth/status")
def auth_status(user: CurrentUser):
    return uploader.auth_status(user["id"])


@app.post("/api/auth/cancel")
def auth_cancel(user: CurrentUser):
    return {"ok": True}


@app.post("/api/auth/disconnect")
def auth_disconnect(user: CurrentUser):
    uploader.disconnect(user["id"])
    return {"ok": True}


# ---------- settings ----------
class SettingsPayload(BaseModel):
    settings: dict


@app.get("/api/settings")
def get_settings(user: CurrentUser):
    return {
        "settings": settings.public(user["id"]),
        "llm_available": settings.llm_available(user["id"]),
    }


@app.post("/api/settings")
def post_settings(payload: SettingsPayload, user: CurrentUser):
    if "output_dir" in payload.settings:
        try:
            payload.settings["output_dir"] = storage.validate_output_dir(payload.settings["output_dir"])
        except ValueError as e:
            raise HTTPException(400, str(e))
    settings.update(user["id"], payload.settings)
    return {
        "ok": True,
        "llm_available": settings.llm_available(user["id"]),
        "output_dir": settings.get(user["id"], "output_dir", "") or "",
    }


# ---------- workspace appearance ----------
class PrefsPayload(BaseModel):
    prefs: dict


_PREF_CHOICES = {
    "mode": {"dark", "light", "system"},
    "font": {"mono", "sans", "editorial"},
    "radius": {"sharp", "soft", "round"},
    "density": {"compact", "cozy", "comfy"},
    "motion": {"full", "reduced", "off"},
    "palette": {"gruvbox", "omarchy", "vice", "nord", "tokyo", "catppuccin", "rosepine"},
}
_PREF_FLAGS = {"aurora", "grain", "grid", "scan", "sound", "sidebar", "cursor"}


@app.get("/api/prefs")
def get_prefs(user: CurrentUser):
    return {"prefs": db.get_ui_prefs(user["id"]), "local": config.LOCAL_MODE}


@app.post("/api/prefs")
def post_prefs(payload: PrefsPayload, user: CurrentUser):
    merged = db.get_ui_prefs(user["id"])
    for key, value in (payload.prefs or {}).items():
        if key in _PREF_CHOICES:
            if isinstance(value, str) and value in _PREF_CHOICES[key]:
                merged[key] = value
        elif key in _PREF_FLAGS:
            merged[key] = bool(value)
        elif key == "accent":
            text = str(value or "").strip().lower()
            merged[key] = text if (not text or (len(text) == 7 and text.startswith("#") and all(c in "0123456789abcdef" for c in text[1:]))) else ""
    return {"ok": True, "prefs": db.set_ui_prefs(user["id"], merged)}


# ---------- jobs ----------
class JobCreate(BaseModel):
    url: str
    short_count: int = 2
    batch_id: int | None = None
    auto_upload: bool | None = None
    privacy: str | None = None
    caption_preset: str | None = None
    caption_size: int | None = None
    caption_position: str | None = None
    caption_color: str | None = None
    caption_animation: str | None = None
    caption_highlight: str | None = None
    caption_uppercase: bool | None = None
    caption_box: bool | None = None
    caption_align: bool | None = None
    clip_duration: int | None = None
    clip_mode: str | None = None
    hook_mode: str | None = None
    chat_highlights: bool | None = None
    reframe: str | None = None


class ManualCreate(BaseModel):
    url: str
    start: float
    end: float
    privacy: str | None = None
    caption_preset: str | None = None
    caption_size: int | None = None
    caption_position: str | None = None
    caption_color: str | None = None
    caption_animation: str | None = None
    caption_highlight: str | None = None
    caption_uppercase: bool | None = None
    caption_box: bool | None = None
    reframe: str | None = None


class ClipEdit(BaseModel):
    index: int
    start: float | None = None
    end: float | None = None
    title: str | None = None
    hook: str | None = None


class JobSelect(BaseModel):
    indices: list[int] = Field(default_factory=list)
    clips: list[ClipEdit] | None = None
    auto_upload: bool | None = None
    privacy: str | None = None
    caption_preset: str | None = None
    caption_size: int | None = None
    caption_position: str | None = None
    caption_color: str | None = None
    caption_animation: str | None = None
    caption_highlight: str | None = None
    caption_uppercase: bool | None = None
    caption_box: bool | None = None
    caption_align: bool | None = None
    hook_mode: str | None = None
    reframe: str | None = None


class ClipDelete(BaseModel):
    ids: list[int] = Field(default_factory=list)
    all: bool = False


class ClipUpload(BaseModel):
    title: str
    description: str = ""
    privacy: str = "private"
    tags: list[str] | None = None
    scheduled_at: float | None = None
    force: bool = False


class ClipPrivacy(BaseModel):
    privacy: str


class CandidateCaptions(BaseModel):
    segments: list[dict] = Field(default_factory=list)


class BatchCreate(BaseModel):
    urls: list[str]
    name: str = ""
    kind: str = "batch"
    short_count: int = 2
    privacy: str | None = None
    clip_duration: int | None = None
    clip_mode: str | None = None
    hook_mode: str | None = None
    chat_highlights: bool | None = None
    reframe: str | None = None
    caption_preset: str | None = None
    caption_animation: str | None = None
    caption_align: bool | None = None


def _job_options(payload):
    return {
        k: v for k, v in {
            "auto_upload": getattr(payload, "auto_upload", None),
            "privacy": payload.privacy,
            "caption_preset": getattr(payload, "caption_preset", None),
            "caption_size": getattr(payload, "caption_size", None),
            "caption_position": getattr(payload, "caption_position", None),
            "caption_color": getattr(payload, "caption_color", None),
            "caption_animation": getattr(payload, "caption_animation", None),
            "caption_highlight": getattr(payload, "caption_highlight", None),
            "caption_uppercase": getattr(payload, "caption_uppercase", None),
            "caption_box": getattr(payload, "caption_box", None),
            "caption_align": getattr(payload, "caption_align", None),
            "clip_duration": getattr(payload, "clip_duration", None),
            "clip_mode": getattr(payload, "clip_mode", None),
            "hook_mode": getattr(payload, "hook_mode", None),
            "chat_highlights": getattr(payload, "chat_highlights", None),
            "reframe": getattr(payload, "reframe", None),
        }.items() if v is not None
    }


def _check_youtube_url(url: str):
    if "youtube.com" not in url and "youtu.be" not in url:
        raise HTTPException(400, "Not a YouTube URL")
    return url.strip()


@app.post("/api/jobs")
def create_job(payload: JobCreate, user: CurrentUser):
    url = _check_youtube_url(payload.url)
    count = 1 if payload.clip_mode == "multi_cut" else max(1, min(payload.short_count, 5))
    options = _job_options(payload)
    if payload.batch_id:
        options["auto_upload"] = False
    job_id = db.create_job(user["id"], url, count, options, batch_id=payload.batch_id, kind="analyze")
    db.log(job_id, "Job queued — transcript first, then selective downloads")
    worker.wake()
    return {"id": job_id}


@app.post("/api/manual")
def create_manual(payload: ManualCreate, user: CurrentUser):
    url = _check_youtube_url(payload.url)
    if payload.end <= payload.start + 1:
        raise HTTPException(400, "End time must be after start time")
    if payload.end - payload.start > 180:
        raise HTTPException(400, "Manual cuts are limited to 180 seconds")
    options = _job_options(payload)
    options.update({"manual": True, "manual_start": payload.start, "manual_end": payload.end})
    job_id = db.create_job(user["id"], url, 1, options, kind="manual")
    db.log(job_id, "Manual cut queued — downloading only the requested range")
    worker.wake()
    return {"id": job_id}


@app.post("/api/batches")
def create_batch(payload: BatchCreate, user: CurrentUser):
    urls = [u.strip() for u in payload.urls if u.strip()]
    if not urls:
        raise HTTPException(400, "Add at least one URL")
    if len(urls) > 20:
        raise HTTPException(400, "A batch is limited to 20 URLs")
    for url in urls:
        _check_youtube_url(url)
    batch = db.create_batch(user["id"], payload.name or f"Batch {time.strftime('%d %b %H:%M')}", payload.kind)
    options = _job_options(payload)
    options["batch_kind"] = batch["kind"]
    ids = []
    for url in urls:
        job_id = db.create_job(user["id"], url, max(1, min(payload.short_count, 5)), options, batch_id=batch["id"])
        db.log(job_id, f"Queued in batch “{batch['name']}”")
        ids.append(job_id)
    worker.wake()
    return {"batch_id": batch["id"], "name": batch["name"], "job_ids": ids}


@app.get("/api/batches")
def list_batches(user: CurrentUser):
    return db.list_batches(user["id"])


def _job_eta(job, ctx=None):
    """Return (seconds_remaining, finish_timestamp, queue_position)."""
    status = job.get("status")
    if not ctx or status not in ("queued", "running"):
        return None, None, None
    now = time.time()
    progress = max(0.0, min(1.0, float(job.get("progress") or 0)))
    if status == "queued":
        position = int(ctx["positions"].get(job["id"], ctx["running"] + 1))
        queued_ahead = max(0, position - int(ctx["running"]) - 1)
        eta = float(ctx["average"]) * (1 + queued_ahead / max(1, config.WORKER_CONCURRENCY))
        eta = max(20.0, min(eta, 6 * 3600.0))
        return int(round(eta)), now + eta, position
    started = float(job.get("started_at") or job.get("created_at") or now)
    elapsed = max(0.0, now - started)
    if progress >= 0.02 and elapsed >= 4:
        eta = elapsed * (1 - progress) / progress
        eta = max(8.0, min(eta, 4 * 3600.0))
        return int(round(eta)), now + eta, None
    eta = max(20.0, float(ctx["average"]) * (1 - progress))
    return int(round(eta)), now + eta, None


def _public_job(job, eta_ctx=None):
    if not job:
        return None
    for key in ("candidates", "uploads", "selected"):
        try:
            job[key] = json.loads(job.get(key) or "[]")
        except (json.JSONDecodeError, TypeError):
            job[key] = []
    try:
        job["options"] = json.loads(job.get("options") or "{}")
    except (json.JSONDecodeError, TypeError):
        job["options"] = {}
    directory = downloader.user_media_dir(job["user_id"])
    job["source"] = _source_name(job["user_id"], job["id"])
    job["manual"] = bool(job["options"].get("manual"))
    preview = job["options"].get("manual_preview")
    job["preview"] = preview if preview and os.path.isfile(os.path.join(directory, preview)) else None
    eta, eta_at, position = _job_eta(job, eta_ctx)
    job["eta_seconds"] = eta
    job["eta_at"] = eta_at
    job["queue_position"] = position
    return job


def _source_name(user_id, job_id):
    directory = downloader.user_media_dir(user_id)
    paths = []
    for pattern in (f"job{job_id}_source.*", f"job{job_id}_live.*"):
        paths.extend(
            p for p in glob.glob(os.path.join(directory, pattern))
            if os.path.isfile(p) and not p.lower().endswith(downloader.PARTIAL_EXTS)
        )
    return os.path.basename(max(paths, key=os.path.getsize)) if paths else None


@app.get("/api/jobs")
def list_jobs(user: CurrentUser):
    ctx = db.job_eta_context()
    return [_public_job(j, ctx) for j in db.list_jobs(user["id"])]


@app.get("/api/jobs/{job_id}")
def get_job(job_id: int, user: CurrentUser, since_log: int = 0):
    job = db.get_job(job_id, user["id"])
    if not job:
        raise HTTPException(404, "Job not found")
    _public_job(job, db.job_eta_context())
    job["logs"] = db.get_logs(job_id, since_log)
    return job


@app.post("/api/jobs/{job_id}/select")
def select_job(job_id: int, payload: JobSelect, user: CurrentUser):
    job = db.get_job(job_id, user["id"])
    if not job:
        raise HTTPException(404, "Job not found")
    if job["status"] != "review":
        raise HTTPException(400, f"Job not in review state (currently: {job['status']})")
    cands = json.loads(job["candidates"] or "[]")
    if payload.clips:
        clips = [c.model_dump() for c in payload.clips]
    else:
        clips = [{"index": i} for i in payload.indices]
    clips = [c for c in clips if 0 <= int(c.get("index", -1)) < len(cands)]
    if not clips:
        raise HTTPException(400, "No valid selection")
    if not pipeline.queue_render(user["id"], job_id, clips, _job_options(payload)):
        raise HTTPException(400, "Could not queue render")
    return {"ok": True, "clips": len(clips), "queued": True}


@app.post("/api/jobs/{job_id}/rerender")
def rerender_job(job_id: int, user: CurrentUser):
    job = db.get_job(job_id, user["id"])
    if not job:
        raise HTTPException(404, "Job not found")
    if job["status"] != "done":
        raise HTTPException(400, f"Only completed jobs can be re-rendered (currently: {job['status']})")
    try:
        selected = json.loads(job.get("selected") or "[]")
        uploads = json.loads(job.get("uploads") or "[]")
        candidates = json.loads(job.get("candidates") or "[]")
    except (json.JSONDecodeError, TypeError):
        selected, uploads, candidates = [], [], []
    if not selected:
        selected = [u.get("index") for u in uploads if isinstance(u, dict)]
    indices = []
    for value in selected:
        try:
            index = int(value)
        except (TypeError, ValueError):
            continue
        if 0 <= index < len(candidates) and index not in indices:
            indices.append(index)
    if not indices:
        raise HTTPException(409, "This completed job has no selected clips to re-render")
    pipeline.queue_render(user["id"], job_id, [{"index": i} for i in indices], {})
    return {"ok": True, "clips": len(indices)}


@app.post("/api/jobs/{job_id}/cancel")
def cancel_job(job_id: int, user: CurrentUser):
    job = db.get_job(job_id, user["id"])
    if not job:
        raise HTTPException(404, "Job not found")
    if job["status"] in ("done", "error", "canceled"):
        raise HTTPException(400, f"Job already {job['status']}")
    pipeline.request_cancel(job_id, user["id"])
    return {"ok": True}


@app.post("/api/jobs/{job_id}/retry")
def retry_job(job_id: int, user: CurrentUser):
    job = db.get_job(job_id, user["id"])
    if not job:
        raise HTTPException(404, "Job not found")
    if job["status"] not in ("error", "canceled"):
        raise HTTPException(400, "Only failed or canceled jobs can be retried")
    db.update_job(
        job_id, status="queued", stage="queued", progress=0.0, error=None,
        uploads="[]", selected="[]",
    )
    db.log(job_id, "Requeued (cached transcript/sections and generated media are reused)")
    worker.wake()
    return {"ok": True}


@app.delete("/api/jobs/{job_id}")
def delete_job(job_id: int, user: CurrentUser):
    job = db.get_job(job_id, user["id"])
    if not job:
        raise HTTPException(404, "Job not found")
    if job["status"] in ("queued", "running", "canceling"):
        raise HTTPException(409, "Cancel the job before deleting it")
    clips = db.list_job_clips(user["id"], job_id)
    db.delete_job(user["id"], job_id)
    _purge_media(user["id"], job_id, clips)
    return {"ok": True}


def _purge_media(user_id, job_id, clips=()):
    paths = list(downloader.job_media_files(user_id, job_id))
    for clip in clips:
        paths.extend(path for path in (clip.get("path"), clip.get("thumb")) if path)
    for path in paths:
        try:
            if os.path.isfile(path):
                os.remove(path)
        except OSError:
            pass


# ---------- review preview / hooks / captions ----------
class HookRequest(BaseModel):
    index: int


@app.post("/api/jobs/{job_id}/preview")
def preview_candidate(job_id: int, payload: HookRequest, user: CurrentUser):
    try:
        result = pipeline.preview_candidate(job_id, payload.index, user["id"])
    except Exception as e:
        raise HTTPException(400, str(e))
    return {
        "filename": result["filename"],
        "url": f"/media/{result['filename']}",
        "duration": result["duration"],
    }


@app.post("/api/jobs/{job_id}/hooklab")
def hook_lab(job_id: int, payload: HookRequest, user: CurrentUser):
    job = db.get_job(job_id, user["id"])
    if not job:
        raise HTTPException(404, "Job not found")
    try:
        candidate = json.loads(job["candidates"] or "[]")[payload.index]
    except (IndexError, TypeError, json.JSONDecodeError):
        raise HTTPException(404, "Candidate not found")
    return assistant.hook_lab(user["id"], job, candidate)


@app.get("/api/jobs/{job_id}/candidates/{idx}/captions")
def candidate_captions(job_id: int, idx: int, user: CurrentUser):
    try:
        return pipeline.candidate_captions(job_id, idx, user["id"])
    except Exception as e:
        raise HTTPException(400, str(e))


@app.put("/api/jobs/{job_id}/candidates/{idx}/captions")
def save_candidate_captions(job_id: int, idx: int, payload: CandidateCaptions, user: CurrentUser):
    try:
        return {"segments": pipeline.save_candidate_captions(job_id, idx, user["id"], payload.segments)}
    except Exception as e:
        raise HTTPException(400, str(e))


# ---------- clip history / publishing ----------
def _public_clip(row, user_id):
    path = row.get("path") or ""
    thumb = row.get("thumb") or ""
    exists = bool(path) and os.path.isfile(path)
    try:
        qa_data = json.loads(row.get("qa_json") or "{}")
    except (json.JSONDecodeError, TypeError):
        qa_data = {}
    return {
        "id": row.get("id"),
        "job_id": row.get("job_id"),
        "title": row.get("title") or "Short",
        "description": row.get("description") or "",
        "path": path or None,
        "file": os.path.basename(path) if path else None,
        "thumb": os.path.basename(thumb) if thumb else None,
        "duration": row.get("duration") or 0,
        "uploaded": bool(row.get("uploaded")),
        "privacy": row.get("privacy"),
        "url": row.get("url"),
        "youtube_id": row.get("youtube_id"),
        "scheduled_at": row.get("scheduled_at"),
        "upload_state": row.get("upload_state") or "idle",
        "upload_progress": row.get("upload_progress") or 0,
        "upload_error": row.get("upload_error"),
        "qa_status": row.get("qa_status") or "pending",
        "qa": qa_data,
        "created_at": row.get("created_at"),
        "exists": exists,
        "source_url": row.get("source_url"),
        "job_title": row.get("job_title"),
        "size": os.path.getsize(path) if exists else 0,
    }


@app.get("/api/clips")
def list_clips(
    user: CurrentUser,
    uploaded: str | None = Query(default=None),
):
    if uploaded in ("true", "1"):
        mode = True
    elif uploaded in ("false", "0"):
        mode = False
    else:
        mode = None
    return [_public_clip(row, user["id"]) for row in db.list_clips(user["id"], uploaded=mode)]


@app.get("/api/clips/{clip_id}")
def get_clip(clip_id: int, user: CurrentUser):
    row = db.get_clip(user["id"], clip_id)
    if not row:
        raise HTTPException(404, "Clip not found")
    return _public_clip(row, user["id"])


@app.get("/api/clips/{clip_id}/file")
def clip_file(clip_id: int, user: CurrentUser):
    """Serve a rendered clip from either the app media folder or a custom output folder."""
    clip = db.get_clip(user["id"], clip_id)
    if not clip or not clip.get("path") or not os.path.isfile(clip["path"]):
        raise HTTPException(404, "Clip file not found")
    return FileResponse(clip["path"], media_type="video/mp4")


@app.get("/api/clips/{clip_id}/thumb")
def clip_thumb(clip_id: int, user: CurrentUser):
    clip = db.get_clip(user["id"], clip_id)
    if not clip or not clip.get("thumb") or not os.path.isfile(clip["thumb"]):
        raise HTTPException(404, "Clip thumbnail not found")
    return FileResponse(clip["thumb"], media_type="image/jpeg")


@app.get("/api/clips/{clip_id}/metadata")
def clip_metadata(clip_id: int, user: CurrentUser):
    clip = db.get_clip(user["id"], clip_id)
    if not clip:
        raise HTTPException(404, "Clip not found")
    job = db.get_job(clip["job_id"], user["id"]) or {}
    return assistant.suggest_metadata(user["id"], job, clip)


def _sync_job_upload(job_id, clip_id, **fields):
    job = db.get_job(job_id)
    if not job:
        return
    try:
        uploads = json.loads(job.get("uploads") or "[]")
    except (json.JSONDecodeError, TypeError):
        uploads = []
    for entry in uploads:
        if entry.get("clip_id") == clip_id:
            entry.update(fields)
            break
    db.update_job(job_id, uploads=json.dumps(uploads))


def _upload_thread(user_id, clip_id, title, description, privacy, tags, scheduled_at):
    clip = db.get_clip(user_id, clip_id)
    if not clip:
        return
    try:
        def progress(pct):
            db.update_clip(user_id, clip_id, upload_progress=pct, upload_state="uploading")

        result = uploader.upload_short(
            user_id,
            clip["path"],
            title,
            description,
            privacy,
            stage_cb=progress,
            tags=tags,
            category_id=str(settings.get(user_id, "category_id", "") or ""),
            scheduled_at=scheduled_at,
        )
        db.update_clip(
            user_id, clip_id,
            uploaded=True,
            url=result["url"],
            youtube_id=result["video_id"],
            privacy=result["privacy"],
            scheduled_at=result.get("scheduled_at"),
            upload_state="uploaded",
            upload_progress=100,
            upload_error=None,
        )
        _sync_job_upload(
            clip["job_id"], clip_id, uploaded=True, url=result["url"],
            youtube_id=result["video_id"], upload_state="uploaded",
        )
        db.log(clip["job_id"], f"Uploaded to YouTube: {result['url']}")
    except Exception as e:
        db.update_clip(user_id, clip_id, upload_state="error", upload_error=str(e)[:1000])
        db.log(clip["job_id"], f"Upload failed: {e}", "error")


@app.post("/api/clips/{clip_id}/upload")
def upload_clip(clip_id: int, payload: ClipUpload, user: CurrentUser):
    clip = db.get_clip(user["id"], clip_id)
    if not clip:
        raise HTTPException(404, "Clip not found")
    if clip.get("uploaded"):
        raise HTTPException(400, "This clip is already on YouTube")
    if clip.get("upload_state") == "uploading":
        raise HTTPException(409, "This clip is already uploading")
    if not clip.get("path") or not os.path.isfile(clip["path"]):
        raise HTTPException(400, "The rendered file is missing")
    if clip.get("qa_status") == "failed" and not payload.force:
        raise HTTPException(409, "QA failed for this clip. Fix/re-render it or force the upload.")
    if not uploader.connected(user["id"]):
        raise HTTPException(400, "Connect your YouTube channel first")
    title = payload.title.strip()
    if not title:
        raise HTTPException(400, "Title is required")
    if payload.scheduled_at and payload.scheduled_at <= time.time() + 60:
        raise HTTPException(400, "Schedule time must be at least a minute in the future")
    tags = payload.tags
    if not tags:
        tags = [t.strip() for t in str(settings.get(user["id"], "upload_tags", "shorts, clips") or "").split(",") if t.strip()]
    if not db.claim_clip_upload(
        user["id"], clip_id, title, payload.description, payload.privacy, payload.scheduled_at
    ):
        raise HTTPException(409, "This clip is already uploading or published")
    threading.Thread(
        target=_upload_thread,
        args=(user["id"], clip_id, title, payload.description, payload.privacy, tags, payload.scheduled_at),
        daemon=True,
    ).start()
    db.log(clip["job_id"], f"Upload requested: {title[:80]}")
    return {"ok": True, "clip": _public_clip(db.get_clip(user["id"], clip_id), user["id"])}


@app.post("/api/clips/{clip_id}/privacy")
def clip_privacy(clip_id: int, payload: ClipPrivacy, user: CurrentUser):
    clip = db.get_clip(user["id"], clip_id)
    if not clip or not clip.get("youtube_id"):
        raise HTTPException(404, "Uploaded clip not found")
    try:
        uploader.set_privacy(user["id"], clip["youtube_id"], payload.privacy)
    except Exception as e:
        raise HTTPException(400, str(e))
    db.update_clip(user["id"], clip_id, privacy=payload.privacy)
    return {"ok": True}


@app.delete("/api/clips/{clip_id}/youtube")
def delete_youtube_clip(clip_id: int, user: CurrentUser):
    clip = db.get_clip(user["id"], clip_id)
    if not clip or not clip.get("youtube_id"):
        raise HTTPException(404, "Uploaded clip not found")
    try:
        uploader.delete_video(user["id"], clip["youtube_id"])
    except Exception as e:
        raise HTTPException(400, f"YouTube delete failed: {e}")
    db.update_clip(
        user["id"], clip_id, uploaded=False, url=None, youtube_id=None,
        scheduled_at=None, upload_state="idle", upload_progress=0,
    )
    _sync_job_upload(clip["job_id"], clip_id, uploaded=False, url=None, youtube_id=None, upload_state="idle")
    return {"ok": True}


@app.post("/api/clips/{clip_id}/qa")
def rerun_qa(clip_id: int, user: CurrentUser):
    clip = db.get_clip(user["id"], clip_id)
    if not clip:
        raise HTTPException(404, "Clip not found")
    result = qa.check_clip(clip["path"])
    db.update_clip(user["id"], clip_id, qa_status=result["status"], qa_json=json.dumps(result))
    return result


@app.get("/api/clips/{clip_id}/export")
def export_clip(clip_id: int, user: CurrentUser):
    clip = db.get_clip(user["id"], clip_id)
    if not clip or not os.path.isfile(clip["path"]):
        raise HTTPException(404, "Clip file not found")
    safe = "".join(c for c in (clip["title"] or "short") if c.isalnum() or c in " -_")[:60].strip() or "short"
    return FileResponse(clip["path"], media_type="video/mp4", filename=f"{safe}-{clip_id}.mp4")


@app.post("/api/clips/delete")
def delete_clips(payload: ClipDelete, user: CurrentUser):
    rows = db.delete_all_clips(user["id"]) if payload.all else db.delete_clips(user["id"], payload.ids)
    freed = 0
    removed = 0
    for row in rows:
        for key in ("path", "thumb"):
            path = row.get(key)
            if not path:
                continue
            try:
                size = os.path.getsize(path)
                os.remove(path)
                freed += size
                removed += 1
            except OSError:
                pass
    return {"ok": True, "deleted": len(rows), "files_removed": removed, "freed": freed}


# ---------- analytics / advisor ----------
@app.post("/api/analytics/refresh")
def analytics_refresh(user: CurrentUser):
    try:
        return JSONResponse(analytics.refresh(user["id"]))
    except Exception as e:
        raise HTTPException(400, str(e))


@app.get("/api/analytics")
def analytics_summary(user: CurrentUser):
    return analytics.summary(user["id"])


@app.get("/api/advisor")
def get_advice(user: CurrentUser):
    try:
        return advisor.advise(user["id"])
    except Exception as e:
        return {"source": "error", "next_best_action": f"Advisor unavailable: {e}", "actions": [], "hook_ideas": []}


# ---------- diagnostics / AI ----------
def _module(name):
    try:
        found = importlib.util.find_spec(name) is not None
    except (ImportError, ValueError):
        found = False
    return {"name": name, "ok": found, "detail": "installed" if found else "missing"}


def _tree_size(path):
    total = 0
    for base, _dirs, files in os.walk(path):
        for f in files:
            try:
                total += os.path.getsize(os.path.join(base, f))
            except OSError:
                pass
    return total


def _binary(name):
    path = shutil.which(name)
    if not path:
        return {"name": name, "ok": False, "detail": "not found on PATH"}
    return {"name": name, "ok": True, "detail": path}


@app.get("/healthz")
def healthz():
    return {"ok": True, "service": "shorts-factory"}


@app.get("/api/health")
def health(user: CurrentUser):
    items = [
        _binary("ffmpeg"), _binary("ffprobe"), _binary("yt-dlp"),
        _module("faster_whisper"), _module("googleapiclient"), _module("numpy"),
        _module("requests"), _module("sqlalchemy"), _module("psycopg"),
        {"name": "CUDA transcription", "ok": gpu.cuda_available(), "detail": gpu.cuda_summary()},
        {"name": "NVENC rendering", "ok": gpu.nvenc_available(),
         "detail": "h264_nvenc available" if gpu.nvenc_available() else "CPU x264 fallback"},
    ]
    directory = downloader.user_media_dir(user["id"])
    try:
        disk = shutil.disk_usage(directory)
        disk_info = {"free": disk.free, "total": disk.total,
                     "used_pct": round((disk.used / disk.total) * 100, 1) if disk.total else 0}
    except OSError:
        disk_info = {}
    jobs = db.list_jobs(user["id"], limit=500)
    return {
        "ok": all(i["ok"] for i in items[:3]),
        "items": items,
        "disk": disk_info,
        "clips": db.count_clips(user["id"]),
        "uploaded": db.count_uploaded(user["id"]),
        "jobs": {"queued": sum(j["status"] == "queued" for j in jobs),
                 "running": sum(j["status"] == "running" for j in jobs),
                 "review": sum(j["status"] == "review" for j in jobs)},
        "media": {"files": len(glob.glob(os.path.join(directory, "*"))),
                  "bytes": _tree_size(directory)},
        "python": sys.version.split()[0],
        "platform": platform.platform(),
        "llm_available": settings.llm_available(user["id"]),
        "connected": uploader.connected(user["id"]),
        "data_dir": str(config.DATA_DIR),
        "mode": "local" if config.LOCAL_MODE else "multi",
        "database": "postgresql" if str(config.DATABASE_URL).startswith("postgres") else "sqlite",
    }


@app.post("/api/ai/test")
def ai_test(user: CurrentUser):
    if not settings.llm_available(user["id"]):
        raise HTTPException(400, "Add a Base URL, API key and model first")
    import requests
    cfg = settings.llm_config(user["id"])
    started = time.time()
    try:
        resp = requests.post(
            cfg["base_url"].rstrip("/") + "/chat/completions",
            headers={"Authorization": f"Bearer {cfg['api_key']}"},
            json={"model": cfg["model"], "messages": [{"role": "user", "content": "Reply with the single word: ready"}],
                  "temperature": 0, "max_tokens": 96},
            timeout=120,
        )
        resp.raise_for_status()
        data = resp.json()
        choices = data.get("choices") or []
        reply = str((choices[0] if choices else {}).get("message", {}).get("content") or "").strip()
        if not str(reply).strip():
            raise HTTPException(400, "AI endpoint returned an empty response")
        return {"ok": True, "model": data.get("model") or cfg["model"], "reply": reply[:200],
                "ms": int((time.time() - started) * 1000)}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(400, f"AI request failed: {e}")


# ---------- media (authenticated, user-scoped) ----------
@app.get("/media/{filename}")
def media_file(filename: str, user: CurrentUser):
    safe = os.path.basename(filename)
    if safe != filename or not safe.startswith("job"):
        raise HTTPException(404)
    path = os.path.join(downloader.user_media_dir(user["id"]), safe)
    if not os.path.isfile(path):
        raise HTTPException(404)
    return FileResponse(path)


if config.SERVE_FRONTEND:
    app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1" if config.LOCAL_MODE else "0.0.0.0", port=config.PORT)
