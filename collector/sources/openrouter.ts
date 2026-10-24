// Per-provider, per-model daily token counts from OpenRouter's public /provider/<slug> pages.
// Each page embeds ~90 days of its "Tokens processed" chart; we merge it into a growing history.
import { fetchJson, fetchText, sleep } from "../lib/http.ts";
import { enclosingObject, objectsStartingWith, rscPayload } from "../lib/nextjs.ts";
import { readJson, sortKeys, today, writeJson } from "../lib/store.ts";
import type { Alert, SourceResult } from "../lib/types.ts";

export const NEBIUS = "nebius";
/** Open-model inference hosts that compete with Token Factory for the same OpenRouter traffic. */
export const PEERS = ["together", "fireworks", "deepinfra", "baseten", "novita", "parasail", "groq", "cerebras", "siliconflow", "crusoe", "coreweave"];

export type ProviderHistory = { provider: string; updatedAt: string; days: Record<string, Record<string, number>> };
export type ModelPrice = { name: string; input: number; output: number; cacheRead: number | null; firstSeen: string; lastSeen: string };

type Endpoint = {
  name?: string;
  model_variant_slug?: string;
  model_variant_permaslug?: string;
  pricing?: { prompt?: string; completion?: string; input_cache_read?: string };
};

const perMillion = (v: string | undefined) => (v === undefined ? null : Math.round(Number(v) * 1e6 * 1e6) / 1e6);

function parseDays(payload: string): Record<string, Record<string, number>> {
  const days: Record<string, Record<string, number>> = {};
  // The first chart on the page is "Tokens processed"; keep the first value seen per date.
  for (const pt of objectsStartingWith<{ x: string; ys: Record<string, number> }>(payload, '{"x":"')) {
    const date = pt.x?.slice(0, 10);
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date) && pt.ys && !days[date]) days[date] = pt.ys;
  }
  return days;
}

function parseEndpoints(payload: string): Endpoint[] {
  const out = new Map<string, Endpoint>();
  const key = '"model_variant_slug"';
  for (let i = payload.indexOf(key); i !== -1; i = payload.indexOf(key, i + key.length)) {
    const ep = enclosingObject<Endpoint>(payload, i);
    if (ep?.model_variant_permaslug && ep.pricing) out.set(ep.model_variant_permaslug, ep);
  }
  return [...out.values()];
}

async function scrapeProvider(slug: string) {
  const payload = rscPayload(await fetchText(`https://openrouter.ai/provider/${slug}`));
  return { days: parseDays(payload), endpoints: slug === NEBIUS ? parseEndpoints(payload) : [] };
}

