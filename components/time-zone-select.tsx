"use client";

import { useEffect, useState } from "react";
import { groupedTimeZones, type TimeZoneOption } from "@/lib/time";

/** IANA timezone picker grouped by region. The list is built after mount so server and browser markup match. */
export function TimeZoneSelect({ value, onChange, className, disabled, name, id }: {
  value: string; onChange: (value: string) => void; className?: string; disabled?: boolean; name?: string; id?: string;
}) {
  const [groups, setGroups] = useState<Array<[string, TimeZoneOption[]]> | null>(null);
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setGroups(groupedTimeZones(value)));
    return () => window.cancelAnimationFrame(frame);
  }, [value]);
  return <select className={className} value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} name={name} id={id}>
    {groups
      ? groups.map(([region, options]) => <optgroup key={region} label={region}>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</optgroup>)
      : <option value={value}>{value}</option>}
  </select>;
}
