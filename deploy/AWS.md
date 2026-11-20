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
Browser
   |-- https://app.<domain>  -> Vercel (static ES modules, no build)
   |
   '-- https://api.<domain>  -> Caddy (TLS, automatic Let's Encrypt)
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

The frontend is hosted on Vercel. EC2 keeps only the API, Postgres, media and
OmniRoute. `frontend/config.js` points the browser at the API origin.

All four users share the instance. The app already scopes jobs, settings,
media, and OAuth credentials by `user_id`; `MAX_USERS=4` plus the invite code
is the access boundary. Each user can connect their own YouTube OAuth client.

Deployed size: **`m7i-flex.large` (2 vCPU, 8 GB)**. This FREE-plan account
rejects every larger type with `InvalidParameterCombination: not eligible for
Free Tier`; `m7i-flex.large` is the largest of the ten free-plan-eligible
types. The 8 GB of RAM (four times `t3.small`) is the important part: Postgres,
the backend, Caddy, OmniRoute and one ffmpeg render fit with headroom,
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
bot"**. A signed-in cookie file fixes normal videos and live streams, but it
must be a **complete** export. The common browser-extension export that only
contains `PREF`, `VISITOR_INFO1_LIVE` and the `__Secure-3P*` cookies is not
enough. The file must contain `LOGIN_INFO` and a first-party session cookie
(`SID` or `__Secure-1PSID`), plus `HSID`/`SSID`.

**Recommended refresh (Windows):**

1. Sign in to YouTube in Firefox. Use a throwaway Google account, not your main
   one: automated downloads can get an account limited.
2. Run:
   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts/refresh-youtube-cookies.ps1
   ```
   The script exports the cookies with `yt-dlp --cookies-from-browser`, checks
   for `LOGIN_INFO` + `SID`, tests the file from EC2, installs it at
   `/opt/shorts/data/secrets/youtube-cookies.txt` with mode `600`, and clears
   the cached jar so the next job uses the new file.
3. Optional weekly refresh:
   ```powershell
   schtasks /Create /SC WEEKLY /TN "Shorts YouTube cookies" ^
     /TR "powershell -ExecutionPolicy Bypass -File C:\Omarchy\projects\yt-short-maker\scripts\refresh-youtube-cookies.ps1" ^
     /ST 09:00
   ```
   This only works while the SSH security group allows your current home IP.
   If SSH times out, run `scripts/allow-ssh-ip.ps1` first: the ISP changed your
   public IP and the app is unaffected, but port 22 is closed to the new one.

**Manual refresh:**

```bash
ssh -i ~/.ssh/shorts-deploy.pem ubuntu@shorts.example.com \
  'mkdir -p /opt/shorts/data/secrets && chmod 700 /opt/shorts/data/secrets'
scp -i ~/.ssh/shorts-deploy.pem cookies.txt \
  ubuntu@shorts.example.com:/opt/shorts/data/secrets/youtube-cookies.txt
ssh -i ~/.ssh/shorts-deploy.pem ubuntu@shorts.example.com \
  'chmod 600 /opt/shorts/data/secrets/youtube-cookies.txt'
```

A file at `/opt/shorts/data/secrets/youtube-cookies.txt` takes precedence over
the read-only `/opt/shorts/secrets/youtube-cookies.txt` mount. The backend
copies the active file to `/data/.cache/youtube-cookies.txt`, so yt-dlp's
rotated cookies survive container restarts. No restart is needed; the next
yt-dlp call picks up a newer source file.

Check **Settings -> System -> YouTube cookies**. It shows `Complete` only when
`LOGIN_INFO` and `SID`/`__Secure-1PSID` are present; an incomplete export shows
a warning there and live jobs will keep failing.

Do **not** try to log the Google account in on EC2 as a workaround. yt-dlp's
YouTube OAuth support no longer works (YouTube removed it), a headless login
from a datacenter IP is challenged, and it puts the account at more risk than a
cookie file. If even a complete cookie file is rejected, set `YTDLP_PROXY` in
`.env` to a residential HTTP/SOCKS proxy and restart the backend:

```bash
docker compose -f docker-compose.aws.yml up -d backend
```

Cookies are credentials: keep the file at mode 600, never commit it, and
refresh it when the health item turns red or downloads start failing again. A
dedicated account limits the blast radius if it is ever leaked. The backend
image ships Deno and `yt-dlp-ejs` for YouTube's signature/n challenges; if logs
show **"Signature solving failed"** or **"No video formats found"**, rebuild
the backend image.

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
LIVE_SPIKE_PAD_SECONDS=60       # record 60 s after each spike (no rewind on live)
LIVE_MAX_CAPTURE_SECONDS=900    # hard safety cap: 15 min per live job
LIVE_RECORD_STALL_SECONDS=120   # fail if ffmpeg writes nothing for 2 min
```

