# Calendar Canvas

ปฏิทินเขียนด้วยลายมือสำหรับมือถือ (PWA) แต่ละวันเป็นหน้ากระดาษให้วาดหรือเขียนด้วยนิ้ว ติดตั้งใช้เองได้ด้วย Docker หนึ่งคอนเทนเนอร์ แล้วเปิดสู่อินเทอร์เน็ตผ่าน Cloudflare Tunnel

Calendar Canvas is a mobile-only handwriting calendar. Every day is a page you draw on with a pen or an eraser. It is a React single-page app served by a Go server, with SQLite storage, in one container. Users sign in with Google. An optional Admin account lists and deletes users. The UI is Thai, and years show in Buddhist Era.

## Contents

- [Local development](#local-development)
- [Self-hosting](#self-hosting)
- [Configuration](#configuration)
- [Google OAuth setup](#google-oauth-setup)
- [Cloudflare Tunnel](#cloudflare-tunnel)
- [Cloudflare cache rules](#cloudflare-cache-rules)
- [Admin account](#admin-account)
- [Data and backup](#data-and-backup)
- [Releases](#releases)
- [Known open items](#known-open-items)

## Local development

You need [Bun](https://bun.sh), Go (the version in `apps/server/go.mod`) and a Google OAuth client (see [Google OAuth setup](#google-oauth-setup)).

```bash
bun install
```

The server reads its settings from the environment. It does not read `.env` files itself. Create `.env.local` in the repository root (it is git-ignored). Use `http://localhost:3001` as the base URL, because the browser talks to the Vite dev server, which proxies `/api` to the Go server on port 8080:

```bash
APP_BASE_URL=http://localhost:3001
DATABASE_PATH=./local.db
GOOGLE_CLIENT_ID=<your client id>
GOOGLE_CLIENT_SECRET=<your client secret>
SESSION_SECRET=<at least 32 random bytes>
ALLOWED_EMAILS=you@gmail.com
```

`DATABASE_PATH` is relative to `apps/server`, where `dev:server` runs. Generate a secret with `openssl rand -base64 48`.

Run the two processes in two terminals:

```bash
set -a; . ./.env.local; set +a; bun run dev:server
bun run dev:web
```

Open <http://localhost:3001>.

`APP_BASE_URL` must be the origin the browser sees. The server checks the `Origin` header of every non-GET request against it, and builds the Google redirect URI from it. So under the Vite dev server the Google redirect URI is `http://localhost:3001/api/auth/google/callback`, not port 8080.

Other commands:

- `bun run check` runs Vite+ format and lint checks and the TypeScript checks.
- `cd apps/server && go test ./...` runs the server tests.
- `bun run gen:types` regenerates the TypeScript types from the Go API types.

Layout: `apps/web` (SPA), `apps/server` (Go/Gin server), `packages/ui` (shared shadcn/ui components), `docs/adr` (decisions), `GLOSSARY.md` (domain terms).

## Self-hosting

You need Docker with Compose, a Google OAuth client, and, for a public instance, a domain on Cloudflare.

1. Copy the example settings and fill them in. See [Configuration](#configuration).

   ```bash
   cp .env.example .env
   ```

2. Pull the published image and start the app.

   ```bash
   docker compose pull app
   docker compose up -d app
   ```

   The app listens on <http://127.0.0.1:8080>. For a local-only trial, set `APP_BASE_URL=http://localhost:8080` and use `http://localhost:8080/api/auth/google/callback` as the Google redirect URI.

   To build the image from this checkout instead, run `bun run docker:up`.

3. For a public instance, add the tunnel. See [Cloudflare Tunnel](#cloudflare-tunnel).

   ```bash
   docker compose up -d
   ```

Why the port binds to `127.0.0.1`: the app must be reachable only through the tunnel. The server trusts the `CF-Connecting-IP` header to rate-limit Admin sign-in per client. Anyone who could reach the port directly could forge that header. Do not change the mapping to `0.0.0.0` or publish the port through another proxy.

Update to a new release:

```bash
docker compose pull app
docker compose up -d
```

Check the app: `curl http://127.0.0.1:8080/api/health` returns `{"status":"ok"}`. The compose health check runs `/server healthcheck`.

## Configuration

Compose passes `.env` to the app container. The server refuses to start when a required value is missing or invalid, and prints every problem.

| Variable               | Required       | Meaning                                                                                                                                            |
| ---------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `APP_BASE_URL`         | yes            | Public origin, such as `https://cal.example.com`. No path. Sets the Google redirect URI and the `Origin` check. `https` turns on `Secure` cookies. |
| `PORT`                 | no             | Listen port in the container. Default `8080`.                                                                                                      |
| `DATABASE_PATH`        | yes            | SQLite file. Use `/data/app.db`, which lives on the `data` volume.                                                                                 |
| `GOOGLE_CLIENT_ID`     | yes            | From [Google OAuth setup](#google-oauth-setup).                                                                                                    |
| `GOOGLE_CLIENT_SECRET` | yes            | From the same page.                                                                                                                                |
| `SESSION_SECRET`       | yes            | At least 32 bytes. Signs the sign-in state cookie. `openssl rand -base64 48` makes one.                                                            |
| `ALLOWED_EMAILS`       | yes            | Who may sign in. See below.                                                                                                                        |
| `ADMIN_USERNAME`       | no             | Admin user name.                                                                                                                                   |
| `ADMIN_PASSWORD_HASH`  | no             | argon2id hash of the Admin password. Admin sign-in is off without it.                                                                              |
| `TUNNEL_TOKEN`         | for the tunnel | Read only by the `cloudflared` service.                                                                                                            |

### `ALLOWED_EMAILS`

A comma-separated list of Google account emails that may sign in, compared case-insensitively:

```bash
ALLOWED_EMAILS=you@gmail.com,friend@example.com
```

Set `ALLOWED_EMAILS=*` to let any Google account with a verified email sign in. The value is required. An empty or missing value stops the server at start-up, so a typo cannot open the instance by accident.

### Quote the password hash

An argon2id hash contains `$` characters. Docker Compose expands `$` in unquoted and double-quoted values in `.env`, which corrupts the hash. Wrap it in single quotes, which Compose and a shell `source` both read literally:

```bash
ADMIN_PASSWORD_HASH='$argon2id$v=19$m=65536,t=3,p=2$c29tZXNhbHQ$aGFzaGhhc2g'
```

`$$` also works in Compose, but a shell `source` of the same file would not read it as a literal `$`. Single quotes are the one form that works for both.

## Google OAuth setup

1. Open the [Google Cloud Console](https://console.cloud.google.com/) and select or create a project.
2. Under APIs & Services, configure the OAuth consent screen. While the app is in "Testing", add your Google accounts as test users.
3. Under Credentials, create an OAuth client ID of type "Web application".
4. Add this authorized redirect URI:

   ```
   ${APP_BASE_URL}/api/auth/google/callback
   ```

   With `APP_BASE_URL=https://cal.example.com`, that is `https://cal.example.com/api/auth/google/callback`. It must match exactly.

5. Copy the client ID and secret into `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

The server asks for the `openid`, `email` and `profile` scopes. It rejects accounts whose email Google has not verified, and accounts not covered by `ALLOWED_EMAILS`.

You can register several redirect URIs on one client. For example, add both `http://localhost:3001/api/auth/google/callback` for development and your production URI.

## Cloudflare Tunnel

The `cloudflared` service connects out to Cloudflare, so you open no inbound port.

1. In the Cloudflare dashboard, open Zero Trust, then Networks, then Tunnels. Create a Cloudflared tunnel and copy its token.
2. Add the token to `.env`:

   ```bash
   TUNNEL_TOKEN=<token>
   ```

3. In the tunnel, add a public hostname such as `cal.example.com` with the service URL `http://app:8080`. Compose gives `cloudflared` the `app` host name on its network.
4. Set `APP_BASE_URL=https://cal.example.com` in `.env`.
5. Start both services:

   ```bash
   docker compose up -d
   ```

`cloudflared` starts after the app is healthy.

## Cloudflare cache rules

The server marks `sw.js`, `index.html` and `manifest.webmanifest` as `Cache-Control: no-cache`, and serves `index.html` for every app route. If Cloudflare caches them, users stay on an old version after a redeploy. Bypass the cache for them.

In the Cloudflare dashboard, open your domain, then Caching, then Cache Rules. Create a rule:

- When the expression is:

  ```
  (http.request.uri.path in {"/" "/index.html" "/sw.js" "/manifest.webmanifest"})
  ```

- Then: Cache eligibility, Bypass cache.

Files under `/assets/` have hashed names and are served as immutable, so Cloudflare may cache them.

## Admin account

Admin sign-in is optional. It lets you list users and delete them, together with their drawings.

1. Pick a password and generate its hash. The password is read from stdin, one line:

   ```bash
   read -rs -p "Admin password: " PW; echo
   printf '%s' "$PW" | docker compose run --rm -T app hash-password
   ```

   The image entrypoint is `/server`, so the argument is only the subcommand. Without Compose:

   ```bash
   printf '%s' "$PW" | docker run --rm -i ghcr.io/seenark/calendar-canvas:latest hash-password
   ```

2. Put the output in `.env` between single quotes, together with the user name:

   ```bash
   ADMIN_USERNAME=admin
   ADMIN_PASSWORD_HASH='<output>'
   ```

3. Restart with `docker compose up -d`, then open `https://<your host>/admin`.

Admin sign-in attempts are rate-limited per client IP.

## Data and backup

All data is one SQLite database at `DATABASE_PATH`, on the `data` Docker volume mounted at `/data`. The database runs in WAL mode, so stop the app before you copy it. Volume name: `calendar-canvas_data`.

Back up:

```bash
docker compose stop app
docker run --rm -v calendar-canvas_data:/data -v "$PWD":/backup alpine \
  tar czf /backup/calendar-canvas-data.tgz -C /data .
docker compose start app
```

Restore into an empty volume:

```bash
docker compose down
docker run --rm -v calendar-canvas_data:/data -v "$PWD":/backup alpine \
  tar xzf /backup/calendar-canvas-data.tgz -C /data
docker compose up -d
```

A deleted stroke stays as a tombstone for 30 days. A daily job then removes it for good.

## Releases

GitHub Actions (`.github/workflows/release.yml`) builds `linux/amd64` and `linux/arm64` images and pushes them to `ghcr.io/seenark/calendar-canvas`.

| Trigger        | Tags                           |
| -------------- | ------------------------------ |
| Push to `main` | `latest`, `sha-<commit>`       |
| Tag `v1.2.3`   | `1.2.3`, `1.2`, `sha-<commit>` |

A new GHCR package is private. After the first publish, set it to public in the package settings so `docker compose pull` works without a login.

## Known open items

- The Day cell aspect ratio, `DAY_ASPECT`, is provisional until the owner reviews it on a real device.
- Google sign-in in an installed iOS (standalone) app is untested.

## License

[MIT](LICENSE)
