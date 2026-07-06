/**
 * Currency conversion utility.
 *
 * Reads exchange rates from EXCHANGE_RATES_TO_USD env var.
 * Format: "INR:83.5,EUR:0.92,GBP:0.79"
 * Each value = how many units of that currency equal 1 USD.
 *
 * USD stays 1:1. Unknown currencies also treated as 1:1 (logged as warning).
 *
 * To update rates: change EXCHANGE_RATES_TO_USD in .env and restart the server.
 * No code change needed.
 */

let rateCache: Map<string, number> | null = null;

function getRates(): Map<string, number> {
  if (rateCache) return rateCache;

  const raw = process.env.EXCHANGE_RATES_TO_USD ?? "";
  const map = new Map<string, number>([["USD", 1]]);

  if (raw.trim()) {
    for (const pair of raw.split(",")) {
      const [code, rate] = pair.trim().split(":");
      if (code && rate && !isNaN(Number(rate))) {
        map.set(code.toUpperCase().trim(), Number(rate));
      }
    }
  }

  rateCache = map;
  return map;
}

/**
 * Convert an amount in the given currency to USD.
 * @param amount  Original cost value
 * @param currency  ISO 4217 currency code (e.g. "INR", "EUR", "USD")
 * @returns  Equivalent amount in USD
 */
export function toUsd(amount: number, currency: string): number {
  if (!currency || currency.toUpperCase() === "USD") return amount;

  const rates = getRates();
  const rate = rates.get(currency.toUpperCase());

  if (!rate) {
    console.warn(
      `[Currency] No exchange rate configured for ${currency} — treating as 1:1 USD. ` +
      `Add ${currency}:<rate> to EXCHANGE_RATES_TO_USD in .env to fix this.`
    );
    return amount;
  }

  return amount / rate;
}

/** Invalidate cache (call after env reload in tests) */
export function clearRateCache(): void {
  rateCache = null;
}

/** Returns all configured rates for display purposes */
export function getAllRates(): Record<string, number> {
  return Object.fromEntries(getRates().entries());
}
