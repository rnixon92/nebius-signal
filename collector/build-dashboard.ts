// Derives the compact dashboard dataset from the raw history in data/. Pure transformation: no network.
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import type { Dashboard, ModelPricing, SourceHealth } from "../shared/dashboard.ts";
import { ROOT, addDays, readJson, today, writeJson } from "./lib/store.ts";
import type { Alert, RunStatus } from "./lib/types.ts";
import type { Customer } from "./sources/atlas.ts";
import type { OnDemandFile, Sku, SpotDaily } from "./sources/gpu.ts";
import type { Job, JobsDay } from "./sources/jobs.ts";
import { FUNCTIONS } from "./sources/jobs.ts";
import type { ModelPrice, ProviderHistory } from "./sources/openrouter.ts";
import { NEBIUS, PEERS } from "./sources/openrouter.ts";
import type { MarketWeek } from "./sources/openrouter-market.ts";
import type { Filing } from "./sources/sec.ts";
import { matchSites, type NewsItem, type Site } from "./sources/news.ts";
import type { RegionsFile } from "./sources/regions.ts";
import { buildNowcast } from "./nowcast.ts";

const FAMILY_ORDER = ["GB300", "B300", "GB200", "B200", "H200", "H100", "RTX PRO 6000", "L40S"];
const BLACKWELL = new Set(["GB300", "B300", "GB200", "B200"]);
const HOPPER = new Set(["H200", "H100"]);
const TOP_MODELS = 6;

const SOURCE_META: Record<string, { label: string; url: string; maxAgeH: number }> = {
  "gpu-ondemand": { label: "Nebius GPU rate card", url: "https://nebius.com/prices", maxAgeH: 36 },
  "gpu-spot": { label: "Nebius spot price API", url: "https://nebius.com/spot-prices", maxAgeH: 36 },
  regions: { label: "Nebius regions docs", url: "https://docs.nebius.com/overview/regions", maxAgeH: 36 },
  news: { label: "Google News (data centers)", url: "https://news.google.com/search?q=Nebius%20data%20center", maxAgeH: 36 },
  openrouter: { label: "OpenRouter provider pages", url: "https://openrouter.ai/provider/nebius", maxAgeH: 36 },
  "openrouter-market": { label: "jimmyresearch OpenRouter CSV", url: "https://jimmyresearch.com/openrouter/", maxAgeH: 72 },
  atlas: { label: "Nebius Atlas", url: "https://nebiusatlas.com/", maxAgeH: 36 },
  sec: { label: "SEC EDGAR", url: "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0001513845", maxAgeH: 36 },
  jobs: { label: "Greenhouse job board", url: "https://careers.nebius.com/", maxAgeH: 36 },
  stock: { label: "Yahoo Finance (NBIS)", url: "https://finance.yahoo.com/quote/NBIS", maxAgeH: 96 },
};

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const mean = (xs: number[]) => (xs.length ? sum(xs) / xs.length : null);
const r4 = (n: number) => Math.round(n * 1e4) / 1e4;
const familyRank = (f: string) => (FAMILY_ORDER.indexOf(f) === -1 ? 99 : FAMILY_ORDER.indexOf(f));

/** `persistNowcast` records today's estimates so the scorecard can later grade them (collector runs only). */
export async function buildDashboard({ persistNowcast = false } = {}): Promise<Dashboard> {
  const now = new Date();
  const dash: Dashboard = {
    generatedAt: now.toISOString(),
    sources: await sources(now),
    alerts: await alerts(),
    events: await events(),
    nowcast: await nowcast(persistNowcast),
    sites: await sites(),
    stock: await stock(),
    gpu: await gpu(),
    tokens: await tokens(),
    atlas: await atlas(),
    jobs: await jobs(),
    sec: await sec(),
    fundamentals: await fundamentals(),
  };
  await writeJson(join(ROOT, "public", "data", "dashboard.json"), dash, true);
  return dash;
}

