"""User-scoped persistence layer (SQLite locally, PostgreSQL in production)."""
import json
import os
import time
from contextlib import contextmanager

from sqlalchemy import create_engine, delete, event, select, update
from sqlalchemy.orm import sessionmaker

from . import config
from .models import (
    Base,
    Batch,
    ChannelSnapshot,
    Clip,
    Job,
    JobLog,
    OAuthState,
    Setting,
    User,
    UserSession,
    UserToken,
    VideoStat,
)

DATA_DIR = str(config.DATA_DIR)
DB_PATH = str(config.DATA_DIR / "shorts.db")

_url = config.DATABASE_URL
if _url.startswith("postgres://"):
    _url = "postgresql+psycopg://" + _url[len("postgres://"):]
elif _url.startswith("postgresql://") and "+psycopg" not in _url:
    _url = "postgresql+psycopg://" + _url[len("postgresql://"):]

_connect_args = {"check_same_thread": False, "timeout": 30} if _url.startswith("sqlite") else {}
engine = create_engine(_url, future=True, pool_pre_ping=True, connect_args=_connect_args)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False, future=True)


if _url.startswith("sqlite"):
    @event.listens_for(engine, "connect")
    def _sqlite_pragmas(conn, _record):
        cur = conn.cursor()
        cur.execute("PRAGMA foreign_keys=ON")
        cur.execute("PRAGMA journal_mode=WAL")
        cur.execute("PRAGMA busy_timeout=30000")
        cur.close()


def init():
    os.makedirs(DATA_DIR, exist_ok=True)
    os.makedirs(os.path.join(DATA_DIR, "media"), exist_ok=True)
    Base.metadata.create_all(engine)


@contextmanager
def _read():
    with SessionLocal() as session:
        yield session


def _row(obj):
    if obj is None:
        return None
    return {c.name: getattr(obj, c.name) for c in obj.__table__.columns}


def _rows(items):
    return [_row(item) for item in items]


def _json(value, fallback):
    if value is None:
        return fallback
    if isinstance(value, (dict, list)):
        return value
    try:
        return json.loads(value)
    except (TypeError, ValueError):
        return fallback


# ---------------- users / sessions ----------------
def count_users():
    with _read() as s:
        return int(s.query(User).count())


def create_user(email, display_name, password_hash):
    with _read() as s:
        user = User(
            email=email.strip().lower(),
            display_name=(display_name or "").strip()[:80],
            password_hash=password_hash,
            created_at=time.time(),
            is_active=True,
        )
        s.add(user)
        s.commit()
        s.refresh(user)
        return _row(user)


def get_user_by_email(email):
    with _read() as s:
        return _row(s.scalar(select(User).where(User.email == str(email or "").strip().lower())))


def get_user(user_id):
    with _read() as s:
        return _row(s.get(User, int(user_id)))


def ensure_local_user(email=None, display_name=None):
    """Return the desktop workspace owner, creating one on a fresh install.

    Existing installations keep their first account (and all of its media,
    jobs and encrypted settings); nothing is copied or deleted.
    """
    with _read() as s:
        user = s.scalar(select(User).order_by(User.id).limit(1))
        if user:
            return _row(user)
        now = time.time()
        user = User(
            email=str(email or config.LOCAL_USER_EMAIL).strip().lower(),
            display_name=str(display_name or config.LOCAL_USER_NAME).strip()[:80],
            password_hash="!local-workspace",
            created_at=now,
            is_active=True,
        )
        s.add(user)
        s.commit()
        s.refresh(user)
        return _row(user)


def update_user(user_id, **fields):
    allowed = {"display_name", "password_hash", "is_active"}
    with _read() as s:
        user = s.get(User, int(user_id))
        if not user:
            return None
        for key, value in fields.items():
            if key in allowed:
                setattr(user, key, value)
        s.commit()
        return _row(user)


def create_user_session(user_id, token_hash, expires_at, user_agent=""):
    with _read() as s:
        s.add(UserSession(
            user_id=int(user_id), token_hash=token_hash, created_at=time.time(),
            expires_at=float(expires_at), user_agent=user_agent or "",
        ))
        s.commit()


def user_for_session(token_hash):
    now = time.time()
    with _read() as s:
        session = s.scalar(select(UserSession).where(
            UserSession.token_hash == token_hash, UserSession.expires_at > now
        ))
        if not session:
            return None
        user = s.get(User, session.user_id)
        if not user or not user.is_active:
            return None
        return _row(user)


