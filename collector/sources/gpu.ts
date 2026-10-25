// Nebius GPU pricing: the published on-demand rate card (nebius.com/prices) and live spot prices from
// Nebius's public, unauthenticated billing API. The API only serves 30 days of history, so storing it
// daily builds a series nobody else keeps.
import { fetchJson, fetchText } from "../lib/http.ts";
import { readJson, sortKeys, today, writeJson } from "../lib/store.ts";
import type { Alert, SourceResult } from "../lib/types.ts";

const API = "https://api.nebius.cloud/billing/v1alpha1/spot-price";

/** GPU family key shared by the rate card and the spot API, e.g. "B300". */
export function gpuFamily(text: string): string | null {
  const t = text.toLowerCase().replace(/[\s_-]/g, "");
  for (const [re, fam] of [
    [/gb300/, "GB300"],
    [/gb200/, "GB200"],
    [/b300/, "B300"],
    [/b200/, "B200"],
    [/h200/, "H200"],
    [/h100/, "H100"],
    [/rtx(pro)?6000/, "RTX PRO 6000"],
    [/l40s/, "L40S"],
  ] as const) {
    if (re.test(t)) return fam;
  }
  return null;
}

// ---------------------------------------------------------------- on-demand rate card

export type OnDemandRow = { name: string; family: string; onDemand: number | null; onDemandFrom: boolean; preemptibleFrom: number | null };
export type OnDemandFile = {
  lastChecked: string;
  current: Record<string, OnDemandRow>;
  changes: { date: string; name: string; from: number | null; to: number | null; source?: string }[];
};

const money = (s: string) => {
  const m = s.replace(/,/g, "").match(/\$([\d.]+)/);
  return m ? Number(m[1]) : null;
};

export function parseRateCard(html: string): OnDemandRow[] {
  const text = html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, "")
    .replace(/<[^>]+>/g, "\n")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ");
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const start = lines.findIndex((l) => /^On-demand, GPU-hour/i.test(l));
  if (start === -1) throw new Error("GPU price table header not found");
  const rows: OnDemandRow[] = [];
  // Rows are 5 cells: name, vCPUs, RAM, preemptible, on-demand. The table ends at the footnotes.
  for (let i = start + 1; i + 4 < lines.length && !lines[i]!.startsWith("*"); i += 5) {
    const [name, , , pre, od] = lines.slice(i, i + 5) as [string, string, string, string, string];
    const family = gpuFamily(name);
    if (!family) break;
    rows.push({ name, family, onDemand: money(od), onDemandFrom: /from/i.test(od), preemptibleFrom: money(pre) });
  }
  if (rows.length < 4) throw new Error(`parsed only ${rows.length} GPU rows`);
  return rows;
}

export async function collectOnDemand(): Promise<SourceResult> {
  const date = today();
  const rows = parseRateCard(await fetchText("https://nebius.com/prices"));
  const file = await readJson<OnDemandFile>("gpu/ondemand.json", { lastChecked: "", current: {}, changes: [] });
  const alerts: Alert[] = [];
  const current: Record<string, OnDemandRow> = {};

  for (const row of rows) {
    current[row.name] = row;
    const prev = file.current[row.name];
    if (prev && prev.onDemand !== row.onDemand) {
      file.changes.push({ date, name: row.name, from: prev.onDemand, to: row.onDemand });
      const pct = prev.onDemand && row.onDemand ? ` (${row.onDemand > prev.onDemand ? "+" : ""}${Math.round((row.onDemand / prev.onDemand - 1) * 100)}%)` : "";
      alerts.push({
        id: `od-${row.name}-${date}`,
        date,
        source: "gpu-ondemand",
        severity: "high",
        title: `On-demand price change: ${row.name}${pct}`,
        detail: `${prev.onDemand === null ? "Contact us" : `$${prev.onDemand}`} → ${row.onDemand === null ? "Contact us" : `$${row.onDemand}`} per GPU-hour`,
        url: "https://nebius.com/prices",
      });
    }
  }
  for (const name of Object.keys(file.current)) {
    if (!current[name]) {
      alerts.push({ id: `od-removed-${name}-${date}`, date, source: "gpu-ondemand", severity: "medium", title: `GPU removed from the rate card: ${name}`, url: "https://nebius.com/prices" });
    }
  }
  await writeJson("gpu/ondemand.json", { lastChecked: date, current, changes: file.changes });
  const priced = rows.filter((r) => r.onDemand !== null).length;
  return { summary: `${rows.length} GPU rows (${priced} with list prices)`, alerts };
}

