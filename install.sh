#!/bin/sh
# Orbit Finance installer.
#
#   curl -fsSL https://andreasawires.github.io/orbit-finance/install.sh | sh
#   curl -fsSL https://andreasawires.github.io/orbit-finance/install.sh | sh -s -- update
#   curl -fsSL https://andreasawires.github.io/orbit-finance/install.sh | sh -s -- uninstall [--purge]
#
# Options:
#   --dir DIR        Install directory (default: $ORBIT_HOME or ~/orbit-finance)
#   --version X.Y.Z  Install or update to a specific version instead of the latest
#   --purge          With uninstall: also delete the database, imported documents, and DIR
#   -h, --help       Show this help
#
# Answers are read from the terminal (/dev/tty), so piping into sh works. Without a terminal,
# set ORBIT_METHOD=docker|node, ORBIT_DB=bundled|external, DATABASE_URL, ORBIT_PROXY=yes|no,
# and ORBIT_DOMAIN instead. Nothing is ever updated automatically; this script only runs when you do.

set -eu

REPO="andreasawires/orbit-finance"
PAGES_URL="${ORBIT_PAGES_URL:-https://andreasawires.github.io/orbit-finance}"
RELEASES_URL="${ORBIT_RELEASES_URL:-https://github.com/${REPO}/releases/download}"
MIN_NODE="22.9.0"
MIN_COMPOSE="2.20.0"

command_name="install"
install_dir="${ORBIT_HOME:-${HOME}/orbit-finance}"
requested_version=""
purge="no"

say() { printf '%s\n' "$*"; }
info() { printf '\033[1;35m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mwarning:\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

usage() {
  cat <<'USAGE'
Usage: install.sh [install|update|uninstall] [options]

  install          Interactive install (default)
  update           Update to the latest release (or --version X.Y.Z)
  uninstall        Stop Orbit Finance; keeps data unless --purge is given

Options:
  --dir DIR        Install directory (default: $ORBIT_HOME or ~/orbit-finance)
  --version X.Y.Z  Install or update to a specific version
  --purge          With uninstall: also delete the database, documents, and DIR
  -h, --help       Show this help
USAGE
}

while [ $# -gt 0 ]; do
  case "$1" in
    install|update|uninstall) command_name="$1" ;;
    --dir) [ $# -ge 2 ] || die "--dir needs a value"; install_dir="$2"; shift ;;
    --dir=*) install_dir="${1#--dir=}" ;;
    --version) [ $# -ge 2 ] || die "--version needs a value"; requested_version="${2#v}"; shift ;;
    --version=*) requested_version="${1#--version=}"; requested_version="${requested_version#v}" ;;
    --purge) purge="yes" ;;
    -h|--help) usage; exit 0 ;;
    *) die "Unknown argument: $1 (try --help)" ;;
  esac
  shift
done

env_file="${install_dir}/.env"

# ---------------------------------------------------------------------------- prompts

has_tty() { (exec </dev/tty) 2>/dev/null; }

# ask VAR "Question" "default"
ask() {
  _var="$1"; _question="$2"; _default="${3:-}"
  _answer=""
  if has_tty; then
    if [ -n "$_default" ]; then printf '%s [%s]: ' "$_question" "$_default" >/dev/tty
    else printf '%s: ' "$_question" >/dev/tty; fi
    IFS= read -r _answer </dev/tty || _answer=""
  fi
  [ -n "$_answer" ] || _answer="$_default"
  eval "$_var=\$_answer"
}

# ask_choice VAR "Question" default option...
ask_choice() {
  _cvar="$1"; _cquestion="$2"; _cdefault="$3"; shift 3
  _choice=""
  while :; do
    ask _choice "$_cquestion ($(printf '%s' "$*" | tr ' ' '/'))" "$_cdefault"
    for _option in "$@"; do
      if [ "$_choice" = "$_option" ]; then eval "$_cvar=\$_choice"; return 0; fi
    done
    has_tty || die "Invalid value '$_choice' for: $_cquestion"
    say "Please answer one of: $*" >/dev/tty
  done
}

# ---------------------------------------------------------------------------- helpers

