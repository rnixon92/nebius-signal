import { useMemo, useState } from "react";
import type { Dashboard } from "../../shared/dashboard.ts";
import { TimeSeriesCard } from "../components/TimeSeriesCard.tsx";
import { Card, CardTitle, DataTable, ExtLink, Pill, Section } from "../components/ui.tsx";
import { modelLabel, pct, tokens, usd, usdM } from "../lib/format.ts";
import type { Range } from "../lib/range.ts";
import { dayRevenue, type RevenueAssumptions } from "../lib/revenue.ts";
import type { Palette } from "../lib/theme.ts";

const OTHER = "Other";
const TYPE_LABEL: Record<string, string> = { text2text: "Text", image2text: "Image and text", embedding: "Embedding" };

export function TokensSection({ d, p, range }: { d: Dashboard; p: Palette; range: Range }) {
  const t = d.tokens;
  const [a, setA] = useState<RevenueAssumptions>({ cacheHit: 0.5, outputShare: 0.1 });
  const name = (id: string) => (id === OTHER ? "Other models" : modelLabel(id, t.pricing[id]?.name));
  const color = (id: string) => (id === OTHER ? p.other : p.series[t.topModels.indexOf(id)]!);

  // Stacked series: top models by recent volume, the rest folded into "Other" (never a 7th+ hue).
  const stacked = useMemo(
    () =>
      t.daily.map((day) => {
        const row: Record<string, number | string | boolean> = { date: day.date, partial: day.partial, total: day.total };
        let other = 0;
        for (const [m, v] of Object.entries(day.byModel)) {
          if (t.topModels.includes(m)) row[m] = v;
          else other += v;
        }
        row[OTHER] = other;
        return row as { date: string; partial: boolean; total: number } & Record<string, number>;
      }),
    [t],
  );
  const series = [...t.topModels, OTHER].map((s) => ({ key: s, label: name(s), color: color(s) }));

  // Revenue: trailing 7 complete days, recomputed live from the assumptions.
  const revenue = useMemo(() => {
    const complete = t.daily.filter((x) => !x.partial);
    const perDay = complete.map((x) => ({ date: x.date, rev: dayRevenue(x.byModel, t.pricing, a) }));
    return perDay.flatMap((x, i) => (i >= 6 ? [{ date: x.date, week: perDay.slice(i - 6, i + 1).reduce((s, y) => s + y.rev, 0) }] : []));
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

  const maxPeer = Math.max(...t.peers.map((x) => x.week), 1);
  // Token charts show what can move token traffic: model launches, Token Factory changes (caching, acquisitions), results.
  const tfEvents = d.events.filter((e) => e.kind === "model" || e.kind === "product" || e.kind === "earnings");

  return (
    <Section
      id="tokens"
      kicker="Secondary signal"
      title="Token Factory traffic on OpenRouter"
      intro={
        <>
          OpenRouter publishes daily token counts per provider and model. It is the only public window into Token Factory demand, but it is a small one: at today's volumes it
          is worth roughly {usd(week * 52)} a year, against {lastQ?.arr ? usdM(lastQ.arr) : "billions"} of reported company ARR. Read it as a competitive signal (which models
          Nebius wins, how it ranks), not a revenue driver.
        </>
      }
    >
      <TimeSeriesCard
        title="Daily tokens by model"
        sub="Nebius's OpenRouter traffic. Today's bar is a partial day, shown lighter."
        p={p}
        globalRange={range}
        rows={stacked}
        series={series}
        kind="stacked"
        format={(v) => tokens(v, 1)}
        axisFormat={(v) => tokens(v)}
        change="none"
        events={tfEvents}
        dimRow={(r) => r.partial}
        tooltipFooter={(r) => `${tokens(r.total, 1)} total${r.partial ? " · partial day" : ""}`}
        csvName="nebius-openrouter-daily-tokens"
        height={300}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
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
        <div className="lg:col-span-3">
          <TimeSeriesCard
            title="Estimated revenue, trailing 7 days"
            sub="Updates with the assumptions on the left"
            p={p}
            globalRange={range}
            rows={revenue}
            series={[{ key: "week", label: "7-day revenue", color: p.accent }]}
            format={(v) => usd(v)}
            events={tfEvents}
            csvName="nebius-openrouter-revenue-estimate"
            height={220}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <TimeSeriesCard
          title="Nebius share of all OpenRouter tokens"
          sub={
            <>
              Weekly, across ~{t.market.at(-1)?.providers ?? 96} providers. Market totals from <ExtLink href="https://jimmyresearch.com/openrouter/">jimmyresearch</ExtLink>.
            </>
          }
          p={p}
          globalRange={range}
          rows={t.market}
          series={[{ key: "share", label: "Share", color: p.accent }]}
          format={(v) => pct(v, { digits: 2 })}
          change="diff"
          diffFormat={(v) => `${(v * 100).toFixed(2)} pts`}
          events={tfEvents}
          tooltipFooter={(r) => `Rank ${r.rank} of ${r.providers} · ${tokens(r.nebius)} of ${tokens(r.total)}`}
          csvName="nebius-openrouter-share"
          height={220}
        />
        <Card>
          <CardTitle title="Against other open-model hosts" sub="OpenRouter tokens, last 7 complete days" />
          <ul className="flex flex-col gap-2.5">
            {t.peers.map((x) => (
              <li key={x.slug} className="grid grid-cols-[6.5rem_1fr_4.5rem_3.5rem] items-center gap-2 text-[13px]">
                <span className={`truncate ${x.isNebius ? "font-semibold text-ink" : "text-ink-2"}`}>{x.name}</span>
                <span className="h-2 overflow-hidden rounded-full" aria-hidden>
                  <span className="block h-full rounded-r-[4px]" style={{ width: `${Math.max(1, (x.week / maxPeer) * 100)}%`, background: x.isNebius ? p.accent : p.muted }} />
                </span>
                <span className="tnum text-right">{tokens(x.week)}</span>
                <span className={`tnum text-right text-xs ${x.change == null ? "text-ink-3" : x.change >= 0 ? "text-good" : "text-bad"}`}>{pct(x.change, { signed: true })}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-ink-3">Change is week over week.</p>
        </Card>
      </div>

      {t.catalog.models.length > 0 && (
        <Card>
          <CardTitle
            title="Token Factory catalog"
            sub={
              <>
                {t.catalog.models.length} public models, {t.catalog.models.filter((m) => m.cacheRead != null).length} with a cached-input price. Nebius's own list at{" "}
                <ExtLink href="https://tokenfactory.nebius.com/model-catalog.md">tokenfactory.nebius.com</ExtLink>. OpenRouter only shows the ones it routes.
              </>
            }
          />
          <DataTable
            caption="Token Factory public model catalog and prices"
            maxHeight={480}
            rows={t.catalog.models}
            columns={[
              {
                key: "model",
                label: "Model",
                render: (r) => (
                  <span className="flex flex-col">
                    <span className="font-medium">{r.name}</span>
                    <span className="font-mono text-[11px] text-ink-3">{r.id}</span>
                  </span>
                ),
              },
              { key: "type", label: "Type", render: (r) => TYPE_LABEL[r.type] ?? r.type },
              { key: "region", label: "Region", render: (r) => r.regions.join(", ") || "—" },
              { key: "ctx", label: "Context", align: "right", render: (r) => (r.contextK ? `${r.contextK}K` : "—") },
              { key: "in", label: "Input $/M", align: "right", render: (r) => `$${r.input}` },
              { key: "cache", label: "Cached $/M", align: "right", render: (r) => (r.cacheRead != null ? `$${r.cacheRead}` : "—") },
              { key: "out", label: "Output $/M", align: "right", render: (r) => (r.output != null ? `$${r.output}` : "—") },
            ]}
          />
        </Card>
      )}

      <Card>
        <CardTitle title="Models served" sub="Last 7 complete days on OpenRouter. Revenue uses the assumptions above." />
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
