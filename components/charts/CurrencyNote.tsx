import { Info } from "lucide-react";

export function CurrencyNote() {
  return (
    <span
      className="inline-flex items-center gap-1 text-[11px] text-gray-400 bg-gray-50 border border-gray-200 rounded px-2 py-0.5"
      title="Costs from all tenants are normalized to USD using exchange rates configured in EXCHANGE_RATES_TO_USD. Original currency amounts are preserved in exports."
    >
      <Info className="h-3 w-3" />
      All figures in USD (normalized)
    </span>
  );
}
