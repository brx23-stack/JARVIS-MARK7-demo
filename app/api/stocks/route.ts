import { NextResponse } from "next/server";
import { isLocalOnlyMode } from "@/lib/privacy/policy";
export const runtime = "nodejs";

const TICKER_RE = /^[A-Z0-9][A-Z0-9._-]{0,19}$/;

// Range -> the Yahoo interval that gives sensible candle resolution for it.
// Intraday ranges (1d/5d) get minute-level candles so "today" actually looks
// like a live intraday chart instead of one flat daily bar. Longer ranges
// fall back to daily/weekly candles - Yahoo doesn't keep fine-grained
// intraday history past a few days anyway.
const RANGE_INTERVAL: Record<string, string> = {
  "1d": "5m",
  "5d": "15m",
  "1mo": "1d",
  "3mo": "1d",
  "6mo": "1d",
  "1y": "1wk",
};
const RANGES = Object.keys(RANGE_INTERVAL);

type StockPoint = {
  date: string; // ISO timestamp (minute-precision for intraday, day-precision otherwise)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
};

async function fetchYahooChart(ticker: string, range: string, interval: string) {
  const upstream = await fetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=${range}&interval=${interval}&includePrePost=false`,
    { headers: { "user-agent": "JARVIS-MARK7/1.0" }, cache: "no-store" },
  );
  if (!upstream.ok) throw { status: 502, message: `Market data request failed (${upstream.status}).` };
  const payload = await upstream.json();
  const result = payload?.chart?.result?.[0];
  if (payload?.chart?.error || !result) {
    throw { status: 404, message: payload?.chart?.error?.description || "No market data was returned for this ticker." };
  }
  return result;
}

function toPoints(result: any): StockPoint[] {
  const timestamps: number[] = result?.timestamp || [];
  const quote = result?.indicators?.quote?.[0] || {};
  const opens: Array<number | null> = quote.open || [];
  const highs: Array<number | null> = quote.high || [];
  const lows: Array<number | null> = quote.low || [];
  const closes: Array<number | null> = quote.close || [];
  const volumes: Array<number | null> = quote.volume || [];
  const points: StockPoint[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const o = opens[i], h = highs[i], l = lows[i], c = closes[i];
    if (![o, h, l, c].every((v) => typeof v === "number" && Number.isFinite(v))) continue;
    points.push({
      date: new Date(timestamps[i] * 1000).toISOString(),
      open: Number(o!.toFixed(2)),
      high: Number(h!.toFixed(2)),
      low: Number(l!.toFixed(2)),
      close: Number(c!.toFixed(2)),
      volume: typeof volumes[i] === "number" ? volumes[i] : null,
    });
  }
  return points;
}

export async function GET(request: Request) {
  if (isLocalOnlyMode()) return NextResponse.json({ error: "External market data is disabled by local-only privacy mode." }, { status: 403 });
  const url = new URL(request.url);
  const ticker = (url.searchParams.get("ticker") || "").trim().toUpperCase();
  const range = url.searchParams.get("range") || "1mo";
  const quoteOnly = url.searchParams.get("quote") === "1";

  if (!TICKER_RE.test(ticker)) return NextResponse.json({ error: "Invalid ticker symbol." }, { status: 400 });

  try {
    if (quoteOnly) {
      // Cheap poll for live price updates: smallest useful intraday payload
      // instead of re-pulling the whole visible chart range every few
      // seconds. Callers already holding a chart just want latest/change.
      const result = await fetchYahooChart(ticker, "1d", "5m");
      const meta = result.meta || {};
      const previousClose = typeof meta.chartPreviousClose === "number" ? meta.chartPreviousClose : meta.previousClose;
      const latest = typeof meta.regularMarketPrice === "number" ? meta.regularMarketPrice : previousClose;
      const change = typeof latest === "number" && typeof previousClose === "number" ? latest - previousClose : 0;
      return NextResponse.json({
        ticker,
        latest,
        change,
        changePercent: previousClose ? (change / previousClose) * 100 : 0,
        marketState: meta.marketState || "UNKNOWN",
        currency: meta.currency || "",
        fetchedAt: new Date().toISOString(),
      });
    }

    if (!RANGES.includes(range)) {
      return NextResponse.json({ error: `Unsupported range. Use one of: ${RANGES.join(", ")}.` }, { status: 400 });
    }
    const interval = RANGE_INTERVAL[range];
    const result = await fetchYahooChart(ticker, range, interval);
    const points = toPoints(result);
    if (!points.length) return NextResponse.json({ error: "No market data was returned for this ticker." }, { status: 404 });

    const meta = result.meta || {};
    const previousClose = typeof meta.chartPreviousClose === "number" ? meta.chartPreviousClose : points[0].open;
    // Prefer Yahoo's own live quote for "latest" over the last candle close -
    // the last candle can be a partial/in-progress bar during market hours.
    const latest = typeof meta.regularMarketPrice === "number" ? meta.regularMarketPrice : points[points.length - 1].close;
    const change = latest - previousClose;

    return NextResponse.json({
      ticker,
      name: meta.longName || meta.shortName || ticker,
      currency: meta.currency || "",
      exchange: meta.exchangeName || "",
      range,
      interval,
      points,
      latest,
      previousClose,
      change,
      changePercent: previousClose ? (change / previousClose) * 100 : 0,
      marketState: meta.marketState || "UNKNOWN",
      fetchedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    const status = err?.status && Number.isInteger(err.status) ? err.status : 503;
    return NextResponse.json({ error: err?.message || "Unable to reach market data service." }, { status });
  }
}
