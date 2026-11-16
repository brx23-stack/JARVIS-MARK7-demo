// ——— Currency conversion ———
//
// fawazahmed0/currency-api (github.com/fawazahmed0/currency-api) publishes
// daily exchange rates as static JSON on a CDN — no API key, no rate limit,
// 150+ currencies. It's just a JSON file fetch, not a traditional REST API,
// which is what makes it free with no signup: a primary CDN (jsdelivr) with
// a documented fallback CDN if the primary is ever down.

const REQUEST_TIMEOUT_MS = 8_000;

const PRIMARY_BASE = "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies";
const FALLBACK_BASE = "https://latest.currency-api.pages.dev/v1/currencies";

async function fetchRates(fromCurrency: string): Promise<Record<string, number>> {
  const code = fromCurrency.trim().toLowerCase();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    let res = await fetch(`${PRIMARY_BASE}/${code}.json`, { signal: controller.signal });
    if (!res.ok) {
      res = await fetch(`${FALLBACK_BASE}/${code}.json`, { signal: controller.signal });
    }
    if (!res.ok) throw new Error(`Currency data unavailable for "${fromCurrency.toUpperCase()}" (${res.status}).`);
    const data = await res.json();
    const rates = data?.[code];
    if (!rates) throw new Error(`Unrecognized currency code "${fromCurrency.toUpperCase()}".`);
    return rates;
  } finally {
    clearTimeout(timeout);
  }
}

export type ConversionResult = {
  amount: number;
  from: string;
  to: string;
  rate: number;
  converted: number;
};

/** Converts `amount` of `from` currency into `to` currency using today's published rate. Currency codes are ISO 4217, e.g. "usd", "eur", "jpy". */
export async function convertCurrency(amount: number, from: string, to: string): Promise<ConversionResult> {
  const toCode = to.trim().toLowerCase();
  const rates = await fetchRates(from);
  const rate = rates[toCode];
  if (rate === undefined) throw new Error(`Unrecognized currency code "${to.toUpperCase()}".`);
  return {
    amount,
    from: from.trim().toUpperCase(),
    to: to.trim().toUpperCase(),
    rate,
    converted: amount * rate,
  };
}

export function formatConversion(result: ConversionResult): string {
  return `${result.amount} ${result.from} is ${result.converted.toFixed(2)} ${result.to} (rate: 1 ${result.from} = ${result.rate.toFixed(4)} ${result.to}).`;
}
