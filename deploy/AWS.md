# Shorts Factory — private AWS deployment for 4 users

Target: one small AWS server, the existing Docker Compose stack, Postgres,
HTTPS, and exactly four accounts (you + three friends). Minimum new
infrastructure: no ALB, ECS, RDS, or S3 is required.

Placeholders used below:

- `shorts.example.com` — the real hostname, pointing at the server
- `you@example.com` — the owner account
- `us-east-1` — pick the region closest to the four users

---

## 1. Architecture

```
Internet (HTTPS 443)
        |
     Caddy  (TLS, automatic Let's Encrypt)
        |
   frontend nginx  (static ES modules, /api and /media proxy)
        |
   backend FastAPI  (auth, jobs, live chat, ffmpeg, yt-dlp, Whisper)
        |
   Postgres 16 container
        |
   EBS gp3 volume mounted at /mnt/shorts
     /mnt/shorts/data   -> /data (media, transcripts, uploads)
     /mnt/shorts/db     -> Postgres data
     /mnt/shorts/caddy  -> certificates
```

All four users share the instance. The app already scopes jobs, settings,
media, and OAuth credentials by `user_id`; `MAX_USERS=4` plus the invite code
is the access boundary. Each user can connect their own YouTube OAuth client.

Rough cost: one 8 GB / 2 vCPU instance + 100 GB gp3 + Elastic IP +
snapshots is usually about **$70–90/month** depending on region and family.
A 4 GB instance is cheaper but can OOM when Whisper and two ffmpeg jobs run
together; 8 GB is the safe minimum.

---

## 2. Launch the instance

Recommended baseline:

- AMI: Ubuntu 24.04 LTS
- Type: `t3.large` (2 vCPU, 8 GB) with unlimited CPU credits, or
  `m7g.large` / `t4g.large` (Graviton) if you prefer ARM
- Storage: 100 GB gp3 root (or 30 GB root + separate 100 GB gp3 data volume)
- Elastic IP: allocate and associate it
- Security group:
  - 22/tcp from your admin IP only (or use SSM Session Manager and no SSH)
  - 80/tcp and 443/tcp from `0.0.0.0/0` for Caddy/Let's Encrypt
  - no 5432, no 8000, no 8080

For a stricter "no public origin" setup, see section 11.

DNS: create an `A` record `shorts.example.com -> Elastic IP` before starting
Caddy, so the first certificate request succeeds.

---

## 3. Mount the data volume

If the data volume is a separate EBS device (for example `/dev/nvme1n1`):

```bash
lsblk
sudo mkfs -t xfs /dev/nvme1n1
sudo mkdir -p /mnt/shorts
echo "UUID=$(sudo blkid -s UUID -o value /dev/nvme1n1) /mnt/shorts xfs defaults,nofail 0 2" \
  | sudo tee -a /etc/fstab
sudo mount -a
sudo mkdir -p /mnt/shorts/data /mnt/shorts/db /mnt/shorts/caddy/data /mnt/shorts/caddy/config
```

Use the root volume for `/mnt/shorts` only if you deliberately want a single
100 GB volume. A separate volume makes snapshots and resizing cleaner.

---

## 4. Install Docker and the app

```bash
sudo apt update
sudo apt install -y docker.io docker-compose-v2 git
sudo usermod -aG docker ubuntu
# log out/in once so the group applies, or use sudo for the commands below

git clone <your-repo-url> ~/yt-short-maker
cd ~/yt-short-maker
cp .env.example .env
```

The deployment must include the current Create-flow changes and the untracked
`frontend/js/` split. Commit and push them first, or copy this working tree to
the server; a clone of an older commit will deploy the previous UI.

`.env.example` includes the live-capture knobs. The defaults match the code;
set them explicitly if you want different bounds:

```dotenv
LIVE_CHAT_SCAN_SECONDS=300      # watch chat up to 5 min for the first spike
LIVE_SPIKE_PAD_SECONDS=300      # record 5 min before/after each spike
LIVE_MAX_CAPTURE_SECONDS=1800   # hard cap: 30 min per live job
LIVE_RECORD_STALL_SECONDS=120   # fail if ffmpeg writes nothing for 2 min
```

---

## 5. Production `.env`

Generate secrets with `openssl rand -hex 32` (key) and
`openssl rand -hex 24` (database password), then:

```dotenv
APP_MODE=multi
APP_DOMAIN=shorts.example.com
APP_BASE_URL=https://shorts.example.com
OAUTH_REDIRECT_URI=https://shorts.example.com/api/auth/callback
APP_SECRET_KEY=<64-char-random-hex>
REGISTRATION_INVITE_CODE=<private-invite-string>
MAX_USERS=4
COOKIE_SECURE=true
SESSION_TTL_DAYS=30
DEFAULT_PRIVACY=private

POSTGRES_DB=shorts
POSTGRES_USER=shorts
POSTGRES_PASSWORD=<strong-random-password>
DATABASE_URL=postgresql+psycopg://shorts:<same-password>@db:5432/shorts

DATA_DIR=/data
WORKER_CONCURRENCY=2
MEDIA_RETENTION_DAYS=14
JOB_SOURCE_RETENTION_DAYS=7
```