def delete_session(token_hash):
    with _read() as s:
        s.execute(delete(UserSession).where(UserSession.token_hash == token_hash))
        s.commit()


def delete_user_sessions(user_id):
    with _read() as s:
        s.execute(delete(UserSession).where(UserSession.user_id == int(user_id)))
        s.commit()


# ---------------- per-user settings / OAuth tokens ----------------
def get_setting(user_id, key, default=None):
    with _read() as s:
        row = s.get(Setting, (int(user_id), str(key)))
        return row.value if row else default


def set_setting(user_id, key, value, secret=False):
    with _read() as s:
        row = s.get(Setting, (int(user_id), str(key)))
        if row is None:
            row = Setting(user_id=int(user_id), key=str(key), value=str(value), secret=bool(secret))
            s.add(row)
        else:
            row.value = str(value)
            row.secret = bool(secret)
        s.commit()


def all_settings(user_id):
    with _read() as s:
        rows = s.scalars(select(Setting).where(Setting.user_id == int(user_id))).all()
        return {r.key: r.value for r in rows}


def get_ui_prefs(user_id):
    raw = get_setting(user_id, "ui_prefs", "")
    value = _json(raw or None, {})
    return value if isinstance(value, dict) else {}


def set_ui_prefs(user_id, value):
    if not isinstance(value, dict):
        value = {}
    set_setting(user_id, "ui_prefs", json.dumps(value, ensure_ascii=False), secret=False)
    return value


def save_user_token(user_id, provider, token_encrypted):
    with _read() as s:
        row = s.get(UserToken, (int(user_id), str(provider)))
        if row is None:
            row = UserToken(
                user_id=int(user_id), provider=str(provider),
                token_encrypted=token_encrypted, updated_at=time.time(),
            )
            s.add(row)
        else:
            row.token_encrypted = token_encrypted
            row.updated_at = time.time()
        s.commit()


def load_user_token(user_id, provider="youtube"):
    with _read() as s:
        row = s.get(UserToken, (int(user_id), str(provider)))
        return row.token_encrypted if row else None


def delete_user_token(user_id, provider="youtube"):
    with _read() as s:
        s.execute(delete(UserToken).where(
            UserToken.user_id == int(user_id), UserToken.provider == str(provider)
        ))
        s.commit()


def create_oauth_state(state, user_id, expires_at):
    with _read() as s:
        s.add(OAuthState(state=state, user_id=int(user_id), created_at=time.time(), expires_at=float(expires_at)))
        s.commit()


def consume_oauth_state(state):
    now = time.time()
    with _read() as s:
        row = s.get(OAuthState, str(state))
        if not row or row.expires_at < now:
            if row:
                s.delete(row)
                s.commit()
            return None
        user_id = row.user_id
        s.delete(row)
        s.commit()
        return user_id


# ---------------- batches ----------------
def create_batch(user_id, name, kind="batch"):
    with _read() as s:
        batch = Batch(
            user_id=int(user_id), name=str(name or "")[:120],
            kind="series" if kind == "series" else "batch", created_at=time.time(),
        )
        s.add(batch)
        s.commit()
        s.refresh(batch)
        return _row(batch)


def list_batches(user_id, limit=50):
    with _read() as s:
        rows = s.scalars(select(Batch).where(Batch.user_id == int(user_id)).order_by(Batch.id.desc()).limit(limit)).all()
        return _rows(rows)


# ---------------- jobs ----------------
def _batch_map(session, batch_ids):
    ids = [b for b in batch_ids if b]
    if not ids:
        return {}
    rows = session.scalars(select(Batch).where(Batch.id.in_(ids))).all()
    return {b.id: {"name": b.name, "kind": b.kind} for b in rows}


def create_job(user_id, url, short_count, options=None, batch_id=None, kind="analyze"):
    now = time.time()
    with _read() as s:
        job = Job(
            user_id=int(user_id), batch_id=int(batch_id) if batch_id else None,
            url=str(url).strip(), kind=kind if kind in ("analyze", "manual", "render") else "analyze",
            status="queued", stage="queued", progress=0.0, short_count=max(1, int(short_count or 1)),
            candidates="[]", selected="[]", uploads="[]",
            options=json.dumps(options or {}, ensure_ascii=False),
            attempts=0, queued_at=now, created_at=now, updated_at=now,
        )
        s.add(job)
        s.commit()
        s.refresh(job)
        return job.id


