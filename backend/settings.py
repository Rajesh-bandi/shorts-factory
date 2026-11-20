"""Per-user settings with encrypted secrets."""
import json

from . import config, db, security

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
    # LLM (OpenAI-compatible, optional)
    "llm_base_url",
    "llm_api_key",
    "llm_model",
    # Pipeline prefs
    "whisper_model",
    "gpu_enabled",
    "chat_highlights",
    "short_length",
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

SECRET_KEYS = ("yt_client_secret", "llm_api_key")


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


def llm_config(user_id):
    return {
        "base_url": get(user_id, "llm_base_url") or "https://api.openai.com/v1",
        "api_key": get(user_id, "llm_api_key") or "",
        "model": get(user_id, "llm_model") or config.LLM_DEFAULT_MODEL or "",
    }


def llm_available(user_id):
    # A model is optional: gateways such as OmniRoute can choose their own
    # default when the request omits ``model``.
    return bool(llm_config(user_id)["api_key"])


def llm_body(cfg, messages, **options):
    """Build an OpenAI-compatible body.

    An empty model means "let the gateway choose". OmniRoute understands the
    literal ``auto`` routing model, so use that instead of omitting the field
    (its API rejects requests without a model).
    """
    body = {"messages": messages, **options}
    body["model"] = cfg.get("model") or "auto"
    return body


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
