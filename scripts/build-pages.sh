#!/bin/sh
# Assembles the GitHub Pages site for a release:
#   latest.json (update manifest), install.sh, docker-compose.yml, Caddyfile, index.html
#
# Usage: scripts/build-pages.sh VERSION [OUT_DIR]
# Optional env: SECURITY=true|false, MIN_UPGRADE_FROM=X.Y.Z, RELEASED_AT=ISO-8601, NOTES_URL=https://...
set -eu

version="${1:?usage: build-pages.sh VERSION [OUT_DIR]}"
version="${version#v}"
out="${2:-site}"
root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)

mkdir -p "$out"
cp "$root/install.sh" "$root/docker-compose.yml" "$root/Caddyfile" "$out/"

# shellcheck disable=SC2016 # JavaScript template literals, not shell expansions.
VERSION="$version" \
SECURITY="${SECURITY:-false}" \
MIN_UPGRADE_FROM="${MIN_UPGRADE_FROM:-}" \
RELEASED_AT="${RELEASED_AT:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}" \
NOTES_URL="${NOTES_URL:-https://github.com/andreasawires/orbit-finance/releases/tag/v$version}" \
node -e '
  const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z.-]+)?$/;
  const env = process.env;
  if (!semver.test(env.VERSION)) throw new Error(`Invalid version: ${env.VERSION}`);
  const min = (env.MIN_UPGRADE_FROM || "").replace(/^v/, "");
  if (min && !semver.test(min)) throw new Error(`Invalid MIN_UPGRADE_FROM: ${min}`);
  if (!/^(true|false)$/.test(env.SECURITY)) throw new Error(`SECURITY must be true or false`);
  const manifest = {
    version: env.VERSION,
    released_at: new Date(env.RELEASED_AT).toISOString(),
    notes_url: env.NOTES_URL,
    security: env.SECURITY === "true",
    min_upgrade_from: min || null,
  };
  process.stdout.write(JSON.stringify(manifest, null, 2) + "\n");
' > "$out/latest.json"

cat > "$out/index.html" <<HTML
<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Orbit Finance v${version}</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:720px;margin:4rem auto;padding:0 1rem;color:#1d1b2d}code,pre{background:#f4f3f8;border-radius:6px}pre{padding:1rem;overflow:auto}a{color:#573cf0}</style>
<h1>Orbit Finance</h1>
<p>Local-first personal finance. Latest release: <a href="https://github.com/andreasawires/orbit-finance/releases/tag/v${version}">v${version}</a>.</p>
<pre><code>curl -fsSL https://andreasawires.github.io/orbit-finance/install.sh | sh</code></pre>
<p><a href="https://github.com/andreasawires/orbit-finance#readme">Documentation</a> · <a href="latest.json">latest.json</a> · <a href="install.sh">install.sh</a> · <a href="docker-compose.yml">docker-compose.yml</a></p>
HTML

echo "Pages site for v${version} written to ${out}"
