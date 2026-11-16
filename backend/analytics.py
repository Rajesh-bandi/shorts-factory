"""Per-user YouTube analytics and retention insights."""
from . import db, uploader, yt_analytics


def refresh(user_id):
    """Pull latest channel/video/retention stats for one user's channel."""
    if not uploader.connected(user_id):
        raise RuntimeError("YouTube not connected")
    info = uploader.channel_info(user_id, force=True)
    if info:
        db.add_channel_snapshot(user_id, info["subs"], info["views"], info["video_count"])
    ids = uploader.list_upload_ids(user_id, 50)
    rows = uploader.fetch_video_stats(user_id, ids)
    retention = yt_analytics.fetch_video_retention(user_id, ids)
    for row in rows:
        row.update(retention.get(row["video_id"], {}))
    db.upsert_video_stats(user_id, rows)
    return {"channel": info, "videos": len(rows), "retention_rows": len(retention)}


def summary(user_id):
    videos = db.list_video_stats(user_id)
    snaps = db.list_channel_snapshots(user_id)
    channel = uploader.channel_info(user_id) if uploader.connected(user_id) else None

    total_views = sum(v["views"] for v in videos)
    best = sorted(videos, key=lambda v: v["views"], reverse=True)[:5]
    recent = videos[:12]
    views_series = [{"ts": s["ts"], "views": s["total_views"]} for s in snaps]

    return {
        "connected": uploader.connected(user_id),
        "channel": channel,
        "videos": recent,
        "top_videos": best,
        "tracked_videos": len(videos),
        "total_views_tracked": total_views,
        "clips_made": db.count_clips(user_id),
        "uploaded_clips": db.count_uploaded(user_id),
        "snapshots": snaps[-30:],
        "views_series": views_series[-30:],
        "insights": _insights(videos, channel),
        "avg_retention": round(
            sum(float(v.get("avg_view_percentage") or 0) for v in videos if v.get("avg_view_percentage"))
            / max(1, len([v for v in videos if v.get("avg_view_percentage")])),
            1,
        ),
    }


def _insights(videos, channel):
    tips = []
    if not videos:
        tips.append("Connect your channel and upload your first Short — analytics unlock after that.")
        return tips

    avg_views = sum(v["views"] for v in videos) / len(videos)
    with_ret = [v for v in videos if v.get("avg_view_percentage")]
    avg_ret = sum(v["avg_view_percentage"] for v in with_ret) / max(1, len(with_ret))
    if avg_views < 500:
        tips.append("Views are low — Shorts live or die in the first 3 seconds. Cut dead air, start mid-action.")
    else:
        tips.append(f"Average {int(avg_views)} views/video. Double down on the format of your top performer.")
    if with_ret:
        if avg_ret < 50:
            tips.append(
                f"Average retention is {avg_ret:.0f}% — tighten the intro, remove pauses, and land the payoff sooner."
            )
        else:
            tips.append(f"Average retention is {avg_ret:.0f}% — this pacing is working; keep the same cut rhythm.")
    if len(videos) < 10:
        tips.append("Post consistently: 1 Short/day for 2 weeks teaches the algorithm who your audience is.")

    if videos:
        worst = sorted(videos, key=lambda v: v["views"])[:3]
        if worst and worst[0]["views"] < avg_views * 0.3:
            tips.append(
                f"'{worst[0]['title']}' underperformed hard — compare its hook with your top clip and note the difference."
            )
        likes_ratio = sum(v["likes"] for v in videos) / max(sum(v["views"] for v in videos), 1)
        if likes_ratio < 0.01:
            tips.append("Like-ratio under 1%: end clips with a moment that demands a reaction (clutch, fail, cliffhanger).")
    return tips
