import { useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Dashboard } from "../../shared/dashboard.ts";
import { CHART_MARGIN, TimeTip, axisX, axisY, cursor, grid } from "../components/chart.tsx";
import { Card, CardTitle, ChartFrame, DataTable, ExtLink, Legend, Meter, Section, Segmented, Sparkline } from "../components/ui.tsx";
import { day, pct, relativeTime, usd } from "../lib/format.ts";
import { clip, type Range } from "../lib/range.ts";
import { GPU_SLOT, type Palette } from "../lib/theme.ts";

const familyColor = (p: Palette, fam: string) => p.series[GPU_SLOT[fam] ?? 7]!;

/** From a shareholder's view a tight pool is good news (pricing power); slack is the warning. */
function tightness(ratio: number | null) {
  if (ratio === null) return null;
  if (ratio >= 0.85) return { label: "Tight", icon: "▲", cls: "text-good" };
  if (ratio <= 0.4) return { label: "Slack", icon: "▼", cls: "text-warn" };
  return null;
}

export function GpuSection({ d, p, range }: { d: Dashboard; p: Palette; range: Range }) {
  const [metric, setMetric] = useState<"ratio" | "price">("ratio");
  const g = d.gpu;
  const rows = clip(metric === "ratio" ? g.ratioDaily : g.priceDaily, range);
  const fmt = metric === "ratio" ? (v: number) => pct(v) : (v: number) => usd(v, { cents: true });
  const lastChange = g.changes.at(-1)?.date;

  return (
    <Section
      id="gpu"
      kicker="Lead signal"
      title="GPU pricing and spare capacity"
      intro={
        <>
          About 98% of Nebius revenue is GPU cloud. Spot (preemptible) prices move with spare capacity and are capped one cent below the on-demand list price. A ratio
          near 100% means that pool is nearly sold out; a low ratio means idle GPUs. Nebius only publishes 30 days of spot history, so this tracker keeps the long-run series.
        </>
      }
    >
      <ChartFrame
        title={metric === "ratio" ? "Spot price as a share of on-demand" : "Cheapest spot price by GPU"}
        sub={metric === "ratio" ? "Daily mean across regions, against the list price in force that day" : "Lowest regional daily mean, $ per GPU-hour"}
        controls={
          <Segmented
            label="Spot metric"
            value={metric}
            onChange={setMetric}
            options={[
              { value: "ratio", label: "% of list" },
              { value: "price", label: "$/GPU-hr" },
            ]}
          />
        }
        legend={<Legend items={g.families.map((f) => ({ label: f, color: familyColor(p, f) }))} />}
        chart={
          <div className="h-72">
            <ResponsiveContainer>
              <LineChart data={rows} margin={CHART_MARGIN}>
                <CartesianGrid {...grid(p)} />
                <XAxis {...axisX(p)} />
                <YAxis {...axisY(p, fmt)} domain={metric === "ratio" ? [0, 1] : [0, "auto"]} ticks={metric === "ratio" ? [0, 0.25, 0.5, 0.75, 1] : undefined} />
                {metric === "ratio" && <ReferenceLine y={1} stroke={p.rule} label={{ value: "On-demand cap", position: "insideTopRight", fill: p.ink3, fontSize: 11 }} />}
                {lastChange && rows.some((r) => r.date === lastChange) && (
                  <ReferenceLine x={lastChange} stroke={p.rule} label={{ value: "List price change", position: "insideTopLeft", fill: p.ink3, fontSize: 11 }} />
                )}
                <Tooltip cursor={cursor(p)} content={(t) => <TimeTip {...(t as object)} format={(v) => fmt(v)} />} />
                {g.families.map((f) => (
                  <Line key={f} dataKey={f} name={f} type="monotone" stroke={familyColor(p, f)} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: p.surface }} connectNulls isAnimationActive={false} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        }
        rows={rows}
        columns={[
          { key: "date", label: "Date", render: (r) => day(r.date, true) },
          ...g.families.map((f) => ({ key: f, label: f, align: "right" as const, render: (r: (typeof rows)[number]) => (typeof r[f] === "number" ? fmt(r[f] as number) : "—") })),
        ]}
      />

      <Card>
        <CardTitle
          title="Live spot prices by region"
          sub={
            <>
              Snapshot {relativeTime(g.snapshotTime)} from Nebius's public{" "}
              <ExtLink href="https://docs.nebius.com/signup-billing/spot-prices">spot price API</ExtLink>. Only pools with spot capacity are listed; a pool that drops out
              is usually sold out.
            </>
          }
        />
        <DataTable
          caption="Live spot prices by region"
          rows={g.spotNow}
          columns={[
            {
              key: "gpu",
              label: "GPU",
              render: (r) => (
                <span className="flex items-center gap-2 whitespace-nowrap font-medium">
                  <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: familyColor(p, r.family) }} />
                  {r.family}
                </span>
              ),
            },
            { key: "region", label: "Region", render: (r) => <span className="font-mono text-[12px] text-ink-2">{r.region}</span> },
            { key: "spot", label: "Spot", align: "right", render: (r) => usd(r.price, { cents: true }) },
            { key: "list", label: "On-demand", align: "right", render: (r) => (r.onDemand ? usd(r.onDemand, { cents: true }) : "—") },
            {
              key: "ratio",
              label: "Share of list",
              render: (r) => {
                const t = tightness(r.ratio);
                return r.ratio === null ? (
                  "—"
                ) : (
                  <div className="flex min-w-36 items-center gap-2">
                    <div className="w-20">
                      <Meter value={r.ratio} color={familyColor(p, r.family)} label={`${r.family} ${r.region} spot at ${pct(r.ratio)} of on-demand`} />
                    </div>
                    <span className="tnum w-9 text-right">{pct(r.ratio)}</span>
                    {t && (
                      <span className={`text-[11px] font-medium ${t.cls}`}>
                        <span aria-hidden>{t.icon}</span> {t.label}
                      </span>
                    )}
                  </div>
                );
              },
            },
            { key: "spark", label: "Last 7 days", render: (r) => <Sparkline values={r.spark} color={familyColor(p, r.family)} width={88} height={20} /> },
            { key: "since", label: "Price since", align: "right", render: (r) => <span className="text-ink-3">{relativeTime(r.effectiveTime)}</span> },
          ]}
        />
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle title="On-demand rate card" sub={<>Published list prices, per GPU-hour. <ExtLink href="https://nebius.com/prices">nebius.com/prices</ExtLink></>} />
          <DataTable
            caption="On-demand rate card"
            rows={g.onDemand}
            columns={[
              { key: "name", label: "Instance", render: (r) => r.name.replace(/^NVIDIA /, "") },
              { key: "od", label: "On-demand", align: "right", render: (r) => (r.onDemand === null ? <span className="text-ink-3">Contact sales</span> : `${r.onDemandFrom ? "from " : ""}${usd(r.onDemand, { cents: true })}`) },
              { key: "pre", label: "Spot from", align: "right", render: (r) => (r.preemptibleFrom === null ? "—" : usd(r.preemptibleFrom, { cents: true })) },
            ]}
          />
        </Card>
        <Card>
          <CardTitle title="List price changes" sub="Changes spotted by the daily run, plus the 1 October 2026 increase recorded from press coverage." />
          {g.changes.length === 0 ? (
            <p className="text-sm text-ink-3">No changes recorded yet.</p>
          ) : (
            <DataTable
              caption="List price changes"
              rows={[...g.changes].reverse()}
              columns={[
                { key: "date", label: "Date", render: (r) => day(r.date, true) },
                { key: "name", label: "Instance", render: (r) => r.name.replace(/^NVIDIA (HGX )?/, "") },
                { key: "from", label: "From", align: "right", render: (r) => (r.from === null ? "—" : usd(r.from, { cents: true })) },
                { key: "to", label: "To", align: "right", render: (r) => (r.to === null ? "—" : usd(r.to, { cents: true })) },
                {
                  key: "chg",
                  label: "Change",
                  align: "right",
                  render: (r) => (r.from && r.to ? <span className={r.to > r.from ? "text-good" : "text-bad"}>{pct(r.to / r.from - 1, { signed: true })}</span> : "—"),
                },
              ]}
            />
          )}
        </Card>
      </div>
    </Section>
  );
}