download() {
  # download URL DEST
  if have curl; then curl -fsSL --retry 3 -o "$2" "$1"
  elif have wget; then wget -q -O "$2" "$1"
  else die "curl or wget is required"; fi
}

random_secret() {
  if have openssl; then openssl rand -hex 24
  else od -An -tx1 -N24 /dev/urandom | tr -d ' \n'; fi
}

sha256_of() {
  if have sha256sum; then sha256sum "$1" | awk '{print $1}'
  elif have shasum; then shasum -a 256 "$1" | awk '{print $1}'
  else die "sha256sum or shasum is required to verify downloads"; fi
}

# version_lt A B: true when A < B (numeric major.minor.patch; prerelease suffixes rank lower).
version_lt() {
  awk -v a="$1" -v b="$2" 'BEGIN {
    na = split(a, x, /[.-]/); nb = split(b, y, /[.-]/)
    for (i = 1; i <= 3; i++) { if (x[i] + 0 < y[i] + 0) exit 0; if (x[i] + 0 > y[i] + 0) exit 1 }
    if (na > 3 && nb <= 3) exit 0
    exit 1
  }'
}

json_field() {
  # json_field FILE KEY -> string or bare value of a top-level key in latest.json
  sed -n "s/^[[:space:]]*\"$2\"[[:space:]]*:[[:space:]]*\"\{0,1\}\([^\",]*\)\"\{0,1\}.*/\1/p" "$1" | head -n 1
}

tmp_dir=""
cleanup() { [ -n "$tmp_dir" ] && rm -rf "$tmp_dir"; return 0; }
trap cleanup EXIT INT TERM
make_tmp() { [ -n "$tmp_dir" ] || tmp_dir=$(mktemp -d 2>/dev/null || mktemp -d -t orbit); }

manifest_version=""
manifest_min=""
load_manifest() {
  make_tmp
  download "${PAGES_URL}/latest.json" "$tmp_dir/latest.json" || die "Could not download ${PAGES_URL}/latest.json"
  manifest_version=$(json_field "$tmp_dir/latest.json" version)
  manifest_min=$(json_field "$tmp_dir/latest.json" min_upgrade_from)
  [ "$manifest_min" = "null" ] && manifest_min=""
  [ -n "$manifest_version" ] || die "latest.json does not contain a version"
}

target_version() {
  if [ -n "$requested_version" ]; then say "$requested_version"; else say "$manifest_version"; fi
}

env_get() {
  [ -f "$env_file" ] || return 0
  sed -n "s/^$1=//p" "$env_file" | tail -n 1
}

env_set() {
  # env_set KEY VALUE: replace or append KEY in .env, preserving everything else
  _tmp="${env_file}.tmp.$$"
  if grep -q "^$1=" "$env_file" 2>/dev/null; then
    awk -v k="$1" -v v="$2" 'index($0, k "=") == 1 { print k "=" v; next } { print }' "$env_file" > "$_tmp"
  else
    cat "$env_file" > "$_tmp"; printf '%s=%s\n' "$1" "$2" >> "$_tmp"
  fi
  chmod 600 "$_tmp"; mv "$_tmp" "$env_file"
}

require_docker() {
  have docker || die "Docker is not installed. Get it from https://docs.docker.com/get-docker/"
  docker info >/dev/null 2>&1 || die "Docker is installed but not running (or this user cannot reach it)."
  _compose=$(docker compose version --short 2>/dev/null || true)
  [ -n "$_compose" ] || die "Docker Compose v2 is required (the 'docker compose' plugin)."
  if version_lt "${_compose#v}" "$MIN_COMPOSE"; then
    die "Docker Compose ${MIN_COMPOSE}+ is required (found ${_compose})."
  fi
}

compose() { (cd "$install_dir" && docker compose "$@"); }

fetch_compose_files() {
  make_tmp
  download "${PAGES_URL}/docker-compose.yml" "$tmp_dir/docker-compose.yml" || die "Could not download docker-compose.yml"
  download "${PAGES_URL}/Caddyfile" "$tmp_dir/Caddyfile" || die "Could not download Caddyfile"
  for _file in docker-compose.yml Caddyfile; do
    [ -f "$install_dir/$_file" ] && cp "$install_dir/$_file" "$install_dir/$_file.bak"
    mv "$tmp_dir/$_file" "$install_dir/$_file"
  done
}

