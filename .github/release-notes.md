# Shorts Factory v1.4.0

Single-workspace desktop studio for turning long YouTube videos and live streams into vertical Shorts. Everything runs locally: no account, no hosted database, no rented server.

## Downloads

- **Windows:** `Shorts-Factory-Setup-1.4.0.exe`
- **Linux:** `Shorts-Factory-1.4.0-x86_64.AppImage`

The Windows installer is not code-signed yet, so Windows SmartScreen may show an "Unknown publisher" warning. On Linux, mark the AppImage executable and launch it:

```bash
chmod +x Shorts-Factory-1.4.0-x86_64.AppImage
./Shorts-Factory-1.4.0-x86_64.AppImage
```

## What's new

- **Copy-ready AI details in History.** Click any rendered clip to open a details view with AI-written title options, a description, tags and the full local video path. Every field has a copy button, so you can publish manually without retyping anything. With auto-upload off, clips still land in History under **Not uploaded**.
- **AI hook lines burned into the Short.** After AI finds the moments, it writes three emoji hook lines for each one. Pick a hook in review, choose **No hook line**, or use **Auto — first AI hook** when creating the job. The chosen line stays at the top of the video for the entire Short, including multi-cut and live-stream clips.
- **Hook control in render settings.** Set the default hook behavior under **Create → Render options** and **Settings → Analysis**. Auto picks the first AI line; manual leaves the choice for review; none renders without a hook.
- **Emoji render correctly.** The desktop build ships a monochrome emoji font and passes it to ffmpeg, so hook emoji render on Linux and Windows instead of showing missing-glyph boxes.

## Also included

- Live chat spike detection records through the stream when enabled, captures chat alongside the recording, and falls back to transcript/AI when chat is quiet.
- Existing live-stream recording, manual cuts, caption studio, analytics, growth advisor and auto-upload behavior are unchanged.

## Upgrading from v1.3.x

1. Install the new build over the old one. Jobs, clips, settings and YouTube connections stay in the local data folder.
2. Hook lines require your configured OpenAI-compatible provider. Without one, the app falls back to local hook text.
3. AI title options and descriptions in History use the same provider and work without connecting YouTube.

## Notes

- Real YouTube uploads require your own Google OAuth credentials.
- Automatic updates install in place on Windows and Linux AppImage builds. macOS is not part of this release.
- The live recorder needs an active stream and a working ffmpeg/yt-dlp pair; age-restricted or members-only streams still need the same cookies/access as normal downloads.
- Your data stays in the app's local user-data folder.
