"""Per-user settings with encrypted secrets."""
import json
import socket
from urllib.parse import urlparse

from . import config, db, omniroute_sync, security

KEYS = [
    # YouTube upload / analytics
    "yt_client_id",
    "yt_client_secret",
    "yt_channel_title",
    "default_privacy",
    "upload_tags",
    "category_id",
    "upload_title_template",
    "upload_description_template",
    # Built-in Omniroute (default) and optional custom OpenAI-compatible LLM
    "omniroute_enabled",
    "omniroute_sync_enabled",
    "omniroute_sync_repo",
    "omniroute_sync_token",
    "omniroute_sync_passphrase",
    "llm_base_url",
    "llm_api_key",
    "llm_model",
    # Pipeline prefs
    "whisper_model",
    "gpu_enabled",
    "short_length",
    "clip_mode",
    "clip_duration",
    "auto_upload",
    "reframe",
    "resolution",
    "quality",
    "output_dir",
    "caption_align",
    # Caption styling
    "caption_preset",
    "caption_size",
    "caption_position",
    "caption_color",
    "caption_highlight",
    "caption_animation",
    "caption_uppercase",
    "caption_box",
]

SECRET_KEYS = (
    "yt_client_secret",
    "llm_api_key",
    "omniroute_sync_token",
    "omniroute_sync_passphrase",
)


def get_all(user_id):
    raw = db.all_settings(user_id)
    out = {}
    for k in KEYS:
        v = raw.get(k)
        if v is None or v == "":
            continue
        if k in SECRET_KEYS:
            v = security.decrypt(v)
        try:
            out[k] = json.loads(v)
        except (json.JSONDecodeError, TypeError):
            out[k] = v
    return out


def public(user_id):
    out = get_all(user_id)
    values = {k: out.get(k) for k in KEYS if k not in SECRET_KEYS}
    values["has_yt_client_secret"] = bool(out.get("yt_client_secret"))
    values["has_llm_api_key"] = bool(out.get("llm_api_key"))
    values["oauth_redirect_uri"] = config.OAUTH_REDIRECT_URI
    values["app_base_url"] = config.APP_BASE_URL
    values["registration_invite_required"] = bool(config.REGISTRATION_INVITE_CODE)
    values["max_users"] = config.MAX_USERS
    values["default_privacy"] = values.get("default_privacy") or config.DEFAULT_PRIVACY
    values["omniroute_enabled"] = omniroute_enabled(user_id)
    values["omniroute_online"] = omniroute_online() if values["omniroute_enabled"] else False
    values["omniroute_model"] = config.OMNIROUTE_MODEL
    values["omniroute_base_url"] = config.OMNIROUTE_BASE_URL
    values["llm_provider"] = "omniroute" if values["omniroute_enabled"] else "custom"
    values["omniroute_sync_available"] = bool(config.LOCAL_MODE)
    values["has_omniroute_sync_token"] = bool(out.get("omniroute_sync_token"))
    values["has_omniroute_sync_passphrase"] = bool(out.get("omniroute_sync_passphrase"))
    values["omniroute_sync_configured"] = bool(
        values.get("omniroute_sync_repo")
        and out.get("omniroute_sync_token")
        and out.get("omniroute_sync_passphrase")
    )
    sync_state = dict(omniroute_sync.read_state())
    if not values.get("omniroute_sync_enabled"):
        sync_state.update({"status": "disabled", "message": "Snapshot sync is off."})
    elif not values["omniroute_sync_configured"]:
        sync_state.update({
            "status": "not_configured",
            "message": "Add the private repo, read-only token and snapshot passphrase.",
        })
    values["omniroute_sync"] = sync_state
    return values


def update(user_id, payload: dict):
    for k, v in payload.items():
        if k not in KEYS:
            continue
        value = v if v is not None else ""
        if isinstance(value, str):
            value = value.strip()
        if k in SECRET_KEYS:
            if not value:
                # Blank means "keep the stored secret"; clearing requires the
                # explicit disconnect/reset action in the UI.
                continue
            db.set_setting(user_id, k, security.encrypt(str(value)), secret=True)
            continue
        db.set_setting(user_id, k, json.dumps(value) if not isinstance(value, str) else value)


def omniroute_enabled(user_id):
    """Built-in inference is the default in the desktop/local app."""
    default = bool(config.LOCAL_MODE)
    return bool(get(user_id, "omniroute_enabled", default))


def omniroute_online():
    """Cheap loopback TCP probe so Settings can show startup/offline state."""
    parsed = urlparse(config.OMNIROUTE_BASE_URL)
    host = parsed.hostname or "127.0.0.1"
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    try:
        with socket.create_connection((host, port), timeout=0.35):
            return True
    except OSError:
        return False


def llm_config(user_id):
    if omniroute_enabled(user_id):
        # Its own loopback instance runs without an API key. The placeholder is
        # only there for the common OpenAI-compatible request headers.
        return {
            "base_url": config.OMNIROUTE_BASE_URL,
            "api_key": "local",
            "model": config.OMNIROUTE_MODEL,
            "provider": "omniroute",
        }
    return {
        "base_url": get(user_id, "llm_base_url") or "https://api.openai.com/v1",
        "api_key": get(user_id, "llm_api_key") or "",
        "model": get(user_id, "llm_model") or "",
        "provider": "custom",
    }


def llm_available(user_id):
    if omniroute_enabled(user_id):
        return True
    cfg = llm_config(user_id)
    return bool(cfg["api_key"] and cfg["model"])


def get(user_id, key, default=None):
    v = db.get_setting(user_id, key)
    if v is None or v == "":
        return default
    if key in SECRET_KEYS:
        return security.decrypt(v)
    try:
        return json.loads(v)
    except (json.JSONDecodeError, TypeError):
        return v
