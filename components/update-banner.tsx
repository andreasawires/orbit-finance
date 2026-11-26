"use client";

import { ArrowUpCircle, Check, Copy, ShieldAlert, X } from "lucide-react";
import { useEffect, useState } from "react";

type UpdateStatus = {
  enabled: boolean;
  currentVersion: string;
  installMethod: "docker" | "node" | "source";
  updateCommand: string;
  latest: { version: string; notes_url: string; security: boolean; min_upgrade_from: string | null } | null;
  updateAvailable: boolean;
  security: boolean;
  directUpgrade: boolean;
};

const dismissKey = "orbit-update-dismissed";

/** Shows a dismissible notice when the server's cached update check found a newer release. */
export function UpdateBanner() {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/update-status", { signal: controller.signal, cache: "no-store" })
      .then((response) => (response.ok ? response.json() as Promise<UpdateStatus> : null))
      .then((next) => {
        if (!next?.enabled || !next.updateAvailable || !next.latest) return;
        let dismissed: string | null = null;
        try { dismissed = localStorage.getItem(dismissKey); } catch { /* storage unavailable */ }
        if (dismissed !== next.latest.version) setStatus(next);
      })
      .catch(() => { /* the banner is optional; stay silent */ });
    return () => controller.abort();
  }, []);

  if (!status?.latest) return null;
  const { latest } = status;

  const dismiss = () => {
    try { localStorage.setItem(dismissKey, latest.version); } catch { /* storage unavailable */ }
    setStatus(null);
  };
  const copy = () => {
    void navigator.clipboard?.writeText(status.updateCommand).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className={`update-banner ${status.security ? "security" : ""}`} role={status.security ? "alert" : "status"}>
      {status.security ? <ShieldAlert size={18} /> : <ArrowUpCircle size={18} />}
      <div className="update-banner-copy">
        <strong>
          {status.security ? `Security update: v${latest.version} available` : `v${latest.version} available`}
          <small> · you are on v{status.currentVersion}</small>
        </strong>
        {!status.directUpgrade && latest.min_upgrade_from && (
          <span>Upgrade to v{latest.min_upgrade_from} first; this release cannot be applied directly from your version.</span>
        )}
        <span className="update-banner-command">
          <code>{status.updateCommand}</code>
          <button type="button" onClick={copy} aria-label="Copy update command" title="Copy">{copied ? <Check size={14} /> : <Copy size={14} />}</button>
        </span>
      </div>
      <a href={latest.notes_url} target="_blank" rel="noreferrer noopener" className="text-button">Release notes</a>
      <button type="button" className="icon-button" onClick={dismiss} aria-label="Dismiss update notice" title="Dismiss"><X size={16} /></button>
    </div>
  );
}
