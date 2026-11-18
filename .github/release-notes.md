# Shorts Factory v1.2.0

Single-workspace desktop studio for turning long YouTube videos into vertical Shorts. Everything runs locally: no account, no hosted database, no rented server.

## Downloads

- **Windows:** `Shorts-Factory-Setup-1.2.0.exe`
- **Linux:** `Shorts-Factory-1.2.0-x86_64.AppImage`

The Windows installer is not code-signed yet, so Windows SmartScreen may show an “Unknown publisher” warning. On Linux, mark the AppImage executable and launch it:

```bash
chmod +x Shorts-Factory-1.2.0-x86_64.AppImage
./Shorts-Factory-1.2.0-x86_64.AppImage
```

## What's new

- **Built-in Omniroute AI is the default.** The app starts its own headless Omniroute instance on `127.0.0.1:20129` and routes AI calls through it. No API key is needed, and the custom OpenAI-compatible provider remains available when the built-in toggle is off.
- **The installer includes the runtime.** Node.js and a separate `omniroute` install are no longer required. The installers are larger because they carry the pinned Omniroute runtime.
- **Encrypted login sync for friends.** Settings → AI → **Snapshot sync for friends** pulls the owner's encrypted Omniroute login snapshot from a private GitHub repository. A downloaded snapshot is staged and applied on the next restart.
- **Provider logins survive app updates.** The app keeps its own Omniroute data under the app's private user-data folder; snapshots and provider credentials are never committed or included in a public release asset.
- **AI status and health.** Settings shows whether built-in Omniroute is online, and the health panel reports its state. The AI connection test works with both built-in and custom providers.

## Friend setup

The owner must invite your GitHub account to the private snapshot repository and share the snapshot passphrase privately.

1. Create a fine-grained GitHub token limited to the private snapshot repository with **Contents: Read-only**.
2. Open **Settings → AI → Snapshot sync for friends**, enable it, and enter the repository, token and passphrase.
3. Click **Check now**, then restart Shorts Factory to apply the staged snapshot.

The token and passphrase are stored in the app's encrypted settings. The snapshot shares the owner's provider accounts and quotas; provider sessions can rotate when several machines use the same login.

## Included

- Local single-user workspace with no sign-in.
- AI or heuristic moment selection, transcript-first analysis and range-only downloads.
- Candidate review, Hook Lab, caption studio, manual cuts, batch/series queues and ETA.
- History, analytics, growth advisor, YouTube connection and explicit or automatic uploads.
- Vice 6 appearance with light/dark, Auto OS theme, cursor and motion options.
- In-app update checks against these GitHub Releases, with a newer-version toast and Install update action.
- Compressed API/static traffic and immutable caching for versioned frontend assets.

## Notes

- Real YouTube uploads require your own Google OAuth credentials.
- Automatic updates install in place on Windows and Linux AppImage builds. macOS is not part of this release.
- Your data stays in the app's local user-data folder.