def update_job(job_id, **fields):
    allowed = {
        "url", "title", "status", "stage", "progress", "error", "short_count",
        "candidates", "selected", "uploads", "options", "batch_id", "kind",
        "attempts", "queued_at", "started_at", "finished_at",
    }
    now = time.time()
    with _read() as s:
        job = s.get(Job, int(job_id))
        if not job:
            return None
        for key, value in fields.items():
            if key in allowed:
                setattr(job, key, value)
        job.updated_at = now
        if fields.get("status") in ("done", "error", "canceled"):
            job.finished_at = now
        s.commit()
        return _row(job)


def get_job(job_id, user_id=None):
    with _read() as s:
        job = s.get(Job, int(job_id))
        if not job or (user_id is not None and job.user_id != int(user_id)):
            return None
        data = _row(job)
        batch = s.get(Batch, job.batch_id) if job.batch_id else None
        data["batch_name"] = batch.name if batch else None
        data["batch_kind"] = batch.kind if batch else None
        return data


def list_jobs(user_id, limit=50):
    with _read() as s:
        rows = s.scalars(select(Job).where(Job.user_id == int(user_id)).order_by(Job.id.desc()).limit(limit)).all()
        data = _rows(rows)
        batches = _batch_map(s, [r["batch_id"] for r in data])
        for item in data:
            batch = batches.get(item["batch_id"]) or {}
            item["batch_name"] = batch.get("name")
            item["batch_kind"] = batch.get("kind")
        return data


def job_eta_context():
    """Queue position plus a median recent duration for local job estimates.

    Estimates are intentionally conservative and restart-safe: every value is
    derived from timestamps already stored on jobs, with no in-memory state.
    """
    with _read() as s:
        live = s.scalars(
            select(Job).where(Job.status.in_(("queued", "running"))).order_by(Job.id)
        ).all()
        recent = s.scalars(
            select(Job)
            .where(Job.status == "done", Job.started_at.isnot(None), Job.finished_at.isnot(None))
            .order_by(Job.finished_at.desc())
            .limit(24)
        ).all()
    durations = sorted(
        max(1.0, float(j.finished_at) - float(j.started_at))
        for j in recent
        if j.finished_at and j.started_at and float(j.finished_at) > float(j.started_at)
    )
    if durations:
        middle = len(durations) // 2
        average = durations[middle] if len(durations) % 2 else (durations[middle - 1] + durations[middle]) / 2
    else:
        average = float(config.DEFAULT_JOB_SECONDS)
    running = sum(1 for j in live if j.status == "running")
    positions = {}
    queued_ahead = running
    for job in live:
        if job.status == "queued":
            queued_ahead += 1
            positions[job.id] = queued_ahead
    return {"positions": positions, "running": running, "average": max(20.0, min(average, 6 * 3600.0))}


def delete_job(user_id, job_id):
    with _read() as s:
        job = s.get(Job, int(job_id))
        if not job or job.user_id != int(user_id):
            return False
        s.execute(delete(Clip).where(Clip.job_id == job.id, Clip.user_id == int(user_id)))
        s.execute(delete(JobLog).where(JobLog.job_id == job.id))
        s.delete(job)
        s.commit()
        return True


def claim_next_job():
    """Atomically claim the oldest queued job for this worker."""
    with _read() as s:
        if _url.startswith("sqlite"):
            job = s.scalar(select(Job).where(Job.status == "queued").order_by(Job.id).limit(1))
        else:
            job = s.scalar(
                select(Job).where(Job.status == "queued").order_by(Job.id)
                .limit(1).with_for_update(skip_locked=True)
            )
        if not job:
            return None
        job.status = "running"
        job.attempts = int(job.attempts or 0) + 1
        job.started_at = time.time()
        job.updated_at = time.time()
        s.commit()
        return _row(job)


def requeue_interrupted_jobs():
    """Requeue work owned by a backend process that stopped mid-job."""
    with _read() as s:
        jobs = s.scalars(select(Job).where(Job.status.in_(("running", "canceling")))).all()
        count = 0
        for job in jobs:
            if job.attempts >= 3:
                job.status = "error"
                job.stage = "interrupted"
                job.error = "Job was interrupted 3 times — retry it manually"
                job.finished_at = time.time()
            else:
                job.status = "queued"
                job.stage = "queued"
                job.queued_at = time.time()
                count += 1
            job.updated_at = time.time()
        s.commit()
        return count