check_upgrade_path() {
  # check_upgrade_path CURRENT TARGET
  if [ -n "$manifest_min" ] && [ -z "$requested_version" ] && version_lt "$1" "$manifest_min"; then
    die "v$2 cannot be installed directly over v$1. Update to v${manifest_min} first: rerun with --version ${manifest_min}"
  fi
}

host_os() { uname -s 2>/dev/null || echo unknown; }

# ---------------------------------------------------------------------------- install

write_env() {
  # write_env METHOD VERSION PROFILES DATABASE_URL PROXY DOMAIN PASSWORD
  # Only .env is private; the compose file and Caddyfile must stay readable by the containers.
  (umask 077 && : > "$env_file")
  chmod 600 "$env_file"
  cat > "$env_file" <<ENV
# Generated by the Orbit Finance installer on $(date -u +%Y-%m-%dT%H:%M:%SZ). Keep this file private.
INSTALL_METHOD=$1
ORBIT_VERSION=$2
COMPOSE_PROJECT_NAME=orbit-finance
COMPOSE_PROFILES=$3

POSTGRES_DB=orbit_finance
POSTGRES_USER=orbit
POSTGRES_PASSWORD=$7
POSTGRES_PORT=5433
DATABASE_URL=$4

WEB_PORT=3000
WEB_BIND_ADDRESS=$( [ "$5" = "yes" ] && echo 127.0.0.1 || echo 0.0.0.0 )
ORBIT_DOMAIN=$6
APP_PLATFORM=linux/amd64

# Daily check of ${PAGES_URL}/latest.json (a plain GET, nothing identifying is sent).
UPDATE_CHECK=true

# Statement imports: an OpenAI Chat Completions-compatible endpoint (see README).
MODEL_BASE_URL=
MODEL_API_KEY=
MODEL_NAME=
MODEL_ALLOW_REMOTE=false
ENV
}

install_docker() {
  require_docker
  db_mode=""; proxy=""
  ask_choice db_mode "Database: bundled Postgres container, or your own server" "${ORBIT_DB:-bundled}" bundled external
  database_url=""
  if [ "$db_mode" = "external" ]; then
    ask database_url "DATABASE_URL (postgresql://user:password@host:5432/db)" "${DATABASE_URL:-}"
    [ -n "$database_url" ] || die "DATABASE_URL is required when you bring your own database."
  fi
  ask_choice proxy "Put Caddy in front with automatic HTTPS" "${ORBIT_PROXY:-no}" yes no
  domain=""
  if [ "$proxy" = "yes" ]; then
    ask domain "Public domain name pointing at this machine (e.g. money.example.com)" "${ORBIT_DOMAIN:-}"
    [ -n "$domain" ] || die "A domain is required for automatic HTTPS."
  fi

  load_manifest
  version=$(target_version)
  password=$(random_secret)
  profiles=""
  [ "$db_mode" = "bundled" ] && profiles="db"
  [ "$proxy" = "yes" ] && profiles="${profiles:+$profiles,}proxy"
  [ -n "$database_url" ] || database_url="postgresql://orbit:${password}@database:5432/orbit_finance"

  mkdir -p "$install_dir"
  write_env docker "$version" "$profiles" "$database_url" "$proxy" "$domain" "$password"
  fetch_compose_files

  info "Starting Orbit Finance v${version} (profiles: ${profiles:-none})"
  compose pull
  compose up -d

  say ""
  info "Orbit Finance is running."
  if [ "$proxy" = "yes" ]; then
    say "  Open https://${domain} (DNS must point here and ports 80/443 must be reachable)."
  else
    say "  Open http://localhost:3000 (or http://<this-machine-ip>:3000 on your network)."
  fi
  say "  Config: ${env_file} (set MODEL_* there for statement imports, then: cd ${install_dir} && docker compose up -d)."
  say "  Update: curl -fsSL ${PAGES_URL}/install.sh | sh -s -- update"
  if [ "$(uname -m 2>/dev/null)" = "arm64" ] || [ "$(uname -m 2>/dev/null)" = "aarch64" ]; then
    warn "The image is linux/amd64 only; on ARM hosts it runs under emulation and is slower."
  fi
}