// ---------------------------------------------------------------- spot prices

type SpotItem = {
  skuId: string;
  productTitle: string;
  region: string;
  computeInstance: { platform: string };
  price: { value: string; currency: string };
  effectiveTime: string;
};
type SeriesItem = Omit<SpotItem, "price" | "effectiveTime"> & { points: { timestamp: string; value: string }[] };

export type Sku = { region: string; platform: string; family: string | null; title: string; firstSeen: string; lastSeen: string };
/**
 * Spot became a market price on this day (capped one cent below on-demand). Before it, the "spot" feed was a
 * fixed preemptible rate, so earlier days say nothing about spare capacity. The day itself is mixed.
 */
export const SPOT_DYNAMIC_FROM = "2026-10-08";
/** Nebius removes the on-demand cap from this day, so spot can trade above list. */
export const SPOT_UNCAPPED_FROM = "2026-11-02";

/** Per SKU per day: [min, mean, max, last] of the hourly averages. */
export type SpotDaily = Record<string, Record<string, [number, number, number, number]>>;

async function listAll<T>(url: string, params: Record<string, string>): Promise<{ items: T[]; snapshotTime?: string }> {
  const items: T[] = [];
  let pageToken = "";
  let snapshotTime: string | undefined;
  for (let page = 0; page < 20; page++) {
    const q = new URLSearchParams({ ...params, pageSize: "100", ...(pageToken ? { pageToken } : {}) });
    const res = await fetchJson<{ items?: T[]; nextPageToken?: string; snapshotTime?: string }>(`${url}?${q}`);
    items.push(...(res.items ?? []));
    snapshotTime ??= res.snapshotTime;
    if (!res.nextPageToken) break;
    pageToken = res.nextPageToken;
  }
  return { items, snapshotTime };
}

export async function collectSpot(): Promise<SourceResult> {
  const date = today();
  const alerts: Alert[] = [];
  const { items: current, snapshotTime } = await listAll<SpotItem>(API, {});
  if (current.length === 0) throw new Error("spot API returned no SKUs");

  // History: hourly means for the full 30-day window the API allows (start must be inside it).
  const start = new Date(Date.now() - 29.9 * 864e5).toISOString().replace(/\.\d+Z$/, "Z");
  const { items: series } = await listAll<SeriesItem>(`${API}/list-series`, {
    "filters.startTime": start,
    "aggregation.granularity": "GRANULARITY_HOUR_1",
    "aggregation.method": "METHOD_AVG_PRICE",
  });

  // SKU registry + capacity changes. The API only lists SKUs that currently offer spot capacity,
  // so a SKU disappearing is itself a signal (sold out or withdrawn).
  const skus = await readJson<Record<string, Sku>>("gpu/skus.json", {});
  const bootstrap = Object.keys(skus).length === 0;
  const listedNow = new Set(current.map((c) => c.skuId));
  // Compare against the previous run's snapshot (runs are hourly, so dates are too coarse).
  const prevSnapshot = await readJson<{ prices: Record<string, unknown> } | null>("gpu/spot-current.json", null);
  const listedBefore = new Set(Object.keys(prevSnapshot?.prices ?? {}));
  for (const s of [...current, ...series]) {
    const prev = skus[s.skuId];
    skus[s.skuId] = {
      region: s.region,
      platform: s.computeInstance.platform,
      family: gpuFamily(s.computeInstance.platform),
      title: s.productTitle.replace("®", ""),
      firstSeen: prev?.firstSeen ?? date,
      lastSeen: listedNow.has(s.skuId) ? date : (prev?.lastSeen ?? date),
    };
  }
  if (!bootstrap) {
    for (const id of listedNow) {
      if (!listedBefore.has(id)) {
        const s = skus[id]!;
        alerts.push({ id: `spot-listed-${id}-${date}`, date, source: "gpu-spot", severity: "info", title: `Spot capacity appeared: ${s.family ?? s.platform} in ${s.region}` });
      }
    }
    for (const id of listedBefore) {
      if (!listedNow.has(id)) {
        const s = skus[id]!;
        alerts.push({ id: `spot-delisted-${id}-${date}`, date, source: "gpu-spot", severity: "medium", title: `Spot capacity gone: ${s.family ?? s.platform} in ${s.region}`, detail: "No longer offered as spot. Often means the region is sold out." });
      }
    }
  }
  await writeJson("gpu/skus.json", sortKeys(skus));

  // Daily aggregates (kept forever) and the last 7 days hourly (rolling, for intraday charts).
  const daily = await readJson<SpotDaily>("gpu/spot-daily.json", {});
  const hourly: Record<string, [string, number][]> = {};
  const cutoff7 = Date.now() - 7 * 864e5;
  for (const s of series) {
    const byDay = new Map<string, number[]>();
    for (const p of s.points) {
      const v = Number(p.value);
      if (!Number.isFinite(v)) continue;
      const d = p.timestamp.slice(0, 10);
      byDay.set(d, [...(byDay.get(d) ?? []), v]);
      if (Date.parse(p.timestamp) >= cutoff7) (hourly[s.skuId] ??= []).push([p.timestamp.slice(0, 13), v]);
    }
    const row = (daily[s.skuId] ??= {});
    for (const [d, vs] of byDay) {
      const mean = vs.reduce((a, b) => a + b, 0) / vs.length;
      row[d] = [Math.min(...vs), round(mean), Math.max(...vs), vs.at(-1)!];
    }
    daily[s.skuId] = sortKeys(row);
  }
  await writeJson("gpu/spot-daily.json", sortKeys(daily));
  await writeJson("gpu/spot-hourly-7d.json", hourly);

  const snapshot = Object.fromEntries(current.map((c) => [c.skuId, { price: Number(c.price.value), effectiveTime: c.effectiveTime }]));
  await writeJson("gpu/spot-current.json", { snapshotTime: snapshotTime ?? new Date().toISOString(), prices: snapshot });

  const availability = await readJson<Record<string, string[]>>("gpu/spot-availability.json", {});
  availability[date] = [...listedNow].sort();
  await writeJson("gpu/spot-availability.json", sortKeys(availability));

  alerts.push(...(await nearCapAlerts(current, skus, daily, date)));
  return { summary: `${current.length} SKUs listed; ${series.length} series, ${series.reduce((a, s) => a + s.points.length, 0)} hourly points`, alerts };
}

