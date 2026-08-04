# Orbit Finance

Orbit Finance is a local-first Next.js finance app backed by PostgreSQL 17. Financial documents and model requests stay on your machine.

## Local document-import pipeline

The Imports workspace accepts PDF, CSV, JPEG, PNG, and WebP statements:

1. The web app streams the upload into private local storage and records its SHA-256 digest.
2. PostgreSQL and `pg-boss` queue the document by batch ID; no Redis or external object store is required.
3. `@firecrawl/pdf-inspector` extracts native PDF text. Only pages marked as needing visual reading are rendered.
4. A local `Qwen3-VL-4B-Instruct` runtime converts PDF text or page images into structured transaction candidates. Known CSV layouts are handled deterministically and do not invoke the model.
5. Code validates dates, signs, amounts, currencies, and ledger compatibility.
6. Every candidate must be approved or rejected in the UI. Final insertion and source provenance are committed in one repeat-safe database transaction.

The model process receives only the current page text/image plus a short first-page context for later statement pages. It has no document volume or database credentials. Originals remain in the private import volume so reviewers can open the exact source; the app's **Delete all financial data** action removes those originals as well as their database records.

## Run with Docker

### Native Ollama (recommended on macOS / Apple Silicon)

Install [Ollama](https://ollama.com), then install the model once:

```bash
ollama pull qwen3-vl:4b-instruct
docker compose up -d --build
```

Open [http://localhost:3000/imports](http://localhost:3000/imports), or from another device on the same network use `http://<your-computer-lan-ip>:3000/imports`. The web UI binds to all network interfaces by default; set `WEB_BIND_ADDRESS=127.0.0.1` in `.env` to keep it on this machine only. PostgreSQL and Ollama remain bound to loopback. Ollama runs natively on the Mac; the worker reaches it at `host.docker.internal:11434`.

`pdf-inspector` currently publishes a Linux x64 native binary but not a Linux ARM64 one, so the app containers default to `linux/amd64` on Apple Silicon. The model remains native and does the expensive inference work outside Docker.

### Fully Dockerized Ollama (CPU)

This is the self-contained option for any Docker host. It is slower than a native GPU runtime, but requires no host Ollama installation. The first start downloads the configured model into the persistent `orbit-ollama-data` volume.

```bash
OLLAMA_BASE_URL_DOCKER=http://ollama-cpu:11434 \
  docker compose --profile ollama-cpu up -d --build
```

### Fully Dockerized Ollama (Linux + NVIDIA)

Install the NVIDIA Container Toolkit, then run the GPU profile. Like the CPU profile, it automatically downloads the model on first start.

```bash
OLLAMA_BASE_URL_DOCKER=http://ollama-gpu:11434 \
  docker compose --profile ollama-gpu up -d --build
```

Use exactly one Ollama mode at a time. The Ollama API stays bound to loopback in the Docker modes as well. To use a different local model, set `VISION_MODEL` consistently for the app and the Ollama service before the command.

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

For this mode, `OLLAMA_BASE_URL=http://127.0.0.1:11434`. The default database connection is `postgresql://orbit:orbit@localhost:5433/orbit_finance`.

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
