# Shorts Factory v1.3.0

Single-workspace desktop studio for turning long YouTube videos and live streams into vertical Shorts. Everything runs locally: no account, no hosted database, no rented server.

## Downloads

- **Windows:** `Shorts-Factory-Setup-1.3.0.exe`
- **Linux:** `Shorts-Factory-1.3.0-x86_64.AppImage`

The Windows installer is not code-signed yet, so Windows SmartScreen may show an "Unknown publisher" warning. On Linux, mark the AppImage executable and launch it:

```bash
chmod +x Shorts-Factory-1.3.0-x86_64.AppImage
./Shorts-Factory-1.3.0-x86_64.AppImage
```

## What's new

- **Omniroute is no longer bundled.** The app now uses only your own OpenAI-compatible endpoint, such as an Omniroute server hosted on AWS EC2. The installers are much smaller and launch faster, and provider state stays on your server.
- **Live-stream links work.** Paste a YouTube live URL (including `/live/<id>` links). The app records a bounded segment with ffmpeg, transcribes it locally, finds highlights, and renders clips. The default capture is 15 minutes; set `LIVE_CAPTURE_SECONDS` (30-3600) to change it.
- **Live previews and retries reuse the recording.** Preview cuts, manual cuts, and retries all use the local live file instead of trying to download a live stream again.
- **Branded installers and window.** The Windows installer now shows the Shorts Factory logo in its sidebar and header, with branded app, shortcut, taskbar and window icons.
- **Cleaner AI setup.** Settings shows the custom Base URL, model and API key fields directly. Hosted Omniroute and any other OpenAI-compatible endpoint work the same way.

## Upgrading from v1.2.x

1. Open **Settings → AI** and enter the Base URL of your EC2 Omniroute server, the model name, and the key configured on that server. The old bundled runtime and snapshot sync are gone.
2. If your live streams are longer than 15 minutes, set `LIVE_CAPTURE_SECONDS` before launching or raise the capture length in a future release.
3. Existing jobs, clips, settings and YouTube connections remain in the local data folder.

## Included

- Transcript-first analysis, AI or heuristic moment selection and range-only downloads.
- Candidate review, Hook Lab, caption studio, manual cuts, batch/series queues and ETA.
- Live-stream recording with local preview and manual cuts relative to the recording start.
- History, analytics, growth advisor, YouTube connection and explicit or automatic uploads.
- Vice 6 appearance with light/dark, Auto OS theme, cursor and motion options.
- In-app update checks against these GitHub Releases, with a newer-version toast and Install update action.
- Compressed API/static traffic and immutable caching for versioned frontend assets.

## Notes

- Real YouTube uploads require your own Google OAuth credentials.
- Automatic updates install in place on Windows and Linux AppImage builds. macOS is not part of this release.
- The live recorder needs an active stream and a working ffmpeg/yt-dlp pair; age-restricted or members-only streams still need the same cookies/access as normal downloads.
- Your data stays in the app's local user-data folder.
