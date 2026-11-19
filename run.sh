#!/usr/bin/env bash
# YTM Shorts Factory — start script
set -e
cd "$(dirname "$0")"

if [ ! -d .venv ]; then
  echo "[*] Creating virtualenv..."
  python3 -m venv .venv
  .venv/bin/pip install -q --upgrade pip
  .venv/bin/pip install -q -r requirements.txt || echo "[!] Some deps failed — app runs in degraded mode, install later."
fi

echo "[*] Starting YTM Shorts Factory on http://127.0.0.1:8787"
exec .venv/bin/python -m uvicorn backend.main:app --host 127.0.0.1 --port 8787
