import { db } from "@/lib/database";
import { appVersion } from "@/lib/app-version";
import {
  evaluateUpdate,
  normalizeInstallMethod,
  parseUpdateManifest,
  updateCommand,
  type InstallMethod,
  type UpdateManifest,
} from "@/lib/update-check/version";

// Server-side update check. It only ever performs a plain GET of a static JSON
// file; no identifiers, telemetry, or usage data are sent, and nothing is ever
// installed automatically.

export const defaultManifestUrl = "https://andreasawires.github.io/orbit-finance/latest.json";
const checkIntervalMs = 24 * 60 * 60 * 1000;
const fetchTimeoutMs = 10_000;
const maxManifestBytes = 64 * 1024;

export type UpdateStatus = {
  enabled: boolean;
  currentVersion: string;
  installMethod: InstallMethod;
  updateCommand: string;
  checkedAt: string | null;
  error: string | null;
  latest: UpdateManifest | null;
  updateAvailable: boolean;
  security: boolean;
  directUpgrade: boolean;
};

type CachedCheck = { checkedAt: Date; manifest: UpdateManifest | null; error: string | null };

const globalForUpdates = globalThis as unknown as {
  orbitUpdateTimer?: ReturnType<typeof setInterval>;
  orbitUpdateLast?: CachedCheck;
};

export function updateCheckEnabled() {
  return !/^(false|0|no|off)$/i.test((process.env.UPDATE_CHECK ?? "").trim());
}

function manifestUrl() {
  return (process.env.UPDATE_MANIFEST_URL ?? "").trim() || defaultManifestUrl;
}

export async function fetchManifest(url = manifestUrl()): Promise<UpdateManifest> {
  const response = await fetch(url, {
    method: "GET",
    cache: "no-store",
    redirect: "follow",
    credentials: "omit",
    headers: { Accept: "application/json", "User-Agent": `orbit-finance/${appVersion}` },
    signal: AbortSignal.timeout(fetchTimeoutMs),
  });
  if (!response.ok) throw new Error(`Update manifest request failed with HTTP ${response.status}.`);
  const body = await response.text();
  if (body.length > maxManifestBytes) throw new Error("Update manifest is too large.");
  return parseUpdateManifest(JSON.parse(body));
}

async function saveCheck(check: CachedCheck) {
  await db.query(
    `INSERT INTO update_check (id, checked_at, current_version, manifest, error)
     VALUES (1, $1, $2, $3, $4)
     ON CONFLICT (id) DO UPDATE SET
       checked_at = EXCLUDED.checked_at,
       current_version = EXCLUDED.current_version,
       -- Keep the last good manifest when a check fails (for example while offline).
       manifest = COALESCE(EXCLUDED.manifest, update_check.manifest),
       error = EXCLUDED.error`,
    [check.checkedAt, appVersion, check.manifest ? JSON.stringify(check.manifest) : null, check.error],
  );
}

async function loadCheck(): Promise<CachedCheck | null> {
  const result = await db.query<{ checked_at: Date; manifest: unknown; error: string | null }>(
    "SELECT checked_at, manifest, error FROM update_check WHERE id = 1",
  );
  const row = result.rows[0];
  if (!row) return null;
  let manifest: UpdateManifest | null = null;
  try { manifest = row.manifest ? parseUpdateManifest(row.manifest) : null; } catch { manifest = null; }
  return { checkedAt: new Date(row.checked_at), manifest, error: row.error };
}

export async function runUpdateCheck(): Promise<CachedCheck> {
  let check: CachedCheck;
  try {
    check = { checkedAt: new Date(), manifest: await fetchManifest(), error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    let previous = globalForUpdates.orbitUpdateLast?.manifest ?? null;
    if (!previous) {
      try { previous = (await loadCheck())?.manifest ?? null; } catch { previous = null; }
    }
    // Keep showing the last known release while the manifest is unreachable (for example offline).
    check = { checkedAt: new Date(), manifest: previous, error: message };
    console.warn(`[update-check] ${message}`);
  }
  globalForUpdates.orbitUpdateLast = check;
  try {
    await saveCheck(check);
  } catch (error) {
    // The table is missing until migrations run; the in-memory result still serves the API.
    console.warn(`[update-check] Could not cache result: ${error instanceof Error ? error.message : error}`);
  }
  return check;
}

/** Called once per server process from instrumentation.ts: checks now, then every 24 hours. */
export function startUpdateChecker() {
  if (!updateCheckEnabled() || globalForUpdates.orbitUpdateTimer) return;
  void runUpdateCheck();
  const timer = setInterval(() => void runUpdateCheck(), checkIntervalMs);
  timer.unref?.();
  globalForUpdates.orbitUpdateTimer = timer;
}

export async function getUpdateStatus(): Promise<UpdateStatus> {
  const installMethod = normalizeInstallMethod(process.env.INSTALL_METHOD);
  const base = {
    enabled: updateCheckEnabled(),
    currentVersion: appVersion,
    installMethod,
    updateCommand: updateCommand(installMethod),
  };
  const empty = { checkedAt: null, error: null, latest: null, updateAvailable: false, security: false, directUpgrade: true };
  if (!base.enabled) return { ...base, ...empty };

  let check = globalForUpdates.orbitUpdateLast ?? null;
  if (!check) {
    try { check = await loadCheck(); } catch { check = null; }
  }
  if (!check) return { ...base, ...empty };

  const evaluation = check.manifest
    ? evaluateUpdate(appVersion, check.manifest)
    : { updateAvailable: false, security: false, directUpgrade: true };
  return {
    ...base,
    checkedAt: check.checkedAt.toISOString(),
    error: check.error,
    latest: check.manifest,
    ...evaluation,
  };
}
