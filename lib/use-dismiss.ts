"use client";

import { useEffect, type RefObject } from "react";

/** Closes a popover when the pointer goes down outside `ref` or Escape is pressed. */
export function useDismiss(ref: RefObject<HTMLElement | null>, open: boolean, setOpen: (open: boolean) => void) {
  useEffect(() => {
    if (!open) return;
    const closeWhenClickingAway = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeWhenClickingAway);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeWhenClickingAway);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open, ref, setOpen]);
}