---

## 5. Production `.env`

Generate secrets with `openssl rand -hex 32` (key) and
`openssl rand -hex 24` (database password), then:

```dotenv
APP_MODE=multi
APP_DOMAIN=api.example.com
APP_BASE_URL=https://api.example.com
FRONTEND_BASE_URL=https://app.example.com
OAUTH_REDIRECT_URI=https://api.example.com/api/auth/callback
APP_SECRET_KEY=<64-char-random-hex>
REGISTRATION_INVITE_CODE=<private-invite-string>
MAX_USERS=4
COOKIE_SECURE=true
# Use none while the Vercel URL is a different site; switch to lax after
# app.<domain> is live so cookies are same-site and more reliable.
COOKIE_SAMESITE=none
SESSION_TTL_DAYS=30
DEFAULT_PRIVACY=private
LLM_DEFAULT_MODEL=antigravity/gemini-3.8-flash-low

POSTGRES_DB=shorts
POSTGRES_USER=shorts
POSTGRES_PASSWORD=<strong-random-password>
DATABASE_URL=postgresql+psycopg://shorts:<same-password>@db:5432/shorts

DATA_DIR=/data
WORKER_CONCURRENCY=2
MEDIA_RETENTION_DAYS=14
JOB_SOURCE_RETENTION_DAYS=7

# bcrypt hash for the OmniRoute dashboard's HTTP basic auth (user: rajesh).
# Generate with: docker compose -f docker-compose.aws.yml exec caddy \
#   caddy hash-password --plaintext '<password>'
OMNIROUTE_BASIC_AUTH_HASH='$2a$14$...'
```

Notes:

- `COOKIE_SECURE=true` requires HTTPS. Do not test login over plain HTTP.
- `FRONTEND_BASE_URL` is the Vercel origin; OAuth returns there after login.
- `COOKIE_SAMESITE=none` is required while the frontend and API are on
  different sites (`*.vercel.app` and the EC2 host). Switch it to `lax` after
  `app.<domain>` and `api.<domain>` are live.
- `REGISTRATION_INVITE_CODE` is enforced only after the first account exists.
- `MAX_USERS=4` counts the owner. There are three invite slots.
- The retention variables are currently **not enforced by the backend**.
  See section 10.
- `APP_SECRET_KEY` must stay stable; changing it breaks stored per-user
  YouTube credentials.

---

## 6. Production compose file

