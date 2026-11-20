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
        |                              |
   Postgres 16                 OmniRoute (127.0.0.1:20128)
        |                              |
   EBS gp3 root volume at /opt/shorts
     /opt/shorts/data      -> /data (media, transcripts, uploads)
     /opt/shorts/db        -> Postgres data
     /opt/shorts/caddy     -> certificates
     /opt/shorts/secrets   -> YouTube cookies (read-only)
     omniroute_data        -> OmniRoute providers and keys
```

All four users share the instance. The app already scopes jobs, settings,
media, and OAuth credentials by `user_id`; `MAX_USERS=4` plus the invite code
is the access boundary. Each user can connect their own YouTube OAuth client.

Deployed size: **`m7i-flex.large` (2 vCPU, 8 GB)**. This FREE-plan account
rejects every larger type with `InvalidParameterCombination: not eligible for
Free Tier`; `m7i-flex.large` is the largest of the ten free-plan-eligible
types. The 8 GB of RAM (four times `t3.small`) is the important part: Postgres,
the backend, Caddy/nginx, OmniRoute and one ffmpeg render fit with headroom,
while analysis jobs stay serialized on two vCPUs.

Rough cost: **$0.09576/hour** while running in `us-east-1`, plus about
$8/month for a 100 GB gp3 root volume and $3.60/month for the public IPv4.
Running 12 hours a day is roughly **$46–50/month**. The account currently has
about **$119.67** in free-plan credits, so watch the remaining balance in the
Billing console.

To go bigger, open **Billing → Account plan** and upgrade to the PAID plan;
the credits carry over and the 8 vCPU quota then allows `m7i.2xlarge`
(8 vCPU, 32 GB). Stop the instance, change its type, and start it again — all
data stays on the root volume.

---

## 2. Launch the instance

Recommended baseline:

- AMI: Ubuntu 24.04 LTS (x86_64)
- Type: `m7i-flex.large` (2 vCPU, 8 GB), the largest FREE-plan-eligible type
- Storage: **100 GB gp3 root volume**. Everything, including Postgres,
  media and OmniRoute, lives on this one volume. Set
  `DeleteOnTermination=false` so terminating the instance does not destroy
  the data.
- Elastic IP: allocate and associate it, so the address survives every
  stop/start.
- Security group:
  - 22/tcp from your admin IP only (or use SSM Session Manager and no SSH)
  - 80/tcp and 443/tcp from `0.0.0.0/0` for Caddy/Let's Encrypt
  - no 5432, no 8000, no 8080, no 20128

For a stricter "no public origin" setup, see section 11.

DNS: point a hostname at the Elastic IP before starting Caddy. If you do not
have a domain yet, `shorts.<elastic-ip>.sslip.io` resolves to the IP and
Let's Encrypt will issue a certificate for it. Move to a real domain later by
changing `APP_DOMAIN`, `APP_BASE_URL` and `OAUTH_REDIRECT_URI`, then
restarting Caddy.

Add a 2 GB swap file as a cushion during a 1080p render or a Whisper
fallback:

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
echo 'vm.swappiness=10' | sudo tee -a /etc/sysctl.conf
sudo sysctl vm.swappiness=10
```

---

## 3. Prepare data directories

All persistent state is on the 100 GB root volume, so a stop/start needs no
mount ordering:

```bash
sudo mkdir -p /opt/shorts/data /opt/shorts/db /opt/shorts/backups \
  /opt/shorts/secrets /opt/shorts/caddy/data /opt/shorts/caddy/config
sudo chown ubuntu:ubuntu /opt/shorts/secrets
sudo chmod 700 /opt/shorts/secrets
```

### YouTube cookies (required on EC2)

YouTube answers most cloud IPs with **"Sign in to confirm you're not a
bot"**. Install the app first, reproduce the error once, then:

