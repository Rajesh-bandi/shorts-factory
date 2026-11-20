# Shorts Factory

Turn long YouTube videos into vertical Shorts on your own computer. The app
reads the timed transcript first, lets AI choose the strongest moments,
downloads **only the selected ranges**, and renders 9:16 clips with burned-in
captions. Live streams are recorded for a bounded segment and then go through
the same pipeline. Rendering is always local; publishing is explicit per clip from
History, or can be enabled for normal AI-clip jobs with AI-written metadata.

This is now a **single-workspace desktop app**: no sign-in screen, no account
separation, and no server to rent. Each installation keeps its own database,
media, API keys and YouTube connection. Friends can install the packaged app
and use their own copy independently.

## Run from source

```bash
./run.sh
# open http://127.0.0.1:8787
```

`run.sh` creates `.venv` and installs `requirements.txt`. For development you
also need `ffmpeg`, `ffprobe` and `yt-dlp` on `PATH`. SQLite lives at
`data/shorts.db`, media at `data/media/<workspace-id>/`. The backend binds to
loopback only.

Existing data is preserved: on first local start the app adopts the oldest
existing profile in the database, so its jobs, clips, settings and OAuth token
stay available. Nothing is copied or deleted. Fresh installs create a local
workspace automatically.

## Desktop app (Electron)

The desktop app starts its own private FastAPI process on
`http://127.0.0.1:8787`, waits until it is healthy, and opens the studio in a
native window. Closing the window stops the backend.

### Develop the desktop shell

```bash
npm install
npm start
```

`npm start` reuses an already-running Shorts Factory backend on port 8787, or
starts `backend.main` with `.venv`. In development it uses the project's
`data/` directory. Logs are written to the Electron user-data `logs/backend.log`.

### Build an installer

Install the build dependencies once:

```bash
.venv/bin/pip install pyinstaller
npm install
```

Then run the build **on the operating system you want to package**:

```bash
# Linux — AppImage in release/
npm run dist

# Windows — NSIS installer in release/
npm run dist:win

# macOS — DMG in release/
npm run dist:mac
```

`npm run dist` runs `scripts/build-desktop.js` first. It freezes the backend
with PyInstaller, bundles static `ffmpeg`/`ffprobe`, and downloads a standalone
`yt-dlp` into `build/bin`. Those files are copied into the app as read-only
resources. Whisper models download on first use into the app's user-data
folder, so the install itself stays small.

The Windows NSIS installer uses `build/icon.ico` plus
`build/installerSidebar.bmp` and `build/installerHeader.bmp` for its branded
sidebar and header. The same icon is used for the desktop shortcut, taskbar and
application window; the Linux AppImage uses `build/icon.png`.

Windows and macOS builds must be produced on those systems (or on a CI runner
for that platform); PyInstaller does not cross-compile. macOS builds are not
code-signed, so first launch may require right-click → Open. Windows SmartScreen
may show an unknown-publisher warning unless the installer is signed.

The Linux output is a single portable file in `release/`. Send it to a friend,
or run it yourself:

```bash
chmod +x release/Shorts-Factory-*.AppImage
./release/Shorts-Factory-*.AppImage
```

If AppImage mounting is unavailable on an older distribution, launch it with
`--appimage-extract-and-run`. No root install is required.

### Where each installation keeps data

| System | Data folder |
| --- | --- |
| Linux | `~/.config/shorts-factory/data` |
| Windows | `%APPDATA%\shorts-factory\data` |
| macOS | `~/Library/Application Support/shorts-factory/data` |

The exact folder is available from **Shorts Factory → Open data folder** in the
desktop menu. To move an existing source install into the desktop app, copy the
project's `data/` folder into that location before launching. Keep a backup;
do not copy over a folder that is already in use.

## Releases and updates

