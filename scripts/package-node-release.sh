#!/bin/sh
# Builds the Node release tarball for the current platform:
#   dist/orbit-finance-v<version>-<os>-<arch>.tar.gz (+ .sha256)
# e.g. linux-x64, linux-arm64, darwin-arm64 (the platforms @firecrawl/pdf-inspector and
# sharp ship native binaries for, and that the release workflow builds on native runners).
#
# The tarball contains the production Next.js build, production node_modules (with only this
# platform's native binaries), and the TypeScript sources the migrate and worker commands run
# through tsx. Build each platform on that platform; run `npm ci && npm run build` first.
set -eu
# Keep macOS tar from adding AppleDouble (._*) files.
export COPYFILE_DISABLE=1

root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root"

version=$(node -p 'require("./package.json").version')
platform=$(node -p 'process.platform + "-" + process.arch')
case "$platform" in
  linux-x64|linux-arm64|darwin-arm64) ;;
  *) echo "Unsupported release platform: $platform (expected linux-x64, linux-arm64, or darwin-arm64)." >&2; exit 1 ;;
esac
name="orbit-finance-v${version}-${platform}"
dist="$root/dist"
stage="$dist/$name"

if [ ! -f .next/BUILD_ID ]; then
  echo "No production build found. Run 'npm run build' first." >&2
  exit 1
fi

rm -rf "$stage" "$dist/$name.tar.gz" "$dist/$name.tar.gz.sha256"
mkdir -p "$stage/scripts" "$stage/database"

cp package.json package-lock.json next.config.ts tsconfig.json LICENSE README.md "$stage/"
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
