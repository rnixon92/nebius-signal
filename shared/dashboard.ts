// The one dataset the dashboard loads (public/data/dashboard.json). Built by collector/build-dashboard.ts.

export type Severity = "high" | "medium" | "info";

export type DashAlert = { id: string; date: string; source: string; severity: Severity; title: string; detail?: string; url?: string };

export type SourceHealth = { id: string; label: string; url: string; ok: boolean; lastSuccess: string | null; summary?: string; error?: string; stale: boolean };

/** $ per million tokens. `nebius` = Nebius's own OpenRouter endpoint price; `catalog` = OpenRouter list price (endpoint no longer listed). */
export type ModelPricing = { id: string; name: string; input: number; output: number; cacheRead: number | null; priceSource: "nebius" | "catalog" };

export type NowcastSignal = {
  id: string;
  label: string;
  /** Human-readable reading, e.g. "72% average". */
  value: string;
  /** −1 (points to a miss) … +1 (points to a beat). */
  score: number;
  /** Prior importance (uncalibrated). */
  weight: number;
  /** Share of the quarter the data covers, 0–1. Effective weight = weight × coverage. */
  coverage: number;
  /** This signal's share of the tilt, as a fraction of the anchor. */
  contribution: number;
  note: string;
};

export type Nowcast = {
  quarter: string;
  end: string;
  status: "ended" | "in progress";
  expectedReport: string | null;
  reportDateConfirmed: boolean;
  anchor: { kind: "consensus" | "guidance-implied"; value: number; range: [number, number] | null; source: string | null };
  /** USD millions. */
  estimate: number;
  low: number;
  high: number;
  tilt: number;
  lean: "beat" | "miss" | "in line" | "no consensus";
  /** Effective weight ÷ total weight: how much of the model has data behind it. */
  coverage: number;
  priorFromLastSurprise: number;
  signals: NowcastSignal[];
  /** Mechanical bounds from the ARR path, USD millions. */
  context: { floor: number | null; pathLow: number | null; pathMid: number | null; pathHigh: number | null };
};

export type ScorecardRow = { quarter: string; consensus: number; actual: number; surprise: number; nowcast: number | null; correctDirection: boolean | null };

export type SiteRow = {
  id: string;
  name: string;
  country: string;
  model: string;
  mw: number | null;
  mwNote?: string;
  status: "live" | "ramping" | "construction" | "planned" | "contracted" | "unconfirmed";
  expected?: string;
  region: string | null;
  note?: string;
  sources: string[];
  /** GPU families Nebius's docs list in this site's region. */
  platforms: string[];
  spotPools: number;
  dcRolesOpen: number;
  dcRolesPosted90d: number;
  news90d: number;
  risk90d: number;
  progress90d: number;
  latest: { title: string; date: string; url: string; tag: "risk" | "progress" | null } | null;
};

export type PowerPoint = { date: string; mw: number; low?: number; high?: number; kind: "actual" | "target" | "implied"; asOf: string; note?: string; source?: string };

export type PowerData = {
  definitions: Record<"contracted" | "connected" | "active", string>;
  contracted: PowerPoint[];
  connected: PowerPoint[];
  /** Reported active power, plus model points implied by ARR ÷ yield (kind "implied"). */
  active: PowerPoint[];
  guidanceHistory: { asOf: string; mw: number }[];
  statements: { date: string; text: string; source: string }[];
  contracts: { customer: string; signed: string; tcv: number; tcvMax: number | null; years: number | null; annual: number | null; site: string; status: string; source: string }[];
  /** USD millions per year. */
  committedAnnual: number;
  latestArr: { value: number; date: string } | null;
  /** $M of ARR per active MW, where both are reported for the same date. */
  arrPerActiveMw: { value: number; date: string } | null;
  newDealYield: [number, number] | null;
  /** Active MW the year-end ARR guidance implies, at the new-deal yield: [low ARR & high yield, high ARR & low yield]. */
  impliedActiveAtGuidance: [number, number] | null;
  connectedTarget: [number, number] | null;
  /** Live spot pools right now: the capacity visibly available outside committed contracts. */
  spotPools: number;
  /** Power statements auto-extracted from the newest shareholder letters, for review. */
  extracted: { filed: string; url: string; sentences: string[] }[];
};

/** Dated annotation for time-series charts. */
export type ChartEvent = { date: string; label: string; kind: "earnings" | "price" | "capacity" | "financing" | "site" };

