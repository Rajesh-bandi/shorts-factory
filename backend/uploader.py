"""Per-user YouTube OAuth and publishing."""
import json
import os
import secrets
import threading
import time
from datetime import datetime, timezone

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import Flow
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload

from . import config, db, security, settings

_channel_cache = {}
_cache_lock = threading.Lock()


class YouTubeError(Exception):
    pass


def _client_config(user_id):
    cid = str(settings.get(user_id, "yt_client_id") or "").strip()
    csecret = str(settings.get(user_id, "yt_client_secret") or "").strip()
    if not cid or not csecret:
        raise YouTubeError("Add your own YouTube OAuth Client ID and Client Secret in Settings first")
    if not cid.endswith(".apps.googleusercontent.com"):
        raise YouTubeError(
            "OAuth Client ID is malformed — copy the full value ending in .apps.googleusercontent.com"
        )
    return {
        "web": {
            "client_id": cid,
            "client_secret": csecret,
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "redirect_uris": [config.OAUTH_REDIRECT_URI],
        }
    }


def _save_creds(user_id, creds):
    db.save_user_token(user_id, "youtube", security.encrypt(creds.to_json()))
    with _cache_lock:
        _channel_cache.pop(int(user_id), None)


def load_creds(user_id):
    raw = db.load_user_token(user_id, "youtube")
    if not raw:
        return None
    try:
        info = json.loads(security.decrypt(raw))
        creds = Credentials.from_authorized_user_info(info, config.YOUTUBE_SCOPES)
        if creds.expired and creds.refresh_token:
            creds.refresh(Request())
            _save_creds(user_id, creds)
        return creds if creds.valid else None
    except Exception:
        return None


def connected(user_id):
    return bool(load_creds(user_id))


def disconnect(user_id):
    db.delete_user_token(user_id, "youtube")
    with _cache_lock:
        _channel_cache.pop(int(user_id), None)


def start_oauth(user_id):
    """Return the Google consent URL for a per-user web OAuth flow."""
    flow = Flow.from_client_config(
        _client_config(user_id),
        scopes=config.YOUTUBE_SCOPES,
        redirect_uri=config.OAUTH_REDIRECT_URI,
    )
    state = security.new_token(24)
    db.create_oauth_state(state, user_id, time.time() + 600)
    url, _ = flow.authorization_url(
        access_type="offline",
        include_granted_scopes="true",
        prompt="consent",
        state=state,
    )
    return url


def finish_oauth(state, code):
    user_id = db.consume_oauth_state(state)
    if not user_id:
        raise YouTubeError("This Google sign-in link expired. Start the connection again.")
    flow = Flow.from_client_config(
        _client_config(user_id),
        scopes=config.YOUTUBE_SCOPES,
        redirect_uri=config.OAUTH_REDIRECT_URI,
        state=state,
    )
    flow.fetch_token(code=code)
    _save_creds(user_id, flow.credentials)
    return user_id


def channel_info(user_id, force=False):
    cached = _channel_cache.get(int(user_id))
    if not force and cached and time.time() - cached["ts"] < 60:
        return cached["data"]
    creds = load_creds(user_id)
    if not creds:
        return None
    yt = build("youtube", "v3", credentials=creds)
    resp = yt.channels().list(part="snippet,statistics", mine=True).execute()
    items = resp.get("items", [])
    if not items:
        return None
    ch = items[0]
    data = {
        "id": ch["id"],
        "title": ch["snippet"]["title"],
        "thumb": ch["snippet"]["thumbnails"].get("default", {}).get("url", ""),
        "subs": int(ch["statistics"].get("subscriberCount", 0)),
        "views": int(ch["statistics"].get("viewCount", 0)),
        "video_count": int(ch["statistics"].get("videoCount", 0)),
    }
    with _cache_lock:
        _channel_cache[int(user_id)] = {"ts": time.time(), "data": data}
    return data


def auth_status(user_id):
    channel = channel_info(user_id) if connected(user_id) else None
    return {
        "connected": bool(channel or connected(user_id)),
        "flow_running": False,
        "flow_error": None,
        "flow_canceled": False,
        "channel": channel,
        "oauth_redirect_uri": config.OAUTH_REDIRECT_URI,
    }


