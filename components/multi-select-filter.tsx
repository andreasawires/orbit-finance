"use client";

import { Check, ChevronDown } from "lucide-react";
import { useRef, useState } from "react";
import { useDismiss } from "@/lib/use-dismiss";

export function MultiSelectFilter({ allLabel, pluralLabel, ariaLabel, options, selected, onChange }: {
  allLabel: string;
  /** e.g. "accounts", used for "3 accounts". */
  pluralLabel: string;
  ariaLabel: string;
  options: Array<{ id: string; label: string }>;
  selected: string[];
  onChange: (selected: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, open, setOpen);
  const label = selected.length === 0 ? allLabel : selected.length === 1 ? options.find((option) => option.id === selected[0])?.label ?? `1 ${pluralLabel}` : `${selected.length} ${pluralLabel}`;
  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id]);
  return <div className="account-filter" ref={ref}>
    <button className="filter-select account-filter-trigger" type="button" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((current) => !current)}><span>{label}</span><ChevronDown size={14} /></button>
    {open && <div className="account-filter-menu popover" role="group" aria-label={ariaLabel}>
      <label className="account-filter-option">
        <input type="checkbox" checked={selected.length === 0} onChange={() => onChange([])} />
        <span className="account-filter-check"><Check size={13} /></span>
        <span>{allLabel}</span>
      </label>
      {options.map((option) => <label className="account-filter-option" key={option.id}>
        <input type="checkbox" checked={selected.includes(option.id)} onChange={() => toggle(option.id)} />
        <span className="account-filter-check"><Check size={13} /></span>
        <span>{option.label}</span>
      </label>)}
    </div>}
  </div>;
}
