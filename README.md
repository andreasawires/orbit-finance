# Orbit Finance

Orbit Finance is a Next.js app backed by PostgreSQL 17. The database starts empty; no demo accounts, transactions, or cost centers are seeded.

## Run locally

```bash
docker compose up -d
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The default local connection is:

```text
postgresql://orbit:orbit@localhost:5433/orbit_finance
```

Copy `.env.example` to `.env.local` when you need to change the database name, credentials, or port. If the Docker volume already existed before a schema change, run `docker compose down -v` once to recreate the local development database (this deletes its data).

`npm run dev` intentionally uses Webpack. Navigation still uses `next/link`; this avoids the Turbopack compatibility issue without giving up Next.js client-side routing.
