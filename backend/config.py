"""Runtime configuration for Shorts Factory.

The desktop app defaults to a single local workspace (no sign-in). Set
APP_MODE=multi to keep the previous invite-only multi-user server behaviour.
"""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.getenv("DATA_DIR", str(ROOT / "data"))).resolve()
MEDIA_DIR = DATA_DIR / "media"

# SQLite is used for zero-config local development. Docker Compose sets this to
# postgresql+psycopg://shorts:shorts@db:5432/shorts.
DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{DATA_DIR / 'shorts.db'}")

APP_BASE_URL = os.getenv("APP_BASE_URL", "http://127.0.0.1:8787").rstrip("/")
APP_MODE = os.getenv("APP_MODE", "local").strip().lower()
LOCAL_MODE = APP_MODE != "multi"
LOCAL_USER_ID = int(os.getenv("LOCAL_USER_ID", "0") or 0)
LOCAL_USER_EMAIL = os.getenv("LOCAL_USER_EMAIL", "local@shorts.factory").strip().lower()
LOCAL_USER_NAME = os.getenv("LOCAL_USER_NAME", "Local Studio").strip() or "Local Studio"
SESSION_COOKIE = os.getenv("SESSION_COOKIE", "sf_session")
SESSION_TTL_DAYS = int(os.getenv("SESSION_TTL_DAYS", "30"))
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "false").lower() in ("1", "true", "yes", "on")

# Registration is invite-only when a code is configured. The first account can
# always be created so a fresh deployment is not locked out.
REGISTRATION_INVITE_CODE = os.getenv("REGISTRATION_INVITE_CODE", "").strip()
MAX_USERS = int(os.getenv("MAX_USERS", "4"))

# Desktop builds spawn the backend on loopback only. Keep this separate from
# APP_BASE_URL so an existing OAuth redirect can be preserved if needed.
PORT = int(os.getenv("PORT", "8787"))

APP_SECRET_KEY = os.getenv("APP_SECRET_KEY", "").strip()
SERVE_FRONTEND = os.getenv("SERVE_FRONTEND", "true").lower() in ("1", "true", "yes", "on")
WORKER_CONCURRENCY = max(1, min(4, int(os.getenv("WORKER_CONCURRENCY", "2"))))
WORKER_POLL_SECONDS = float(os.getenv("WORKER_POLL_SECONDS", "1.0"))

# Public GitHub Releases feed used by the in-app update toast. The desktop
# shell passes its own packaged version in APP_VERSION.
APP_VERSION = os.getenv("APP_VERSION", "1.0.0").strip() or "1.0.0"
UPDATE_REPO = (os.getenv("UPDATE_REPO", "Rajesh-bandi/shorts-factory").strip().strip("/")
               or "Rajesh-bandi/shorts-factory")
UPDATE_API_URL = os.getenv("UPDATE_API_URL", "").strip() or (
    f"https://api.github.com/repos/{UPDATE_REPO}/releases/latest"
)

# OAuth: register this exact URL in each user's Google OAuth web client.
OAUTH_REDIRECT_URI = os.getenv(
    "OAUTH_REDIRECT_URI", f"{APP_BASE_URL}/api/auth/callback"
).strip()

# Upload defaults are safety-first. Publishing is always an explicit action.
DEFAULT_PRIVACY = os.getenv("DEFAULT_PRIVACY", "private")

# Retention / cache policy (0 = keep forever).
MEDIA_RETENTION_DAYS = int(os.getenv("MEDIA_RETENTION_DAYS", "14"))
JOB_SOURCE_RETENTION_DAYS = int(os.getenv("JOB_SOURCE_RETENTION_DAYS", "7"))

# Used only while a job has no measurable progress yet.
DEFAULT_JOB_SECONDS = max(30, int(os.getenv("DEFAULT_JOB_SECONDS", "480")))

YOUTUBE_SCOPES = [
    "https://www.googleapis.com/auth/youtube.force-ssl",
    "https://www.googleapis.com/auth/youtube.readonly",
    "https://www.googleapis.com/auth/yt-analytics.readonly",
]
