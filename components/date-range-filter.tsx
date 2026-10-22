"use client";

import { CalendarDays, Check, ChevronDown } from "lucide-react";
import { useRef, useState } from "react";
import { DATE_RANGE_LABELS, DATE_RANGE_PRESETS, formatDateRange, resolveDateRange, type DateRange, type DateRangeSelection } from "@/lib/date-range";
import { useDismiss } from "@/lib/use-dismiss";

const presets = DATE_RANGE_PRESETS.filter((preset) => preset !== "custom");

// Display only: the server resolves the same selection in the workspace timezone for the actual query.
function safeResolve(value: DateRangeSelection, timeZone: string): DateRange | null {
  try { return resolveDateRange(value, timeZone); } catch { return null; }
}

export function DateRangeFilter({ value, onChange, timeZone, locale }: { value: DateRangeSelection; onChange: (value: DateRangeSelection) => void; timeZone: string; locale: string }) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState<DateRange>({ from: "", to: "" });
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, open, setOpen);
  const range = safeResolve(value, timeZone);
  const customValid = !!custom.from && !!custom.to && custom.from <= custom.to;

  function toggle() {
    // Each time it opens, the custom fields start from the range currently shown.
    if (!open) setCustom(range ?? { from: "", to: "" });
    setOpen(!open);
  }

  function choose(next: DateRangeSelection) {
    onChange(next);
    setOpen(false);
  }

  return <div className="date-range-filter" ref={ref}>
    <button type="button" className="filter-select date-range-trigger" aria-haspopup="dialog" aria-expanded={open} onClick={toggle}>
      <CalendarDays size={16} />
      <span><strong>{DATE_RANGE_LABELS[value.preset]}</strong>{range && <small>{formatDateRange(range, locale)}</small>}</span>
      <ChevronDown size={14} />
    </button>
    {open && <div className="date-range-menu popover" role="dialog" aria-label="Choose a date range">
      <div className="date-range-presets">
        {presets.map((preset) => <button type="button" key={preset} className={`date-range-option ${value.preset === preset ? "active" : ""}`} onClick={() => choose({ preset })}>
          <span>{DATE_RANGE_LABELS[preset]}</span>{value.preset === preset && <Check size={14} />}
        </button>)}
      </div>
      <form className="date-range-custom" onSubmit={(event) => { event.preventDefault(); if (customValid) choose({ preset: "custom", ...custom }); }}>
        <strong>{DATE_RANGE_LABELS.custom}</strong>
        <label>From<input type="date" value={custom.from} max={custom.to || undefined} onChange={(event) => setCustom((current) => ({ ...current, from: event.target.value }))} required /></label>
        <label>To<input type="date" value={custom.to} min={custom.from || undefined} onChange={(event) => setCustom((current) => ({ ...current, to: event.target.value }))} required /></label>
        <button type="submit" className="button primary" disabled={!customValid}>Apply</button>
      </form>
    </div>}
  </div>;
}