async function sources(now: Date): Promise<SourceHealth[]> {
  const runs = await readJson<Record<string, RunStatus>>("meta/runs.json", {});
  return Object.entries(SOURCE_META).map(([id, meta]) => {
    const r = runs[id];
    const ageH = r?.lastSuccess ? (now.getTime() - Date.parse(r.lastSuccess)) / 36e5 : Infinity;
    return { id, label: meta.label, url: meta.url, ok: r?.ok ?? false, lastSuccess: r?.lastSuccess ?? null, summary: r?.summary, error: r?.error, stale: ageH > meta.maxAgeH };
  });
}

async function nowcast(persist: boolean): Promise<Dashboard["nowcast"]> {
  const t = today();
  const nc = await buildNowcast(t);
  const history = await readJson<Record<string, Record<string, number>>>("nowcast/history.json", {});
  history[t] = Object.fromEntries(nc.quarters.map((q) => [q.quarter, Math.round(q.estimate * 10) / 10]));
  if (persist) await writeJson("nowcast/history.json", history);
  return {
    ...nc,
    history: Object.entries(history)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => ({ date, ...v })),
  };
}

/** Dated annotations shared by time-series charts: results, list price changes, capacity go-lives, financings. */
async function events(): Promise<Dashboard["events"]> {
  const out: Dashboard["events"] = [];
  const filings = Object.values(await readJson<Record<string, Filing>>("sec/filings.json", {}));
  for (const f of filings) {
    if (f.form !== "6-K" || !f.title) continue;
    if (/(first|second|third|fourth) quarter.*results|reports .*quarter/i.test(f.title)) out.push({ date: f.filed, label: f.title.replace(/^Nebius (Group )?reports /i, "").replace(/ financial( results)?$/i, " results"), kind: "earnings" });
    else if (/financing|convertible|notes|facility/i.test(f.title) && /closing|secures|pricing/i.test(f.title)) out.push({ date: f.filed, label: f.title.replace(/^Nebius (Group )?/i, ""), kind: "financing" });
  }
  const od = await readJson<OnDemandFile>("gpu/ondemand.json", { lastChecked: "", current: {}, changes: [] });
  for (const d of [...new Set(od.changes.map((c) => c.date))]) out.push({ date: d, label: "List price change", kind: "price" });
  const regions = await readJson<RegionsFile>("capacity/regions.json", { lastChecked: "", regions: {}, platforms: {}, changes: [] });
  for (const c of regions.changes.filter((c) => c.kind !== "region-removed" && c.kind !== "platform-removed")) {
    out.push({ date: c.date, label: c.platform ? `${c.platform} live in ${c.region}` : `Region ${c.region} live`, kind: "capacity" });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

async function sites(): Promise<Dashboard["sites"]> {
  const registry = await readJson<Site[]>("sites.json", []);
  const regions = await readJson<RegionsFile>("capacity/regions.json", { lastChecked: "", regions: {}, platforms: {}, changes: [] });
  const skus = await readJson<Record<string, Sku>>("gpu/skus.json", {});
  const current = await readJson<{ prices: Record<string, unknown> } | null>("gpu/spot-current.json", null);
  const roles = Object.values(await readJson<Record<string, Job>>("jobs/roles.json", {}));
  const news = Object.values(await readJson<Record<string, NewsItem>>("news/items.json", {})).sort((a, b) => b.date.localeCompare(a.date));
  const since = addDays(today(), -90);
  const live = new Set(Object.keys(current?.prices ?? {}));

  const rows = registry.map((s) => {
    const matches = (loc: string) => matchSites(loc, [s]).length > 0;
    const dc = roles.filter((j) => j.function === "Data center & power" && matches(j.location));
    const n90 = news.filter((n) => n.date >= since && n.sites.includes(s.id));
    const latest = news.find((n) => n.sites.includes(s.id));
    return {
      id: s.id,
      name: s.name,
      country: s.country,
      model: s.model,
      mw: s.mw,
      mwNote: s.mwNote,
      status: s.status,
      expected: s.expected,
      region: s.region ?? null,
      note: s.note,
      sources: s.sources,
      platforms: s.region ? Object.entries(regions.platforms).filter(([, rs]) => rs.includes(s.region!)).map(([fam]) => fam) : [],
      spotPools: s.region ? Object.entries(skus).filter(([id, k]) => k.region === s.region && live.has(id)).length : 0,
      dcRolesOpen: dc.filter((j) => !j.closedAt).length,
      dcRolesPosted90d: dc.filter((j) => (j.posted ?? j.firstSeen) >= since).length,
      news90d: n90.length,
      risk90d: n90.filter((n) => n.tag === "risk").length,
      progress90d: n90.filter((n) => n.tag === "progress").length,
      latest: latest ? { title: latest.title, date: latest.date, url: latest.url, tag: latest.tag } : null,
    };
  });

  const order: Dashboard["sites"]["rows"][number]["status"][] = ["live", "ramping", "construction", "contracted", "planned", "unconfirmed"];
  return {
    rows: rows.sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status) || (b.mw ?? 0) - (a.mw ?? 0)),
    mwByStatus: order.map((status) => ({ status, mw: sum(rows.filter((r) => r.status === status).map((r) => r.mw ?? 0)), sites: rows.filter((r) => r.status === status).length })).filter((x) => x.sites > 0),
    news: news.filter((n) => n.sites.length).slice(0, 60).map(({ title, publisher, date, url, sites: ids, tag }) => ({ title, publisher, date, url, sites: ids, tag })),
    regionChanges: [...regions.changes].reverse(),
  };
}

