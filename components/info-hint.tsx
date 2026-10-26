import { Info } from "lucide-react";

// A small "i" that explains a figure on hover or keyboard focus. The tooltip is pure CSS (see .info-hint) so it shows instantly.
export function InfoHint({ text }: { text: string }) {
  return <span className="info-hint" tabIndex={0} role="img" aria-label={text} data-tip={text}><Info size={13} /></span>;
}