1. In a browser signed in to YouTube (use a throwaway Google account, not your
   main one), install a "Get cookies.txt LOCALLY" extension and export
   `youtube.com` cookies in Netscape format as `cookies.txt`.
2. Upload the file:
   ```bash
   scp -i ~/.ssh/shorts-deploy.pem cookies.txt \
     ubuntu@shorts.example.com:/opt/shorts/secrets/youtube-cookies.txt
   ssh ubuntu@shorts.example.com \
     'chmod 600 /opt/shorts/secrets/youtube-cookies.txt'
   ```
3. The backend reads `/secrets/youtube-cookies.txt` automatically (compose
   mounts `/opt/shorts/secrets` read-only at `/secrets`). No restart is needed;
   each new yt-dlp call copies it to a writable temp file and picks up changes.
   The backend image also ships Deno and `yt-dlp-ejs`, which yt-dlp needs to
   solve YouTube's signature/n challenges. If logs show **"Signature solving
   failed"** or **"No video formats found"**, rebuild the backend image so
   those components are present.
4. If YouTube still blocks the IP, set `YTDLP_PROXY` in `.env` to a
   residential HTTP/SOCKS proxy and restart the backend:
   ```bash
   docker compose -f docker-compose.aws.yml up -d backend
   ```

Cookies are credentials: keep the file at mode 600, never commit it, and
refresh it when downloads start failing again. A dedicated account limits the
blast radius if it is ever leaked.

Take EBS snapshots of the root volume before upgrades. The instance can be
terminated and relaunched from the snapshot if needed.

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

The repo ships `docker-compose.aws.yml` (shown below). It puts Postgres,
media, Caddy state and OmniRoute on the root volume and stops publishing the
raw frontend port. Use it explicitly so the generic `docker-compose.yml` stays
usable for local Docker tests.

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
      - /opt/shorts/db:/var/lib/postgresql/data
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
      YTDLP_COOKIES_FILE: /secrets/youtube-cookies.txt
      YTDLP_PROXY: ${YTDLP_PROXY:-}
    volumes:
      - /opt/shorts/data:/data
      - /opt/shorts/secrets:/secrets:ro
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
      - /opt/shorts/caddy/data:/data
      - /opt/shorts/caddy/config:/config
    depends_on:
      - frontend
    logging: *small-logs

  omniroute:
    image: diegosouzapw/omniroute:latest
    restart: unless-stopped
    stop_grace_period: 40s
    environment:
      OMNIROUTE_MEMORY_MB: "4096"
    # Leave most of the 8 GB host for Postgres, ffmpeg and Whisper.
    mem_limit: 3g
    ports:
      - "127.0.0.1:20128:20128"
    volumes:
      - omniroute_data:/app/data
    logging: *small-logs

volumes:
  omniroute_data:
```

`HF_HOME=/data/.cache` keeps the Whisper model on the root volume instead of
re-downloading it into a fresh container after every rebuild. OmniRoute is
published only on host loopback; section 9 shows the SSH tunnel.

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
continues to proxy `/api/` and `/media/` to the backend. OmniRoute is not
published through Caddy; it stays on host loopback and is reached through an
SSH tunnel.

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
docker compose -f docker-compose.aws.yml logs --tail=30 omniroute
```

Open the OmniRoute dashboard from your PC through an SSH tunnel:

```bash
ssh -L 20128:127.0.0.1:20128 ubuntu@shorts.example.com
# keep that session open, then browse http://localhost:20128
```

Add your providers in that dashboard. Use `http://omniroute:20128/v1` as the
base URL when configuring the Shorts app's AI settings, and create an
OmniRoute API key there for the app.

Enable Docker at boot and confirm the whole stack returns after a stop/start:

```bash
sudo systemctl enable docker
sudo systemctl enable --now docker
```

