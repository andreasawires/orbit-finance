import { z } from "zod";

// Pure helpers for the update check. No I/O here so they can be unit tested.

export type Semver = { major: number; minor: number; patch: number; prerelease: string[] };

const semverPattern = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export function parseSemver(value: string): Semver | null {
  const match = semverPattern.exec(value.trim());
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split(".") : [],
  };
}

function compareIdentifiers(a: string, b: string) {
  const aNumeric = /^\d+$/.test(a);
  const bNumeric = /^\d+$/.test(b);
  if (aNumeric && bNumeric) return Math.sign(Number(a) - Number(b));
  if (aNumeric) return -1;
  if (bNumeric) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Returns -1, 0, or 1 following semver 2.0 precedence. Throws on invalid input. */
export function compareSemver(a: string, b: string): -1 | 0 | 1 {
  const left = parseSemver(a);
  const right = parseSemver(b);
  if (!left) throw new Error(`Invalid version: ${a}`);
  if (!right) throw new Error(`Invalid version: ${b}`);
  for (const key of ["major", "minor", "patch"] as const) {
    if (left[key] !== right[key]) return left[key] > right[key] ? 1 : -1;
  }
  // A version without a prerelease tag ranks above the same version with one.
  if (!left.prerelease.length || !right.prerelease.length) {
    if (left.prerelease.length === right.prerelease.length) return 0;
    return left.prerelease.length ? -1 : 1;
  }
  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const l = left.prerelease[index];
    const r = right.prerelease[index];
    if (l === undefined) return -1;
    if (r === undefined) return 1;
    const result = compareIdentifiers(l, r);
    if (result) return result as -1 | 1;
  }
  return 0;
}

const versionString = z.string().trim().refine((value) => parseSemver(value) !== null, "must be a semantic version");

export const updateManifestSchema = z.object({
  version: versionString,
  released_at: z.string().refine((value) => !Number.isNaN(Date.parse(value)), "must be an ISO timestamp"),
  notes_url: z.url({ protocol: /^https$/ }),
  security: z.boolean(),
  min_upgrade_from: versionString.nullable().optional(),
});

export type UpdateManifest = {
  version: string;
  released_at: string;
  notes_url: string;
  security: boolean;
  min_upgrade_from: string | null;
};

/** Validates an untrusted manifest body. Unknown keys are ignored so the format can grow. */
export function parseUpdateManifest(input: unknown): UpdateManifest {
  const result = updateManifestSchema.safeParse(input);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new Error(`Invalid update manifest: ${issue?.path.join(".") || "body"} ${issue?.message ?? "is invalid"}`);
  }
  const { version, released_at, notes_url, security, min_upgrade_from } = result.data;
  return {
    version: version.replace(/^v/, ""),
    released_at: new Date(released_at).toISOString(),
    notes_url,
    security,
    min_upgrade_from: min_upgrade_from ? min_upgrade_from.replace(/^v/, "") : null,
  };
}

export type UpdateEvaluation = {
  updateAvailable: boolean;
  security: boolean;
  /** False when the running version is older than `min_upgrade_from` and needs a stepping-stone upgrade. */
  directUpgrade: boolean;
};

export function evaluateUpdate(currentVersion: string, manifest: UpdateManifest): UpdateEvaluation {
  const updateAvailable = compareSemver(manifest.version, currentVersion) > 0;
  const directUpgrade = !manifest.min_upgrade_from || compareSemver(currentVersion, manifest.min_upgrade_from) >= 0;
  return { updateAvailable, security: updateAvailable && manifest.security, directUpgrade: !updateAvailable || directUpgrade };
}

export type InstallMethod = "docker" | "node" | "source";

export function normalizeInstallMethod(value: string | undefined): InstallMethod {
  const method = (value ?? "").trim().toLowerCase();
  return method === "docker" || method === "node" ? method : "source";
}

export const installerUrl = "https://andreasawires.github.io/orbit-finance/install.sh";

export function updateCommand(method: InstallMethod): string {
  switch (method) {
    case "docker":
    case "node":
      return `curl -fsSL ${installerUrl} | sh -s -- update`;
    default:
      return "git pull && npm ci && npm run build && npm run db:migrate";
  }
}
