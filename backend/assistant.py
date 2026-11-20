"""AI metadata assistance for publishing and Hook Lab."""
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


def _fallback_hooks(candidate):
    title = " ".join(str((candidate or {}).get("title") or "Watch this").split())
    title = title[:58].rstrip(" .,;:!-")
    if not title:
        title = "Watch this"
    return [f"🔥 {title}", f"😳 {title}", f"⚡ {title}"]


def _has_emoji(text):
    return any(0x2600 <= ord(ch) <= 0x27BF or ord(ch) >= 0x1F000 for ch in str(text or ""))


def suggest_hooks(user_id, job, candidate):
    """Three short on-screen hook lines for the top of a Short."""
    candidate = candidate or {}
    fallback = _fallback_hooks(candidate)
    cfg = _config(user_id)
    if not cfg:
        return {"hooks": fallback, "source": "fallback"}
    title = str((candidate or {}).get("title") or "Short")
    reason = str((candidate or {}).get("reason") or "")
    transcript = str((candidate or {}).get("transcript") or "")[:1800]
    prompt = (
        "Write 3 hook lines for a vertical YouTube Short. The chosen line is burned in at the "
        "top of the video and stays on screen for the entire clip.\n"
        f"Source video: {job.get('title') or job.get('url') or 'video'}\n"
        f"Moment title: {title}\n"
        f"Why this moment: {reason}\n"
        f"Transcript around the moment:\n{transcript}\n\n"
        "Rules:\n"
        "- Exactly 3 options, each under 55 characters.\n"
        "- Each option must include 1 or 2 relevant emoji.\n"
        "- Make them curiosity-driven and specific to this moment; no hashtags, quotes, or generic filler.\n"
        "- They must make sense on their own at the top of the screen.\n"
        'Return JSON only: {"hooks": ["first", "second", "third"]}'
    )
    try:
        data = _json_object(_chat(cfg, prompt, timeout=60))
        hooks = []
        for raw in (data or {}).get("hooks") or []:
            line = " ".join(str(raw or "").split()).strip().strip('"').strip("'")
            line = " ".join(word for word in line.split() if not word.startswith("#"))
            if not line:
                continue
            if not _has_emoji(line):
                line = "🔥 " + line
            line = line[:80].rstrip(" .,;:!-")
            if line and line.lower() not in {h.lower() for h in hooks}:
                hooks.append(line)
        for line in fallback:
            if len(hooks) >= 3:
                break
            if line.lower() not in {h.lower() for h in hooks}:
                hooks.append(line)
        if hooks:
            return {"hooks": hooks[:3], "source": "llm"}
    except Exception:
        pass
    return {"hooks": fallback, "source": "fallback"}


def hook_lab(user_id, job, candidate):
    """Three title/openings for a review candidate before rendering."""
    base = {
        "titles": [str(candidate.get("title") or "Highlight")[:90]],
        "source": "fallback",
    }
    cfg = _config(user_id)
    if not cfg:
        return base
    prompt = f"""Give 3 strong opening titles for one YouTube Shorts moment.

Source video: {job.get('title') or 'video'}
AI summary: {candidate.get('title') or ''}
Why it was picked: {candidate.get('reason') or ''}
Transcript window: {str(candidate.get('transcript') or '')[:1500]}

Titles must be under 90 characters, promise the actual payoff, and avoid generic words.
Reply with ONLY a JSON object: {{"titles": ["...", "...", "..."]}}"""
    try:
        data = _json_object(_chat(cfg, prompt, timeout=60))
        titles = [str(t).strip()[:100] for t in (data.get("titles") or []) if str(t).strip()]
        return {"titles": titles[:3] or base["titles"], "source": "llm"}
    except Exception:
        return base
