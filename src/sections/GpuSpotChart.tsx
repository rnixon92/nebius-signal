import { useEffect, useMemo, useState } from "react";
import type { Dashboard } from "../../shared/dashboard.ts";
import { TimeSeriesCard } from "../components/TimeSeriesCard.tsx";
import { Card, CardTitle, Segmented } from "../components/ui.tsx";
import { pct, usd } from "../lib/format.ts";
import type { Range } from "../lib/range.ts";
import { GPU_SLOT, type Palette } from "../lib/theme.ts";

type Agg = "equal" | "weighted" | "min" | "max";
type Metric = "ratio" | "price";
type View = "gpu" | "region";

const AGG_LABEL: Record<Agg, string> = { equal: "Average", weighted: "Capacity-weighted", min: "Cheapest region", max: "Tightest region" };
const WEIGHTS_KEY = "regionWeights";

const familyColor = (p: Palette, fam: string) => p.series[GPU_SLOT[fam] ?? 7]!;

function readWeights(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(WEIGHTS_KEY) ?? "{}") as Record<string, number>;
  } catch {
    return {};
  }
}

function aggregate(values: { v: number; w: number }[], agg: Agg): number | null {
  if (!values.length) return null;
  if (agg === "min") return Math.min(...values.map((x) => x.v));
  if (agg === "max") return Math.max(...values.map((x) => x.v));
  if (agg === "weighted") {
    const wsum = values.reduce((a, x) => a + x.w, 0);
    if (wsum > 0) return values.reduce((a, x) => a + x.v * x.w, 0) / wsum;
  }
  return values.reduce((a, x) => a + x.v, 0) / values.length;
}

/**
 * Spot chart with the controls an analyst needs: per-GPU lines combined across regions (average,
 * capacity-weighted, cheapest or tightest), or one GPU split by region, with a region filter.
 */
