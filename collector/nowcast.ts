// Quarter nowcast: an explicit, inspectable guess at each unreported quarter's revenue versus consensus.
//
//   estimate = anchor × (1 + tilt)
//   anchor   = analyst consensus, or the revenue guidance implies when there is none
//   tilt     = 4% × weighted signal score (−1…+1) + half of last quarter's surprise
//
// Each signal is scored −1…+1 and weighted by its prior importance × how much of the quarter the data
// covers. The weights are uncalibrated priors; the scorecard records each quarter's guess against the
// reported result so they can be tested once a few quarters exist.
import type { Nowcast, NowcastSignal, ScorecardRow } from "../shared/dashboard.ts";
import { addDays, readJson } from "./lib/store.ts";
import type { NewsItem, Site } from "./sources/news.ts";
import type { OnDemandFile, Sku, SpotDaily } from "./sources/gpu.ts";
import type { Job } from "./sources/jobs.ts";
import type { ProviderHistory } from "./sources/openrouter.ts";
import type { RegionsFile } from "./sources/regions.ts";
import type { EpochFile } from "./sources/epoch.ts";

type Quarter = { quarter: string; end: string; revenue: number; arr: number | null; consensus?: number | null };
type Upcoming = { quarter: string; end: string; consensus: number | null; consensusRange: [number, number] | null; expectedReport: string | null; reportDateConfirmed: boolean; source: string | null };
type Fundamentals = { quarters: Quarter[]; upcoming?: Upcoming[]; guidance: { year: number; arrExit: [number, number]; revenue: [number, number] } };

const TILT_PER_SCORE = 0.04;
const LEAN_THRESHOLD = 0.015;
const BLACKWELL = new Set(["GB300", "B300", "GB200", "B200"]);
const HOPPER = new Set(["H200", "H100"]);

const clamp = (v: number, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, v));
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const mean = (xs: number[]) => (xs.length ? sum(xs) / xs.length : null);

/** First day of the quarter that ends on `end` (a quarter-end date, YYYY-MM-DD). */
function startOf(end: string): string {
  const [y, m] = end.split("-").map(Number) as [number, number];
  return `${y}-${String(m - 2).padStart(2, "0")}-01`;
}

const days = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 864e5) + 1;

type Inputs = {
  f: Fundamentals;
  od: OnDemandFile;
  skus: Record<string, Sku>;
  spot: SpotDaily;
  regions: RegionsFile;
  news: Record<string, NewsItem>;
  sites: Site[];
  jobs: Record<string, Job>;
  tokens: ProviderHistory;
  epoch: EpochFile;
};

async function load(): Promise<Inputs> {
  return {
    f: await readJson<Fundamentals>("fundamentals.json", { quarters: [], guidance: { year: 0, arrExit: [0, 0], revenue: [0, 0] } }),
    od: await readJson<OnDemandFile>("gpu/ondemand.json", { lastChecked: "", current: {}, changes: [] }),
    skus: await readJson<Record<string, Sku>>("gpu/skus.json", {}),
    spot: await readJson<SpotDaily>("gpu/spot-daily.json", {}),
    regions: await readJson<RegionsFile>("capacity/regions.json", { lastChecked: "", regions: {}, platforms: {}, changes: [] }),
    news: await readJson<Record<string, NewsItem>>("news/items.json", {}),
    sites: await readJson<Site[]>("sites.json", []),
    jobs: await readJson<Record<string, Job>>("jobs/roles.json", {}),
    tokens: await readJson<ProviderHistory>("openrouter/providers/nebius.json", { provider: "nebius", updatedAt: "", days: {} }),
    epoch: await readJson<EpochFile>("capacity/epoch.json", { updatedAt: "", sites: {} }),
  };
}

/** List price in force for a family on a date, rolling back later rate-card changes. */
function listAt(inp: Inputs, family: string, date: string): number | null {
  let price: number | null = Object.values(inp.od.current).find((r) => r.family === family)?.onDemand ?? null;
  const nameToFamily = new Map(Object.values(inp.od.current).map((r) => [r.name, r.family]));
  for (const c of [...inp.od.changes].sort((a, b) => b.date.localeCompare(a.date))) {
    if ((nameToFamily.get(c.name) ?? "") === family && c.date > date) price = c.from;
  }
  return price;
}

