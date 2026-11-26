import assert from "node:assert/strict";
import test from "node:test";
import packageJson from "@/package.json";
import {
  compareSemver,
  evaluateUpdate,
  normalizeInstallMethod,
  parseSemver,
  parseUpdateManifest,
  updateCommand,
} from "@/lib/update-check/version";

const manifest = (overrides: Record<string, unknown> = {}) => ({
  version: "1.2.0",
  released_at: "2026-10-26T12:00:00Z",
  notes_url: "https://github.com/andreasawires/orbit-finance/releases/tag/v1.2.0",
  security: false,
  min_upgrade_from: "1.0.0",
  ...overrides,
});

test("package.json carries a valid semantic version", () => {
  assert.ok(parseSemver(packageJson.version), packageJson.version);
});

test("parseSemver accepts semver with optional v prefix and rejects everything else", () => {
  assert.deepEqual(parseSemver("v1.2.3"), { major: 1, minor: 2, patch: 3, prerelease: [] });
  assert.deepEqual(parseSemver("1.2.3-rc.1+build.5"), { major: 1, minor: 2, patch: 3, prerelease: ["rc", "1"] });
  for (const bad of ["", "1", "1.2", "01.2.3", "1.2.3.4", "latest", "1.2.x"]) assert.equal(parseSemver(bad), null, bad);
});

test("compareSemver orders core versions numerically", () => {
  assert.equal(compareSemver("1.0.0", "1.0.0"), 0);
  assert.equal(compareSemver("1.0.10", "1.0.9"), 1);
  assert.equal(compareSemver("1.9.0", "1.10.0"), -1);
  assert.equal(compareSemver("2.0.0", "1.99.99"), 1);
  assert.equal(compareSemver("v1.2.3", "1.2.3"), 0);
});

test("compareSemver follows prerelease precedence", () => {
  const ordered = ["1.0.0-alpha", "1.0.0-alpha.1", "1.0.0-alpha.beta", "1.0.0-beta", "1.0.0-beta.2", "1.0.0-beta.11", "1.0.0-rc.1", "1.0.0"];
  for (let index = 1; index < ordered.length; index += 1) {
    assert.equal(compareSemver(ordered[index - 1], ordered[index]), -1, `${ordered[index - 1]} < ${ordered[index]}`);
    assert.equal(compareSemver(ordered[index], ordered[index - 1]), 1);
  }
  assert.equal(compareSemver("1.0.0+build.1", "1.0.0+build.2"), 0);
  assert.throws(() => compareSemver("nope", "1.0.0"), /Invalid version/);
});

test("parseUpdateManifest normalizes a valid manifest and ignores unknown keys", () => {
  assert.deepEqual(parseUpdateManifest(manifest({ version: "v1.2.0", extra: true, released_at: "2026-10-26T13:00:00+01:00" })), {
    version: "1.2.0",
    released_at: "2026-10-26T12:00:00.000Z",
    notes_url: "https://github.com/andreasawires/orbit-finance/releases/tag/v1.2.0",
    security: false,
    min_upgrade_from: "1.0.0",
  });
  assert.equal(parseUpdateManifest(manifest({ min_upgrade_from: null })).min_upgrade_from, null);
  assert.equal(parseUpdateManifest(manifest({ min_upgrade_from: undefined })).min_upgrade_from, null);
});

test("parseUpdateManifest rejects malformed manifests", () => {
  for (const bad of [
    null,
    "1.2.0",
    manifest({ version: "latest" }),
    manifest({ released_at: "yesterday" }),
    manifest({ notes_url: "http://example.com/notes" }),
    manifest({ notes_url: "javascript:alert(1)" }),
    manifest({ security: "yes" }),
    manifest({ min_upgrade_from: "1.x" }),
  ]) {
    assert.throws(() => parseUpdateManifest(bad), /Invalid update manifest/);
  }
});

test("evaluateUpdate reports newer releases, security flags, and stepping-stone upgrades", () => {
  const current = parseUpdateManifest(manifest());
  assert.deepEqual(evaluateUpdate("1.1.0", current), { updateAvailable: true, security: false, directUpgrade: true });
  assert.deepEqual(evaluateUpdate("1.2.0", current), { updateAvailable: false, security: false, directUpgrade: true });
  assert.deepEqual(evaluateUpdate("1.3.0", current), { updateAvailable: false, security: false, directUpgrade: true });
  assert.deepEqual(evaluateUpdate("0.9.0", current), { updateAvailable: true, security: false, directUpgrade: false });
  const security = parseUpdateManifest(manifest({ security: true }));
  assert.deepEqual(evaluateUpdate("1.1.0", security), { updateAvailable: true, security: true, directUpgrade: true });
  assert.deepEqual(evaluateUpdate("1.2.0", security), { updateAvailable: false, security: false, directUpgrade: true });
  assert.equal(evaluateUpdate("1.2.0-rc.1", current).updateAvailable, true);
});

test("install method selects the update command", () => {
  assert.equal(normalizeInstallMethod("Docker"), "docker");
  assert.equal(normalizeInstallMethod("node"), "node");
  assert.equal(normalizeInstallMethod(undefined), "source");
  assert.equal(normalizeInstallMethod("weird"), "source");
  assert.match(updateCommand("docker"), /install\.sh \| sh -s -- update$/);
  assert.match(updateCommand("source"), /^git pull/);
});
