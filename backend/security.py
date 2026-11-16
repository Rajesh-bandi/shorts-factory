"""Secret-at-rest helpers and opaque token generation."""
import base64
import hashlib
import os
import secrets
from functools import lru_cache
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken

from . import config

_PREFIX = "enc:v1:"


@lru_cache(maxsize=1)
def _fernet():
    key = config.APP_SECRET_KEY
    if not key:
        path = Path(config.DATA_DIR) / ".secret_key"
        path.parent.mkdir(parents=True, exist_ok=True)
        if path.exists():
            key = path.read_text().strip()
        else:
            key = base64.urlsafe_b64encode(os.urandom(32)).decode()
            path.write_text(key)
            try:
                path.chmod(0o600)
            except OSError:
                pass
    raw = hashlib.sha256(key.encode()).digest()
    return Fernet(base64.urlsafe_b64encode(raw))


def encrypt(value: str) -> str:
    if not value:
        return ""
    return _PREFIX + _fernet().encrypt(str(value).encode()).decode()


def decrypt(value: str) -> str:
    if not value:
        return ""
    if not str(value).startswith(_PREFIX):
        # Values written by the old single-user build were plain text. Read them
        # once, then the settings layer re-encrypts on the next save.
        return str(value)
    try:
        return _fernet().decrypt(str(value)[len(_PREFIX):].encode()).decode()
    except (InvalidToken, ValueError):
        return ""


def new_token(nbytes: int = 32) -> str:
    return secrets.token_urlsafe(nbytes)


def token_hash(token: str) -> str:
    return hashlib.sha256(str(token).encode()).hexdigest()
