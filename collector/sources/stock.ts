// Daily closes for NBIS and a few comparables from Yahoo Finance's chart endpoint (unofficial but stable and keyless).
import { fetchJson, sleep } from "../lib/http.ts";
import { readJson, sortKeys, writeJson } from "../lib/store.ts";
import type { SourceResult } from "../lib/types.ts";

/** Comparables for relative performance: the closest listed neocloud, the GPU supplier, a hyperscaler buyer of neocloud capacity, and the semis sector. */
export const PEERS = [
  { ticker: "CRWV", name: "CoreWeave" },
  { ticker: "NVDA", name: "Nvidia" },
  { ticker: "ORCL", name: "Oracle" },
  { ticker: "SMH", name: "Semiconductor ETF" },
] as const;

type Chart = {
  chart: {
    result: { timestamp: number[]; indicators: { quote: { close: (number | null)[]; volume: (number | null)[] }[] } }[] | null;
    error: unknown;
  };
};

/** Yahoo rate-limits erratically per host and user agent; a bare UA plus a host fallback is reliable. */
async function fetchChart(ticker: string): Promise<Chart> {
  let lastErr: unknown;
  for (const host of ["query1", "query2"]) {
    try {
      return await fetchJson<Chart>(`https://${host}.finance.yahoo.com/v8/finance/chart/${ticker}?range=2y&interval=1d`, { ua: "Mozilla/5.0", retries: 3 });
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

async function collectTicker(ticker: string, file: string): Promise<[string, [number, number]] | undefined> {
  const res = await fetchChart(ticker);
  const r = res.chart.result?.[0];
  if (!r) throw new Error(`${ticker}: no chart data: ${JSON.stringify(res.chart.error)}`);
  const q = r.indicators.quote[0]!;
  const prices = await readJson<Record<string, [number, number]>>(file, {});
  r.timestamp.forEach((t, i) => {
    const close = q.close[i];
    if (close == null) return;
    prices[new Date(t * 1000).toISOString().slice(0, 10)] = [Math.round(close * 100) / 100, q.volume[i] ?? 0];
  });
  await writeJson(file, sortKeys(prices));
  return Object.entries(prices).at(-1);
}

export async function collectStock(): Promise<SourceResult> {
  const last = await collectTicker("NBIS", "market/nbis.json");
  // Peers are context, not core: a failed peer doesn't fail the source.
  const failed: string[] = [];
  for (const p of PEERS) {
    await sleep(800);
    try {
      await collectTicker(p.ticker, `market/peers/${p.ticker}.json`);
    } catch {
      failed.push(p.ticker);
    }
  }
  return { summary: `NBIS last ${last?.[0]} $${last?.[1][0]}; ${PEERS.length - failed.length}/${PEERS.length} peers${failed.length ? ` (failed: ${failed.join(", ")})` : ""}`, alerts: [] };
}