function spotRatio(inp: Inputs, set: Set<string>, from: string, to: string): { avg: number | null; coverage: number } {
  const byDay = new Map<string, number[]>();
  for (const [id, series] of Object.entries(inp.spot)) {
    const fam = inp.skus[id]?.family;
    if (!fam || !set.has(fam)) continue;
    for (const [d, v] of Object.entries(series)) {
      if (d < from || d > to) continue;
      const list = listAt(inp, fam, d);
      if (list) byDay.set(d, [...(byDay.get(d) ?? []), v[1] / list]);
    }
  }
  const dailyMeans = [...byDay.values()].map((v) => mean(v)!);
  return { avg: mean(dailyMeans), coverage: Math.min(1, byDay.size / days(from, to)) };
}

function signalsFor(inp: Inputs, from: string, to: string, asOf: string): NowcastSignal[] {
  const end = to < asOf ? to : asOf;
  const out: NowcastSignal[] = [];
  const push = (s: Omit<NowcastSignal, "contribution">) => out.push({ ...s, contribution: 0 });

  // 1. Capacity going live: new regions or GPU platforms in Nebius's docs during the quarter.
  const regionTracked = inp.regions.lastChecked ? Math.max(0, days(Object.values(inp.regions.regions).reduce((m, r) => (r.firstSeen < m ? r.firstSeen : m), "9999"), end)) : 0;
  const goLives = inp.regions.changes.filter((c) => c.date >= from && c.date <= end && (c.kind === "region-added" || c.kind === "platform-added" || c.kind === "region-public"));
  push({
    id: "capacity",
    label: "Capacity going live",
    value: regionTracked ? `${goLives.length} new region/GPU go-live${goLives.length === 1 ? "" : "s"}` : "Not tracked yet",
    score: goLives.length ? clamp(goLives.length / 2) : 0,
    weight: 3,
    coverage: Math.min(1, regionTracked / days(from, to)),
    note: "From Nebius's regions page. Absence of go-lives only counts once tracking covers the quarter.",
  });

  // 1b. Satellite-observed power at tracked sites (Epoch AI): IT MW at quarter start vs the latest
  // observation inside the quarter. Only counts as far as observations reach into the quarter.
  const obsAt = (date: string) =>
    Object.values(inp.epoch.sites).reduce((sum, s) => sum + (s.timeline.filter((x) => !x.projected && x.date <= date).at(-1)?.itMw ?? 0), 0);
  const obsInQuarter = Object.values(inp.epoch.sites).flatMap((s) => s.timeline.filter((x) => !x.projected && x.date >= from && x.date <= end).map((x) => x.date)).sort().at(-1);
  const startMw = obsAt(addDays(from, -1));
  const latestMw = obsInQuarter ? obsAt(obsInQuarter) : startMw;
  const growth = startMw ? latestMw / startMw - 1 : 0;
  push({
    id: "observed-power",
    label: "Observed live power (satellite)",
    value: obsInQuarter ? `${startMw} → ${latestMw} MW at tracked sites (to ${obsInQuarter})` : `No observations yet this quarter (${startMw} MW at start)`,
    score: clamp(growth / 0.3),
    weight: 1.5,
    coverage: obsInQuarter ? Math.min(1, days(from, obsInQuarter) / days(from, to)) : 0,
    note: "Epoch AI's satellite estimates for Vineland (Microsoft) and Mäntsälä. +30% in a quarter scores +1. Only two sites are tracked, so it's a partial view.",
  });

  // 2. Site news: progress (power delivered, online) versus risk (lawsuits, halts, delays). Only sites
  // that are live or ramping can move this quarter's revenue; news on future campuses is pipeline risk.
  const billing = new Set(inp.sites.filter((s) => s.status === "live" || s.status === "ramping").map((s) => s.id));
  const items = Object.values(inp.news).filter((n) => n.date >= from && n.date <= end && n.sites.some((id) => billing.has(id)));
  const prog = items.filter((n) => n.tag === "progress").length;
  const risk = items.filter((n) => n.tag === "risk").length;
  const oldest = Object.values(inp.news).reduce((m, n) => (n.date < m ? n.date : m), "9999");
  push({
    id: "site-news",
    label: "News at billing sites",
    value: `${prog} progress · ${risk} risk headlines`,
    score: prog + risk ? (prog - risk) / (prog + risk + 2) : 0,
    weight: 1.5,
    coverage: oldest > end ? 0 : Math.min(1, days(oldest > from ? oldest : from, end) / days(from, to)),
    note: "Live and ramping sites only. Trouble at future campuses (Independence, Birmingham) is pipeline risk, shown in Data centers.",
  });

  // 3. Data-center hiring: share of new postings that are data-center roles, vs the prior quarter.
  // Shares (not counts) because only still-open roles are visible, which inflates recent quarters.
  const prevFrom = startOf(addDays(from, -1));
  const posted = Object.values(inp.jobs).map((j) => ({ d: j.posted ?? j.firstSeen, dc: j.function === "Data center & power" }));
  const share = (a: string, b: string) => {
    const ps = posted.filter((p) => p.d >= a && p.d <= b);
    return ps.length >= 10 ? ps.filter((p) => p.dc).length / ps.length : null;
  };
  const sNow = share(from, end);
  const sPrev = share(prevFrom, addDays(from, -1));
  push({
    id: "dc-hiring",
    label: "Data-center hiring mix",
    value: sNow === null ? "Too few postings" : `${Math.round(sNow * 100)}% of new roles${sPrev !== null ? ` (prior quarter ${Math.round(sPrev * 100)}%)` : ""}`,
    score: sNow !== null && sPrev ? clamp((sNow - sPrev) / sPrev) : 0,
    weight: 0.5,
    coverage: sNow !== null && sPrev !== null ? 1 : 0,
    note: "Build-out staffing leads capacity by one to three quarters, so it's weighted lightly for the current one. Survivorship-biased: only still-open roles are visible.",
  });

  // 4–5. Spot tightness: Blackwell near its cap = new capacity absorbed; Hopper slack = older-fleet pressure.
  const bw = spotRatio(inp, BLACKWELL, from, end);
  push({
    id: "blackwell-spot",
    label: "Blackwell spot vs list",
    value: bw.avg === null ? "No data" : `${Math.round(bw.avg * 100)}% average`,
    score: bw.avg === null ? 0 : clamp((bw.avg - 0.6) / 0.25),
    weight: 2,
    coverage: bw.coverage,
    note: "Above ~60% means spare Blackwell capacity is being taken up.",
  });
  const hp = spotRatio(inp, HOPPER, from, end);
  push({
    id: "hopper-spot",
    label: "Hopper spot vs list",
    value: hp.avg === null ? "No data" : `${Math.round(hp.avg * 100)}% average`,
    score: hp.avg === null ? 0 : clamp((hp.avg - 0.45) / 0.3),
    weight: 1,
    coverage: hp.coverage,
    note: "Low Hopper prices point to idle older GPUs and pricing pressure on renewals.",
  });

  // 6. List price changes during the quarter.
  const changes = inp.od.changes.filter((c) => c.date >= from && c.date <= end && c.from && c.to);
  const avgChange = mean(changes.map((c) => c.to! / c.from! - 1));
  push({
    id: "list-price",
    label: "On-demand list prices",
    value: avgChange === null ? "No change" : `${avgChange > 0 ? "+" : ""}${Math.round(avgChange * 100)}% average change`,
    score: avgChange === null ? 0 : clamp(avgChange / 0.15),
    weight: 1.5,
    coverage: 1,
    note: "Raising list prices signals demand ahead of supply.",
  });

  // 7. Token Factory volume on OpenRouter, quarter vs prior quarter (tiny share of revenue).
  const tok = (a: string, b: string) => {
    const ds = Object.entries(inp.tokens.days).filter(([d]) => d >= a && d <= b);
    return { total: sum(ds.map(([, v]) => sum(Object.values(v)))), n: ds.length };
  };
  const tNow = tok(from, end);
  const tPrev = tok(prevFrom, addDays(from, -1));
  const ratio = tPrev.n >= 20 && tNow.n >= 20 ? tNow.total / tNow.n / (tPrev.total / tPrev.n) : null;
  push({
    id: "tokens",
    label: "Token Factory on OpenRouter",
    value: ratio === null ? `${tNow.n} days tracked` : `${ratio >= 1 ? "+" : ""}${Math.round((ratio - 1) * 100)}% daily volume vs prior quarter`,
    score: ratio === null ? 0 : clamp(Math.log2(ratio) / 2),
    weight: 0.5,
    coverage: ratio === null ? 0 : Math.min(1, tNow.n / days(from, to)),
    note: "Under 0.1% of revenue: a demand-breadth read only.",
  });

  return out;
}

