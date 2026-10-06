# Orbit Finance

Orbit Finance is a local-first Next.js finance app backed by PostgreSQL 17. Financial documents stay on your machine unless you explicitly configure a remote model provider.

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

## Run with Docker

### Model provider

Configure any endpoint that implements the OpenAI Chat Completions API and supports your chosen model's text and image inputs. Copy `.env.example` to `.env` and set:

```bash
MODEL_BASE_URL=https://provider.example/v1
MODEL_API_KEY=
MODEL_NAME=your-vision-model
MODEL_ALLOW_REMOTE=true
```

`MODEL_BASE_URL` must end in `/v1`; remote endpoints must use HTTPS and require `MODEL_ALLOW_REMOTE=true`. This explicitly acknowledges that statement content is sent to that provider. Local loopback endpoints do not require an API key or the acknowledgement. The importer tries JSON Schema structured output first and automatically falls back to JSON mode when the provider does not support schemas.

For Ollama running on the Docker host, use `MODEL_BASE_URL=http://host.docker.internal:11434/v1`. The Compose services map this hostname to the host gateway, so it is treated as a local provider and does not require HTTPS or `MODEL_ALLOW_REMOTE=true`.

Set `MODEL_TIMEOUT_MS` to control the per-request timeout (five minutes by default). `MODEL_MAX_INPUT_CHARS` bounds the combined native-PDF text sent to the model in one request: consecutive text pages are combined and split only when this limit is exceeded. Set it below the model's usable context window, leaving room for the importer prompt, JSON schema, and response. OCR/image pages are handled separately. `MODEL_STRUCTURED_OUTPUT=auto` tries JSON Schema first, then caches a JSON-mode fallback if the endpoint rejects schema output; set it to `json_schema` or `json_object` to require one mode.

After configuration, run `docker compose up -d --build`. Open [http://localhost:3000/imports](http://localhost:3000/imports), or from another device on the same network use `http://<your-computer-lan-ip>:3000/imports`. Set `WEB_BIND_ADDRESS=127.0.0.1` in `.env` to keep the web UI on this machine.

## Run the app and worker from source

```bash
cp .env.example .env.local
npm install
docker compose up -d database
npm run db:migrate
npm run dev
```

Run the worker in another terminal:

```bash
npm run worker
```

The development server listens on all interfaces, so it is also available at `http://<your-computer-lan-ip>:3000`. If you use a host firewall, allow inbound TCP port 3000 only from your local network.

For this mode, configure `MODEL_BASE_URL`, `MODEL_NAME`, and (when needed) `MODEL_API_KEY` in `.env.local`. The default database connection is `postgresql://orbit:orbit@localhost:5433/orbit_finance`.

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
