import { useMemo, useState } from "react";
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Dashboard, PowerPoint } from "../../shared/dashboard.ts";
import { CHART_MARGIN, axisX, axisY, grid, type TipProps } from "../components/chart.tsx";
import { timeTicks, toTime } from "../components/TimeSeriesCard.tsx";
import { Card, CardTitle, DataTable, ExtLink, Stat, TooltipCard } from "../components/ui.tsx";
import { day, usdM } from "../lib/format.ts";
import { href } from "../lib/router.ts";
import type { Palette } from "../lib/theme.ts";

const mw = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(v % 1000 ? 1 : 0)} GW` : `${Math.round(v)} MW`);

type Row = { date: string; t: number } & Record<string, number | [number, number] | string | undefined>;

/** Merge several point series onto one date-keyed table, one column per series. */
function merge(series: Record<string, PowerPoint[]>, bandKey?: { from: string; key: string }): Row[] {
  const rows = new Map<string, Row>();
  for (const [key, pts] of Object.entries(series)) {
    for (const pt of pts) {
      const r = rows.get(pt.date) ?? ({ date: pt.date, t: toTime(pt.date) } as Row);
      r[key] = pt.mw;
      r[`${key}Note`] = pt.note;
      if (bandKey?.from === key && pt.low !== undefined && pt.high !== undefined) r[bandKey.key] = [pt.low, pt.high];
      rows.set(pt.date, r);
    }
  }
  return [...rows.values()].sort((a, b) => a.t - b.t);
}

/**
 * Actuals as solid lines, guidance as dashed lines (a projection, the one place dashes belong),
 * the model as a dotted line with a shaded low–high band.
 */
function PowerChart({ title, sub, rows, lines, p, height = 260 }: {
  title: string;
  sub: string;
  rows: Row[];
  lines: { key: string; label: string; color: string; style: "actual" | "target" | "implied"; band?: string }[];
  p: Palette;
  height?: number;
}) {
  const ticks = useMemo(() => (rows.length > 1 ? timeTicks(rows[0]!.t, rows.at(-1)!.t) : null), [rows]);
  return (
    <Card>
      <CardTitle title={title} sub={sub} />
      <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1" aria-label="Legend">
        {lines.map((l) => (
          <li key={l.key} className="flex items-center gap-1.5 text-xs text-ink-2">
            <svg width="18" height="6" aria-hidden>
              <line x1="0" y1="3" x2="18" y2="3" stroke={l.color} strokeWidth="2" strokeDasharray={l.style === "target" ? "5 3" : l.style === "implied" ? "1.5 3" : undefined} strokeLinecap="round" />
            </svg>
            {l.label}
          </li>
        ))}
      </ul>
      <div style={{ height }}>
        <ResponsiveContainer>
          <ComposedChart data={rows} margin={{ ...CHART_MARGIN, right: 16 }}>
            <CartesianGrid {...grid(p)} />
            <XAxis {...axisX(p)} dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} ticks={ticks?.ticks} tickFormatter={ticks?.format} interval={0} padding={{ left: 8, right: 8 }} />
            <YAxis {...axisY(p, (v) => mw(v), { width: 60 })} domain={[0, "auto"]} />
            <Tooltip cursor={{ stroke: p.rule, strokeWidth: 1 }} content={(t) => <PowerTip {...(t as TipProps)} lines={lines} />} />
            {lines.filter((l) => l.band).map((l) => (
              <Area key={`${l.key}-band`} dataKey={l.band!} stroke="none" fill={l.color} fillOpacity={0.12} connectNulls isAnimationActive={false} />
            ))}
            {lines.map((l) => (
              <Line
                key={l.key}
                dataKey={l.key}
                stroke={l.color}
                strokeWidth={2}
                strokeDasharray={l.style === "target" ? "6 4" : l.style === "implied" ? "1.5 4" : undefined}
                dot={{ r: 4, fill: l.style === "actual" ? l.color : p.surface, stroke: l.color, strokeWidth: 2 }}
                activeDot={{ r: 5, stroke: p.surface, strokeWidth: 2, fill: l.color }}
                connectNulls
                isAnimationActive={false}
              />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

function PowerTip({ active, payload, lines }: TipProps & { lines: { key: string; label: string; color: string; band?: string }[] }) {
  const row = payload?.[0]?.payload as Row | undefined;
  if (!active || !row) return null;
  const rows = lines.flatMap((l) => {
    const v = row[l.key];
    if (typeof v !== "number") return [];
    const band = l.band ? (row[l.band] as [number, number] | undefined) : undefined;
    return [{ name: l.label, value: band ? `${mw(band[0])}–${mw(band[1])}` : mw(v), color: l.color }];
  });
  const notes = lines.map((l) => row[`${l.key}Note`]).filter((n): n is string => typeof n === "string");
  return <TooltipCard title={day(row.date, true)} rows={rows} footer={notes.length ? notes.join(" · ") : undefined} />;
}

export function PowerPanel({ d, p }: { d: Dashboard; p: Palette }) {
  const pw = d.power;
  const [showAllStatements, setShowAll] = useState(false);
  const lastContracted = [...pw.contracted].reverse().find((x) => x.kind === "actual");
  const contractedTarget = [...pw.contracted].reverse().find((x) => x.kind === "target");
  const lastActive = [...pw.active].reverse().find((x) => x.kind === "actual");
  const lastImplied = [...pw.active].filter((x) => x.kind === "implied" && x.date <= d.generatedAt.slice(0, 10)).at(-1);

  const secured = useMemo(() => {
    // Plot the year-end target at the date each raise was announced, to show it being raised over time.
    const raises: PowerPoint[] = pw.guidanceHistory.map((g) => ({ date: g.asOf, mw: g.mw, kind: "target", asOf: g.asOf, note: `Year-end target raised to ${mw(g.mw)}` }));
    return merge({ securedActual: pw.contracted.filter((x) => x.kind === "actual"), securedTarget: raises });
  }, [pw]);

  const running = useMemo(
    () =>
      merge(
        {
          connActual: pw.connected.filter((x) => x.kind === "actual"),
          connTarget: [...pw.connected.filter((x) => x.kind === "actual").slice(-1), ...pw.connected.filter((x) => x.kind === "target")],
          activeActual: pw.active.filter((x) => x.kind === "actual"),
          activeImplied: [...pw.active.filter((x) => x.kind === "actual").slice(-1), ...pw.active.filter((x) => x.kind === "implied")],
        },
        { from: "activeImplied", key: "activeBand" },
      ),
    [pw],
  );

  const arr = pw.latestArr?.value ?? 0;
  const maxBar = Math.max(arr, pw.committedAnnual, 1);

  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Secured power (contracted)"
          value={lastContracted ? `>${mw(lastContracted.mw)}` : "—"}
          note={lastContracted ? `As of ${day(lastContracted.date, true)} · target ${contractedTarget ? mw(contractedTarget.mw) : "—"} by year-end` : undefined}
        />
        <Stat label="Connected power target" value={pw.connectedTarget ? `${mw(pw.connectedTarget[0])}–${mw(pw.connectedTarget[1])}` : "—"} note="Built and equipped, by year-end 2026" />
        <Stat
          label="Active power (running GPUs)"
          value={lastActive ? `~${mw(lastActive.mw)}` : "—"}
          note={
            <>
              Reported {lastActive ? day(lastActive.date, true) : ""}
              {lastImplied && lastImplied.low !== undefined ? ` · model ~${mw(lastImplied.low)}–${mw(lastImplied.high!)} by ${day(lastImplied.date, true)}` : ""}
            </>
          }
        />
        <Stat
          label="Active power ARR guidance implies"
          value={pw.impliedActiveAtGuidance ? `${mw(pw.impliedActiveAtGuidance[0])}–${mw(pw.impliedActiveAtGuidance[1])}` : "—"}
          note={pw.newDealYield ? `By year-end, at $${pw.newDealYield[0]}–${pw.newDealYield[1]}M per MW for new capacity` : undefined}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <PowerChart
          title="Secured power"
          sub="Land and power under contract (supply, not customers): reported, and the year-end target each time it was raised"
          rows={secured}
          lines={[
            { key: "securedActual", label: "Secured (reported)", color: p.series[0]!, style: "actual" },
            { key: "securedTarget", label: "Year-end 2026 target, as guided", color: p.series[1]!, style: "target" },
          ]}
          p={p}
        />
        <PowerChart
          title="Built and running power"
          sub="Connected (built data centers) and active (running GPUs that can bill), with guidance and a revenue-implied model"
          rows={running}
          lines={[
            { key: "connActual", label: "Connected (reported)", color: p.series[0]!, style: "actual" },
            { key: "connTarget", label: "Connected (guided)", color: p.series[0]!, style: "target" },
            { key: "activeActual", label: "Active (reported)", color: p.series[2]!, style: "actual" },
            { key: "activeImplied", label: "Active (implied by ARR)", color: p.series[2]!, style: "implied", band: "activeBand" },
          ]}
          p={p}
        />
      </div>

      <Card>
        <CardTitle title="Live capacity: committed vs open to spot" sub="How much running capacity is locked into long-term contracts, and how much is left to sell on-demand or as spot" />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2.5">
              {[
                { label: `ARR (run-rate, ${pw.latestArr ? day(pw.latestArr.date, true) : ""})`, v: arr, color: p.accent },
                { label: "Known long-term contracts, per year once delivered", v: pw.committedAnnual, color: p.series[1]! },
              ].map((b) => (
                <div key={b.label}>
                  <div className="mb-1 flex justify-between gap-2 text-[13px]">
                    <span className="text-ink-2">{b.label}</span>
                    <span className="tnum font-semibold">{usdM(b.v)}</span>
                  </div>
                  <div className="h-2.5 rounded-full bg-surface-2">
                    <div className="h-full rounded-r-[4px] rounded-l-full" style={{ width: `${(b.v / maxBar) * 100}%`, background: b.color }} />
                  </div>
                </div>
              ))}
            </div>
            <p className="text-sm leading-relaxed text-ink-2">
              The Microsoft and Meta contracts alone come to about <span className="font-semibold text-ink">{usdM(pw.committedAnnual)} a year</span>, more than the whole run-rate in
              June, before counting the four $1B+ deals signed in Q2. Nebius also said it ran <span className="font-semibold text-ink">sold out at peak utilization</span> in Q4 2025.
              So most live capacity is committed, and capacity selling at spot or on-demand prices is a thin residual.
            </p>
            <p className="text-sm leading-relaxed text-ink-2">
              That residual is visible directly: <span className="font-semibold text-ink">{pw.spotPools} GPU pools</span> are offering spot capacity right now.{" "}
              <a href={href("gpu")} className="font-medium text-accent hover:underline">
                Spot prices and pools →
              </a>
            </p>
            <p className="text-xs text-ink-3">
              Annual values assume contract value spread evenly over the stated term. Revenue per MW was about {pw.arrPerActiveMw ? usdM(pw.arrPerActiveMw.value) : "—"} at end-2025 versus{" "}
              {pw.newDealYield ? `$${pw.newDealYield[0]}–${pw.newDealYield[1]}M` : "—"} on the newest deals, so each new MW earns roughly three times the old fleet.
            </p>
          </div>
          <DataTable
            caption="Known long-term contracts"
            rows={pw.contracts}
            columns={[
              { key: "c", label: "Customer", render: (r) => <ExtLink href={r.source} className="font-medium no-underline hover:underline">{r.customer}</ExtLink> },
              { key: "s", label: "Signed", render: (r) => <span className="whitespace-nowrap text-ink-3">{day(r.signed, true)}</span> },
              { key: "v", label: "Total value", align: "right", render: (r) => `${usdM(r.tcv)}${r.tcvMax ? `–${usdM(r.tcvMax)}` : ""}${r.customer.startsWith("Four") ? "+" : ""}` },
              { key: "a", label: "Per year", align: "right", render: (r) => (r.annual ? usdM(r.annual) : <span className="text-ink-3">term n/d</span>) },
              { key: "st", label: "Status", render: (r) => <span className="text-ink-2">{r.status}</span> },
            ]}
          />
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle title="What Nebius has said about capacity" />
          <ul className="flex flex-col gap-3">
            {[...pw.statements].reverse().map((s) => (
              <li key={s.date} className="flex gap-3 text-sm">
                <span className="tnum w-24 shrink-0 text-xs text-ink-3">{day(s.date, true)}</span>
                <span className="text-ink-2">
                  {s.text}{" "}
                  <ExtLink href={s.source} className="text-xs text-ink-3">
                    letter
                  </ExtLink>
                </span>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardTitle title="Power statements in recent letters" sub="Pulled automatically from each results filing; new ones raise an alert so the figures above can be updated" />
          <ul className="flex flex-col gap-3">
            {pw.extracted.slice(0, showAllStatements ? undefined : 1).map((e) => (
              <li key={e.filed}>
                <p className="mb-1 text-xs text-ink-3">
                  {day(e.filed, true)} ·{" "}
                  <ExtLink href={e.url} className="text-ink-3">
                    filing
                  </ExtLink>
                </p>
                <ul className="list-disc space-y-1 pl-5 text-[13px] text-ink-2">
                  {e.sentences.slice(0, 6).map((s) => (
                    <li key={s}>{s.replace(/^[•○●\s]+/, "")}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
          {pw.extracted.length > 1 && (
            <button type="button" onClick={() => setShowAll((v) => !v)} className="mt-3 text-sm font-medium text-accent hover:underline">
              {showAllStatements ? "Show latest only" : `Show ${pw.extracted.length - 1} earlier letters`}
            </button>
          )}
        </Card>
      </div>
    </>
  );
}
