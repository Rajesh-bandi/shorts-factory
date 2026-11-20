# Vercel frontend + EC2 API

This split is live. The EC2 host keeps the API, Postgres, media and OmniRoute;
Vercel serves the static `frontend/` directory.

Current URLs until the custom domain is connected:

- Frontend: **https://shorts-factory-topaz.vercel.app**
- API: **https://shorts.52.207.181.21.sslip.io**
- OmniRoute: **https://omniroute.shorts.52.207.181.21.sslip.io**

The Vercel project is `shorts-factory` in the team
`rajesh-bandis-projects-9c708eb1`. It is linked to
`Rajesh-bandi/shorts-factory` with root directory `frontend` and auto-deploys
every push to `main`. There is no build step.

> The Vercel token used to create the project was shared in chat. Rotate it
> after the setup is finished.

```
browser
  |
  |  https://app.<domain>          (Vercel, static files)
  v
frontend/  --- fetch /media and /api --->  https://api.<domain>
                                             |
                                             v
                                      Caddy -> backend:8000
                                             |
                              Postgres + /data/media + OmniRoute
```

Two hostnames are used so cookies, CORS and video streaming stay simple and
media never passes through Vercel:

- `app.<domain>` — Vercel project, root directory `frontend`
- `api.<domain>` — EC2 Elastic IP `52.207.181.21`, DNS-only in Cloudflare
- `omniroute.api.<domain>` — optional, also the Elastic IP, DNS-only

## 1. Vercel access

Either provide a Vercel token or create the project manually.

**Token option (recommended):** Vercel dashboard -> Account Settings ->
Tokens -> Create Token. Use the account or team that will own the project and
send the token privately. The token is never committed.

**Manual option:** Vercel -> Add New -> Project -> import
`Rajesh-bandi/shorts-factory` with:

| Setting | Value |
| --- | --- |
| Root Directory | `frontend` |
| Framework Preset | Other |
| Build Command | empty / disabled |
| Output Directory | empty (serve the root) |
| Install Command | empty / disabled |

There is no build step: `index.html` and the ES modules are served as-is.

## 2. Frontend API origin

`frontend/config.js` is the only runtime setting:

```js
window.SHORTS_CONFIG = Object.assign(
  { apiBase: "https://api.<domain>" },
  window.SHORTS_CONFIG || {}
);
```

The current deployment sets `apiBase` to the EC2 API origin. API and media
requests then include the session cookie. After the custom domain is live,
change this value to `https://api.<domain>` and redeploy `frontend/`:

```bash
npx vercel deploy frontend --prod \
  --project shorts-factory \
  --scope rajesh-bandis-projects-9c708eb1
```

## 3. DNS (Cloudflare)

| Type | Name | Target | Proxy |
| --- | --- | --- | --- |
| CNAME | `app` | value Vercel shows (`cname.vercel-dns.com`) | DNS only |
| A | `api` | `52.207.181.21` | DNS only (grey cloud) |
| A | `omniroute.api` | `52.207.181.21` | DNS only (grey cloud) |

Caddy needs direct HTTP-01/TLS-ALPN access to `api` and `omniroute`, so do not
orange-cloud those two records. Add `app.<domain>` in Vercel -> Project ->
Settings -> Domains after DNS is in place.

## 4. EC2 `.env` changes

```dotenv
APP_DOMAIN=api.<domain>
APP_BASE_URL=https://api.<domain>
FRONTEND_BASE_URL=https://app.<domain>
OAUTH_REDIRECT_URI=https://api.<domain>/api/auth/callback

COOKIE_SECURE=true
COOKIE_SAMESITE=none
```

Then recreate the backend and Caddy:

```bash
cd ~/yt-short-maker
docker compose -f docker-compose.aws.yml up -d backend caddy
```

`FRONTEND_BASE_URL` controls the post-OAuth redirect. `COOKIE_SAMESITE=none`
is required while the frontend uses a `*.vercel.app` URL because that is a
different site from the API; it only works with `COOKIE_SECURE=true` over
HTTPS. After `app.<domain>` and `api.<domain>` are live, switch it to `lax`
(same site) for more reliable cookies.

## 5. Google OAuth callback

Every member must add this exact authorized redirect URI to their own Google
OAuth web client:

```
https://api.<domain>/api/auth/callback
```

The old `shorts.52.207.181.21.sslip.io` URI can stay during the transition.

## 6. Remove the EC2 frontend

This is already done: `deploy/Caddyfile` is API-only and
`docker-compose.aws.yml` no longer defines a `frontend` service. The steps below
are the reproducible version.

1. Change `deploy/Caddyfile` so the main API host proxies only backend routes:

   ```caddyfile
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

2. Remove the `frontend` service from `docker-compose.aws.yml` and make Caddy
   depend on `backend` instead.

3. Rebuild and remove the old container:

   ```bash
   docker compose -f docker-compose.aws.yml up -d --remove-orphans
   docker compose -f docker-compose.aws.yml ps
   ```

The `Dockerfile.frontend`, `deploy/nginx.conf` and `frontend/` stay in the repo;
Vercel uses `frontend/`, and `Dockerfile.frontend` remains useful for a
self-hosted fallback.

## 7. Verify

```bash
curl -I https://app.<domain>/
curl -I https://api.<domain>/healthz
curl -I https://api.<domain>/api/auth/config
```

Then sign in at `https://app.<domain>/`, open Settings -> AI, leave the model
blank and press Test connection. Blank uses `LLM_DEFAULT_MODEL`, or OmniRoute
`auto` when that is unset.