export function GpuSpotChart({ d, p, range }: { d: Dashboard; p: Palette; range: Range }) {
  const g = d.gpu;
  const [metric, setMetric] = useState<Metric>("ratio");
  const [view, setView] = useState<View>("gpu");
  const [agg, setAgg] = useState<Agg>("equal");
  const [family, setFamily] = useState<string>(g.families[0] ?? "B300");
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [overrides, setOverrides] = useState<Record<string, number>>(readWeights);

  useEffect(() => {
    try {
      localStorage.setItem(WEIGHTS_KEY, JSON.stringify(overrides));
    } catch {
      // per-visit only
    }
  }, [overrides]);

  const spotRegions = useMemo(() => [...new Set(g.pools.map((x) => x.region))].sort(), [g.pools]);
  const regionColor = (r: string) => p.series[spotRegions.indexOf(r) % 8]!;

  // Region weights: user override, else the public proxy, else the median of the known proxies.
  const weights = useMemo(() => {
    const known = g.regionWeights.filter((w) => w.mw !== null).map((w) => w.mw!).sort((a, b) => a - b);
    const median = known.length ? (known.length % 2 ? known[(known.length - 1) / 2]! : (known[known.length / 2 - 1]! + known[known.length / 2]!) / 2) : 1;
    return Object.fromEntries(
      spotRegions.map((r) => {
        const proxy = g.regionWeights.find((w) => w.region === r);
        const value = overrides[r] ?? proxy?.mw ?? median;
        const source = overrides[r] !== undefined ? "yours" : proxy?.mw != null ? "public" : "default";
        return [r, { value, source, basis: proxy?.basis ?? "No public capacity figure", location: proxy?.location ?? "", median }];
      }),
    ) as Record<string, { value: number; source: "yours" | "public" | "default"; basis: string; location: string; median: number }>;
  }, [g.regionWeights, spotRegions, overrides]);

  const daily = metric === "ratio" ? g.poolRatioDaily : g.poolPriceDaily;
  const included = (region: string) => !excluded.has(region);

  const { rows, series } = useMemo(() => {
    if (view === "region") {
      const pools = g.pools.filter((x) => x.family === family && included(x.region));
      return {
        rows: daily.map((row) => ({ date: row.date, ...Object.fromEntries(pools.filter((x) => typeof row[x.skuId] === "number").map((x) => [x.region, row[x.skuId] as number])) })),
        series: pools.map((x) => ({ key: x.region, label: `${x.region}${weights[x.region]?.location ? ` · ${weights[x.region]!.location.split(",")[0]}` : ""}`, color: regionColor(x.region) })),
      };
    }
    const fams = g.families.filter((f) => g.pools.some((x) => x.family === f && included(x.region)));
    return {
      rows: daily.map((row) => {
        const out: Record<string, number | string> = { date: row.date };
        for (const f of fams) {
          const vals = g.pools
            .filter((x) => x.family === f && included(x.region) && typeof row[x.skuId] === "number")
            .map((x) => ({ v: row[x.skuId] as number, w: weights[x.region]?.value ?? 1 }));
          const v = aggregate(vals, agg);
          if (v !== null) out[f] = Math.round(v * 1e4) / 1e4;
        }
        return out as { date: string } & Record<string, number>;
      }),
      series: fams.map((f) => ({ key: f, label: f, color: familyColor(p, f) })),
    };
  }, [view, family, excluded, agg, daily, weights, g, p]);

  // Spot is uncapped from Nov 2, 2026, so the ratio axis grows past 100% when a pool trades above list.
  const ratioTop = useMemo(() => {
    const peak = Math.max(1, ...rows.flatMap((r) => series.map((s) => (r as Record<string, unknown>)[s.key]).filter((v): v is number => typeof v === "number")));
    return Math.ceil(peak * 4) / 4;
  }, [rows, series]);

  const fmt = metric === "ratio" ? (v: number) => pct(v) : (v: number) => usd(v, { cents: true });
  const title =
    view === "region"
      ? `${family} spot by region`
      : `${metric === "ratio" ? "Spot price as a share of on-demand" : "Spot price by GPU"} · ${AGG_LABEL[agg].toLowerCase()}`;
  const sub =
    view === "region"
      ? metric === "ratio"
        ? "Each region's daily mean spot price against the list price in force that day"
        : "Each region's daily mean spot price, $ per GPU-hour"
      : agg === "weighted"
        ? "Regions weighted by estimated live capacity (see weights below)"
        : agg === "min"
          ? "The lowest regional daily mean: what a spot buyer actually pays"
          : agg === "max"
            ? "The highest regional daily mean: the tightest pool for each GPU"
            : "Simple mean across regions, each region counted equally";

  const chips = (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {view === "gpu" ? (
          <Segmented label="Combine regions by" value={agg} onChange={setAgg} options={(Object.keys(AGG_LABEL) as Agg[]).map((a) => ({ value: a, label: AGG_LABEL[a] }))} />
        ) : (
          <Segmented label="GPU" value={family} onChange={setFamily} options={g.families.map((f) => ({ value: f, label: f }))} />
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Regions">
        <span className="mr-1 text-xs text-ink-3">Regions</span>
        {spotRegions
          .filter((r) => view === "gpu" || g.pools.some((x) => x.family === family && x.region === r))
          .map((r) => {
            const on = included(r);
            return (
              <button
                key={r}
                type="button"
                aria-pressed={on}
                onClick={() =>
                  setExcluded((prev) => {
                    const next = new Set(prev);
                    if (next.has(r)) next.delete(r);
                    else if (spotRegions.length - next.size > 1) next.add(r);
                    return next;
                  })
                }
                className={`rounded-md border px-2 py-0.5 font-mono text-[11px] transition-colors ${on ? "border-line bg-surface-2 text-ink" : "border-dashed border-line text-ink-3 line-through"}`}
                title={weights[r]?.location}
              >
                {r}
              </button>
            );
          })}
        {excluded.size > 0 && (
          <button type="button" onClick={() => setExcluded(new Set())} className="ml-1 text-xs font-medium text-accent hover:underline">
            All regions
          </button>
        )}
      </div>
    </div>
  );

  return (
    <>
      <TimeSeriesCard
        title={title}
        sub={sub}
        p={p}
        globalRange={range}
        rows={rows}
        series={series}
        format={fmt}
        change={metric === "ratio" ? "diff" : "pct"}
        diffFormat={(v) => `${Math.round(v * 100)} pts`}
        yDomain={metric === "ratio" ? [0, ratioTop] : [0, "auto"]}
        yTicks={metric === "ratio" ? Array.from({ length: ratioTop / 0.25 + 1 }, (_, i) => i * 0.25) : undefined}
        refY={metric === "ratio" ? [{ y: 1, label: "On-demand list price" }] : undefined}
        events={d.events.filter((e) => e.kind === "price" || e.kind === "capacity" || e.kind === "earnings")}
        csvName={`nebius-spot-${view === "region" ? family.replace(/\s+/g, "-").toLowerCase() + "-by-region" : agg}-${metric}`}
        height={300}
        filters={chips}
        controls={
          <>
            <Segmented
              label="Compare"
              value={view}
              onChange={setView}
              options={[
                { value: "gpu", label: "By GPU" },
                { value: "region", label: "By region" },
              ]}
            />
            <Segmented
              label="Spot metric"
              value={metric}
              onChange={setMetric}
              options={[
                { value: "ratio", label: "% of list" },
                { value: "price", label: "$/GPU-hr" },
              ]}
            />
          </>
        }
        note="Change is from the first to the last day in view. Click a legend item to hide it; click a region to drop it from the calculation."
      />

      {view === "gpu" && agg === "weighted" && (
        <Card>
          <CardTitle
            title="Capacity weights by region"
            sub="Nebius doesn't publish capacity per region. These are the best public proxies; type your own to override (saved in this browser)."
            right={
              Object.keys(overrides).length > 0 ? (
                <button type="button" onClick={() => setOverrides({})} className="text-sm font-medium text-accent hover:underline">
                  Reset to defaults
                </button>
              ) : undefined
            }
          />
          <div className="-mx-1 overflow-x-auto px-1">
            <table className="w-full border-collapse text-[13px]">
              <caption className="sr-only">Region capacity weights</caption>
              <thead>
                <tr className="border-b border-line text-left text-ink-3">
                  <th scope="col" className="px-2 py-2 font-medium">Region</th>
                  <th scope="col" className="px-2 py-2 font-medium">GPUs on spot</th>
                  <th scope="col" className="px-2 py-2 text-right font-medium">Weight (MW)</th>
                  <th scope="col" className="px-2 py-2 font-medium">Source</th>
                </tr>
              </thead>
              <tbody>
                {spotRegions.map((r) => {
                  const w = weights[r]!;
                  return (
                    <tr key={r} className="border-b border-line last:border-0">
                      <td className="px-2 py-2">
                        <span className="font-mono text-[12px]">{r}</span>
                        <span className="ml-2 text-ink-3">{w.location}</span>
                      </td>
                      <td className="px-2 py-2 text-ink-2">{g.pools.filter((x) => x.region === r).map((x) => x.family).join(", ")}</td>
                      <td className="px-2 py-2 text-right">
                        <input
                          type="number"
                          min={0}
                          step={1}
                          value={Math.round(w.value * 10) / 10}
                          onChange={(e) => {
                            const v = Number(e.target.value);
                            setOverrides((o) => ({ ...o, [r]: Number.isFinite(v) && v >= 0 ? v : 0 }));
                          }}
                          aria-label={`Weight for ${r} in MW`}
                          className="tnum w-20 rounded-md border border-line bg-surface-2 px-2 py-1 text-right"
                        />
                      </td>
                      <td className="px-2 py-2 text-xs leading-snug text-ink-2">
                        <span className={`mr-1.5 rounded px-1 py-0.5 text-[10px] font-semibold uppercase ${w.source === "public" ? "bg-accent-wash text-accent" : w.source === "yours" ? "bg-[color-mix(in_srgb,var(--good)_14%,transparent)] text-good" : "bg-surface-2 text-ink-3"}`}>
                          {w.source === "public" ? "Public" : w.source === "yours" ? "Yours" : "Default"}
                        </span>
                        {w.source === "default" ? `Unknown, so set to the median of known regions (${Math.round(w.median)} MW)` : w.basis}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-ink-3">
            Weights are per region, not per GPU type: in a region with several GPU types, each type gets the region's full weight against other regions offering the same GPU. Spot
            only exists where there is spare capacity, so a big region with no spot pool for a GPU simply doesn't appear.
          </p>
        </Card>
      )}
    </>
  );
}
