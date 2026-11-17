"""Destination management for finished clip files."""
import os
import shutil
import tempfile
from pathlib import Path

from . import downloader, settings


def validate_output_dir(value):
    """Return a normalized absolute folder, creating and probing it."""
    value = str(value or "").strip()
    if not value:
        return ""
    expanded = os.path.expanduser(os.path.expandvars(value))
    path = Path(expanded)
    if not path.is_absolute():
        raise ValueError("Use an absolute folder path")
    try:
        path.mkdir(parents=True, exist_ok=True)
        fd, probe = tempfile.mkstemp(prefix=".shorts-factory-write-", dir=str(path))
        os.close(fd)
        os.unlink(probe)
    except OSError as e:
        raise ValueError(f"Could not write to that folder: {e}") from e
    return str(path.resolve())


def resolve_output_dir(user_id):
    value = settings.get(user_id, "output_dir", "") or ""
    if not str(value).strip():
        return downloader.user_media_dir(user_id)
    return str(Path(os.path.expanduser(os.path.expandvars(str(value)))).resolve())


def place_clip(user_id, path, thumb=None):
    """Move a finished clip into the configured folder, when one is set."""
    target_dir = resolve_output_dir(user_id)
    source_dir = os.path.abspath(os.path.dirname(path))
    if os.path.abspath(target_dir) == source_dir:
        return path, thumb
    os.makedirs(target_dir, exist_ok=True)
    target_path = os.path.join(target_dir, os.path.basename(path))
    if os.path.abspath(target_path) != os.path.abspath(path):
        if os.path.exists(target_path):
            os.remove(target_path)
        shutil.move(path, target_path)
    target_thumb = None
    if thumb and os.path.isfile(thumb):
        target_thumb = os.path.join(target_dir, os.path.basename(thumb))
        if os.path.abspath(target_thumb) != os.path.abspath(thumb):
            try:
                if os.path.exists(target_thumb):
                    os.remove(target_thumb)
                shutil.move(thumb, target_thumb)
            except OSError:
                # The video is already in place; a missing thumbnail should not
                # make the render look lost.
                target_thumb = None
    return target_path, target_thumb