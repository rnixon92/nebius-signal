// Nebius's own public model catalog: every Token Factory model, with region and list price.
// OpenRouter only shows the subset it routes, so this is the full product list.
import { fetchJson } from "../lib/http.ts";
import { readJson, sortKeys, today, writeJson } from "../lib/store.ts";
import type { Alert, SourceResult } from "../lib/types.ts";

const URL = "https://tokenfactory.nebius.com/api/public/models_info";
const PAGE = "https://tokenfactory.nebius.com/model-catalog.md";

export type CatalogModel = {
  id: string;
  name: string;
  vendor: string;
  type: string;
  regions: string[];
  contextK: number;
  input: number;
  /** Null for embeddings and models with no cached-input price. */
  output: number | null;
  cacheRead: number | null;
  quantization: string | null;
  tokensPerSecond: number | null;
  firstSeen: string;
  lastSeen: string;
};

export type CatalogFile = { updatedAt: string; models: Record<string, CatalogModel> };

type Flavor = {
  model_id?: string;
  label?: string;
  regions?: { name?: string }[];
  context_window_k?: number;
  input_price_per_million_tokens?: number;
  input_cached_price_per_million_tokens?: number | null;
  output_price_per_million_tokens?: number | null;
  quantization?: string | null;
  tokens_per_second?: number | null;
};

type ApiModel = { name?: string; vendor?: string; type?: string; flavors?: Flavor[] };

const money = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 1e6) / 1e6 : null);
const usd = (n: number | null) => (n == null ? "none" : `$${n}/M`);

export function parseCatalog(raw: ApiModel[], date: string, prev: Record<string, CatalogModel>): Record<string, CatalogModel> {
  const out: Record<string, CatalogModel> = {};
  for (const model of raw) {
    const flavor = model.flavors?.[0];
    const id = flavor?.model_id;
    const input = money(flavor?.input_price_per_million_tokens);
    if (!id || input == null) continue;
    const type = model.type ?? "text2text";
    const output = type === "embedding" ? null : money(flavor?.output_price_per_million_tokens);
    const tps = money(flavor?.tokens_per_second);
    out[id] = {
      id,
      name: model.name || id,
      vendor: model.vendor ?? "",
      type,
      regions: [...new Set((flavor?.regions ?? []).map((r) => r.name).filter((n): n is string => !!n))].sort(),
      contextK: flavor?.context_window_k ?? 0,
      input,
      output,
      cacheRead: money(flavor?.input_cached_price_per_million_tokens),
      quantization: flavor?.quantization || null,
      tokensPerSecond: tps && tps > 0 ? tps : null,
      firstSeen: prev[id]?.firstSeen ?? date,
      lastSeen: date,
    };
  }
  return sortKeys(out);
}

function priceAlert(prev: CatalogModel, cur: CatalogModel, date: string): Alert | null {
  const bits: string[] = [];
  if (prev.input !== cur.input) bits.push(`input ${usd(prev.input)} → ${usd(cur.input)}`);
  if (prev.cacheRead !== cur.cacheRead) bits.push(`cached input ${usd(prev.cacheRead)} → ${usd(cur.cacheRead)}`);
  if (prev.output !== cur.output) bits.push(`output ${usd(prev.output)} → ${usd(cur.output)}`);
  if (!bits.length) return null;
  return {
    id: `tf-price-${cur.id}-${date}`,
    date,
    source: "tokenfactory",
    severity: "medium",
    title: `Token Factory price change: ${cur.name}`,
    detail: bits.join("; "),
    url: PAGE,
  };
}

export async function collectTokenFactory(): Promise<SourceResult> {
  const date = today();
  const raw = await fetchJson<ApiModel[]>(URL);
  if (!Array.isArray(raw) || raw.length < 10) throw new Error(`catalog returned ${Array.isArray(raw) ? raw.length : "no"} models`);

  const prev = await readJson<CatalogFile>("tokenfactory/catalog.json", { updatedAt: "", models: {} });
  const bootstrap = !prev.updatedAt;
  const models = parseCatalog(raw, date, prev.models);
  if (Object.keys(models).length < 10) throw new Error(`parsed ${Object.keys(models).length} models`);

  const alerts: Alert[] = [];
  if (!bootstrap) {
    for (const cur of Object.values(models)) {
      const old = prev.models[cur.id];
      if (!old) {
        alerts.push({
          id: `tf-new-${cur.id}`,
          date,
          source: "tokenfactory",
          severity: "info",
          title: `Token Factory listed ${cur.name}`,
          detail: `${cur.regions.join(", ") || "no region"} · input ${usd(cur.input)}, cached ${usd(cur.cacheRead)}, output ${usd(cur.output)}`,
          url: PAGE,
        });
        continue;
      }
      const price = priceAlert(old, cur, date);
      if (price) alerts.push(price);
      else if (old.regions.join() !== cur.regions.join()) {
        alerts.push({
          id: `tf-region-${cur.id}-${date}`,
          date,
          source: "tokenfactory",
          severity: "info",
          title: `Token Factory region change: ${cur.name}`,
          detail: `${old.regions.join(", ") || "none"} → ${cur.regions.join(", ") || "none"}`,
          url: PAGE,
        });
      }
    }
    for (const old of Object.values(prev.models)) {
      if (models[old.id]) continue;
      alerts.push({
        id: `tf-gone-${old.id}`,
        date,
        source: "tokenfactory",
        severity: "medium",
        title: `Token Factory removed ${old.name}`,
        url: PAGE,
      });
    }
  }

  await writeJson("tokenfactory/catalog.json", { updatedAt: new Date().toISOString(), models });
  const cached = Object.values(models).filter((m) => m.cacheRead != null).length;
  return { summary: `${Object.keys(models).length} models, ${cached} with a cached-input price`, alerts };
}