install_node_release() {
  # install_node_release VERSION -> extracts into releases/ and repoints current
  case "$(host_os)-$(uname -m 2>/dev/null)" in
    Linux-x86_64|Linux-amd64) ;;
    *) die "The Node release is built for Linux x64 only (native PDF dependency). Use Docker, or run from source." ;;
  esac
  have node || die "Node.js ${MIN_NODE}+ is required."
  _node=$(node -p 'process.versions.node')
  version_lt "$_node" "$MIN_NODE" && die "Node.js ${MIN_NODE}+ is required (found ${_node})."
  have npm || die "npm is required."

  _name="orbit-finance-v$1-linux-x64"
  make_tmp
  info "Downloading ${_name}.tar.gz"
  download "${RELEASES_URL}/v$1/${_name}.tar.gz" "$tmp_dir/${_name}.tar.gz" || die "Could not download the v$1 release."
  download "${RELEASES_URL}/v$1/${_name}.tar.gz.sha256" "$tmp_dir/${_name}.tar.gz.sha256" || die "Could not download the checksum."
  _expected=$(awk '{print $1; exit}' "$tmp_dir/${_name}.tar.gz.sha256")
  _actual=$(sha256_of "$tmp_dir/${_name}.tar.gz")
  if [ -z "$_expected" ] || [ "$_expected" != "$_actual" ]; then die "Checksum mismatch for ${_name}.tar.gz (expected ${_expected}, got ${_actual})."; fi
  info "Checksum verified"

  mkdir -p "$install_dir/releases" "$install_dir/data/imports"
  rm -rf "${install_dir:?}/releases/${_name}"
  tar -xzf "$tmp_dir/${_name}.tar.gz" -C "$install_dir/releases"
  ln -sf "$env_file" "$install_dir/releases/${_name}/.env"
  rm -f "$install_dir/current"
  ln -s "releases/${_name}" "$install_dir/current"
}

print_node_instructions() {
  _dir="$install_dir/current"
  _node_bin=$(command -v node)
  cat <<TXT

Orbit Finance v$1 is installed in ${_dir}.

Run it (each in its own terminal, from ${_dir}):
  npm run db:migrate     # apply database migrations (after every install or update)
  npm start              # web UI on http://localhost:3000 (PORT=8080 npm start to change)
  npm run worker         # statement import worker

Example systemd units (/etc/systemd/system/orbit-finance-web.service and -worker.service):

  [Unit]
  Description=Orbit Finance web
  After=network-online.target postgresql.service

  [Service]
  WorkingDirectory=${_dir}
  Environment=NODE_ENV=production PORT=3000
  ExecStartPre=${_node_bin} --env-file-if-exists=.env --import tsx scripts/migrate.ts
  ExecStart=${_dir}/node_modules/.bin/next start --hostname 0.0.0.0
  Restart=on-failure
  User=$(id -un)

  [Install]
  WantedBy=multi-user.target

  # orbit-finance-worker.service: same [Unit]/[Install]; in [Service] use
  #   ExecStart=${_node_bin} --env-file-if-exists=.env --import tsx workers/import-worker.ts

Then: sudo systemctl daemon-reload && sudo systemctl enable --now orbit-finance-web orbit-finance-worker
Put any reverse proxy (Caddy, nginx) in front of port 3000 for HTTPS.
TXT
}

install_node() {
  db_mode=""
  ask_choice db_mode "Database: bundled Postgres container (needs Docker), or your own server" "${ORBIT_DB:-external}" bundled external
  database_url=""
  if [ "$db_mode" = "external" ]; then
    ask database_url "DATABASE_URL (postgresql://user:password@host:5432/db)" "${DATABASE_URL:-}"
    [ -n "$database_url" ] || die "DATABASE_URL is required when you bring your own database."
  else
    require_docker
  fi

  load_manifest
  version=$(target_version)
  password=$(random_secret)
  profiles=""
  if [ "$db_mode" = "bundled" ]; then
    profiles="db"
    database_url="postgresql://orbit:${password}@localhost:5433/orbit_finance"
  fi

  mkdir -p "$install_dir"
  write_env node "$version" "$profiles" "$database_url" no "" "$password"
  env_set IMPORT_STORAGE_PATH "$install_dir/data/imports"
  install_node_release "$version"

  if [ "$db_mode" = "bundled" ]; then
    fetch_compose_files
    info "Starting the bundled Postgres container (127.0.0.1:5433)"
    compose up -d database
  fi
  print_node_instructions "$version"
}

