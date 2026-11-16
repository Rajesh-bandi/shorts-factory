"""Password accounts and opaque cookie sessions."""
import re
import time

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError

from . import config, db, security

_hasher = PasswordHasher(time_cost=3, memory_cost=65536, parallelism=4)
_EMAIL = re.compile(r"^[^@\s]{1,120}@[^@\s]{1,200}\.[^@\s]{2,}$")


class AuthError(Exception):
    pass


def validate_registration(email: str, password: str, invite: str = ""):
    email = str(email or "").strip().lower()
    if not _EMAIL.match(email):
        raise AuthError("Enter a valid email address")
    if len(str(password or "")) < 10:
        raise AuthError("Password must be at least 10 characters")
    count = db.count_users()
    if count >= config.MAX_USERS:
        raise AuthError("This instance has reached its account limit")
    if count > 0 and config.REGISTRATION_INVITE_CODE:
        if str(invite or "").strip() != config.REGISTRATION_INVITE_CODE:
            raise AuthError("Invalid invite code")
    return email


def register(email: str, password: str, display_name: str = "", invite: str = ""):
    email = validate_registration(email, password, invite)
    if db.get_user_by_email(email):
        raise AuthError("An account with that email already exists")
    user = db.create_user(
        email=email,
        display_name=str(display_name or "").strip()[:80] or email.split("@")[0],
        password_hash=_hasher.hash(password),
    )
    return user


def authenticate(email: str, password: str):
    user = db.get_user_by_email(str(email or "").strip().lower())
    if not user or not user.get("is_active"):
        raise AuthError("Invalid email or password")
    try:
        _hasher.verify(user["password_hash"], password)
    except (VerifyMismatchError, InvalidHashError):
        raise AuthError("Invalid email or password")
    if _hasher.check_needs_rehash(user["password_hash"]):
        db.update_user(user["id"], password_hash=_hasher.hash(password))
    return user


def create_session(user_id: int, user_agent: str = ""):
    token = security.new_token()
    db.create_user_session(
        user_id,
        security.token_hash(token),
        time.time() + config.SESSION_TTL_DAYS * 86400,
        str(user_agent or "")[:300],
    )
    return token


def user_for_token(token: str):
    if not token:
        return None
    return db.user_for_session(security.token_hash(token))


def delete_session(token: str):
    if token:
        db.delete_session(security.token_hash(token))


def public_user(user):
    return {
        "id": user["id"],
        "email": user["email"],
        "display_name": user["display_name"],
        "created_at": user["created_at"],
    }