/** Sum of tokens over the 7 UTC days ending on (and including) `end`. */
export function weekTotal(days: ProviderHistory["days"], end: string): number {
  let total = 0;
  const d = new Date(end + "T00:00:00Z");
  for (let k = 0; k < 7; k++) {
    const key = d.toISOString().slice(0, 10);
    total += Object.values(days[key] ?? {}).reduce((a, b) => a + b, 0);
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return total;
}

export async function collectOpenRouter(): Promise<SourceResult> {
  const alerts: Alert[] = [];
  const date = today();
  const failures: string[] = [];
  let nebiusDays = 0;

  for (const slug of [NEBIUS, ...PEERS]) {
    try {
      const { days, endpoints } = await scrapeProvider(slug);
      if (Object.keys(days).length < 7) throw new Error(`only ${Object.keys(days).length} days parsed`);
      const file = `openrouter/providers/${slug}.json`;
      const prev = await readJson<ProviderHistory>(file, { provider: slug, updatedAt: "", days: {} });
      const merged = sortKeys({ ...prev.days, ...days });
      await writeJson(file, { provider: slug, updatedAt: new Date().toISOString(), days: merged });

      if (slug === NEBIUS) {
        nebiusDays = Object.keys(merged).length;
        alerts.push(...(await updateNebiusModels(endpoints, prev.days, days, date)));
        alerts.push(...weekOverWeek(merged, date));
      }
    } catch (err) {
      if (slug === NEBIUS) throw err; // the headline source must not fail silently
      failures.push(`${slug}: ${(err as Error).message}`);
    }
    await sleep(1500); // be gentle: one page per provider per day
  }

  try {
    await updateCatalogPrices();
  } catch (err) {
    failures.push(`catalog: ${(err as Error).message}`);
  }

  const peersOk = PEERS.length - failures.filter((f) => !f.startsWith("catalog")).length;
  return {
    summary: `Nebius ${nebiusDays} days of history; ${peersOk}/${PEERS.length} peers` + (failures.length ? ` (failed: ${failures.join("; ")})` : ""),
    alerts,
  };
}

async function updateNebiusModels(
  endpoints: Endpoint[],
  prevDays: ProviderHistory["days"],
  newDays: ProviderHistory["days"],
  date: string,
): Promise<Alert[]> {
  const alerts: Alert[] = [];
  const file = "openrouter/nebius-models.json";
  const models = await readJson<Record<string, ModelPrice>>(file, {});
  const bootstrap = Object.keys(models).length === 0;

  for (const ep of endpoints) {
    const id = ep.model_variant_permaslug!;
    const input = perMillion(ep.pricing?.prompt) ?? 0;
    const output = perMillion(ep.pricing?.completion) ?? 0;
    const cacheRead = perMillion(ep.pricing?.input_cache_read);
    // The variant slug ("deepseek/deepseek-v4.1-flash-1017") tells re-dated variants apart; the display name doesn't.
    const name = ep.model_variant_slug ?? id;
    const prev = models[id];
    if (prev && (prev.input !== input || prev.output !== output)) {
      alerts.push({
        id: `or-price-${id}-${date}`,
        date,
        source: "openrouter",
        severity: "medium",
        title: `Token Factory price change: ${name}`,
        detail: `Input $${prev.input} → $${input}/M, output $${prev.output} → $${output}/M`,
        url: "https://openrouter.ai/provider/nebius",
      });
    }
    models[id] = { name, input, output, cacheRead, firstSeen: prev?.firstSeen ?? date, lastSeen: date };
  }
  await writeJson(file, sortKeys(models));

  // A model that shows up in the token chart for the first time = new launch on Nebius.
  if (!bootstrap) {
    const seen = new Set(Object.values(prevDays).flatMap((d) => Object.keys(d)));
    const fresh = [...new Set(Object.values(newDays).flatMap((d) => Object.keys(d)))].filter((m) => !seen.has(m) && m !== "Others");
    for (const m of fresh) {
      alerts.push({
        id: `or-newmodel-${m}`,
        date,
        source: "openrouter",
        severity: "info",
        title: `New model in Nebius's OpenRouter top 10: ${m}`,
        url: "https://openrouter.ai/provider/nebius",
      });
    }
  }
  return alerts;
}

/**
 * Catalog prices from OpenRouter's public models API, keyed by canonical slug (the same dated
 * permaslug the token chart uses). Fallback for chart models whose Nebius endpoint is no longer listed.
 */
async function updateCatalogPrices(): Promise<void> {
  type ApiModel = { id: string; canonical_slug?: string; name: string; pricing: { prompt?: string; completion?: string; input_cache_read?: string } };
  const { data } = await fetchJson<{ data: ApiModel[] }>("https://openrouter.ai/api/v1/models");
  const out: Record<string, Omit<ModelPrice, "firstSeen" | "lastSeen">> = {};
  // Variants (":free", ":batch") share a canonical slug; the plain id carries the standard price.
  for (const m of [...data].sort((a, b) => Number(a.id.includes(":")) - Number(b.id.includes(":")))) {
    const key = m.canonical_slug ?? m.id;
    if (out[key]) continue;
    out[key] = { name: m.id, input: perMillion(m.pricing.prompt) ?? 0, output: perMillion(m.pricing.completion) ?? 0, cacheRead: perMillion(m.pricing.input_cache_read) };
  }
  await writeJson("openrouter/catalog-prices.json", sortKeys(out));
}

function weekOverWeek(days: ProviderHistory["days"], date: string): Alert[] {
  // Use complete days only: the current UTC day is partial.
  const end = new Date(date + "T00:00:00Z");
  end.setUTCDate(end.getUTCDate() - 1);
  const endKey = end.toISOString().slice(0, 10);
  const prior = new Date(end);
  prior.setUTCDate(prior.getUTCDate() - 7);
  const cur = weekTotal(days, endKey);
  const prev = weekTotal(days, prior.toISOString().slice(0, 10));
  if (!prev || !cur) return [];
  const change = cur / prev - 1;
  if (Math.abs(change) < 0.4) return [];
  return [
    {
      id: `or-wow-${endKey}`,
      date,
      source: "openrouter",
      severity: "medium",
      title: `Nebius OpenRouter tokens ${change > 0 ? "up" : "down"} ${Math.round(Math.abs(change) * 100)}% week over week`,
      detail: `${(cur / 1e9).toFixed(1)}B tokens in the 7 days to ${endKey} vs ${(prev / 1e9).toFixed(1)}B the week before`,
      url: "https://openrouter.ai/provider/nebius",
    },
  ];
}
