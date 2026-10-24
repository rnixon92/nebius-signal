import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Dashboard } from "../../shared/dashboard.ts";
import { CHART_MARGIN, TimeTip, axisX, axisY, cursor, grid } from "../components/chart.tsx";
import { Card, CardTitle, ChartFrame, DataTable, ExtLink, Legend, Pill, Section } from "../components/ui.tsx";
import { day, modelLabel, pct, tokens, usd, usdM } from "../lib/format.ts";
import { clip, type Range } from "../lib/range.ts";
import { dayRevenue, type RevenueAssumptions } from "../lib/revenue.ts";
import type { Palette } from "../lib/theme.ts";

const OTHER = "Other";

export function TokensSection({ d, p, range }: { d: Dashboard; p: Palette; range: Range }) {
  const t = d.tokens;
  const [a, setA] = useState<RevenueAssumptions>({ cacheHit: 0.5, outputShare: 0.1 });
  const name = (id: string) => (id === OTHER ? "Other models" : modelLabel(id, t.pricing[id]?.name));
  const color = (id: string) => (id === OTHER ? p.other : p.series[t.topModels.indexOf(id)]!);

  // Stacked series: top models by recent volume, the rest folded into "Other" (never a 7th+ hue).
  const stacked = useMemo(
    () =>
      clip(t.daily, range).map((day) => {
        const row: Record<string, number | string | boolean> = { date: day.date, partial: day.partial, total: day.total };
        let other = 0;
        for (const [m, v] of Object.entries(day.byModel)) {
          if (t.topModels.includes(m)) row[m] = v;
          else other += v;
        }
        row[OTHER] = other;
        return row as { date: string; partial: boolean; total: number } & Record<string, number>;
      }),
    [t, range],
  );
  const series = [...t.topModels, OTHER];

  // Revenue: trailing 7 complete days, recomputed live from the assumptions.
  const revenue = useMemo(() => {
    const complete = t.daily.filter((x) => !x.partial);
    const perDay = complete.map((x) => ({ date: x.date, rev: dayRevenue(x.byModel, t.pricing, a) }));
    return perDay.map((x, i) => ({ date: x.date, week: i >= 6 ? perDay.slice(i - 6, i + 1).reduce((s, y) => s + y.rev, 0) : null })).filter((x): x is { date: string; week: number } => x.week !== null);
  }, [t, a]);
  const week = revenue.at(-1)?.week ?? 0;
  const lastQ = d.fundamentals.quarters.at(-1);

  const modelRows = useMemo(() => {
    const last7 = t.daily.filter((x) => !x.partial).slice(-7);
    const totals = new Map<string, number>();
    for (const x of last7) for (const [m, v] of Object.entries(x.byModel)) totals.set(m, (totals.get(m) ?? 0) + v);
    const sum = [...totals.values()].reduce((s, v) => s + v, 0);
    return [...totals.entries()]
      .sort((x, y) => y[1] - x[1])
      .map(([id, tok]) => ({ id, tok, share: sum ? tok / sum : 0, price: t.pricing[id], rev: dayRevenue({ [id]: tok }, t.pricing, a) }));
  }, [t, a]);

  const market = clip(t.market, range);
  const maxPeer = Math.max(...t.peers.map((x) => x.week), 1);

  return (
    <Section
      id="tokens"
      kicker="Secondary signal"
      title="Token Factory traffic on OpenRouter"
      intro={
        <>
          OpenRouter publishes daily token counts per provider and model. It is the only public window into Token Factory demand, but it is a small one: even at today's
          volumes it is worth roughly {usd(week * 52)} a year, against {lastQ?.arr ? usdM(lastQ.arr) : "billions"} of reported company ARR. Read it as a
          competitive signal (which models Nebius wins, how it ranks), not a revenue driver.
        </>
      }
    >
      <ChartFrame
        title="Daily tokens by model"
        sub="Nebius's OpenRouter traffic. Today's bar is a partial day, shown lighter."
        legend={<Legend items={series.map((s) => ({ label: name(s), color: color(s), shape: "rect" }))} />}
        chart={
          <div className="h-72">
            <ResponsiveContainer>
              <BarChart data={stacked} margin={CHART_MARGIN} barCategoryGap="12%">
                <CartesianGrid {...grid(p)} />
                <XAxis {...axisX(p)} />
                <YAxis {...axisY(p, (v) => tokens(v))} />
                <Tooltip
                  cursor={{ fill: p.grid, opacity: 0.5 }}
                  content={(tp) => <TimeTip {...(tp as object)} nameOf={name} format={(v) => tokens(v, 1)} footer={(r) => `${tokens(r.total as number, 1)} total${r.partial ? " · partial day" : ""}`} />}
                />
                {series.map((s) => (
                  <Bar
                    key={s}
                    dataKey={s}
                    stackId="t"
                    fill={color(s)}
                    maxBarSize={24}
                    isAnimationActive={false}
                    // Custom shape: a 1px surface stroke keeps segments visually separate, and the partial day is dimmed.
                    shape={(props: unknown) => {
                      const b = props as { x: number; y: number; width: number; height: number; fill: string; payload: { partial: boolean } };
                      if (!(b.height > 0) || !(b.width > 0)) return <g />;
                      return <rect x={b.x} y={b.y} width={b.width} height={b.height} fill={b.fill} opacity={b.payload.partial ? 0.45 : 1} stroke={p.surface} strokeWidth={1} />;
                    }}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        }
        rows={stacked}
        columns={[
          { key: "date", label: "Date", render: (r) => `${day(r.date, true)}${r.partial ? " (partial)" : ""}` },
          { key: "total", label: "Total", align: "right", render: (r) => tokens(r.total, 1) },
          ...series.map((s) => ({ key: s, label: name(s), align: "right" as const, render: (r: (typeof stacked)[number]) => (r[s] ? tokens(r[s], 1) : "—") })),
        ]}
      />

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <CardTitle title="Revenue estimate" sub="Token counts × OpenRouter list prices. Adjust the two unknowns." />
          <div className="flex flex-col gap-4">
            <Slider label="Input served from cache" value={a.cacheHit} min={0} max={0.9} step={0.05} onChange={(v) => setA({ ...a, cacheHit: v })} hint="Cached input bills at 2–20% of the normal input price" />
            <Slider label="Output share of tokens" value={a.outputShare} min={0.02} max={0.3} step={0.01} onChange={(v) => setA({ ...a, outputShare: v })} hint="Agent and coding traffic is mostly input" />
            <div className="grid grid-cols-2 gap-3 border-t border-line pt-4">
              <div>
                <p className="text-[13px] text-ink-2">Last 7 days</p>
                <p className="text-2xl font-semibold tracking-tight">{usd(week)}</p>
              </div>
              <div>
                <p className="text-[13px] text-ink-2">Annualized</p>
                <p className="text-2xl font-semibold tracking-tight">{usd(week * 52)}</p>
              </div>
            </div>
            {lastQ && <p className="text-xs text-ink-3">That is {pct((week * 13) / (lastQ.revenue * 1e6), { digits: 2 })} of Nebius's last reported quarterly revenue.</p>}
          </div>
        </Card>
        <Card className="lg:col-span-3">
          <CardTitle title="Estimated revenue, trailing 7 days" sub="Updates with the assumptions on the left" />
          <div className="h-60">
            <ResponsiveContainer>
              <LineChart data={clip(revenue, range)} margin={CHART_MARGIN}>
                <CartesianGrid {...grid(p)} />
                <XAxis {...axisX(p)} />
                <YAxis {...axisY(p, (v) => usd(v))} />
                <Tooltip cursor={cursor(p)} content={(tp) => <TimeTip {...(tp as object)} nameOf={() => "7-day revenue"} format={(v) => usd(v)} />} />
                <Line dataKey="week" stroke={p.series[0]} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: p.surface }} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartFrame
          title="Nebius share of all OpenRouter tokens"
          sub={
            <>
              Weekly, across ~{market.at(-1)?.providers ?? 96} providers. Market totals from <ExtLink href="https://jimmyresearch.com/openrouter/">jimmyresearch</ExtLink>.
            </>
          }
          chart={
            <div className="h-60">
              <ResponsiveContainer>
                <LineChart data={market} margin={CHART_MARGIN}>
                  <CartesianGrid {...grid(p)} />
                  <XAxis {...axisX(p)} />
                  <YAxis {...axisY(p, (v) => pct(v, { digits: 2 }))} />
                  <Tooltip
                    cursor={cursor(p)}
                    content={(tp) => <TimeTip {...(tp as object)} nameOf={() => "Share"} format={(v) => pct(v, { digits: 3 })} footer={(r) => `Rank ${r.rank} of ${r.providers} · ${tokens(r.nebius as number)} of ${tokens(r.total as number)}`} />}
                  />
                  <Line dataKey="share" stroke={p.series[0]} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: p.surface }} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          }
          rows={market}
          columns={[
            { key: "date", label: "Week to", render: (r) => day(r.date, true) },
            { key: "neb", label: "Nebius", align: "right", render: (r) => tokens(r.nebius) },
            { key: "share", label: "Share", align: "right", render: (r) => pct(r.share, { digits: 3 }) },
            { key: "rank", label: "Rank", align: "right", render: (r) => `${r.rank ?? "—"} / ${r.providers}` },
          ]}
        />
        <Card>
          <CardTitle title="Against other open-model hosts" sub="OpenRouter tokens, last 7 complete days" />
          <ul className="flex flex-col gap-2.5">
            {t.peers.map((x) => (
              <li key={x.slug} className="grid grid-cols-[6.5rem_1fr_4.5rem_3.5rem] items-center gap-2 text-[13px]">
                <span className={`truncate ${x.isNebius ? "font-semibold text-ink" : "text-ink-2"}`}>{x.name}</span>
                <span className="h-2 overflow-hidden rounded-full" aria-hidden>
                  <span className="block h-full rounded-r-[4px]" style={{ width: `${Math.max(1, (x.week / maxPeer) * 100)}%`, background: x.isNebius ? p.series[0] : p.muted }} />
                </span>
                <span className="tnum text-right">{tokens(x.week)}</span>
                <span className={`tnum text-right text-xs ${x.change == null ? "text-ink-3" : x.change >= 0 ? "text-good" : "text-bad"}`}>{pct(x.change, { signed: true })}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-ink-3">Change is week over week.</p>
        </Card>
      </div>

      <Card>
        <CardTitle title="Models served" sub="Last 7 complete days. Revenue uses the assumptions above." />
        <DataTable
          caption="Models served by Nebius on OpenRouter"
          maxHeight={420}
          rows={modelRows}
          columns={[
            {
              key: "model",
              label: "Model",
              render: (r) => (
                <span className="flex items-center gap-2">
                  {t.topModels.includes(r.id) && <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: color(r.id) }} />}
                  <span className="font-medium">{name(r.id)}</span>
                  {r.price?.priceSource === "catalog" && <Pill>catalog price</Pill>}
                </span>
              ),
            },
            { key: "tok", label: "Tokens", align: "right", render: (r) => tokens(r.tok, 1) },
            { key: "share", label: "Share", align: "right", render: (r) => pct(r.share, { digits: 1 }) },
            { key: "in", label: "Input $/M", align: "right", render: (r) => (r.price ? `$${r.price.input}` : "—") },
            { key: "out", label: "Output $/M", align: "right", render: (r) => (r.price ? `$${r.price.output}` : "—") },
            { key: "cache", label: "Cached $/M", align: "right", render: (r) => (r.price?.cacheRead != null ? `$${r.price.cacheRead}` : "—") },
            { key: "rev", label: "Est. revenue", align: "right", render: (r) => usd(r.rev) },
          ]}
        />
      </Card>
    </Section>
  );
}

function Slider({ label, value, min, max, step, onChange, hint }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; hint?: string }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="flex items-baseline justify-between text-[13px]">
        <span className="text-ink-2">{label}</span>
        <span className="tnum font-semibold text-ink">{pct(value)}</span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full" />
      {hint && <span className="text-xs text-ink-3">{hint}</span>}
    </label>
  );
}
