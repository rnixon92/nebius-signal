// NBIS daily closes from Yahoo Finance's chart endpoint (unofficial but stable and keyless).
import { fetchJson } from "../lib/http.ts";
import { readJson, sortKeys, writeJson } from "../lib/store.ts";
import type { SourceResult } from "../lib/types.ts";

type Chart = {
  chart: {
    result: { timestamp: number[]; indicators: { quote: { close: (number | null)[]; volume: (number | null)[] }[] } }[] | null;
    error: unknown;
  };
};

/** Yahoo rate-limits erratically per host and user agent; a bare UA plus a host fallback is reliable. */
async function fetchChart(): Promise<Chart> {
  let lastErr: unknown;
  for (const host of ["query1", "query2"]) {
    try {
      return await fetchJson<Chart>(`https://${host}.finance.yahoo.com/v8/finance/chart/NBIS?range=2y&interval=1d`, { ua: "Mozilla/5.0", retries: 3 });
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

export async function collectStock(): Promise<SourceResult> {
  const res = await fetchChart();
  const r = res.chart.result?.[0];
  if (!r) throw new Error(`no chart data: ${JSON.stringify(res.chart.error)}`);
  const q = r.indicators.quote[0]!;
  const prices = await readJson<Record<string, [number, number]>>("market/nbis.json", {});
  r.timestamp.forEach((t, i) => {
    const close = q.close[i];
    if (close == null) return;
    prices[new Date(t * 1000).toISOString().slice(0, 10)] = [Math.round(close * 100) / 100, q.volume[i] ?? 0];
  });
  await writeJson("market/nbis.json", sortKeys(prices));
  const last = Object.entries(prices).at(-1)!;
  return { summary: `${Object.keys(prices).length} closes, last ${last[0]} $${last[1][0]}`, alerts: [] };
}
