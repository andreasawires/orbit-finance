#!/bin/sh
# Builds the Node release tarball: dist/orbit-finance-v<version>-linux-x64.tar.gz (+ .sha256).
#
# The tarball contains the production Next.js build, production node_modules, and the
# TypeScript sources the migrate and worker commands run through tsx. It is built for the
# platform it is created on (CI uses linux x64, the only platform @firecrawl/pdf-inspector ships
# a native binary for). Run `npm ci && npm run build` first.
set -eu

root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root"

version=$(node -p 'require("./package.json").version')
platform="${RELEASE_PLATFORM:-linux-x64}"
name="orbit-finance-v${version}-${platform}"
dist="$root/dist"
stage="$dist/$name"

if [ ! -f .next/BUILD_ID ]; then
  echo "No production build found. Run 'npm run build' first." >&2
  exit 1
fi

rm -rf "$stage" "$dist/$name.tar.gz" "$dist/$name.tar.gz.sha256"
mkdir -p "$stage/scripts" "$stage/database"

cp package.json package-lock.json next.config.ts tsconfig.json "$stage/"
cp -R lib workers "$stage/"
cp scripts/migrate.ts "$stage/scripts/"
cp -R database/migrations "$stage/database/"
cp .env.example "$stage/"
[ -d public ] && cp -R public "$stage/"

# The build output without the incremental cache, traces, or dev-only type stubs.
mkdir -p "$stage/.next"
(cd .next && tar -cf - --exclude=./cache --exclude=./trace --exclude=./trace-build --exclude=./types --exclude=./diagnostics .) | (cd "$stage/.next" && tar -xf -)

# Production dependencies only. tsx is a runtime dependency, so migrate and the worker run as-is.
(cd "$stage" && npm ci --omit=dev --ignore-scripts=false --no-audit --no-fund --loglevel=error)

printf '%s\n' "$version" > "$stage/VERSION"

(cd "$dist" && tar -czf "$name.tar.gz" "$name")
if command -v sha256sum >/dev/null 2>&1; then
  (cd "$dist" && sha256sum "$name.tar.gz" > "$name.tar.gz.sha256")
else
  (cd "$dist" && shasum -a 256 "$name.tar.gz" > "$name.tar.gz.sha256")
fi
rm -rf "$stage"
echo "Wrote $dist/$name.tar.gz"
