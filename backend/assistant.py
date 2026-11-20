"""AI metadata assistance for publishing."""
import json
import re

from . import settings


def _fallback_title(clip, job):
    base = str(clip.get("title") or "Highlight").strip()
    if len(base) > 74:
        base = base[:71].rsplit(" ", 1)[0] + "…"
    return base or "Highlight"


def _fallback_description(clip, job, platform="youtube"):
    source = job.get("title") or "the source video"
    reason = str(clip.get("description") or clip.get("reason") or "").strip()
    lines = []
    if reason:
        lines.append(reason)
    lines.append(f"From: {source}")
    if job.get("url"):
        lines.append(str(job["url"]))
    lines.append("")
    lines.append("#Shorts")
    return "\n".join(lines)


def _config(user_id):
    cfg = settings.llm_config(user_id)
    if not cfg["api_key"]:
        return None
    return cfg


def _chat(cfg, prompt, timeout=90):
    import requests

    resp = requests.post(
        cfg["base_url"].rstrip("/") + "/chat/completions",
        headers={"Authorization": f"Bearer {cfg['api_key']}"},
        json=settings.llm_body(
            cfg,
            [{"role": "user", "content": prompt}],
            temperature=0.7,
        ),
        timeout=timeout,
    )
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]


def _json_object(text):
    m = re.search(r"\{.*\}", text or "", re.DOTALL)
    if not m:
        return {}
    try:
        value = json.loads(m.group(0))
        return value if isinstance(value, dict) else {}
    except json.JSONDecodeError:
        return {}


def _clip_prompt(job, clip, platform="youtube"):
    return f"""Write YouTube Shorts metadata for this clip.

Source video: {job.get('title') or 'video'}
Channel topic: {job.get('url') or ''}
Current clip title: {clip.get('title') or 'Highlight'}
Context: {str(clip.get('description') or '')[:1200]}
Target platform: {platform}

Requirements:
- 3 title options, each under 90 characters, specific, curiosity-driven, no clickbait lies
- one description under 1200 characters with a short hook, context, and source credit
- 3-5 relevant tags
- no hashtags inside the title

Reply with ONLY a JSON object:
{{"titles": ["...", "...", "..."], "description": "...", "tags": ["...", "..."]}}"""


def suggest_metadata(user_id, job, clip, platform="youtube"):
    fallback_titles = [_fallback_title(clip, job)]
    fallback = {
        "titles": fallback_titles,
        "description": _fallback_description(clip, job, platform),
        "tags": ["shorts", "clips"],
        "source": "fallback",
    }
    cfg = _config(user_id)
    if not cfg:
        return fallback
    try:
        text = _chat(cfg, _clip_prompt(job, clip, platform))
        data = _json_object(text)
        titles = [str(t).strip()[:100] for t in (data.get("titles") or []) if str(t).strip()]
        description = str(data.get("description") or "").strip()
        tags = [str(t).strip().lstrip("#") for t in (data.get("tags") or []) if str(t).strip()]
        if not titles:
            titles = fallback_titles
        if not description:
            description = fallback["description"]
        if not tags:
            tags = fallback["tags"]
        return {
            "titles": titles[:3],
            "description": description[:5000],
            "tags": tags[:8],
            "source": "llm",
        }
    except Exception:
        return fallback