Notes:

- `COOKIE_SECURE=true` requires HTTPS. Do not test login over plain HTTP.
- `REGISTRATION_INVITE_CODE` is enforced only after the first account exists.
- `MAX_USERS=4` counts the owner. There are three invite slots.
- The retention variables are currently **not enforced by the backend**.
  See section 10.
- `APP_SECRET_KEY` must stay stable; changing it breaks stored per-user
  YouTube credentials.

---

## 6. Production compose file

The repo ships `docker-compose.aws.yml` (shown below). It puts Postgres, media,
and Caddy state on the EBS mount and stops publishing the raw frontend port.
Use it explicitly so the generic `docker-compose.yml` stays usable for local
Docker tests.

```yaml
services:
  db:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: ${POSTGRES_DB:-shorts}
      POSTGRES_USER: ${POSTGRES_USER:-shorts}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?set POSTGRES_PASSWORD in .env}
    volumes:
      - /mnt/shorts/db:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U $${POSTGRES_USER} -d $${POSTGRES_DB}"]
      interval: 5s
      timeout: 5s
      retries: 12
    logging: &small-logs
      driver: json-file
      options: { max-size: "20m", max-file: "5" }

  backend:
    build:
      context: .
      dockerfile: Dockerfile.backend
    restart: unless-stopped
    env_file: .env
    environment:
      APP_MODE: multi
      DATABASE_URL: ${DATABASE_URL:?set DATABASE_URL in .env}
      DATA_DIR: /data
      SERVE_FRONTEND: "false"
      FORWARDED_ALLOW_IPS: "*"
      HF_HOME: /data/.cache
    volumes:
      - /mnt/shorts/data:/data
    depends_on:
      db:
        condition: service_healthy
    logging: *small-logs

  frontend:
    build:
      context: .
      dockerfile: Dockerfile.frontend
    restart: unless-stopped
    depends_on:
      - backend
    logging: *small-logs

  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    environment:
      APP_DOMAIN: ${APP_DOMAIN:?set APP_DOMAIN in .env}
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./deploy/Caddyfile:/etc/caddy/Caddyfile:ro
      - /mnt/shorts/caddy/data:/data
      - /mnt/shorts/caddy/config:/config
    depends_on:
      - frontend
    logging: *small-logs
```

`HF_HOME=/data/.cache` keeps the Whisper model on the EBS volume instead of
re-downloading it into a fresh container after every rebuild.

---

## 7. Caddyfile

The repo ships `deploy/Caddyfile`:

```
{$APP_DOMAIN} {
    encode zstd gzip
    reverse_proxy frontend:80
}
```

Caddy obtains and renews the certificate automatically. The nginx container
continues to proxy `/api/` and `/media/` to the backend.

---

## 8. Static asset cache rule

`deploy/nginx.conf` serves `.js`/`.mjs` with `no-cache`. Keep this rule: the
frontend split modules are imported without version query strings, so caching
them for an hour can leave a browser running mixed old/new modules. The
relevant block is:

```nginx
    location ~* \.(css|png|jpg|jpeg|svg|woff2)$ {
        try_files $uri =404;
        expires 1h;
        add_header Cache-Control "public, max-age=3600";
    }

    location ~* \.(js|mjs)$ {
        try_files $uri =404;
        add_header Cache-Control "no-cache";
    }
```

Keep this rule when editing the nginx config.

---

## 9. First start and owner bootstrap

```bash
cd ~/yt-short-maker
docker compose -f docker-compose.aws.yml up -d --build
docker compose -f docker-compose.aws.yml ps
curl -fsS https://shorts.example.com/healthz
```

Create the owner **before sharing the URL**, so no scanner can claim the
first account:

```bash
docker compose -f docker-compose.aws.yml exec backend python -c \
  "from backend import db, auth; db.init(); print(auth.register('you@example.com', '<long-owner-password>', 'Owner'))"
```

Then open `https://shorts.example.com`, sign in with that email/password,
and confirm a normal analysis job works. Only then send the URL + invite code
to the other three people.

If the CLI bootstrap is not an option, temporarily restrict the security
group to your IP, register the owner in the browser immediately, then open
443 to the friends' IPs.

---

## 10. Retention, backups, monitoring

### Retention

`MEDIA_RETENTION_DAYS` and `JOB_SOURCE_RETENTION_DAYS` exist in
`backend/config.py` but are not used anywhere yet. Either delete old jobs in
the UI, or add an off-peak cleanup cron on the host:

```cron
15 4 * * * find /mnt/shorts/data/media -type f -mtime +21 -delete
```

This leaves database rows in place; the UI already tolerates missing preview
files. Do not run it while a long live capture is active.

### Backups

- Enable EBS Data Lifecycle Manager: daily snapshot of the data volume,
  retain 7–14 days. This captures Postgres, media, and Caddy state together.