Public releases are published at
[github.com/Rajesh-bandi/shorts-factory/releases](https://github.com/Rajesh-bandi/shorts-factory/releases).
The Linux AppImage and Windows NSIS installer are built by
`.github/workflows/release.yml` on every `v*` tag.

At launch — and every six hours while the app is open — the studio checks the
latest public GitHub release. If a newer version exists, a persistent toast
offers **Install update**. Linux replaces the running AppImage atomically and
relaunches it; Windows downloads the setup executable, launches it and exits so
the installer can finish. The button opens the release page if no installer is
available for the current platform (for example, when running from source).

To publish a new version, bump `package.json` and create a matching tag (for
example `v1.4.0` for package version `1.4.0`). Tags may omit trailing zeroes:
`v1`, `v1.0` and `v1.0.0` normalize to the same version. Pushing the tag starts
GitHub Actions for both platforms and publishes the installers and
`SHA256SUMS.txt`.

## Features

- Transcript-first analysis without downloading the full video.
- AI moment selection, or local transcript/audio heuristics without an API key.
- Review candidates before rendering: trim, rename, cut sequences, Hook Lab
  titles, per-word caption editing.
- Section-only downloads, cached retries, CPU/GPU rendering, automated QA.
- Live-stream support: records a configurable segment, then finds and renders
  clips from that recording.
- Durable queued jobs with ETA, queue position and live activity logs.
- History, batch/series mode, analytics, growth advisor and CSV export.
- Optional YouTube connect/upload with AI-written metadata, including automatic
  upload after normal AI-clip renders (never batch jobs).
- Vice 6 appearance: sunset and daytime themes, configurable cursor, sound,
  motion, palette, typography, density and focus states.
- Local appearance preferences sync to the workspace database, with an
  instant localStorage copy to prevent theme flashes.

## YouTube and AI setup

Open **Settings** in the app:

1. **Channel** — create a Google OAuth *web client*, enable YouTube Data API v3
   and YouTube Analytics API, and register the callback shown in Settings:
   `http://127.0.0.1:8787/api/auth/callback`.
2. Paste the client ID and secret, save, then **Connect channel**. Desktop
   builds open Google in your normal browser; the local backend receives the
   callback.
3. **AI** — enter your hosted Omniroute server's Base URL (for example
   `https://ai.example.com/v1`), API key and optional model. Leaving the model
   blank sends `auto`, so OmniRoute picks a healthy provider; set an exact model
   name for endpoints that require one. The app no longer bundles
   Omniroute, so installers are smaller and start faster; the server can run on
   AWS EC2 and keep its provider state there. Any other OpenAI-compatible
   endpoint also works. Without it, the pipeline falls back to local heuristics.
4. **Pipeline** — choose Whisper model, GPU, clip length, output quality and the
   folder where finished clips are stored.

Secrets are encrypted at rest and never returned to the browser after saving.
A lost `APP_SECRET_KEY` makes stored tokens and API keys unreadable, so keep it
stable and backed up. The bundled desktop app uses a generated key stored in
the workspace data folder.

The app requests `youtube.force-ssl`, `youtube.readonly` and
`yt-analytics.readonly` so it can upload, update privacy, delete, and read
retention/watch-time metrics.

## Pipeline

1. Read metadata and English captions without downloading video.
   For an active live stream, record it locally first. Live links always use
   chat spikes: watch chat for the first surge (`LIVE_CHAT_SCAN_SECONDS`),
   record `LIVE_SPIKE_PAD_SECONDS` after each surge (live cannot be rewound),
   stop once the requested number of clips has its post-roll, and never exceed
   `LIVE_MAX_CAPTURE_SECONDS`. No chat or no spike fails the job with a clear
   error.
2. AI selects moments from the timed transcript. Long videos are map-reduced in
   overlapping windows so the end of a two-hour video is not dropped. Without
   AI, a transcript hook heuristic is used.
3. Review candidates before any media download: trim in/out, rename, use Hook
   Lab for AI title options, or edit the exact caption lines.
4. Download only selected sections, then crop/reframe to 1080×1920 and burn
   captions. A full-source download is a fallback only when section extraction
   fails; cached sections are reused on retry/re-render.
5. Automated QA checks duration, 9:16 aspect, audio presence, loudness and
   clipping. Failed QA blocks upload unless explicitly forced.

