"""Encrypted Omniroute snapshot sync from a private GitHub release.

The owner publishes one rolling release asset. It is a passphrase-encrypted
bundle containing only ``storage.sqlite`` and ``.env``. Friends pull it with a
read-only GitHub token, and the backend stages it for the next app launch.

Secrets (GitHub token and snapshot passphrase) live in encrypted settings and
are never written to the repository or the sync state file.
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import shutil
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

import requests
from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from . import config

RELEASE_TAG = "snapshot"
ASSET_NAME = "omniroute-snapshot.enc"

_MAGIC = b"SFOS"
_VERSION = 1
_SALT_LEN = 16
_NONCE_LEN = 12
_TAG_LEN = 16
_HEADER_LEN = 4 + 1 + _SALT_LEN + _NONCE_LEN
_MAX_BUNDLE = 160 * 1024 * 1024
_MAX_DB = 120 * 1024 * 1024
_SCRYPT_N = 32768
_SCRYPT_R = 8
_SCRYPT_P = 1
_SCRYPT_MAXMEM = 128 * 1024 * 1024

_REPO_RE = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")
_STATE_NAME = "sync-state.json"
_MARKER_NAME = "sync.json"

_lock = threading.Lock()
_wake = threading.Event()
_stop = threading.Event()
_thread: threading.Thread | None = None


class SyncError(Exception):
    """A user-actionable sync failure that is safe to show in Settings."""


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _interval_seconds() -> int:
    try:
        return max(300, int(os.getenv("OMNIROUTE_SYNC_INTERVAL_SECONDS", "21600")))
    except (TypeError, ValueError):
        return 21600


def _root() -> Path:
    return Path(config.DATA_DIR) / "omniroute"


def _state_path() -> Path:
    return _root() / _STATE_NAME


def _ensure_root() -> Path:
    root = _root()
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    try:
        root.chmod(0o700)
    except OSError:
        pass
    return root


def read_state() -> dict:
    """Return the last sync result without exposing any secret material."""
    try:
        data = json.loads(_state_path().read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError):
        data = {}
    if not isinstance(data, dict):
        data = {}
    data.setdefault("status", "idle")
    data.setdefault("message", "")
    data.setdefault("checked_at", "")
    return data


def _write_state(fields: dict) -> dict:
    state = read_state()
    state.update({k: v for k, v in fields.items() if v is not None})
    state["updated_at"] = _now()
    _ensure_root()
    path = _state_path()
    temp = path.with_name(f".{path.name}.tmp-{os.getpid()}-{time.time_ns()}")
    temp.write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")
    try:
        temp.chmod(0o600)
    except OSError:
        pass
    os.replace(temp, path)
    return state


def _safe_error(exc: BaseException) -> str:
    text = " ".join(str(exc).split()) or exc.__class__.__name__
    return text[:600]


def _finish(status: str, message: str, **fields) -> dict:
    return _write_state({"status": status, "message": message, "checked_at": _now(), **fields})


def _validate_repo(repo: str) -> str:
    repo = (repo or "").strip().strip("/")
    if not _REPO_RE.fullmatch(repo):
        raise SyncError("Private repo must look like owner/repository.")
    return repo


def _headers(token: str, accept: str = "application/vnd.github+json") -> dict:
    return {
        "Authorization": f"Bearer {token}",
        "Accept": accept,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "ShortsFactory-Omniroute-Sync",
    }


def _release_asset(repo: str, token: str) -> dict:
    url = f"https://api.github.com/repos/{repo}/releases/tags/{RELEASE_TAG}"
    try:
        resp = requests.get(url, headers=_headers(token), timeout=30)
    except requests.RequestException as exc:
        raise SyncError(f"Could not reach GitHub: {_safe_error(exc)}") from exc
    if resp.status_code == 404:
        raise SyncError("No snapshot release exists yet. The owner must publish one first.")
    if resp.status_code in (401, 403):
        raise SyncError(
            f"GitHub rejected the token (HTTP {resp.status_code}). "
            "Use a read-only token with access to this private repo."
        )
    if resp.status_code != 200:
        raise SyncError(f"GitHub returned HTTP {resp.status_code} while looking for the snapshot.")
    try:
        release = resp.json()
    except ValueError as exc:
        raise SyncError("GitHub returned an unreadable release response.") from exc
    assets = release.get("assets") if isinstance(release, dict) else None
    for asset in assets or []:
        if isinstance(asset, dict) and asset.get("name") == ASSET_NAME:
            return asset
    raise SyncError(f"The release has no {ASSET_NAME} asset.")


def _asset_digest(asset: dict) -> str:
    digest = str(asset.get("digest") or "").strip().lower()
    if digest.startswith("sha256:") and re.fullmatch(r"[0-9a-f]{64}", digest[7:]):
        return digest[7:]
    return ""


def _download_asset(asset: dict, token: str) -> bytes:
    url = str(asset.get("url") or "").strip()
    if not url.startswith("https://api.github.com/"):
        raise SyncError("The snapshot asset URL was not a GitHub API URL.")
    try:
        with requests.get(
            url,
            headers=_headers(token, "application/octet-stream"),
            timeout=(15, 180),
            stream=True,
            allow_redirects=True,
        ) as resp:
            if resp.status_code in (401, 403):
                raise SyncError(
                    f"GitHub rejected the download token (HTTP {resp.status_code})."
                )
            if resp.status_code != 200:
                raise SyncError(f"Snapshot download returned HTTP {resp.status_code}.")
            outside_size = int(resp.headers.get("Content-Length") or 0)
            if outside_size > _MAX_BUNDLE:
                raise SyncError("The snapshot asset is unexpectedly large.")
            chunks = []
            total = 0
            for chunk in resp.iter_content(chunk_size=256 * 1024):
                if not chunk:
                    continue
                total += len(chunk)
                if total > _MAX_BUNDLE:
                    raise SyncError("The snapshot asset exceeded the size limit.")
                chunks.append(chunk)
    except SyncError:
        raise
    except requests.RequestException as exc:
        raise SyncError(f"Snapshot download failed: {_safe_error(exc)}") from exc
    if not chunks:
        raise SyncError("The downloaded snapshot was empty.")
    return b"".join(chunks)


def _decrypt(blob: bytes, passphrase: str) -> bytes:
    if len(blob) < _HEADER_LEN + _TAG_LEN:
        raise SyncError("The snapshot bundle is truncated.")
    if blob[:4] != _MAGIC:
        raise SyncError("The snapshot bundle has an unknown format.")
    if blob[4] != _VERSION:
        raise SyncError("This snapshot was made by an unsupported version.")
    salt = blob[5:5 + _SALT_LEN]
    nonce = blob[5 + _SALT_LEN:_HEADER_LEN]
    ciphertext = blob[_HEADER_LEN:-_TAG_LEN]
    tag = blob[-_TAG_LEN:]
    try:
        key = hashlib.scrypt(
            passphrase.encode("utf-8"),
            salt=salt,
            n=_SCRYPT_N,
            r=_SCRYPT_R,
            p=_SCRYPT_P,
            dklen=32,
            maxmem=_SCRYPT_MAXMEM,
        )
        return AESGCM(key).decrypt(nonce, ciphertext + tag, None)
    except (InvalidTag, ValueError, TypeError) as exc:
        raise SyncError("Could not decrypt the snapshot. Check the snapshot passphrase.") from exc


def _env_has_storage_key(env_text: str) -> bool:
    for line in env_text.splitlines():
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        if key.strip() == "STORAGE_ENCRYPTION_KEY" and value.strip():
            return True
    return False


def _stage(payload: bytes, repo: str, asset: dict, digest: str) -> dict:
    try:
        data = json.loads(payload.decode("utf-8"))
    except (UnicodeDecodeError, ValueError) as exc:
        raise SyncError("The decrypted snapshot is not valid JSON.") from exc
    if not isinstance(data, dict) or data.get("format") != 1:
        raise SyncError("The decrypted snapshot has an unsupported format.")
    files = data.get("files")
    if not isinstance(files, dict):
        raise SyncError("The decrypted snapshot has no files.")
    db_b64 = files.get("storage.sqlite")
    env_text = files.get(".env")
    if not isinstance(db_b64, str) or not isinstance(env_text, str):
        raise SyncError("The snapshot is missing its database or environment file.")
    try:
        db_bytes = base64.b64decode(db_b64, validate=True)
    except (ValueError, TypeError) as exc:
        raise SyncError("The snapshot database is not valid base64.") from exc
    if len(db_bytes) > _MAX_DB:
        raise SyncError("The snapshot database is too large.")
    if not db_bytes.startswith(b"SQLite format 3\x00"):
        raise SyncError("The snapshot does not contain a valid SQLite database.")
    if not env_text.strip() or not _env_has_storage_key(env_text):
        raise SyncError("The snapshot is missing STORAGE_ENCRYPTION_KEY.")

    root = _ensure_root()
    pending = root / "pending"
    temp = root / f".pending-{os.getpid()}-{time.time_ns()}"
    old = root / f".pending-old-{os.getpid()}-{time.time_ns()}"
    temp.mkdir(mode=0o700)
    try:
        db_path = temp / "storage.sqlite"
        db_path.write_bytes(db_bytes)
        env_path = temp / ".env"
        env_path.write_text(env_text, encoding="utf-8", newline="")
        created_at = str(data.get("created_at") or _now())[:80]
        snapshot_meta = {
            "created_at": created_at,
            "source": "private-repo",
            "omniroute": "Omniroute",
        }
        (temp / "snapshot.json").write_text(
            json.dumps(snapshot_meta, indent=2) + "\n", encoding="utf-8"
        )
        marker = {
            "source": "private-repo",
            "repo": repo,
            "tag": RELEASE_TAG,
            "asset_id": asset.get("id"),
            "asset_updated_at": asset.get("updated_at"),
            "asset_digest": digest or hashlib.sha256(payload).hexdigest(),
            "snapshot_created_at": created_at,
            "downloaded_at": _now(),
        }
        (temp / "sync.json").write_text(
            json.dumps(marker, indent=2) + "\n", encoding="utf-8"
        )
        for child in temp.iterdir():
            try:
                child.chmod(0o600)
            except OSError:
                pass
        try:
            temp.chmod(0o700)
        except OSError:
            pass

        if pending.exists():
            os.replace(pending, old)
        try:
            os.replace(temp, pending)
        except Exception:
            if old.exists() and not pending.exists():
                os.replace(old, pending)
            raise
        shutil.rmtree(old, ignore_errors=True)
        try:
            pending.chmod(0o700)
        except OSError:
            pass
        return marker
    finally:
        shutil.rmtree(temp, ignore_errors=True)


def _marker(path: Path) -> dict:
    try:
        data = json.loads((path / _MARKER_NAME).read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError):
        return {}
    return data if isinstance(data, dict) else {}


def _marker_matches(marker: dict, asset: dict, digest: str) -> bool:
    if not marker:
        return False
    if marker.get("source") != "private-repo":
        return False
    asset_id = asset.get("id")
    if asset_id is not None and str(marker.get("asset_id")) != str(asset_id):
        return False
    updated = asset.get("updated_at")
    if updated and marker.get("asset_updated_at") and marker.get("asset_updated_at") != updated:
        return False
    if digest and marker.get("asset_digest") and marker.get("asset_digest") != digest:
        return False
    return True


def check(user_id: int) -> dict:
    """Pull the latest snapshot and stage it. Safe to call from the UI or loop."""
    # Imported lazily: settings imports this module for status summaries.
    from . import settings

    if not config.LOCAL_MODE:
        return _finish("disabled", "Snapshot sync is only available in the local desktop app.")

    enabled = bool(settings.get(user_id, "omniroute_sync_enabled", False))
    repo = str(settings.get(user_id, "omniroute_sync_repo", "") or "").strip()
    token = str(settings.get(user_id, "omniroute_sync_token", "") or "").strip()
    passphrase = str(settings.get(user_id, "omniroute_sync_passphrase", "") or "")

    if not enabled:
        return _finish("disabled", "Snapshot sync is off.")
    if not repo or not token or not passphrase:
        return _finish(
            "not_configured",
            "Add the private repo, read-only token and snapshot passphrase.",
        )

    if not _lock.acquire(timeout=120):
        return read_state()
    try:
        repo = _validate_repo(repo)
        _finish("checking", "Checking the private snapshot repo…", repo=repo)
        asset = _release_asset(repo, token)
        digest = _asset_digest(asset)
        current_marker = _marker(_root() / "current")
        pending_marker = _marker(_root() / "pending")

        if _marker_matches(current_marker, asset, digest):
            # Remove only an older *synced* pending copy; a locally staged
            # snapshot is left alone.
            if pending_marker and pending_marker.get("source") == "private-repo" \
                    and not _marker_matches(pending_marker, asset, digest):
                shutil.rmtree(_root() / "pending", ignore_errors=True)
            return _finish(
                "current",
                "Up to date. This device is using the latest snapshot.",
                repo=repo,
                asset_id=asset.get("id"),
                asset_updated_at=asset.get("updated_at"),
                asset_digest=digest,
            )

        if _marker_matches(pending_marker, asset, digest):
            return _finish(
                "staged",
                "Latest snapshot is already staged. Restart Shorts Factory to apply it.",
                repo=repo,
                asset_id=asset.get("id"),
                asset_updated_at=asset.get("updated_at"),
                asset_digest=digest,
            )

        blob = _download_asset(asset, token)
        actual = hashlib.sha256(blob).hexdigest()
        if digest and actual != digest:
            raise SyncError("The downloaded snapshot failed its integrity check.")
        payload = _decrypt(blob, passphrase)
        marker = _stage(payload, repo, asset, digest or actual)
        return _finish(
            "staged",
            "New snapshot staged. Restart Shorts Factory to apply it.",
            repo=repo,
            asset_id=marker.get("asset_id"),
            asset_updated_at=marker.get("asset_updated_at"),
            asset_digest=marker.get("asset_digest"),
            snapshot_created_at=marker.get("snapshot_created_at"),
        )
    except SyncError as exc:
        return _finish("error", _safe_error(exc), repo=repo)
    except Exception as exc:  # pragma: no cover - defensive boundary
        return _finish("error", f"Snapshot sync failed: {_safe_error(exc)}", repo=repo)
    finally:
        _lock.release()


def wake() -> None:
    """Ask the background loop to check now."""
    _wake.set()


def start() -> None:
    global _thread
    if not config.LOCAL_MODE:
        return
    if _thread is not None and _thread.is_alive():
        return
    _stop.clear()
    _thread = threading.Thread(target=_loop, name="omniroute-sync", daemon=True)
    _thread.start()


def stop() -> None:
    _stop.set()
    _wake.set()


def _loop() -> None:
    # Give the local user, DB and app a moment to settle.
    if _stop.wait(5):
        return
    while not _stop.is_set():
        _wake.clear()
        try:
            user_id = int(config.LOCAL_USER_ID or 0)
            if user_id:
                check(user_id)
        except Exception as exc:  # pragma: no cover - keep the loop alive
            try:
                _finish("error", f"Snapshot sync failed: {_safe_error(exc)}")
            except Exception:
                pass
        _wake.wait(_interval_seconds())