export type Dashboard = {
  generatedAt: string;
  sources: SourceHealth[];
  alerts: DashAlert[];
  events: ChartEvent[];

  nowcast: { quarters: Nowcast[]; scorecard: ScorecardRow[]; realization: number | null; history: { date: string; [quarter: string]: number | string }[] };

  power: PowerData;

  sites: {
    rows: SiteRow[];
    mwByStatus: { status: SiteRow["status"]; mw: number; sites: number }[];
    news: { title: string; publisher: string; date: string; url: string; sites: string[]; tag: "risk" | "progress" | null }[];
    regionChanges: { date: string; kind: string; region: string; platform?: string }[];
  };

  stock: { series: [string, number][]; last: { date: string; close: number; chg1d: number | null; chg30d: number | null } | null };

  gpu: {
    snapshotTime: string | null;
    /** Rate card rows in display order. */
    onDemand: { name: string; family: string; onDemand: number | null; onDemandFrom: boolean; preemptibleFrom: number | null }[];
    changes: { date: string; name: string; from: number | null; to: number | null; source?: string }[];
    /** Live spot price per GPU platform and region. `ratio` = spot ÷ on-demand list price. */
    spotNow: { skuId: string; family: string; region: string; price: number; onDemand: number | null; ratio: number | null; effectiveTime: string; spark: number[] }[];
    families: string[];
    /** Per day: mean across regions of each family's spot ÷ on-demand (on-demand as of that day). */
    ratioDaily: ({ date: string } & Record<string, number | string>)[];
    /** Per day: cheapest regional daily-mean spot price per family, $/GPU-hour. */
    priceDaily: ({ date: string } & Record<string, number | string>)[];
    availability: { date: string; skus: number }[];
    tightness: { blackwell: number | null; hopper: number | null };
  };

  tokens: {
    /** Complete and partial UTC days, oldest first. byModel holds every model (unfolded) for revenue maths. */
    daily: { date: string; partial: boolean; total: number; byModel: Record<string, number> }[];
    /** Display order for the stacked chart; everything else folds into "Other". */
    topModels: string[];
    pricing: Record<string, ModelPricing>;
    week: { end: string; tokens: number; prev: number; change: number | null };
    market: { date: string; nebius: number; total: number; share: number; rank: number | null; providers: number }[];
    peers: { slug: string; name: string; week: number; prevWeek: number; change: number | null; isNebius: boolean }[];
  };

  atlas: {
    total: number;
    tokenFactory: number;
    aiCloud: number;
    cumulative: { date: string; total: number; added: number }[];
    byCategory: { name: string; count: number }[];
    byService: { name: string; count: number }[];
    recent: { name: string; category: string; use: string; services: string[]; date: string }[];
  };

  jobs: {
    total: number;
    /** Open roles as observed (archive snapshots, then daily runs), with cumulative roles posted and closed among all roles ever seen. */
    daily: { date: string; total: number; posted: number; closed: number; archive: boolean }[];
    /** Every role ever seen (open + closed) since the archive history starts. */
    tracked: number;
    trackedSince: string | null;
    closed30d: number;
    /** Median days from posting to leaving the board, for roles closed in the last 180 days. */
    medianDaysToClose: number | null;
    daysToCloseByFunction: { name: string; days: number; n: number }[];
    byFunction: { name: string; count: number }[];
    byRegion: { name: string; count: number }[];
    new7d: number;
    dcRoles: { title: string; location: string; posted: string; url: string }[];
    /** Roles by posting month: "Still open" + "Closed" = all posted that month, plus the same total split by function. */
    postedByMonth: ({ date: string } & Record<string, number | string>)[];
  };

  sec: {
    filings: { filed: string; form: string; title: string; url: string; kind: "results" | "corporate" | "insider" | "ownership" | "other" }[];
    insiders: { owner: string; role: string; sold: number; bought: number; planned: number; lastDate: string }[];
    totals90d: { sold: number; bought: number; planned: number };
  };

  fundamentals: {
    quarters: { quarter: string; end: string; revenue: number; arr: number | null; source: string }[];
    guidance: { year: number; asOf: string; arrExit: [number, number]; revenue: [number, number]; capex: [number, number]; adjEbitdaMargin: number; contractedPowerGw: number; source: string };
    /** Average revenue per remaining quarter needed to hit the low and high ends of revenue guidance. */
    neededPerQuarter: [number, number] | null;
    remainingQuarters: number;
    /** A results 6-K newer than the latest quarter in fundamentals.json (time to update it). */
    newerResults: { filed: string; title: string; url: string } | null;
  };
};
