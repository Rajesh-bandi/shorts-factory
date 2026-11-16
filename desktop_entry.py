"""Entry point used by PyInstaller for the desktop backend."""
import os

import uvicorn

from backend.main import app


if __name__ == "__main__":
    uvicorn.run(
        app,
        host="127.0.0.1",
        port=int(os.environ.get("PORT", "8787")),
        log_level=os.environ.get("LOG_LEVEL", "info"),
    )