async function alerts() {
  const all = await readJson<Alert[]>("alerts.json", []);
  const cutoff = addDays(today(), -60);
  return all.filter((a) => a.date >= cutoff).slice(0, 150);
}

async function stock(): Promise<Dashboard["stock"]> {
  const prices = Object.entries(await readJson<Record<string, [number, number]>>("market/nbis.json", {})).sort(([a], [b]) => a.localeCompare(b));
  const series = prices.map(([d, [c]]) => [d, c] as [string, number]);
  const last = series.at(-1);
  if (!last) return { series, last: null };
  const prev = series.at(-2);
  const monthAgo = [...series].reverse().find(([d]) => d <= addDays(last[0], -30));
  return {
    series,
    last: { date: last[0], close: last[1], chg1d: prev ? last[1] / prev[1] - 1 : null, chg30d: monthAgo ? last[1] / monthAgo[1] - 1 : null },
  };
}

// ---------------------------------------------------------------- GPU

async function gpu(): Promise<Dashboard["gpu"]> {
  const od = await readJson<OnDemandFile>("gpu/ondemand.json", { lastChecked: "", current: {}, changes: [] });
  const skus = await readJson<Record<string, Sku>>("gpu/skus.json", {});
  const daily = await readJson<SpotDaily>("gpu/spot-daily.json", {});
  const current = await readJson<{ snapshotTime: string; prices: Record<string, { price: number; effectiveTime: string }> } | null>("gpu/spot-current.json", null);
  const hourly = await readJson<Record<string, [string, number][]>>("gpu/spot-hourly-7d.json", {});
  const avail = await readJson<Record<string, string[]>>("gpu/spot-availability.json", {});

  // One list price per family (L40S has two CPU variants; spot doesn't cover it, so the first is fine).
  const listNow = new Map<string, number | null>();
  for (const r of Object.values(od.current)) if (!listNow.has(r.family)) listNow.set(r.family, r.onDemand);
  const nameToFamily = new Map(Object.values(od.current).map((r) => [r.name, r.family]));
  const changes = [...od.changes].sort((a, b) => a.date.localeCompare(b.date));
  /** The on-demand price in force on `date`, rolling back any rate-card change made after it. */
  const listAt = (family: string, date: string): number | null => {
    let price = listNow.get(family) ?? null;
    for (const c of [...changes].reverse()) {
      if ((nameToFamily.get(c.name) ?? c.name) === family && c.date > date) price = c.from;
    }
    return price;
  };

  const spotNow = Object.entries(current?.prices ?? {})
    .map(([skuId, p]) => {
      const s = skus[skuId];
      const family = s?.family ?? s?.platform ?? "Unknown";
      const list = listNow.get(family) ?? null;
      const spark = (hourly[skuId] ?? []).map(([, v]) => v);
      return { skuId, family, region: s?.region ?? "?", price: p.price, onDemand: list, ratio: list ? r4(p.price / list) : null, effectiveTime: p.effectiveTime, spark };
    })
    .sort((a, b) => familyRank(a.family) - familyRank(b.family) || a.region.localeCompare(b.region));

  const families = [...new Set(Object.values(skus).map((s) => s.family).filter((f): f is string => !!f))].sort((a, b) => familyRank(a) - familyRank(b));
  const dates = [...new Set(Object.values(daily).flatMap((d) => Object.keys(d)))].sort();
  const ratioDaily: Dashboard["gpu"]["ratioDaily"] = [];
  const priceDaily: Dashboard["gpu"]["priceDaily"] = [];
  for (const date of dates) {
    const ratioRow: Record<string, number | string> = { date };
    const priceRow: Record<string, number | string> = { date };
    for (const fam of families) {
      const vals = Object.entries(daily)
        .filter(([id]) => skus[id]?.family === fam)
        .map(([, d]) => d[date]?.[1])
        .filter((v): v is number => v !== undefined);
      if (!vals.length) continue;
      const list = listAt(fam, date);
      if (list) ratioRow[fam] = r4(mean(vals.map((v) => v / list))!);
      priceRow[fam] = Math.min(...vals);
    }
    ratioDaily.push(ratioRow as Dashboard["gpu"]["ratioDaily"][number]);
    priceDaily.push(priceRow as Dashboard["gpu"]["priceDaily"][number]);
  }

  const latestRatio = (set: Set<string>) => mean(spotNow.filter((s) => set.has(s.family) && s.ratio !== null).map((s) => s.ratio!));
  return {
    snapshotTime: current?.snapshotTime ?? null,
    onDemand: Object.values(od.current).sort((a, b) => familyRank(a.family) - familyRank(b.family)),
    changes,
    spotNow,
    families,
    ratioDaily,
    priceDaily,
    availability: Object.entries(avail).map(([date, ids]) => ({ date, skus: ids.length })),
    tightness: { blackwell: latestRatio(BLACKWELL), hopper: latestRatio(HOPPER) },
  };
}

