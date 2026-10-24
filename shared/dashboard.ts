// The one dataset the dashboard loads (public/data/dashboard.json). Built by collector/build-dashboard.ts.

export type Severity = "high" | "medium" | "info";

export type DashAlert = { id: string; date: string; source: string; severity: Severity; title: string; detail?: string; url?: string };

export type SourceHealth = { id: string; label: string; url: string; ok: boolean; lastSuccess: string | null; summary?: string; error?: string; stale: boolean };

/** $ per million tokens. `nebius` = Nebius's own OpenRouter endpoint price; `catalog` = OpenRouter list price (endpoint no longer listed). */
export type ModelPricing = { id: string; name: string; input: number; output: number; cacheRead: number | null; priceSource: "nebius" | "catalog" };

export type Dashboard = {
  generatedAt: string;
  sources: SourceHealth[];
  alerts: DashAlert[];

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
    daily: { date: string; total: number }[];
    byFunction: { name: string; count: number }[];
    byRegion: { name: string; count: number }[];
    new7d: number;
    dcRoles: { title: string; location: string; firstSeen: string; url: string }[];
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