export async function buildNowcast(asOf: string): Promise<{ quarters: Nowcast[]; scorecard: ScorecardRow[]; realization: number | null }> {
  const inp = await load();
  const { f } = inp;
  const reported = f.quarters;
  const last = reported.at(-1);

  // Revenue realized per $ of average in-quarter ARR (quarterly), from quarters with ARR at both ends.
  const ratios: number[] = [];
  for (let i = 1; i < reported.length; i++) {
    const a = reported[i - 1]!.arr;
    const b = reported[i]!.arr;
    if (a && b) ratios.push(reported[i]!.revenue / ((a + b) / 2 / 4));
  }
  const r = mean(ratios) ?? 1;

  // Last surprise vs consensus feeds a small "track record" prior.
  const lastScored = [...reported].reverse().find((q) => q.consensus);
  const lastSurprise = lastScored?.consensus ? lastScored.revenue / lastScored.consensus - 1 : 0;
  const prior = clamp(lastSurprise * 0.5, -0.03, 0.03);

  const upcoming = (f.upcoming ?? []).filter((u) => !reported.some((q) => q.quarter === u.quarter));
  const nGuidance = upcoming.filter((u) => u.quarter.startsWith(String(f.guidance.year))).length;
  const arr0 = last?.arr ?? null;
  const booked = sum(reported.filter((q) => q.quarter.startsWith(String(f.guidance.year))).map((q) => q.revenue));

  const out: Nowcast[] = [];
  let estimatedSoFar = 0;
  upcoming.forEach((u, k) => {
    // ARR path: straight line from the last reported ARR to the guided exit, one step per quarter.
    const path = (target: number) => {
      if (!arr0 || !nGuidance) return null;
      const at = (i: number) => arr0 + ((target - arr0) * i) / nGuidance;
      return ((at(k) + at(k + 1)) / 2 / 4) * r;
    };
    const [lo, hi] = f.guidance.arrExit;
    const context = {
      floor: arr0 ? (arr0 / 4) * r : null,
      pathLow: path(lo),
      pathMid: path((lo + hi) / 2),
      pathHigh: path(hi),
    };

    const from = startOf(u.end);
    const signals = signalsFor(inp, from, u.end, asOf);
    const totalW = sum(signals.map((s) => s.weight));
    const effW = sum(signals.map((s) => s.weight * s.coverage));
    const score = effW ? sum(signals.map((s) => s.score * s.weight * s.coverage)) / effW : 0;
    for (const s of signals) s.contribution = effW ? TILT_PER_SCORE * ((s.score * s.weight * s.coverage) / effW) : 0;
    const tilt = TILT_PER_SCORE * score + prior;

    // Anchor: consensus, else what full-year guidance (midpoint) leaves for this quarter.
    const remainingAfter = nGuidance - k - 1;
    const guidanceImplied = (f.guidance.revenue[0] + f.guidance.revenue[1]) / 2 - booked - estimatedSoFar - (remainingAfter > 0 ? (context.pathMid ?? 0) * remainingAfter : 0);
    const anchor = u.consensus ? { kind: "consensus" as const, value: u.consensus } : { kind: "guidance-implied" as const, value: guidanceImplied };
    const estimate = anchor.value * (1 + tilt);
    estimatedSoFar += estimate;
    const spread = u.consensusRange ? (u.consensusRange[1] - u.consensusRange[0]) / 2 / anchor.value : 0;
    const band = Math.max(0.03, spread);

    out.push({
      quarter: u.quarter,
      end: u.end,
      status: asOf > u.end ? "ended" : "in progress",
      expectedReport: u.expectedReport,
      reportDateConfirmed: u.reportDateConfirmed,
      anchor: { ...anchor, range: u.consensusRange, source: u.source },
      estimate,
      low: estimate * (1 - band),
      high: estimate * (1 + band),
      tilt,
      lean: !u.consensus ? "no consensus" : tilt > LEAN_THRESHOLD ? "beat" : tilt < -LEAN_THRESHOLD ? "miss" : "in line",
      coverage: totalW ? effW / totalW : 0,
      priorFromLastSurprise: prior,
      signals,
      context,
    });
  });

  const history = await readJson<Record<string, Record<string, number>>>("nowcast/history.json", {});
  const scorecard: ScorecardRow[] = reported
    .filter((q) => q.consensus)
    .map((q) => {
      // The last guess recorded before the quarter's results (roughly 45 days after quarter end).
      const cutoff = addDays(q.end, 45);
      const guesses = Object.entries(history).filter(([d, v]) => d <= cutoff && v[q.quarter] !== undefined).sort(([a], [b]) => a.localeCompare(b));
      const nowcast = guesses.at(-1)?.[1][q.quarter] ?? null;
      const surprise = q.revenue / q.consensus! - 1;
      const leanCalled = nowcast === null ? null : nowcast / q.consensus! - 1;
      return {
        quarter: q.quarter,
        consensus: q.consensus!,
        actual: q.revenue,
        surprise,
        nowcast,
        correctDirection: leanCalled === null ? null : Math.abs(leanCalled) < LEAN_THRESHOLD ? Math.abs(surprise) < LEAN_THRESHOLD : Math.sign(leanCalled) === Math.sign(surprise),
      };
    });

  return { quarters: out, scorecard, realization: ratios.length ? r : null };
}