- Optional logical dump:
  ```bash
  docker compose -f docker-compose.aws.yml exec -T db pg_dump -U shorts shorts \
    | gzip > /mnt/shorts/backups/shorts-$(date +%F).sql.gz
  ```
- Test a restore once. A snapshot you have never restored is not a backup.

### Monitoring

- CloudWatch alarms: CPU > 80% for 15 min, disk used > 80%, instance status
  check failed.
- The app exposes `/healthz`; the backend image also has a Docker healthcheck.
- Docker log rotation is configured in the compose file above.

---

## 11. Access-control options

**A. Account lock (recommended minimum change).** Public HTTPS endpoint,
but only four accounts can exist, registration needs the invite after the
owner exists, and all media/API routes require a session. This is what the
existing app is designed for.

**B. Cloudflare Tunnel + Access (strict, no public origin).** Keep the app
off the public internet:

- Bind the frontend only to loopback: `127.0.0.1:8080:80` and drop Caddy.
- Run `cloudflared` on the host with a tunnel to
  `http://127.0.0.1:8080`.
- Add a Cloudflare Access policy allowing only the four email addresses.
- DNS and TLS live at Cloudflare; open no inbound 80/443 ports.
- `APP_BASE_URL` and `OAUTH_REDIRECT_URI` still use the HTTPS hostname.

This adds a Cloudflare dependency but gives real "not public" semantics and
email-OTP protection in front of the login page.

**C. Security-group IP allowlist.** Allow 443 only from the four users'
current IPs. Effective, but breaks whenever a residential IP changes; not
recommended unless all four have static addresses.

---

## 12. Multi-user tuning

- One backend container, one uvicorn process. The durable worker is
  in-process; do not scale backend replicas or uvicorn workers.
- `WORKER_CONCURRENCY=2` on 8 GB. Use `1` on 4 GB. More workers only contend
  for the same two vCPUs and memory.
- Analysis is serialized by an in-process lock, so extra workers do not make
  transcript analysis parallel. A second worker can still run a manual cut or
  a render while one analysis (including a live capture) holds the lock.
- A live job can hold the analysis lock for up to 30 minutes (5 min scan +
  capture). With two workers, one analysis plus one manual cut/render is the
  comfortable limit; two simultaneous analyses serialize.
- Whisper only runs when English captions are unavailable. On CPU, `small`
  is slow. Set the per-user Whisper model to `base` if fallback speed matters.
- Keep `MAX_USERS=4`; do not expose a registration page without the invite
  code.
- 100 GB gp3 is enough for normal use with cleanup; use 200 GB if live
  clipping is heavy (a 30-minute 1080p recording can be 1–2 GB).

---

## 13. Updates

```bash
cd ~/yt-short-maker
git pull
docker compose -f docker-compose.aws.yml up -d --build
docker compose -f docker-compose.aws.yml ps
curl -fsS https://shorts.example.com/healthz
```

Bump the `?v=` query strings in `frontend/index.html` when JS/CSS changes,
and keep the nginx no-cache rule for `.js`/`.mjs`. In-flight jobs are requeued
on restart.

Take an EBS snapshot before a schema-changing update. The app uses
`create_all`, not migrations.

---

## 14. Known risks / gotchas

1. **YouTube may block EC2 datacenter IPs** with "Sign in to confirm you're
   not a bot". The app currently has no cookie-file or proxy option. Smoke
   test a real download before inviting friends. If it is blocked, either
   add `YTDLP_PROXY` / `YTDLP_COOKIES` support to the downloader or host the
   stack on a residential connection behind Cloudflare Tunnel.
2. **First account is uninvited** by design. Bootstrap the owner from the
   CLI before exposing the host (section 9).
3. **Google OAuth in Testing mode** expires refresh tokens after 7 days.
   Each user supplies their own OAuth client ID/secret; the redirect URI must
   be exactly `https://shorts.example.com/api/auth/callback`. Publishing the
   OAuth consent screen avoids weekly reconnects.
4. **Retention env vars are not implemented.** Use the cron or UI cleanup.
5. **The frontend nginx cache** must not pin `.js` for an hour.
6. **Plain HTTP login will not work** with `COOKIE_SECURE=true`; finish TLS
   first.
7. **Elastic IP + Caddy** need DNS to be live before the first certificate
   request; otherwise Caddy retries with backoff.
8. **No GPU on this box.** Rendering uses libx264; CPU transcodes are the
   main cost. Keep one or two workers, not more.
9. **Live ffmpeg can stall silently.** I observed a real live job whose chat
   capture kept working while `jobNN_live.part.mp4` stayed at 0 bytes for
   ~10 minutes; a fresh ffmpeg with the same resolved URLs wrote 5 MB in 12
   seconds. The recorder has no "no output growth" watchdog, so a stalled
   ffmpeg can hold the global analysis lock until the 30-minute cap. If a
   live job shows no video bytes, cancel and retry it. Adding a watchdog is a
   sensible follow-up before inviting heavy live users.
