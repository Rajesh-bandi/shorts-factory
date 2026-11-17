"""Read the latest public GitHub release for in-app update checks."""
from __future__ import annotations

import os
import platform
import re
from urllib.parse import quote

import requests


DEFAULT_REPO = "Rajesh-bandi/shorts-factory"
USER_AGENT = "Shorts-Factory-Updater"


def version_tuple(value: str) -> tuple[int, int, int]:
    """Turn `v1`, `1.0.0` or `1.2.3-beta` into a comparable numeric tuple."""
    text = str(value or "").strip().lower()
    if text.startswith("v"):
        text = text[1:]
    text = text.split("+", 1)[0].split("-", 1)[0]
    parts: list[int] = []
    for piece in text.split(".")[:3]:
        match = re.match(r"\d+", piece)
        parts.append(int(match.group()) if match else 0)
    while len(parts) < 3:
        parts.append(0)
    return parts[0], parts[1], parts[2]


def display_version(value: str) -> str:
    return ".".join(str(part) for part in version_tuple(value))


def _arch_tokens(machine: str | None = None) -> tuple[str, ...]:
    value = (machine or platform.machine() or "").lower()
    if "x86_64" in value or value in {"amd64", "x64"}:
        return "x86_64", "amd64", "x64"
    if "aarch64" in value or "arm64" in value:
        return "aarch64", "arm64"
    return (value,) if value else ()


def pick_asset(assets, system: str | None = None, machine: str | None = None):
    """Pick the installer for this OS/architecture, ignoring checksums and maps."""
    system = system or platform.system()
    suffix = ".exe" if system == "Windows" else ".dmg" if system == "Darwin" else ".appimage"
    candidates = []
    for asset in assets or []:
        if not isinstance(asset, dict):
            continue
        name = str(asset.get("name") or "")
        url = str(asset.get("browser_download_url") or "")
        if not name or not url or not name.lower().endswith(suffix):
            continue
        candidates.append({
            "name": name,
            "url": url,
            "size": int(asset.get("size") or 0),
        })
    if not candidates:
        return None
    tokens = _arch_tokens(machine)
    matching = [item for item in candidates if any(token in item["name"].lower() for token in tokens)]
    return (matching or candidates)[0]


def check_for_update(
    current_version: str | None = None,
    api_url: str | None = None,
    repo: str | None = None,
    timeout: float = 6,
    system: str | None = None,
    machine: str | None = None,
):
    """Return serializable update metadata. Network failures are non-fatal."""
    current = str(current_version or "1.1.0")
    repo = (repo or os.getenv("UPDATE_REPO") or DEFAULT_REPO).strip().strip("/")
    api = (api_url or os.getenv("UPDATE_API_URL") or "").strip()
    if not api:
        api = f"https://api.github.com/repos/{repo}/releases/latest"
    result = {
        "current_version": display_version(current),
        "latest_version": None,
        "latest_tag": None,
        "available": False,
        "release_url": f"https://github.com/{repo}/releases",
        "notes": "",
        "published_at": None,
        "asset": None,
        "error": None,
    }
    try:
        response = requests.get(
            api,
            headers={"Accept": "application/vnd.github+json", "User-Agent": USER_AGENT},
            timeout=timeout,
        )
        if response.status_code == 404:
            result["error"] = "No published release found"
            return result
        response.raise_for_status()
        release = response.json()
    except Exception:
        result["error"] = "Update feed unavailable"
        return result
    if not isinstance(release, dict):
        result["error"] = "Update feed returned an invalid response"
        return result

    tag = str(release.get("tag_name") or "").strip()
    if not tag:
        result["error"] = "Release has no tag"
        return result
    latest = display_version(tag)
    result.update({
        "latest_version": latest,
        "latest_tag": tag,
        "available": (
            version_tuple(tag) > version_tuple(current)
            and not bool(release.get("draft"))
            and not bool(release.get("prerelease"))
        ),
        "release_url": str(release.get("html_url") or f"https://github.com/{repo}/releases/tag/{quote(tag)}"),
        "notes": str(release.get("body") or "")[:4000],
        "published_at": release.get("published_at"),
    })
    result["asset"] = pick_asset(release.get("assets") or [], system, machine)
    return result