// ---------------------------------------------------------------- tokens

const stripDate = (s: string) => s.replace(/-\d{8}$/, "");

async function tokens(): Promise<Dashboard["tokens"]> {
  const neb = await readJson<ProviderHistory>(`openrouter/providers/${NEBIUS}.json`, { provider: NEBIUS, updatedAt: "", days: {} });
  const models = await readJson<Record<string, ModelPrice>>("openrouter/nebius-models.json", {});
  const catalog = await readJson<Record<string, Omit<ModelPrice, "firstSeen" | "lastSeen">>>("openrouter/catalog-prices.json", {});
  const t = today();
  const daily = Object.entries(neb.days)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, byModel]) => ({ date, partial: date >= t, total: sum(Object.values(byModel)), byModel }));

  // Price every model key seen in the chart; chart keys are dated permaslugs, so fall back to
  // matching with the date suffix stripped (a re-dated variant of the same model).
  const pricing: Record<string, ModelPricing> = {};
  const byStripped = new Map(Object.entries(models).map(([id, m]) => [stripDate(id), m]));
  for (const key of new Set(daily.flatMap((d) => Object.keys(d.byModel)))) {
    const own = models[key] ?? byStripped.get(stripDate(key));
    const m = own ?? catalog[key];
    if (m) pricing[key] = { id: key, name: m.name, input: m.input, output: m.output, cacheRead: m.cacheRead, priceSource: own ? "nebius" : "catalog" };
  }

  // Rank by the last 7 complete days so a fresh launch gets its own color instead of hiding in "Other".
  const complete = daily.filter((d) => !d.partial);
  const totals = new Map<string, number>();
  for (const d of complete.slice(-7)) for (const [m, v] of Object.entries(d.byModel)) if (m !== "Others") totals.set(m, (totals.get(m) ?? 0) + v);
  const topModels = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOP_MODELS).map(([m]) => m);

  const weekSum = (days: typeof complete) => sum(days.map((d) => d.total));
  const cur = weekSum(complete.slice(-7));
  const prev = weekSum(complete.slice(-14, -7));

  const market = Object.entries(await readJson<Record<string, MarketWeek>>("openrouter/market-weekly.json", {}))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, w]) => ({ date, nebius: w.tokens["Nebius"] ?? 0, total: w.total, share: w.total ? r4((w.tokens["Nebius"] ?? 0) / w.total) : 0, rank: w.nebiusRank, providers: w.providers }));

  const peers: Dashboard["tokens"]["peers"] = [];
  for (const slug of [NEBIUS, ...PEERS]) {
    const h = await readJson<ProviderHistory>(`openrouter/providers/${slug}.json`, { provider: slug, updatedAt: "", days: {} });
    const days = Object.entries(h.days).filter(([d]) => d < t).sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => sum(Object.values(v)));
    if (days.length < 14) continue;
    const week = sum(days.slice(-7));
    const prevWeek = sum(days.slice(-14, -7));
    peers.push({ slug, name: PROVIDER_NAMES[slug] ?? slug, week, prevWeek, change: prevWeek ? week / prevWeek - 1 : null, isNebius: slug === NEBIUS });
  }
  peers.sort((a, b) => b.week - a.week);

  return {
    daily,
    topModels,
    pricing,
    week: { end: complete.at(-1)?.date ?? "", tokens: cur, prev, change: prev ? cur / prev - 1 : null },
    market,
    peers,
  };
}