Normal AI-clip runs can optionally auto-upload their rendered Shorts with AI
metadata; batch, series and manual cuts always stay local. Every render is in
History, with **Not uploaded** and **Uploaded** filters. Batch/series mode queues
up to 20 source URLs at once. The local job queue records ETA as a conservative estimate; it appears as a
queue position while waiting and a remaining-time estimate once progress is
measurable.

## Configuration

For source runs, environment variables can be placed in `.env`. Do not expose
the local server to a public network.

| Variable | Purpose |
| --- | --- |
| `APP_MODE` | `local` (default) or `multi` for the invite-only server mode |
| `APP_DOMAIN` | Hostname Caddy obtains a certificate for (AWS compose) |
| `APP_BASE_URL` | Origin used by OAuth callbacks |
| `OAUTH_REDIRECT_URI` | Exact Google callback URL |
| `APP_SECRET_KEY` | Encryption key for per-workspace secrets |
| `DATA_DIR` | Database and media root |
| `DATABASE_URL` | Postgres URL in multi mode; defaults to SQLite under `DATA_DIR` |
| `APP_VERSION` | Current desktop version used by update checks |
| `UPDATE_REPO` | Public GitHub repository that hosts releases |
| `UPDATE_API_URL` | Override the releases feed (advanced/testing) |
| `WORKER_CONCURRENCY` | Durable job workers (default 2). Keep one backend process; analysis is serialized. |
| `MAX_USERS` | Account cap in multi mode (default 4) |
| `REGISTRATION_INVITE_CODE` | Required after the first account; share only with invited users |
| `COOKIE_SECURE` | Set `true` behind HTTPS in multi mode |
| `MEDIA_RETENTION_DAYS` | Reserved cleanup setting; not enforced by the backend yet (0 = keep) |
| `JOB_SOURCE_RETENTION_DAYS` | Reserved source-cleanup setting; not enforced yet (0 = keep) |
| `DEFAULT_JOB_SECONDS` | Fallback ETA before enough job history exists |
| `LIVE_CHAT_SCAN_SECONDS` | Watch chat for the first spike (default 300, 30–1800) |
| `LIVE_SPIKE_PAD_SECONDS` | Record after each spike; live has no rewind (default 60, 30–900) |
| `LIVE_MAX_CAPTURE_SECONDS` | Hard safety cap per live capture (default 900, 120–7200) |
| `LIVE_RECORD_STALL_SECONDS` | Fail when ffmpeg writes no data (default 120, 60–600) |

## Optional multi-user server

An invite-only multi-user deployment remains available for small private
groups. The default account cap is four.

For a private AWS deployment, use `docker-compose.aws.yml`, `deploy/Caddyfile`
and the step-by-step runbook in `deploy/AWS.md`. It covers Caddy TLS, Postgres,
EBS media storage, backups, and the four-user invite setup.

For a generic Docker host:

```bash
cp .env.example .env
# edit the public URL, secrets, invite code and database password
docker compose up -d --build
# open http://your-host:8080
```

Docker Compose explicitly sets `APP_MODE=multi`. Put HTTPS in front and set
`APP_BASE_URL`, `OAUTH_REDIRECT_URI` and `COOKIE_SECURE=true` to match the
public origin. Set `REGISTRATION_INVITE_CODE` before inviting anyone and
bootstrap the owner before exposing the host. See `.env.example` for the full
list. Never run the default local mode on a public interface: it is
intentionally unauthenticated.

## Notes and limits

- YouTube can rate-limit caption requests; the app falls back to audio-only
  Whisper analysis.
- The desktop bundle ships CPU Whisper support for portability. On this
  development machine, GPU acceleration works through the existing Python
  environment; a GPU-enabled frozen build requires bundling the matching CUDA
  runtime.
- Auto-upload is opt-in and requires each user's own Google OAuth client;
  manual cuts and batch jobs stay local.
- Live links always use chat-spike detection. The chat toggle in Settings only
  affects normal videos.
- Updates are checked against public GitHub Releases. Windows and Linux AppImage
  builds can install them in place; the Windows installer is currently
  unsigned.
- Real YouTube uploads and paid AI calls require the user's own credentials and
  are not exercised by the bundled smoke checks.