The repo ships `docker-compose.aws.yml` (shown below). It puts Postgres,
media, Caddy state and OmniRoute on the root volume. The frontend is on Vercel,
so this stack has no nginx container. Use it explicitly so the generic
`docker-compose.yml` stays usable for local Docker tests.

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

  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    environment:
      APP_DOMAIN: ${APP_DOMAIN:?set APP_DOMAIN in .env}
      OMNIROUTE_BASIC_AUTH_HASH: ${OMNIROUTE_BASIC_AUTH_HASH:?set OMNIROUTE_BASIC_AUTH_HASH in .env}
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./deploy:/etc/caddy:ro
      - /opt/shorts/caddy/data:/data
      - /opt/shorts/caddy/config:/config
    depends_on:
      - backend
    logging: *small-logs

  omniroute:
    image: diegosouzapw/omniroute:latest
    restart: unless-stopped
    stop_grace_period: 40s
    environment:
      OMNIROUTE_MEMORY_MB: "3072"
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

    handle /api/* {
        reverse_proxy backend:8000
    }
    handle /media/* {
        reverse_proxy backend:8000
    }
    handle /healthz {
        reverse_proxy backend:8000
    }
    handle {
        respond "Shorts Factory API" 200
    }
}
```

Caddy obtains and renews the certificate automatically. It proxies only the
API, media and health routes; the UI is served by Vercel. The `omniroute.$APP_DOMAIN`
site is a second Caddy block in the same file.

---

## 8. Static asset cache rule

Vercel serves the frontend and revalidates its static files. `deploy/nginx.conf`
is kept for a self-hosted fallback and serves `.js`/`.mjs` with `no-cache`;
the frontend split modules are imported without version query strings, so
caching them for an hour can leave a browser running mixed old/new modules. The
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

Open the OmniRoute dashboard at `https://omniroute.shorts.example.com`
(user `rajesh`, password chosen when you generated the hash):

```bash
# generate or replace the basic-auth hash in .env
docker compose -f docker-compose.aws.yml exec caddy \
  caddy hash-password --plaintext '<password>'
docker compose -f docker-compose.aws.yml up -d caddy
```

The dashboard is a second Caddy site that reverse-proxies to
`omniroute:20128`. It is still protected by basic auth plus OmniRoute's own
login. If you prefer not to expose it, remove the `omniroute.$APP_DOMAIN`
block from `deploy/Caddyfile` and use the tunnel instead:

```bash
ssh -L 20128:127.0.0.1:20128 ubuntu@shorts.example.com
# keep that session open, then browse http://localhost:20128
```

Add your providers in that dashboard. Use `http://omniroute:20128/api/v1` as
the base URL when configuring the Shorts app's AI settings, and create an
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

**B. Cloudflare Tunnel + Access (strict, no public origin).** Keep the API
off the public internet:

- Keep the frontend on Vercel.
- Run `cloudflared` on the host with a tunnel to the backend on
  `http://127.0.0.1:8000`.
- Add a Cloudflare Access policy allowing only the four email addresses.
- DNS and TLS live at Cloudflare; open no inbound 80/443 ports.
- Set `frontend/config.js` `apiBase`, `APP_BASE_URL` and `OAUTH_REDIRECT_URI`
  to the HTTPS API hostname.

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
- OmniRoute has a 3 GB container ceiling
  (`mem_limit: 3g`, `OMNIROUTE_MEMORY_MB=3072`), which is ample for one or two
  light chat clients and keeps Postgres/ffmpeg/Whisper protected. Raise it
  only if you use long coding agent sessions.
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
then redeploy `frontend/` to Vercel. In-flight jobs are requeued
on restart. OmniRoute uses the mutable `latest` tag; `pull` before an update
and check the dashboard version after it restarts.

Take an EBS snapshot before a schema-changing update. The app uses
`create_all`, not migrations.

---

## 14. Known risks / gotchas

1. **YouTube blocks EC2 datacenter IPs** with "Sign in to confirm you're not
   a bot" (confirmed on this instance). Mount a **complete** signed-in
   `cookies.txt` (it must include `LOGIN_INFO` and `SID`/`__Secure-1PSID`); the
   downloader, live recorder, chat grabber and caption lookup all pass it to
   yt-dlp. `scripts/refresh-youtube-cookies.ps1` exports, tests and installs a
   fresh file. The backend image includes Deno + `yt-dlp-ejs` for the
   signature/n challenge solver. If a complete cookie file is still rejected,
   set `YTDLP_PROXY` to a residential proxy. Refresh when Settings -> System
   shows "YouTube cookies" as incomplete.
2. **First account is uninvited** by design. Bootstrap the owner from the
   CLI before exposing the host (section 9).
3. **Google OAuth in Testing mode** expires refresh tokens after 7 days.
   Each user supplies their own OAuth client ID/secret; the redirect URI must
   be exactly `https://shorts.example.com/api/auth/callback`. Publishing the
   OAuth consent screen avoids weekly reconnects.
4. **Retention env vars are not implemented.** Use the cron or UI cleanup.
5. **Vercel caches frontend assets.** Bump the `?v=` strings in
   `frontend/index.html` when modules change, then redeploy.
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

---

## 15. The deployment as built

These are the live values for the reference deployment in `us-east-1`.

| Item | Value |
| --- | --- |
| Instance | `i-06ecb5d56814d39b5` (`m7i-flex.large`, us-east-1f) |
| Elastic IP | `52.207.181.21` (`eipalloc-0a6da4fa610433f78`) |
| Public URL | `https://shorts.52.207.181.21.sslip.io` |
| Owner login | `bandirajesh209@gmail.com` (password is kept out of this repo) |
| Registration invite | `REGISTRATION_INVITE_CODE` in `~/yt-short-maker/.env` on the server |
| SSH key | `shorts-deploy.pem` (holds the `shorts-deploy` key pair) |
| Repo checkout | `/home/ubuntu/yt-short-maker` |
| Persistent data | `/opt/shorts` on the 100 GB gp3 root volume |

`sslip.io` resolves the hostname to the Elastic IP, so TLS keeps working
across stop/start cycles. To move to a real domain later, point an `A` record
at the Elastic IP, change `APP_DOMAIN`, `APP_BASE_URL` and `OAUTH_REDIRECT_URI`
in `.env`, then `docker compose -f docker-compose.aws.yml up -d caddy`.

### Nightly stop and start

Stop from the AWS console (Instance state → Stop instance) or with the CLI.
Never use `sudo shutdown -h now`; the console stop lets EBS flush cleanly.

```bash
aws ec2 stop-instances  --region us-east-1 --instance-ids i-06ecb5d56814d39b5
aws ec2 start-instances --region us-east-1 --instance-ids i-06ecb5d56814d39b5
```

Verify after a start (about 30–45 seconds to healthy):

```bash
aws ec2 wait instance-status-ok --region us-east-1 \
  --instance-ids i-06ecb5d56814d39b5
curl -fsS https://shorts.52.207.181.21.sslip.io/healthz
ssh -i shorts-deploy.pem ubuntu@52.207.181.21 \
  'cd ~/yt-short-maker && docker compose -f docker-compose.aws.yml ps'
```

What recovers automatically: Docker starts at boot, and all four containers
(`db`, `backend`, `caddy`, `omniroute`) use
`restart: unless-stopped`. Postgres data, media, certificates and OmniRoute
state live on the root volume, and jobs interrupted by a stop are requeued on
the next boot. The Elastic IP does not change.

### OmniRoute

OmniRoute listens on `127.0.0.1:20128` inside the host and is published to the
internet only through Caddy's `omniroute.$APP_DOMAIN` site, behind HTTP basic
auth (user `rajesh`) plus OmniRoute's own login:

**https://omniroute.shorts.52.207.181.21.sslip.io**

If you ever need to bypass Caddy, the loopback port still works through a
tunnel:

```bash
ssh -i shorts-deploy.pem -L 20128:127.0.0.1:20128 ubuntu@52.207.181.21
# browse http://localhost:20128
```

Inside the app, point the AI settings at `http://omniroute:20128/api/v1` with a
key you create in the OmniRoute dashboard. The model field is optional: leave
it blank to use `LLM_DEFAULT_MODEL`, or OmniRoute's `auto` router when that is
empty. You can also enter a provider model such as
`antigravity/gemini-3.8-flash-low`. The container URL works because the
backend and OmniRoute share the compose network.

### Housekeeping

- The AWS Budget `shorts-factory-monthly` emails alerts to
  `bandirajesh209@gmail.com`; confirm the subscription from the first AWS
  Budget email, or alerts will not arrive.
- SSH is allowed only from your current home IP (`<your-ip>/32`). If the home
  IP changes, run `scripts/allow-ssh-ip.ps1`; 80/443 stay open either way.
  The app itself keeps working when SSH is blocked.
- Refresh YouTube cookies with `scripts/refresh-youtube-cookies.ps1` when the
  Settings -> System health item turns red or downloads start failing. The file
  is mode `600`; no restart is needed.
- Take an EBS snapshot of the root volume before schema-changing updates.
