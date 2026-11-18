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

# Built-in AI: start the app-owned Omniroute instance if it is installed.
# The desktop shell does the same; this keeps ./run.sh equivalent.
OMNI_PID=""
if command -v node >/dev/null 2>&1; then
  node scripts/omniroute-run.js &
  OMNI_PID=$!
fi

cleanup() {
  if [ -n "$OMNI_PID" ]; then
    kill -TERM "$OMNI_PID" 2>/dev/null || true
    wait "$OMNI_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

.venv/bin/python -m uvicorn backend.main:app --host 127.0.0.1 --port 8787 &
APP_PID=$!
STATUS=0
wait "$APP_PID" || STATUS=$?
cleanup
exit "$STATUS"