def reset_interrupted_uploads():
    """Mark uploads cut off by a restart as failed instead of retrying blindly.

    YouTube's insert call has no idempotency key, so an upload may have finished
    even though the database never recorded it. Retrying automatically could
    publish a duplicate; the user is asked to check YouTube before retrying.
    """
    with _read() as s:
        clips = s.scalars(select(Clip).where(Clip.upload_state == "uploading")).all()
        for clip in clips:
            clip.upload_state = "error"
            clip.upload_error = (
                "Upload was interrupted by a server restart. Check YouTube for the "
                "video before uploading again."
            )
        s.commit()
        return len(clips)


# ---------------- logs ----------------
def log(job_id, message, level="info", user_id=None):
    if not isinstance(message, str):
        try:
            message = json.dumps(message, ensure_ascii=False, default=str)
        except (TypeError, ValueError):
            message = str(message)
    with _read() as s:
        job = s.get(Job, int(job_id))
        if not job:
            return
        s.add(JobLog(
            user_id=job.user_id if user_id is None else int(user_id),
            job_id=job.id, ts=time.time(), level=str(level)[:16], message=message,
        ))
        s.commit()


def get_logs(job_id, since_id=0):
    with _read() as s:
        rows = s.scalars(
            select(JobLog).where(JobLog.job_id == int(job_id), JobLog.id > int(since_id)).order_by(JobLog.id)
        ).all()
        return _rows(rows)


# ---------------- clips / history ----------------
def add_clip(user_id, job_id, title, path, thumb=None, duration=0, uploaded=False,
             privacy=None, url=None, description="", youtube_id=None,
             scheduled_at=None, upload_state="idle", qa_status="pending", qa_json="{}"):
    now = time.time()
    with _read() as s:
        clip = s.scalar(select(Clip).where(Clip.user_id == int(user_id), Clip.path == str(path)))
        if clip is None:
            clip = Clip(
                user_id=int(user_id), job_id=int(job_id), title=str(title or "Short")[:300],
                description=str(description or ""), path=str(path), thumb=thumb,
                duration=float(duration or 0), uploaded=bool(uploaded), privacy=privacy,
                url=url, youtube_id=youtube_id, scheduled_at=scheduled_at,
                upload_state=upload_state, qa_status=qa_status, qa_json=qa_json, created_at=now,
            )
            s.add(clip)
        else:
            clip.job_id = int(job_id)
            clip.title = str(title or clip.title or "Short")[:300]
            if description:
                clip.description = str(description)
            clip.thumb = thumb or clip.thumb
            clip.duration = float(duration or clip.duration or 0)
            clip.uploaded = bool(uploaded) or bool(clip.uploaded)
            clip.privacy = privacy or clip.privacy
            clip.url = url or clip.url
            clip.youtube_id = youtube_id or clip.youtube_id
            clip.scheduled_at = scheduled_at if scheduled_at is not None else clip.scheduled_at
            clip.upload_state = upload_state or clip.upload_state
            clip.qa_status = qa_status or clip.qa_status
            clip.qa_json = qa_json or clip.qa_json
        s.commit()
        s.refresh(clip)
        return clip.id


def list_clips(user_id, uploaded=None, limit=500):
    with _read() as s:
        q = select(Clip, Job.url, Job.title).join(Job, Job.id == Clip.job_id).where(Clip.user_id == int(user_id))
        if uploaded is True:
            q = q.where(Clip.uploaded.is_(True))
        elif uploaded is False:
            q = q.where(Clip.uploaded.is_(False))
        rows = s.execute(q.order_by(Clip.created_at.desc()).limit(limit)).all()
        out = []
        for clip, source_url, job_title in rows:
            item = _row(clip)
            item["source_url"] = source_url
            item["job_title"] = job_title
            out.append(item)
        return out


def get_clip(user_id, clip_id):
    with _read() as s:
        clip = s.get(Clip, int(clip_id))
        if not clip or clip.user_id != int(user_id):
            return None
        data = _row(clip)
        job = s.get(Job, clip.job_id)
        data["source_url"] = job.url if job else None
        data["job_title"] = job.title if job else None
        return data


def update_clip(user_id, clip_id, **fields):
    allowed = {
        "title", "description", "uploaded", "privacy", "url", "youtube_id",
                        "scheduled_at", "upload_state", "upload_progress", "upload_error", "qa_status", "qa_json",
                "thumb", "duration",
    }
    with _read() as s:
        clip = s.get(Clip, int(clip_id))
        if not clip or clip.user_id != int(user_id):
            return None
        for key, value in fields.items():
            if key in allowed:
                setattr(clip, key, value)
        s.commit()
        return _row(clip)