do_install() {
  method=""
  if [ -f "$env_file" ]; then
    die "Orbit Finance is already installed in ${install_dir}. Run with 'update', or pass --dir for a new location."
  fi
  info "Installing Orbit Finance into ${install_dir}"
  ask_choice method "Install with Docker (recommended) or Node.js" "${ORBIT_METHOD:-docker}" docker node
  case "$method" in
    docker) install_docker ;;
    node) install_node ;;
  esac
}

# ---------------------------------------------------------------------------- update

do_update() {
  [ -f "$env_file" ] || die "No installation found in ${install_dir} (pass --dir if it lives elsewhere)."
  method=$(env_get INSTALL_METHOD)
  current=$(env_get ORBIT_VERSION)
  load_manifest
  version=$(target_version)

  if [ -n "$current" ] && [ "$current" != "latest" ]; then
    if [ "$current" = "$version" ]; then
      info "Already on v${version}."
      [ "$method" = "docker" ] && { compose pull; compose up -d; }
      return 0
    fi
    check_upgrade_path "$current" "$version"
  fi
  info "Updating Orbit Finance ${current:+v$current }-> v${version}"

  case "$method" in
    docker)
      require_docker
      fetch_compose_files
      env_set ORBIT_VERSION "$version"
      # The migrate service runs before web and the worker start, so the schema is upgraded automatically.
      compose pull
      compose up -d
      info "Updated to v${version}."
      ;;
    node)
      install_node_release "$version"
      env_set ORBIT_VERSION "$version"
      if [ -n "$(env_get COMPOSE_PROFILES)" ] && have docker; then fetch_compose_files; compose up -d database; fi
      say ""
      info "v${version} is in ${install_dir}/current. Now apply migrations and restart:"
      say "  cd ${install_dir}/current && npm run db:migrate"
      say "  sudo systemctl restart orbit-finance-web orbit-finance-worker   # or restart your processes"
      say "Older releases stay in ${install_dir}/releases until you remove them."
      ;;
    *) die "Unknown INSTALL_METHOD '${method}' in ${env_file}. Source checkouts update with git pull." ;;
  esac
}

# ---------------------------------------------------------------------------- uninstall

do_uninstall() {
  confirm=""
  [ -d "$install_dir" ] || die "Nothing to uninstall in ${install_dir}."
  method=$(env_get INSTALL_METHOD)
  if [ -f "$install_dir/docker-compose.yml" ] && have docker; then
    if [ "$purge" = "yes" ]; then
      warn "--purge permanently deletes the database volume, imported documents, and ${install_dir}."
      if ! has_tty; then die "--purge needs a terminal to confirm."; fi
      ask confirm "Type 'delete' to confirm" ""
      [ "$confirm" = "delete" ] || die "Not confirmed; nothing was removed."
      compose --profile db --profile proxy down --volumes --remove-orphans
    else
      compose --profile db --profile proxy down --remove-orphans
    fi
  fi
  if [ "$purge" = "yes" ]; then
    if [ "$method" = "node" ] && [ ! -f "$install_dir/docker-compose.yml" ]; then
      if ! has_tty; then die "--purge needs a terminal to confirm."; fi
      warn "--purge permanently deletes ${install_dir}, including imported documents in data/."
      ask confirm "Type 'delete' to confirm" ""
      [ "$confirm" = "delete" ] || die "Not confirmed; nothing was removed."
    fi
    rm -rf "${install_dir:?}"
    info "Removed ${install_dir}."
  else
    info "Stopped Orbit Finance. Your data, volumes, and ${install_dir} were kept."
    [ "$method" = "node" ] && say "  Stop your systemd units too: sudo systemctl disable --now orbit-finance-web orbit-finance-worker"
    say "  Remove everything with: sh install.sh uninstall --purge"
  fi
}

case "$command_name" in
  install) do_install ;;
  update) do_update ;;
  uninstall) do_uninstall ;;
esac