const PROVIDER_NAMES: Record<string, string> = {
  nebius: "Nebius",
  together: "Together",
  fireworks: "Fireworks",
  deepinfra: "DeepInfra",
  baseten: "Baseten",
  novita: "Novita",
  parasail: "Parasail",
  groq: "Groq",
  cerebras: "Cerebras",
  siliconflow: "SiliconFlow",
  crusoe: "Crusoe",
  coreweave: "CoreWeave",
};

// ---------------------------------------------------------------- customers, jobs, filings

async function atlas(): Promise<Dashboard["atlas"]> {
  const all = Object.values(await readJson<Record<string, Customer>>("atlas/customers.json", {})).filter((c) => !c.removedAt);
  const count = (keys: string[]) =>
    [...keys.reduce((m, k) => m.set(k, (m.get(k) ?? 0) + 1), new Map<string, number>())].map(([name, n]) => ({ name, count: n })).sort((a, b) => b.count - a.count);

  const byDate = new Map<string, number>();
  for (const c of all) byDate.set(c.firstListedAt, (byDate.get(c.firstListedAt) ?? 0) + 1);
  let running = 0;
  const cumulative = [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, added]) => ({ date, added, total: (running += added) }));

  return {
    total: all.length,
    tokenFactory: all.filter((c) => c.services.includes("Nebius Token Factory")).length,
    aiCloud: all.filter((c) => c.services.includes("Nebius AI Cloud")).length,
    cumulative,
    byCategory: count(all.map((c) => c.category)),
    byService: count(all.flatMap((c) => c.services)),
    recent: all
      .filter((c) => !c.baseline)
      .sort((a, b) => b.firstListedAt.localeCompare(a.firstListedAt) || a.name.localeCompare(b.name))
      .slice(0, 30)
      .map((c) => ({ name: c.name, category: c.category, use: c.use, services: c.services, date: c.firstListedAt })),
  };
}