Every service uses `restart: unless-stopped`, so an EC2 stop/start brings
Postgres, the backend, Caddy and OmniRoute back automatically. Test it once:
stop the instance from the AWS console, start it again, wait a minute, then
`curl -fsS https://shorts.example.com/healthz`.

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
15 4 * * * find /opt/shorts/data/media -type f -mtime +21 -delete
```

This leaves database rows in place; the UI already tolerates missing preview
files. Do not run it while a long live capture is active.

### Backups

- Enable EBS Data Lifecycle Manager: daily snapshot of the root volume,
  retain 7–14 days. This captures Postgres, media, Caddy and OmniRoute state
  together.
- Optional logical dump:
  ```bash
  docker compose -f docker-compose.aws.yml exec -T db pg_dump -U shorts shorts \
    | gzip > /opt/shorts/backups/shorts-$(date +%F).sql.gz
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
- Set `WORKER_CONCURRENCY=2` in `.env` on `m7i-flex.large`. Analysis is still
  serialized by an in-process lock shared by the worker threads, but the
  second thread can run a manual cut or render while one analysis (including
  a live capture) holds the lock. Drop to `1` if the instance swaps.
- A live job can hold the analysis lock for up to 30 minutes (5 min scan plus
  the capture cap). Other analysis jobs wait; manual cuts and renders are
  small enough to queue behind them.
- Whisper only runs when English captions are unavailable. On CPU, `small`
  is slower but usable on four vCPU. Use `base` if fallback speed matters.
- Keep `MAX_USERS=4`; do not expose a registration page without the invite
  code.
- The 100 GB root volume is enough for normal use with cleanup; monitor it
  and expand it online if live clipping is heavy (a 30-minute 1080p recording
  can be 1–2 GB). Retention env vars are not enforced, so delete old jobs in
  the UI.
- OmniRoute is capped at 4 GB (`OMNIROUTE_MEMORY_MB=4096`), which is ample
  for one or two light chat clients. Raise it only if you use long coding
  agent sessions.
- Stopping the instance at night is safe. Postgres, media, Caddy certificates
  and OmniRoute state are all on the root volume; jobs that were running are
  requeued on the next boot. Always stop from the AWS console, not with
  `shutdown -h now`, so the EBS volume is detached cleanly.

---

## 13. Updates

```bash
cd ~/yt-short-maker
git pull
docker compose -f docker-compose.aws.yml pull omniroute
docker compose -f docker-compose.aws.yml up -d --build
docker compose -f docker-compose.aws.yml ps
docker compose -f docker-compose.aws.yml logs --tail=20 omniroute
curl -fsS https://shorts.example.com/healthz
```

Bump the `?v=` query strings in `frontend/index.html` when JS/CSS changes,
and keep the nginx no-cache rule for `.js`/`.mjs`. In-flight jobs are requeued
on restart. OmniRoute uses the mutable `latest` tag; `pull` before an update
and check the dashboard version after it restarts.

Take an EBS snapshot before a schema-changing update. The app uses
`create_all`, not migrations.

---

## 14. Known risks / gotchas

1. **YouTube blocks EC2 datacenter IPs** with "Sign in to confirm you're not
   a bot" (confirmed on this instance). Mount a signed-in `cookies.txt` at
   `/opt/shorts/secrets/youtube-cookies.txt`; the downloader, live recorder,
   chat grabber and caption lookup all pass it to yt-dlp. The backend image
   includes Deno + `yt-dlp-ejs` for the signature/n challenge solver. If
   cookies are not enough, set `YTDLP_PROXY` to a residential proxy. Cookies
   expire: refresh them when downloads start failing again.
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
9. **Live ffmpeg can stall silently.** A real live job once left
   `jobNN_live.part.mp4` at zero bytes while chat capture continued. The
   recorder now aborts when ffmpeg writes nothing for
   `LIVE_RECORD_STALL_SECONDS` (default 120) and fails the job with a clear
   error instead of holding the analysis lock for 30 minutes. Raise the value
   only if your streams routinely need longer reconnects.