/**
 * A price at ≥95% of on-demand means that pool is nearly full; once the cap is gone (SPOT_UNCAPPED_FROM),
 * a price above on-demand means buyers are bidding past list. Fires on the crossing only, not every day the
 * price stays there.
 */
async function nearCapAlerts(current: SpotItem[], skus: Record<string, Sku>, daily: SpotDaily, date: string): Promise<Alert[]> {
  const od = await readJson<OnDemandFile>("gpu/ondemand.json", { lastChecked: "", current: {}, changes: [] });
  const list = new Map(Object.values(od.current).map((r) => [r.family, r.onDemand]));
  const yesterday = new Date(Date.parse(date) - 864e5).toISOString().slice(0, 10);
  const alerts: Alert[] = [];
  for (const c of current) {
    const fam = skus[c.skuId]?.family;
    const cap = fam ? list.get(fam) : null;
    const price = Number(c.price.value);
    const before = daily[c.skuId]?.[yesterday]?.[3];
    if (cap && date >= SPOT_UNCAPPED_FROM && price > cap && (before === undefined || before <= cap)) {
      alerts.push({
        id: `spot-above-list-${c.skuId}-${date}`,
        date,
        source: "gpu-spot",
        severity: "high",
        title: `${fam} spot above on-demand in ${c.region}: $${price} vs $${cap} list`,
        detail: `${Math.round((price / cap) * 100)}% of on-demand. Buyers are paying more than list for preemptible GPUs.`,
        url: "https://nebius.com/spot-prices",
      });
      continue;
    }
    const wasBelow = before === undefined || !cap || before / cap < 0.95;
    if (cap && price / cap >= 0.95 && price <= cap && wasBelow) {
      alerts.push({
        id: `spot-cap-${c.skuId}-${date}`,
        date,
        source: "gpu-spot",
        severity: "medium",
        title: `${fam} spot near ${date >= SPOT_UNCAPPED_FROM ? "on-demand" : "its cap"} in ${c.region}: $${price} vs $${cap} on-demand`,
        detail: `${Math.round((price / cap) * 100)}% of on-demand. Spare capacity is almost gone.`,
        url: "https://nebius.com/spot-prices",
      });
    }
  }
  return alerts;
}

const round = (n: number) => Math.round(n * 1000) / 1000;
