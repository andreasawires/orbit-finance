"use client";

import { AlertTriangle, Trash2 } from "lucide-react";
import { useState } from "react";
import { Modal } from "@/components/modal";

/** Destructive confirmation: the delete button only enables once `confirmText` is typed exactly. */
export function ConfirmDeleteDialog({ open, onClose, title, confirmText, impact, action = "Delete permanently", onConfirm }: {
  open: boolean; onClose: () => void; title: string; confirmText: string; impact: React.ReactNode; action?: string; onConfirm: (typed: string) => Promise<unknown> | unknown;
}) {
  const [typed, setTyped] = useState("");
  const matches = typed.trim() === confirmText.trim() && confirmText.trim() !== "";
  function close() { setTyped(""); onClose(); }
  return <Modal open={open} onClose={close} title={title} subtitle="This cannot be undone." action={<><Trash2 size={16} />{action}</>} danger submitDisabled={!matches} savingLabel="Deleting…" onSubmit={async () => { if (matches) await onConfirm(confirmText); }}>
    <div className="confirm-delete">
      <div className="confirm-delete-warning"><AlertTriangle size={18} /><div>{impact}</div></div>
      <label className="full">
        <span>Type <strong className="confirm-delete-name">{confirmText}</strong> to confirm</span>
        <input value={typed} onChange={(event) => setTyped(event.target.value)} autoFocus autoComplete="off" spellCheck={false} aria-invalid={typed !== "" && !matches} />
      </label>
    </div>
  </Modal>;
}
