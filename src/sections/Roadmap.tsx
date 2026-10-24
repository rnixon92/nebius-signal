import { useMemo, useState } from "react";
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Dashboard } from "../../shared/dashboard.ts";
import { CHART_MARGIN, axisX, axisY, grid, type TipProps } from "../components/chart.tsx";
import { timeTicks, toTime } from "../components/TimeSeriesCard.tsx";
import { Card, CardTitle, DataTable, TooltipCard } from "../components/ui.tsx";
import { day } from "../lib/format.ts";
import type { Palette } from "../lib/theme.ts";

const mw = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(v % 1000 ? 2 : 0)} GW` : `${Math.round(v)} MW`);

/**
 * Capacity expected online by quarter from dated site phases, stacked by geography, against Nebius's
 * connected-power guidance (a band) and satellite-observed live power. A dotted line shows how much
 * of the stack rests on announced timing rather than estimates.
 */
export function RoadmapPanel({ d, p }: { d: Dashboard; p: Palette }) {
  const r = d.power.roadmap;
  const [showPhases, setShowPhases] = useState(false);
  const rows = useMemo(
    () => r.rows.map((x) => ({ ...x, t: toTime(x.date), band: x.guidanceLow !== undefined ? [x.guidanceLow, x.guidanceHigh] : undefined })),
    [r.rows],
  );
  const ticks = useMemo(() => (rows.length > 1 ? timeTicks(rows[0]!.t, rows.at(-1)!.t) : null), [rows]);
  const colors = Object.fromEntries(r.groups.map((g, i) => [g, p.series[i]!]));
  const ye26 = r.rows.find((x) => x.date === "2026-12-31");
  const ye27 = r.rows.find((x) => x.date === "2027-12-31");

  return (
    <>
      <Card>
        <CardTitle title="Capacity roadmap" sub="MW expected online at sites with disclosed size and timing, by quarter, against Nebius's connected-power guidance" />
        <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1" aria-label="Legend">
          {r.groups.map((g) => (
            <li key={g} className="flex items-center gap-1.5 text-xs text-ink-2">
              <span aria-hidden className="h-2.5 w-2.5 rounded-[3px]" style={{ background: colors[g] }} />
              {g}
            </li>
          ))}
          <li className="flex items-center gap-1.5 text-xs text-ink-2">
            <span aria-hidden className="h-2.5 w-4 rounded-[3px]" style={{ background: p.muted }} />
            Nebius guidance (connected)
          </li>
          <li className="flex items-center gap-1.5 text-xs text-ink-2">
            <svg width="18" height="6" aria-hidden>
              <line x1="0" y1="3" x2="18" y2="3" stroke={p.ink2} strokeWidth="2" strokeDasharray="1.5 3" strokeLinecap="round" />
            </svg>
            Announced timing only
          </li>
          <li className="flex items-center gap-1.5 text-xs text-ink-2">
            <svg width="18" height="6" aria-hidden>
              <line x1="0" y1="3" x2="18" y2="3" stroke={p.accent} strokeWidth="2.5" strokeLinecap="round" />
            </svg>
            Seen live (satellite)
          </li>
        </ul>
        <div className="h-80">
          <ResponsiveContainer>
            <ComposedChart data={rows} margin={{ ...CHART_MARGIN, right: 16 }}>
              <CartesianGrid {...grid(p)} />
              <XAxis {...axisX(p)} dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} ticks={ticks?.ticks} tickFormatter={ticks?.format} interval={0} />
              <YAxis {...axisY(p, (v) => mw(v), { width: 68 })} domain={[0, "auto"]} />
              <Tooltip cursor={{ stroke: p.rule, strokeWidth: 1 }} content={(t) => <RoadmapTip {...(t as TipProps)} groups={r.groups} colors={colors} p={p} />} />
              <Area dataKey="band" stroke="none" fill={p.muted} fillOpacity={0.9} connectNulls isAnimationActive={false} />
              {r.groups.map((g) => (
                <Area key={g} dataKey={g} stackId="sites" type="stepAfter" stroke={colors[g]} strokeWidth={1} fill={colors[g]} fillOpacity={0.5} isAnimationActive={false} />
              ))}
              <Line dataKey="announced" type="stepAfter" stroke={p.ink2} strokeWidth={2} strokeDasharray="1.5 4" dot={false} isAnimationActive={false} />
              <Line dataKey="observed" type="stepAfter" stroke={p.accent} strokeWidth={2.5} dot={false} connectNulls isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        {ye26?.guidanceLow !== undefined && (
          <div className="mt-4 grid grid-cols-1 gap-3 border-t border-line pt-4 text-sm sm:grid-cols-2">
            <p className="leading-relaxed text-ink-2">
              <span className="font-semibold text-ink">End of 2026:</span> sites with disclosed size add up to about {mw(ye26.total)} ({mw(ye26.announced)} on announced timing), against{" "}
              {mw(ye26.guidanceLow!)}–{mw(ye26.guidanceHigh!)} of connected power guided. The other{" "}
              <span className="font-semibold text-ink">
                {mw(Math.max(0, ye26.guidanceLow! - ye26.total))}–{mw(Math.max(0, ye26.guidanceHigh! - ye26.total))}
              </span>{" "}
              has to come from live or contracted sites that don't disclose size ({r.undisclosed.join(", ")}) or capacity not yet announced.
            </p>
            {ye27?.guidanceLow !== undefined && (
              <p className="leading-relaxed text-ink-2">
                <span className="font-semibold text-ink">End of 2027:</span> disclosed sites reach about {mw(ye27.total)}, against roughly {mw(ye27.guidanceLow!)}–{mw(ye27.guidanceHigh!)} if
                Nebius delivers its planned "more than 1 GW a year" from 2027. Most of the 2027 step relies on the owned campuses (Pennsylvania, Birmingham, Independence, Lappeenranta) landing on time, after Vineland fills out in 2026.
              </p>
            )}
          </div>
        )}
        <p className="mt-3 text-xs leading-relaxed text-ink-3">
          Timing is announced only where marked; the rest spreads an announced size over an announced window. The chart runs to early 2029, just past where guidance stops; later phases are in the table. The 2027–28 guidance band extends the year-end 2026 target by the stated
          +1 GW a year. Satellite data covers only Vineland and Mäntsälä.{" "}
          <button type="button" onClick={() => setShowPhases((v) => !v)} className="font-medium text-accent hover:underline">
            {showPhases ? "Hide" : "Show"} the {r.phases.length} site phases behind this
          </button>
        </p>
        {showPhases && (
          <div className="mt-3">
            <DataTable
              caption="Site phases behind the roadmap"
              maxHeight={420}
              rows={r.phases}
              columns={[
                { key: "by", label: "By", render: (x) => <span className="whitespace-nowrap text-ink-3">{day(x.by, true)}</span> },
                { key: "site", label: "Site", render: (x) => <span className="font-medium">{x.site}</span> },
                { key: "mw", label: "Cumulative MW", align: "right", render: (x) => x.mw.toLocaleString() },
                {
                  key: "basis",
                  label: "Timing",
                  render: (x) => (
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${x.basis === "announced" ? "bg-accent-wash text-accent" : "bg-surface-2 text-ink-3"}`}>{x.basis}</span>
                  ),
                },
                { key: "note", label: "Note", render: (x) => <span className="text-ink-2">{x.note}</span> },
              ]}
            />
          </div>
        )}
      </Card>
    </>
  );
}

function RoadmapTip({ active, payload, groups, colors, p }: TipProps & { groups: string[]; colors: Record<string, string>; p: Palette }) {
  const row = payload?.[0]?.payload as (Record<string, unknown> & { date: string; total: number; announced: number; observed?: number; guidanceLow?: number; guidanceHigh?: number }) | undefined;
  if (!active || !row) return null;
  const rows = [
    ...groups.filter((g) => Number(row[g]) > 0).reverse().map((g) => ({ name: g, value: mw(Number(row[g])), color: colors[g] })),
    { name: "Disclosed sites, total", value: mw(row.total) },
    { name: "of which announced timing", value: mw(row.announced), color: p.ink2 },
    ...(row.guidanceLow !== undefined ? [{ name: "Guidance (connected)", value: row.guidanceLow === row.guidanceHigh ? mw(row.guidanceLow) : `${mw(row.guidanceLow)}–${mw(row.guidanceHigh!)}`, color: p.muted }] : []),
    ...(typeof row.observed === "number" ? [{ name: "Seen live (satellite)", value: mw(row.observed), color: p.accent }] : []),
  ];
  return <TooltipCard title={`By ${day(row.date, true)}`} rows={rows} />;
}
