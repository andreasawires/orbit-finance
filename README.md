# Orbit Finance

Orbit Finance is a local-first Next.js finance app backed by PostgreSQL 17. Financial documents stay on your machine unless you explicitly configure a remote model provider.

- [Install](#install): one-line installer, Docker Compose (three setups), Node.js, or from source
- [Updating](#updating) and the [update check](#update-check)
- [Model provider](#model-provider) for statement imports
- [Releasing](#releasing) (maintainers)

## Workspaces

Every account, transaction, cost center, currency, preference, report, and import belongs to one workspace. Use the workspace selector in the sidebar to switch datasets, and use **Settings → Workspaces** to create, rename, archive, restore, or permanently delete a workspace. Existing installations are migrated into a default **Personal** workspace when `npm run db:migrate` runs.

## Document-import pipeline

The Imports workspace accepts PDF, CSV, JPEG, PNG, and WebP statements:

1. The web app streams the upload into private local storage and records its SHA-256 digest.
2. PostgreSQL and `pg-boss` queue the document by batch ID; no Redis or external object store is required.
3. `@firecrawl/pdf-inspector` extracts native PDF text. Only pages marked as needing visual reading are rendered.
4. A configured OpenAI Chat Completions-compatible model converts PDF text or page images into structured transaction candidates. Known CSV layouts are handled deterministically and do not invoke the model.
5. Code validates dates, signs, amounts, currencies, and ledger compatibility.
6. Every candidate must be approved or rejected in the UI. Final insertion and source provenance are committed in one repeat-safe database transaction.

The model receives only the current page text/image plus a short first-page context for later statement pages. Originals remain in the private import volume so reviewers can open the exact source; the app's **Delete all financial data** action removes those originals as well as their database records.

## Install

### Quick install

```bash
curl -fsSL https://andreasawires.github.io/orbit-finance/install.sh | sh
```

The installer (POSIX `sh`, macOS and Linux) asks three questions: Docker or Node.js, the bundled Postgres or your own `DATABASE_URL`, and whether to put Caddy in front with automatic HTTPS (and for which domain). It then:

- creates `~/orbit-finance` (change it with `--dir`),
- writes `.env` with a random `POSTGRES_PASSWORD` (mode `600`), plus `INSTALL_METHOD`, `ORBIT_VERSION`, and `COMPOSE_PROFILES`,
- downloads `docker-compose.yml` and `Caddyfile` for the latest release and runs `docker compose up -d` (Docker), or downloads the release tarball, verifies its SHA-256, and prints run instructions with systemd examples (Node.js).

You can read the script first at [`install.sh`](install.sh). Without a terminal (for example in provisioning scripts) it takes its answers from `ORBIT_METHOD=docker|node`, `ORBIT_DB=bundled|external`, `DATABASE_URL`, `ORBIT_PROXY=yes|no`, and `ORBIT_DOMAIN`. Docker installs need Docker Compose v2.20 or newer.

### Docker Compose

One [`docker-compose.yml`](docker-compose.yml) covers three setups through Compose profiles. The app services (`migrate`, `web`, `import-worker`) always run and use the published image `ghcr.io/andreasawires/orbit-finance:${ORBIT_VERSION}`; `migrate` applies database migrations before the web app and worker start.

| Setup | Command | What runs |
| --- | --- | --- |
| Full | `docker compose --profile db --profile proxy up -d` | App + bundled Postgres + Caddy with automatic HTTPS |
| App + database | `docker compose --profile db up -d` | App + bundled Postgres |
| App only | `docker compose up -d` | App; `DATABASE_URL` points at your own Postgres |

Instead of passing `--profile` every time, set `COMPOSE_PROFILES=db,proxy` (or `db`, or empty) in `.env`; the installer does this. Manual setup:

```bash
mkdir orbit-finance && cd orbit-finance
curl -fsSLO https://andreasawires.github.io/orbit-finance/docker-compose.yml
curl -fsSLO https://andreasawires.github.io/orbit-finance/Caddyfile
curl -fsSL -o .env https://raw.githubusercontent.com/andreasawires/orbit-finance/main/.env.example
# Edit .env: set POSTGRES_PASSWORD (and the same password in DATABASE_URL),
# COMPOSE_PROFILES, ORBIT_VERSION, and the MODEL_* settings.
docker compose up -d
```

Open [http://localhost:3000](http://localhost:3000), or `http://<your-computer-lan-ip>:3000` from another device on your network. Set `WEB_BIND_ADDRESS=127.0.0.1` to keep the web UI on this machine.

**Bundled database (`db`).** Postgres 17 with its data in the `orbit-postgres-data` volume, published only on `127.0.0.1:${POSTGRES_PORT:-5433}`. `POSTGRES_PASSWORD` is applied when the volume is first created; the Compose fallback is the old `orbit` default, so always set your own (the installer generates one).

**Your own database (no `db` profile).** Set `DATABASE_URL` to your server, for example `postgresql://orbit:secret@db.internal:5432/orbit_finance`. The `migrate`, `web`, and `import-worker` services only wait for the bundled database when the `db` profile is enabled (`depends_on` with `required: false`).

**HTTPS with Caddy (`proxy`).** Set `ORBIT_DOMAIN` to a domain whose DNS points at this host and make ports 80 and 443 reachable; Caddy obtains and renews the certificate automatically ([`Caddyfile`](Caddyfile)). In this mode set `WEB_BIND_ADDRESS=127.0.0.1` so port 3000 is only reachable locally and all outside traffic goes through Caddy (the installer does this). For local testing, `ORBIT_DOMAIN=localhost` uses Caddy's internal CA.

**Build the image yourself.** To build from a checkout instead of pulling from GHCR, add the build override:

```bash
docker compose -f docker-compose.yml -f docker-compose.build.yml --profile db up -d --build
```

All app containers keep the existing hardening: `no-new-privileges`, all Linux capabilities dropped (Caddy gets back only `NET_BIND_SERVICE`), and health checks on Postgres and the web app.

> **Apple Silicon and other ARM hosts:** the image is `linux/amd64` only, because `@firecrawl/pdf-inspector` ships just a Linux x64 native binary. Docker Desktop runs it under emulation (Rosetta or QEMU). It works, but imports are slower. `APP_PLATFORM=linux/amd64` in `.env` keeps this explicit.

> **Upgrading a pre-1.0 checkout** that ran `docker compose up -d --build`: Postgres is now behind the `db` profile and the app image comes from GHCR. Add `COMPOSE_PROFILES=db` to your `.env` (your existing `orbit-postgres-data` volume and its password are kept), then either run `docker compose pull && docker compose up -d` or keep building locally with the build override above.

### Node.js

Each release attaches `orbit-finance-v<version>-linux-x64.tar.gz` and its `.sha256`. It contains the production Next.js build, production `node_modules`, the migrations, and the worker, so nothing is built on the server. It needs **Linux x64 and Node.js 22.9 or newer** (the native PDF dependency is Linux x64 only; on macOS use Docker or run from source). The installer's Node.js option sets this up under `~/orbit-finance/releases/` with a `current` symlink and a shared `.env`; to do it by hand:

```bash
version=1.0.0
curl -fsSLO https://github.com/andreasawires/orbit-finance/releases/download/v$version/orbit-finance-v$version-linux-x64.tar.gz
curl -fsSLO https://github.com/andreasawires/orbit-finance/releases/download/v$version/orbit-finance-v$version-linux-x64.tar.gz.sha256
sha256sum -c orbit-finance-v$version-linux-x64.tar.gz.sha256
tar -xzf orbit-finance-v$version-linux-x64.tar.gz && cd orbit-finance-v$version-linux-x64
cp .env.example .env   # set DATABASE_URL, IMPORT_STORAGE_PATH, INSTALL_METHOD=node, MODEL_*
npm run db:migrate
npm start              # web UI on port 3000; PORT=8080 npm start to change it
npm run worker         # in another terminal or as a service
```

The installer prints systemd unit examples for the web app and the worker. Put any reverse proxy in front of port 3000 for HTTPS.

### From source

```bash
git clone https://github.com/andreasawires/orbit-finance.git && cd orbit-finance
cp .env.example .env.local
npm install
docker compose up -d database   # or use any Postgres 17 server
npm run db:migrate
npm run dev
```

Run the worker in another terminal:

```bash
npm run worker
```

For this mode, configure `MODEL_BASE_URL`, `MODEL_NAME`, and (when needed) `MODEL_API_KEY` in `.env.local`. Set `DATABASE_URL` to `postgresql://orbit:<POSTGRES_PASSWORD>@localhost:5433/orbit_finance` so the host app can reach the published Postgres port. A remote Postgres URL works here too.

The development server listens on all interfaces, so it is also available at `http://<your-computer-lan-ip>:3000`. If you use a host firewall, allow inbound TCP port 3000 only from your local network. Node.js 22.9 or newer is required.

## Updating

Orbit Finance never updates itself. When you choose to update:

| Install | Command |
| --- | --- |
| Docker (installer) | `curl -fsSL https://andreasawires.github.io/orbit-finance/install.sh \| sh -s -- update` |
| Docker (manual) | set `ORBIT_VERSION` in `.env`, then `docker compose pull && docker compose up -d` |
| Node.js | the same installer `update` command, then `npm run db:migrate` and restart the services |
| From source | `git pull && npm ci && npm run build && npm run db:migrate`, then restart |

The installer's `update` reads `latest.json`, refreshes `docker-compose.yml` and `Caddyfile` (keeping `.bak` copies), sets `ORBIT_VERSION`, and runs `docker compose pull && docker compose up -d`; the `migrate` service upgrades the schema before the app starts. Use `--version X.Y.Z` to pick a specific release and `--dir` if you installed somewhere other than `~/orbit-finance`. If a release declares a minimum version to upgrade from, the installer stops and tells you which version to install first.

`sh install.sh uninstall` stops the containers and keeps your data. `uninstall --purge` also deletes the database volume, imported documents, and the install directory, after you type `delete` to confirm.

## Update check

To tell you about new releases, the server (never the browser) downloads one static file once at startup and then every 24 hours:

```
GET https://andreasawires.github.io/orbit-finance/latest.json
```

```json
{
  "version": "1.1.0",
  "released_at": "2026-11-02T10:00:00.000Z",
  "notes_url": "https://github.com/andreasawires/orbit-finance/releases/tag/v1.1.0",
  "security": false,
  "min_upgrade_from": null
}
```

When the manifest lists a newer version than yours, the app shell shows a dismissible banner with the release notes link and the update command for your install type (`INSTALL_METHOD`). Security releases are highlighted. The result is cached in the `update_check` table, so the banner survives restarts and offline periods.

**Privacy.** The request is a plain `GET` with no cookies, query parameters, installation ID, or usage data. The only header that says anything about you is `User-Agent: orbit-finance/<version>`. GitHub Pages, like any web server, sees the requesting IP address.

**Turn it off** with `UPDATE_CHECK=false` in `.env`; no request is made at all. `UPDATE_MANIFEST_URL` points the check at a mirror or your own manifest.

## Releasing

Releases are cut by pushing a semver tag. [`.github/workflows/release.yml`](.github/workflows/release.yml) then runs lint and tests, pushes the image to `ghcr.io/andreasawires/orbit-finance` (tags `X.Y.Z`, `X.Y`, and `latest`; `linux/amd64`), builds and smoke-tests the Node tarball, creates the GitHub Release with auto-generated notes and the tarball plus `.sha256`, and deploys GitHub Pages with `latest.json`, `install.sh`, `docker-compose.yml`, and `Caddyfile`.

```bash
npm run release:patch   # or release:minor / release:major: bumps package.json, commits, tags vX.Y.Z
git push --follow-tags
```

The tag must match `package.json`, or the workflow stops. To flag a security release or require a stepping-stone version, add trailers to the annotated tag message, which feed `security` and `min_upgrade_from` in `latest.json`:

```bash
npm version patch --no-git-tag-version
git commit -am "Release v1.0.1"
git tag -a v1.0.1 -m "Release v1.0.1" -m "Security: true" -m "Min-Upgrade-From: 1.0.0"
git push --follow-tags
```

Prerelease tags such as `v1.1.0-rc.1` publish an image and a GitHub prerelease, but do not move `latest`, the `X.Y` tag, or the Pages manifest. Pull requests and pushes to `main` run [`.github/workflows/ci.yml`](.github/workflows/ci.yml): lint, tests, build, `shellcheck`, `docker compose config` for every profile combination, and Caddyfile validation.

One-time repository setup: in **Settings → Pages**, set the source to **GitHub Actions**. After the first release, make the `orbit-finance` package public under **Packages → Package settings** so `docker compose pull` works without logging in.

## Model provider

Configure any endpoint that implements the OpenAI Chat Completions API and supports your chosen model's text and image inputs. Set these in `.env` (the installer creates it; otherwise copy `.env.example`):

```bash
MODEL_BASE_URL=https://provider.example/v1
MODEL_API_KEY=
MODEL_NAME=your-vision-model
MODEL_ALLOW_REMOTE=true
```

`MODEL_BASE_URL` must end in `/v1`; remote endpoints must use HTTPS and require `MODEL_ALLOW_REMOTE=true`. This explicitly acknowledges that statement content is sent to that provider. Local loopback endpoints do not require an API key or the acknowledgement. The importer tries JSON Schema structured output first and automatically falls back to JSON mode when the provider does not support schemas.

For Ollama running on the Docker host, use `MODEL_BASE_URL=http://host.docker.internal:11434/v1`. The Compose services map this hostname to the host gateway, so it is treated as a local provider and does not require HTTPS or `MODEL_ALLOW_REMOTE=true`.

Set `MODEL_TIMEOUT_MS` to control the per-request timeout (five minutes by default). `MODEL_MAX_INPUT_CHARS` bounds the combined native-PDF text sent to the model in one request: consecutive text pages are combined and split only when this limit is exceeded. Set it below the model's usable context window, leaving room for the importer prompt, JSON schema, and response. OCR/image pages are handled separately. `MODEL_STRUCTURED_OUTPUT=auto` tries JSON Schema first, then caches a JSON-mode fallback if the endpoint rejects schema output; set it to `json_schema` or `json_object` to require one mode.

## Import limits

| Input | Default limit |
| --- | --- |
| PDF | 25 MiB and 50 pages |
| CSV | 10 MiB, 50,000 rows, and 100 columns |
| Image | 10 MiB and 20 decoded megapixels |
| Rendered PDF page | 4 megapixels |
| Worker concurrency | 1 document |

All limits can be changed through the variables documented in `.env.example`. Uploaded originals are retained in the local `orbit-import-data` volume for provenance. Database changes are managed by ordered, checksummed migrations; run `npm run db:migrate` after pulling schema changes.

Candidate review is paginated at 100 rows per request, so the CSV acceptance limit does not become one enormous API response or React render. Approval rechecks the batch revision and duplicate fingerprints while holding PostgreSQL locks before it inserts ledger rows.
