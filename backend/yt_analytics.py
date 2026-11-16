"""YouTube Analytics (retention / watch time) queries."""
from datetime import date, timedelta

from googleapiclient.discovery import build

from . import uploader


def _client(user_id):
    creds = uploader.load_creds(user_id)
    if not creds:
        return None
    return build("youtubeAnalytics", "v2", credentials=creds)


def fetch_video_retention(user_id, video_ids=None):
    """Return {video_id: metrics} for the last 90 days.

    Analytics metric availability varies by channel type. We degrade to the
    universally available core metrics rather than failing the whole refresh.
    """
    yt = _client(user_id)
    if not yt:
        return {}
    end = date.today()
    start = end - timedelta(days=90)
    full = (
        "views,estimatedMinutesWatched,averageViewDuration,"
        "averageViewPercentage,subscribersGained"
    )
    core = "views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage"
    for metrics in (full, core):
        try:
            resp = yt.reports().query(
                ids="channel==MINE",
                startDate=start.isoformat(),
                endDate=end.isoformat(),
                metrics=metrics,
                dimensions="video",
                sort="-views",
                maxResults=200,
            ).execute()
            headers = [h["name"] for h in resp.get("columnHeaders", [])]
            rows = resp.get("rows", []) or []
            out = {}
            for row in rows:
                item = dict(zip(headers, row))
                vid = str(item.get("video") or "")
                if not vid:
                    continue
                out[vid] = {
                    "views": int(item.get("views") or 0),
                    "watch_time_minutes": float(item.get("estimatedMinutesWatched") or 0),
                    "avg_view_duration": float(item.get("averageViewDuration") or 0),
                    "avg_view_percentage": float(item.get("averageViewPercentage") or 0),
                    "subs_gained": int(item.get("subscribersGained") or 0),
                }
            if video_ids:
                wanted = set(video_ids)
                out = {k: v for k, v in out.items() if k in wanted}
            return out
        except Exception:
            continue
    return {}
