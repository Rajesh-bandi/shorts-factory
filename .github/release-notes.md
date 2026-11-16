# Shorts Factory v1

Single-workspace desktop studio for turning long YouTube videos into vertical Shorts. Everything runs locally: no account, no hosted database, no rented server.

## Downloads

- **Windows:** `Shorts-Factory-Setup-1.0.0.exe`
- **Linux:** `Shorts-Factory-1.0.0-x86_64.AppImage`

The Windows installer is not code-signed yet, so Windows SmartScreen may show an “Unknown publisher” warning. On Linux, mark the AppImage executable and launch it:

```bash
chmod +x Shorts-Factory-1.0.0-x86_64.AppImage
./Shorts-Factory-1.0.0-x86_64.AppImage
```

## Included

- Local single-user workspace with no sign-in.
- AI or heuristic moment selection, transcript-first analysis and range-only downloads.
- Candidate review, Hook Lab, caption studio, manual cuts, batch/series queues and ETA.
- History, analytics, growth advisor, YouTube connection and explicit uploads.
- Vice 6 appearance with light/dark, Auto OS theme, cursor and motion options.
- In-app update checks against these GitHub Releases, with a newer-version toast and Install update action.
- Compressed API/static traffic and immutable caching for versioned frontend assets.

## Notes

- Real YouTube uploads and paid AI calls require your own credentials.
- Automatic updates install in place on Windows and Linux AppImage builds. macOS is not part of this release.
- Your data stays in the app's local user-data folder.