async function jobs(): Promise<Dashboard["jobs"]> {
  const roles = await readJson<Record<string, Job>>("jobs/roles.json", {});
  const daily = await readJson<Record<string, JobsDay>>("jobs/daily.json", {});
  const open = Object.entries(roles).filter(([, j]) => !j.closedAt);
  const weekAgo = addDays(today(), -7);
  const posted = (j: Job) => j.posted ?? j.firstSeen;

  // Open roles by the month they were posted. Closed roles are invisible, so older months undercount.
  const months = new Map<string, Record<string, number>>();
  for (const [, j] of open) {
    const m = posted(j).slice(0, 7);
    const row = months.get(m) ?? {};
    row[j.function] = (row[j.function] ?? 0) + 1;
    months.set(m, row);
  }
  const postedByMonth = [...months.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .filter(([m]) => m >= addDays(today(), -365).slice(0, 7))
    .map(([m, row]) => ({ date: `${m}-01`, ...Object.fromEntries(FUNCTIONS.map((f) => [f, row[f] ?? 0])) }));
  const tally = (key: (j: Job) => string, order?: readonly string[]) => {
    const m = new Map<string, number>();
    for (const [, j] of open) m.set(key(j), (m.get(key(j)) ?? 0) + 1);
    const out = [...m].map(([name, count]) => ({ name, count }));
    return order ? out.sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name)) : out.sort((a, b) => b.count - a.count);
  };
  return {
    total: open.length,
    daily: Object.entries(daily).sort(([a], [b]) => a.localeCompare(b)).map(([date, d]) => ({ date, total: d.total })),
    byFunction: tally((j) => j.function, FUNCTIONS),
    byRegion: tally((j) => j.region),
    new7d: open.filter(([, j]) => posted(j) >= weekAgo).length,
    dcRoles: open
      .filter(([, j]) => j.function === "Data center & power")
      .sort(([, a], [, b]) => posted(b).localeCompare(posted(a)) || a.location.localeCompare(b.location))
      .slice(0, 60)
      .map(([id, j]) => ({ title: j.title, location: j.location, posted: posted(j), url: `https://careers.nebius.com/job?gh_jid=${id}` })),
    postedByMonth,
  };
}

