// Whole-market OpenRouter context (total weekly tokens across ~96 providers, back to March 2026),
// from jimmyresearch.com's public CSV. Needed for Nebius's share and rank, which a single provider
// page can't give us.
import { fetchText } from "../lib/http.ts";
import { readJson, sortKeys, writeJson } from "../lib/store.ts";
import type { SourceResult } from "../lib/types.ts";

const CSV_URL = "https://jimmyresearch.com/openrouter/provider_token_history.csv";
/** Providers kept by name in the history; everything else is folded into the total only. */
const KEEP = ["Nebius", "Together", "Fireworks", "DeepInfra", "BaseTen", "Novita", "Parasail", "Groq", "Cerebras", "SiliconFlow", "Crusoe", "CoreWeave"];

export type MarketWeek = { total: number; providers: number; nebiusRank: number | null; tokens: Record<string, number> };

export async function collectOpenRouterMarket(): Promise<SourceResult> {
  const csv = await fetchText(CSV_URL);
  const lines = csv.trim().split("\n");
  if (lines[0]?.trim() !== "date,provider,weekly_tokens,weekly_tokens_num") throw new Error(`unexpected CSV header: ${lines[0]}`);

  const byDate = new Map<string, Map<string, number>>();
  for (const line of lines.slice(1)) {
    const [date, provider, , num] = line.split(",");
    if (!date || !provider || !num) continue;
    const m = byDate.get(date) ?? new Map<string, number>();
    m.set(provider, Number(num));
    byDate.set(date, m);
  }

  const prev = await readJson<Record<string, MarketWeek>>("openrouter/market-weekly.json", {});
  const out: Record<string, MarketWeek> = { ...prev };
  for (const [date, m] of byDate) {
    const ranked = [...m.entries()].sort((a, b) => b[1] - a[1]);
    const rank = ranked.findIndex(([p]) => p === "Nebius");
    out[date] = {
      total: ranked.reduce((a, [, v]) => a + v, 0),
      providers: ranked.length,
      nebiusRank: rank === -1 ? null : rank + 1,
      tokens: Object.fromEntries(KEEP.filter((p) => m.has(p)).map((p) => [p, m.get(p)!])),
    };
  }
  await writeJson("openrouter/market-weekly.json", sortKeys(out));

  const last = [...byDate.keys()].sort().at(-1)!;
  const w = out[last]!;
  return {
    summary: `${byDate.size} snapshots to ${last}; Nebius rank ${w.nebiusRank} of ${w.providers}`,
    alerts: [],
  };
}
