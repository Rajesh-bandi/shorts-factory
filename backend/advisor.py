"""Growth advisor — LLM strategy tips grounded in real channel stats."""
import json
import re

from . import analytics, settings


def _rule_based(user_id):
    data = analytics.summary(user_id)
    tips = list(data.get("insights") or [])
    return {
        "source": "rules",
        "next_best_action": tips[0] if tips else "Upload your first Short — every insight improves once there is data.",
        "actions": tips[1:5] or [
            "Batch three clips from one long video while the context is fresh.",
            "Cut on the reaction, not the setup.",
            "Post at the same hour for a week, then read the analytics.",
        ],
    }


def advise(user_id):
    """Return prioritized actions to grow this user's channel."""
    if not settings.llm_available(user_id):
        return _rule_based(user_id)

    try:
        data = analytics.summary(user_id)
        context = {
            "channel": data["channel"],
            "tracked_videos": [
                {
                    "title": v["title"],
                    "views": v["views"],
                    "likes": v["likes"],
                    "published": v["published_at"],
                }
                for v in data["videos"]
            ],
            "clips_made_by_app": data["clips_made"],
            "avg_retention": data.get("avg_retention"),
        }

        prompt = f"""You are a YouTube growth strategist for a channel that posts gaming Shorts.

Channel data (JSON): {json.dumps(context)[:8000]}

Give short, concrete, prioritized advice. Reply with ONLY a JSON object:
{{
  "next_best_action": "<the single most impactful thing to do next, one sentence>",
  "actions": ["<action 1>", "<action 2>", "<action 3>", "<action 4>"]
}}"""

        import requests

        cfg = settings.llm_config(user_id)
        resp = requests.post(
            cfg["base_url"].rstrip("/") + "/chat/completions",
            headers={"Authorization": f"Bearer {cfg['api_key']}"},
            json=settings.llm_body(
                cfg,
                [{"role": "user", "content": prompt}],
                temperature=0.6,
            ),
            timeout=90,
        )
        resp.raise_for_status()
        text = resp.json()["choices"][0]["message"]["content"]
        m = re.search(r"\{.*\}", text, re.DOTALL)
        if not m:
            return _rule_based(user_id)
        out = json.loads(m.group(0))
        out["source"] = "llm"
        out.setdefault("next_best_action", "")
        out.setdefault("actions", [])
        if not out["next_best_action"]:
            return _rule_based(user_id)
        return out
    except Exception:
        return _rule_based(user_id)