async function sec(): Promise<Dashboard["sec"]> {
  const filings = Object.values(await readJson<Record<string, Filing>>("sec/filings.json", {})).sort((a, b) => b.filed.localeCompare(a.filed));
  const kind = (f: Filing): Dashboard["sec"]["filings"][number]["kind"] => {
    if (f.form === "20-F" || (f.form === "6-K" && /results|quarter|annual report/i.test(f.title ?? ""))) return "results";
    if (f.form === "6-K") return "corporate";
    if (f.form === "4" || f.form === "144") return "insider";
    if (/13[DG]/.test(f.form)) return "ownership";
    return "other";
  };
  const value = (f: Filing, code: string) => sum((f.trades ?? []).filter((t) => t.code === code).map((t) => t.shares * (t.price ?? 0)));
  const title = (f: Filing) => {
    if (f.form === "4") {
      const sold = value(f, "S");
      const bought = value(f, "P");
      const verb = bought > 0 ? `bought ${usd(bought)}` : sold > 0 ? `sold ${usd(sold)}` : "reported holdings change";
      return `${f.owner ?? "Insider"}${f.role ? ` (${f.role})` : ""} ${verb}${f.plan10b5 ? " · 10b5-1 plan" : ""}`;
    }
    if (f.form === "144") return `${f.owner ?? "Insider"} plans to sell ${usd(f.proposedValue ?? 0)}`;
    return f.title ?? f.form;
  };

  // Form 4 names are "Last First", Form 144 names are "FIRST LAST" or a family trust, so people are
  // matched by shared name tokens rather than by exact string.
  const tokensOf = (name: string) => new Set(name.toLowerCase().match(/[a-z]{2,}/g)?.filter((w) => !["the", "tr", "trust", "of", "llc", "lp", "family", "jr", "sr"].includes(w)) ?? []);
  const cutoff = addDays(today(), -90);
  const people: { tokens: Set<string>; p: Dashboard["sec"]["insiders"][number] }[] = [];
  const personFor = (f: Filing) => {
    const toks = tokensOf(f.owner ?? "Unknown");
    const hit = people.find((x) => [...toks].filter((t) => x.tokens.has(t)).length >= 2);
    if (hit) return hit.p;
    const p = { owner: f.owner ?? "Unknown", role: f.role ?? "", sold: 0, bought: 0, planned: 0, lastDate: f.filed };
    people.push({ tokens: toks, p });
    return p;
  };
  // Form 4s first so the display name comes from the "Last First" filing.
  const insiderFilings = filings.filter((f) => f.filed >= cutoff && (f.form === "4" || f.form === "144")).sort((a, b) => (a.form === "4" ? 0 : 1) - (b.form === "4" ? 0 : 1));
  for (const f of insiderFilings) {
    const p = personFor(f);
    if (f.form === "4") {
      p.sold += value(f, "S");
      p.bought += value(f, "P");
      if (f.role) p.role = f.role;
    } else p.planned += f.proposedValue ?? 0;
    if (f.filed > p.lastDate) p.lastDate = f.filed;
  }
  // Grants and holdings-only Form 4s carry no sale or purchase; leave those people out.
  const insiders = people.map((x) => x.p).filter((x) => x.sold || x.bought || x.planned).sort((a, b) => Math.max(b.sold, b.planned) - Math.max(a.sold, a.planned));
  return {
    filings: filings.filter((f) => f.form !== "4" || (f.trades?.length ?? 0) > 0).slice(0, 80).map((f) => ({ filed: f.filed, form: f.form, title: title(f), url: f.url, kind: kind(f) })),
    insiders,
    totals90d: { sold: sum(insiders.map((p) => p.sold)), bought: sum(insiders.map((p) => p.bought)), planned: sum(insiders.map((p) => p.planned)) },
  };
}

async function fundamentals(): Promise<Dashboard["fundamentals"]> {
  const f = await readJson<{ quarters: Dashboard["fundamentals"]["quarters"]; guidance: Dashboard["fundamentals"]["guidance"] }>("fundamentals.json", {
    quarters: [],
    guidance: { year: 0, asOf: "", arrExit: [0, 0], revenue: [0, 0], capex: [0, 0], adjEbitdaMargin: 0, contractedPowerGw: 0, source: "" },
  });
  const g = f.guidance;
  const thisYear = f.quarters.filter((q) => q.quarter.startsWith(String(g.year)));
  const remaining = 4 - thisYear.length;
  const booked = sum(thisYear.map((q) => q.revenue));
  const neededPerQuarter: [number, number] | null = remaining > 0 ? [(g.revenue[0] - booked) / remaining, (g.revenue[1] - booked) / remaining] : null;

  // Results for the quarter after the latest one recorded can only be filed after that next quarter ends.
  const lastEnd = f.quarters.at(-1)?.end ?? "";
  const filings = Object.values(await readJson<Record<string, Filing>>("sec/filings.json", {}));
  const newer = filings
    .filter((x) => x.form === "6-K" && /(first|second|third|fourth) quarter|Q[1-4]\b.*results|results.*Q[1-4]\b/i.test(x.title ?? "") && x.filed > addDays(lastEnd, 92))
    .sort((a, b) => b.filed.localeCompare(a.filed))[0];

  return {
    quarters: f.quarters,
    guidance: g,
    neededPerQuarter,
    remainingQuarters: remaining,
    newerResults: newer ? { filed: newer.filed, title: newer.title ?? "Results 6-K", url: newer.url } : null,
  };
}

function usd(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${Math.round(n)}`;
}

// `npm run dashboard` rebuilds from data/ without collecting.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await buildDashboard();
  console.log("Wrote public/data/dashboard.json");
}
