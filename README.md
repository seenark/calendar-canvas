# Calendar Canvas

ปฏิทินเขียนด้วยลายมือสำหรับมือถือ (PWA) แต่ละวันเป็นหน้ากระดาษให้วาดหรือเขียนด้วยนิ้ว ติดตั้งใช้เองได้ด้วย Docker หนึ่งคอนเทนเนอร์ แล้วเปิดสู่อินเทอร์เน็ตผ่าน Cloudflare Tunnel

Calendar Canvas is a mobile-only handwriting calendar. Every day is a page you draw on with a pen or an eraser. It is a React single-page app served by a Go server, with SQLite storage, in one container. Users sign in with Google. An Admin account approves, blocks and deletes users. The UI is Thai, and years show in Buddhist Era.

## Contents

- [Local development](#local-development)
- [Self-hosting](#self-hosting)
- [Configuration](#configuration)
- [Google OAuth setup](#google-oauth-setup)
- [Cloudflare Tunnel](#cloudflare-tunnel)
- [Cloudflare cache rules](#cloudflare-cache-rules)
- [Admin account](#admin-account)
- [Install the Admin app on iPhone](#install-the-admin-app-on-iphone)
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
- `bun run test:browser` runs the Pruning tests in headless Chromium. Install the browser once with `cd apps/web && bunx playwright install chromium`. `vp test run` skips these tests.
- `bun run gen:types` regenerates the TypeScript types from the Go API types.

Layout: `apps/web` (SPA), `apps/server` (Go/Gin server), `packages/ui` (shared shadcn/ui components), `docs/adr` (decisions), `GLOSSARY.md` (domain terms).

## Self-hosting

You need Docker, a Google OAuth client, and, for a public instance, a domain on Cloudflare with `cloudflared` installed on the host. The app runs in one container; `cloudflared` runs on the host and is not part of the compose file.

1. Copy the example settings and fill them in. See [Configuration](#configuration).

   ```bash
   cp .env.example .env
   ```

2. Pull the published image and start the app.

   ```bash
   docker compose pull app
   docker compose up -d app
   ```

   The app listens on <http://127.0.0.1:8080>. For a local-only trial, set `APP_BASE_URL=http://localhost:8080`, open <http://localhost:8080> (not `127.0.0.1`, because the `Origin` check compares against `APP_BASE_URL`), and use `http://localhost:8080/api/auth/google/callback` as the Google redirect URI.

   To build the image from this checkout instead, run `docker compose up -d --build app` (or `bun run docker:up`).

   Without Compose, the same container runs with `docker run`:

   ```bash
   docker run -d --name calendar-canvas --restart unless-stopped \
     -p 127.0.0.1:8080:8080 --env-file .env \
     -v calendar-canvas-data:/data ghcr.io/seenark/calendar-canvas:latest
   ```

   `docker run --env-file` reads values literally, so write `ADMIN_PASSWORD_HASH` without quotes there. See [Quote the password hash](#quote-the-password-hash).

3. For a public instance, point the host's Cloudflare Tunnel at the app. See [Cloudflare Tunnel](#cloudflare-tunnel).

Why the port binds to `127.0.0.1`: the app must be reachable only through the tunnel. The server trusts the `CF-Connecting-IP` header to rate-limit Admin sign-in per client. Anyone who could reach the port directly could forge that header. Do not change the mapping to `0.0.0.0` or publish the port through another proxy.

Update to a new release:

```bash
docker compose pull app
docker compose up -d app
```

With `docker run`, pull the new image, then remove and re-create the container with the same command. The data stays in the volume.

Check the app: `curl http://127.0.0.1:8080/api/health` returns `{"status":"ok"}`. The container health check runs `/server healthcheck`.

## Configuration

Compose (or `docker run --env-file`) passes `.env` to the app container. The server refuses to start when a required value is missing or invalid, and prints every problem.

| Variable               | Required | Meaning                                                                                                                                            |
| ---------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `APP_BASE_URL`         | yes      | Public origin, such as `https://cal.example.com`. No path. Sets the Google redirect URI and the `Origin` check. `https` turns on `Secure` cookies. |
| `PORT`                 | no       | Listen port in the container. Default `8080`.                                                                                                      |
| `DATABASE_PATH`        | yes      | SQLite file. Use `/data/app.db`, which lives on the `data` volume.                                                                                 |
| `GOOGLE_CLIENT_ID`     | yes      | From [Google OAuth setup](#google-oauth-setup).                                                                                                    |
| `GOOGLE_CLIENT_SECRET` | yes      | From the same page.                                                                                                                                |
| `SESSION_SECRET`       | yes      | At least 32 bytes. Signs the sign-in state cookie. `openssl rand -base64 48` makes one.                                                            |
| `ADMIN_USERNAME`       | no       | Admin user name.                                                                                                                                   |
| `ADMIN_PASSWORD_HASH`  | no       | argon2id hash of the Admin password. Admin sign-in is off without it.                                                                              |

### Quote the password hash

An argon2id hash contains `$` characters, and the two ways of reading `.env` treat quotes differently.

- **Docker Compose** expands `$` in unquoted and double-quoted values, which corrupts the hash. Wrap it in single quotes:

  ```bash
  ADMIN_PASSWORD_HASH='$argon2id$v=19$m=65536,t=3,p=2$c29tZXNhbHQ$aGFzaGhhc2g'
  ```

- **`docker run --env-file`** keeps quotes as part of the value, so the single-quoted form fails with `ADMIN_PASSWORD_HASH is invalid`. Write it without quotes:

  ```bash
  ADMIN_PASSWORD_HASH=$argon2id$v=19$m=65536,t=3,p=2$c29tZXNhbHQ$aGFzaGhhc2g
  ```

Do not `source` the unquoted form in a shell; the shell expands its `$` too.

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

The server asks for the `openid`, `email` and `profile` scopes. It rejects accounts whose email Google has not verified. Any other Google account can sign in, but must be approved first (see [Admin account](#admin-account)).

You can register several redirect URIs on one client. For example, add both `http://localhost:3001/api/auth/google/callback` for development and your production URI.

## Cloudflare Tunnel

Run `cloudflared` on the host, not in a container. It connects out to Cloudflare, so you open no inbound port.

1. Install `cloudflared` on the host and create a tunnel (Zero Trust, then Networks, then Tunnels), or reuse an existing one.
2. Add a public hostname such as `cal.example.com` with the service URL `http://localhost:8080`. The app container publishes port 8080 on the host's loopback only, which `cloudflared` on the same host can reach.
3. Set `APP_BASE_URL=https://cal.example.com` in `.env`, add `https://cal.example.com/api/auth/google/callback` to the Google OAuth client, and restart the app container.

## Cloudflare cache rules

The server marks `sw.js`, `index.html`, `manifest.webmanifest` and `admin.webmanifest` as `Cache-Control: no-cache`, and serves `index.html` for every app route. If Cloudflare caches them, users stay on an old version after a redeploy. Bypass the cache for them.

In the Cloudflare dashboard, open your domain, then Caching, then Cache Rules. Create a rule:

- When the expression is:

  ```
  (http.request.uri.path in {"/" "/index.html" "/sw.js" "/manifest.webmanifest" "/admin.webmanifest"})
  ```

- Then: Cache eligibility, Bypass cache.

Files under `/assets/` have hashed names and are served as immutable, so Cloudflare may cache them.

## Admin account

Any Google account with a verified email can sign in. A first sign-in creates a **Pending** User, who sees a waiting screen instead of the calendar. Only the Admin can approve a Pending User, so set up Admin sign-in before you invite anyone. The Admin page lists Users in three sections, Pending, Approved and Blocked, with อนุมัติ (approve), ระงับ (block) and ลบ (delete) where they apply. Approved Users use the calendar, and a waiting User who reopens or refocuses the app moves into the Month view without signing in again. Blocking a User ends all their sessions at once and keeps their drawings. A Blocked person who signs in sees that the account is suspended and stays Blocked until the Admin approves them again, and that device discards its unsynced drawing. Deleting a User also deletes their drawings, and signing in again makes them Pending.

Approved Users can share their calendar read-only with other Approved Users from the calendar menu in the Month view header. The other User sees an in-app invitation and must accept it; no email is sent, and the list of Users to share with shows names and avatars, never email addresses. While either side is Blocked, the share is hidden, and it comes back when the Admin approves them again. Deleting a User also deletes every share they are part of.

Users that exist when you upgrade from a version with `ALLOWED_EMAILS` become Approved automatically. A leftover `ALLOWED_EMAILS` value in the environment is ignored.

1. Pick a password and generate its hash. The password is read from stdin, one line:

   ```bash
   printf 'Admin password: '; read -rs PW; echo
   printf '%s' "$PW" | docker compose run --rm -T app hash-password
   ```

   The image entrypoint is `/server`, so the argument is only the subcommand. Without Compose:

   ```bash
   printf '%s' "$PW" | docker run --rm -i ghcr.io/seenark/calendar-canvas:latest hash-password
   ```

2. Put the output in `.env` together with the user name. With Compose, wrap the hash in single quotes; with `docker run --env-file`, leave it unquoted (see [Quote the password hash](#quote-the-password-hash)):

   ```bash
   ADMIN_USERNAME=admin
   ADMIN_PASSWORD_HASH='<output>'   # Compose
   ADMIN_PASSWORD_HASH=<output>     # docker run --env-file
   ```

3. Restart the app (`docker compose up -d app`, or re-create the `docker run` container), then open `https://<your host>/admin/login`.

Admin sign-in attempts are rate-limited per client IP.

## Install the Admin app on iPhone

The Admin area installs as its own home-screen app named "Cal Admin", with a black icon that is easy to tell apart from the calendar app.

1. In Safari, open `https://<your host>/admin/login`. Do this in Safari, not inside the calendar app, because a home-screen app has no address bar.
2. Tap Share, then Add to Home Screen. The name is filled in as "Cal Admin".
3. Open Cal Admin from the home screen. It opens at `/admin`, or at the Admin sign-in when your 12-hour Admin session has expired, and it stays inside `/admin`.

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
docker volume rm calendar-canvas_data
docker run --rm -v calendar-canvas_data:/data -v "$PWD":/backup alpine \
  tar xzf /backup/calendar-canvas-data.tgz -C /data
docker compose up -d app
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