def _iso_time(timestamp):
    return datetime.fromtimestamp(float(timestamp), tz=timezone.utc).isoformat().replace("+00:00", "Z")


def upload_short(user_id, path, title, description, privacy="private", stage_cb=None,
                 tags=None, category_id="", scheduled_at=None):
    """Upload one rendered clip. Scheduling always uses YouTube's private+publishAt flow."""
    creds = load_creds(user_id)
    if not creds:
        raise YouTubeError("Connect your YouTube channel in Settings first")
    if not os.path.isfile(path):
        raise YouTubeError("The rendered clip file is missing")
    yt = build("youtube", "v3", credentials=creds)

    if privacy not in ("public", "unlisted", "private"):
        privacy = "private"
    publish_at = None
    if scheduled_at:
        publish_at = _iso_time(scheduled_at)
        privacy = "private"

    tag_list = [str(t).strip() for t in (tags or ["shorts", "clips"]) if str(t).strip()][:15]
    if "shorts" not in [t.lower() for t in tag_list]:
        tag_list.insert(0, "shorts")
    category = str(category_id) if str(category_id).isdigit() else "20"

    status = {
        "privacyStatus": privacy,
        "selfDeclaredMadeForKids": False,
    }
    if publish_at:
        status["publishAt"] = publish_at
    body = {
        "snippet": {
            "title": str(title or "Short")[:100],
            "description": str(description or "")[:5000],
            "tags": tag_list,
            "categoryId": category,
        },
        "status": status,
    }

    media = MediaFileUpload(path, chunksize=1024 * 1024 * 4, resumable=True, mimetype="video/mp4")
    request = yt.videos().insert(part="snippet,status", body=body, media_body=media)
    response = None
    last_progress = -1
    while response is None:
        chunk, response = request.next_chunk(num_retries=3)
        if chunk:
            pct = int((chunk.progress() or 0) * 100)
            if pct != last_progress:
                last_progress = pct
                if stage_cb:
                    stage_cb(pct)

    video_id = response["id"]
    return {
        "video_id": video_id,
        "url": f"https://youtube.com/shorts/{video_id}",
        "privacy": privacy,
        "scheduled_at": scheduled_at,
    }


def set_privacy(user_id, video_id, privacy):
    creds = load_creds(user_id)
    if not creds:
        raise YouTubeError("Connect your YouTube channel first")
    if privacy not in ("public", "unlisted", "private"):
        raise YouTubeError("Invalid privacy value")
    yt = build("youtube", "v3", credentials=creds)
    yt.videos().update(
        part="status",
        body={"id": video_id, "status": {"privacyStatus": privacy}},
    ).execute()
    return privacy


def delete_video(user_id, video_id):
    creds = load_creds(user_id)
    if not creds:
        raise YouTubeError("Connect your YouTube channel first")
    yt = build("youtube", "v3", credentials=creds)
    yt.videos().delete(id=video_id).execute()


def list_upload_ids(user_id, max_results=50):
    creds = load_creds(user_id)
    if not creds:
        return []
    yt = build("youtube", "v3", credentials=creds)
    chans = yt.channels().list(part="contentDetails", mine=True).execute()
    items = chans.get("items", [])
    if not items:
        return []
    uploads_playlist = items[0]["contentDetails"]["relatedPlaylists"]["uploads"]
    resp = (
        yt.playlistItems()
        .list(part="contentDetails", playlistId=uploads_playlist, maxResults=min(max_results, 50))
        .execute()
    )
    return [i["contentDetails"]["videoId"] for i in resp.get("items", [])]


def fetch_video_stats(user_id, video_ids):
    creds = load_creds(user_id)
    if not creds or not video_ids:
        return []
    yt = build("youtube", "v3", credentials=creds)
    out = []
    for i in range(0, len(video_ids), 50):
        chunk = video_ids[i:i + 50]
        resp = yt.videos().list(part="snippet,statistics", id=",".join(chunk)).execute()
        for v in resp.get("items", []):
            st = v.get("statistics", {})
            out.append({
                "video_id": v["id"],
                "title": v["snippet"]["title"],
                "published_at": v["snippet"]["publishedAt"],
                "views": int(st.get("viewCount", 0)),
                "likes": int(st.get("likeCount", 0)),
                "comments": int(st.get("commentCount", 0)),
            })
    return out