def claim_clip_upload(user_id, clip_id, title, description, privacy, scheduled_at):
    """Atomically move a clip to uploading so two requests cannot publish it twice."""
    with _read() as s:
        result = s.execute(
            update(Clip)
            .where(
                Clip.id == int(clip_id),
                Clip.user_id == int(user_id),
                Clip.uploaded.is_(False),
                Clip.upload_state != "uploading",
            )
            .values(
                title=str(title)[:100],
                description=str(description or "")[:5000],
                privacy=privacy,
                scheduled_at=scheduled_at,
                upload_state="uploading",
                upload_progress=0,
                upload_error=None,
            )
        )
        s.commit()
        return result.rowcount == 1


def get_clips(user_id, ids):
    ids = [int(i) for i in ids]
    if not ids:
        return []
    with _read() as s:
        rows = s.scalars(select(Clip).where(Clip.user_id == int(user_id), Clip.id.in_(ids))).all()
        return _rows(rows)


def list_job_clips(user_id, job_id):
    with _read() as s:
        rows = s.scalars(
            select(Clip).where(Clip.user_id == int(user_id), Clip.job_id == int(job_id))
        ).all()
        return _rows(rows)


def delete_clips(user_id, ids):
    rows = get_clips(user_id, ids)
    if not rows:
        return []
    with _read() as s:
        s.execute(delete(Clip).where(Clip.user_id == int(user_id), Clip.id.in_([r["id"] for r in rows])))
        s.commit()
    return rows


def delete_all_clips(user_id):
    with _read() as s:
        rows = s.scalars(select(Clip).where(Clip.user_id == int(user_id))).all()
        data = _rows(rows)
        s.execute(delete(Clip).where(Clip.user_id == int(user_id)))
        s.commit()
        return data


def count_clips(user_id):
    with _read() as s:
        return int(s.query(Clip).filter(Clip.user_id == int(user_id)).count())


def count_uploaded(user_id):
    with _read() as s:
        return int(s.query(Clip).filter(Clip.user_id == int(user_id), Clip.uploaded.is_(True)).count())


# Compatibility alias used by older callers.
def count_uploads(user_id):
    return count_clips(user_id)


# ---------------- video stats / snapshots ----------------
def upsert_video_stats(user_id, rows):
    now = time.time()
    with _read() as s:
        for r in rows:
            row = s.scalar(select(VideoStat).where(
                VideoStat.user_id == int(user_id), VideoStat.video_id == r["video_id"]
            ))
            if row is None:
                row = VideoStat(user_id=int(user_id), video_id=r["video_id"], fetched_at=now)
                s.add(row)
            row.title = r.get("title") or row.title or ""
            row.published_at = r.get("published_at") or row.published_at or ""
            row.views = int(r.get("views") or 0)
            row.likes = int(r.get("likes") or 0)
            row.comments = int(r.get("comments") or 0)
            row.watch_time_minutes = float(r.get("watch_time_minutes") or 0)
            row.avg_view_duration = float(r.get("avg_view_duration") or 0)
            row.avg_view_percentage = float(r.get("avg_view_percentage") or 0)
            row.subs_gained = int(r.get("subs_gained") or 0)
            row.impressions = int(r.get("impressions") or 0)
            row.ctr = float(r.get("ctr") or 0)
            row.fetched_at = now
        s.commit()


def list_video_stats(user_id):
    with _read() as s:
        rows = s.scalars(select(VideoStat).where(VideoStat.user_id == int(user_id))
                         .order_by(VideoStat.fetched_at.desc(), VideoStat.published_at.desc())).all()
        return _rows(rows)


def add_channel_snapshot(user_id, subs, total_views, video_count):
    now = time.time()
    with _read() as s:
        row = s.scalar(select(ChannelSnapshot).where(
            ChannelSnapshot.user_id == int(user_id), ChannelSnapshot.ts == now
        ))
        if row is None:
            row = ChannelSnapshot(user_id=int(user_id), ts=now)
            s.add(row)
        row.subs = int(subs or 0)
        row.total_views = int(total_views or 0)
        row.video_count = int(video_count or 0)
        s.commit()


def list_channel_snapshots(user_id):
    with _read() as s:
        rows = s.scalars(select(ChannelSnapshot).where(ChannelSnapshot.user_id == int(user_id)).order_by(ChannelSnapshot.ts)).all()
        return _rows(rows)
