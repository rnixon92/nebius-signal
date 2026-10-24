import { useMemo, useState } from "react";
import type { Dashboard, Severity } from "../../shared/dashboard.ts";
import { Card, CardTitle, ExtLink, Segmented, SeverityBadge, Sparkline, Stat } from "../components/ui.tsx";
import { TimeSeriesCard } from "../components/TimeSeriesCard.tsx";
import { day, pct, tokens, usd, usdM } from "../lib/format.ts";
import type { Range } from "../lib/range.ts";
import type { Palette } from "../lib/theme.ts";

export function KpiRow({ d, p }: { d: Dashboard; p: Palette }) {
  const lastQ = d.fundamentals.quarters.at(-1);
  const market = d.tokens.market.at(-1);
  const recentAtlas = d.atlas.cumulative.filter((c) => c.date >= addDays(d.generatedAt.slice(0, 10), -7)).reduce((a, c) => a + c.added, 0);
  const dc = d.jobs.byFunction.find((f) => f.name === "Data center & power")?.count ?? 0;
  const stock90 = d.stock.series.slice(-90).map(([, c]) => c);
  const next = d.nowcast.quarters[0];

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Stat
        label="Blackwell spot vs on-demand"
        value={pct(d.gpu.tightness.blackwell)}
        note={<>Hopper {pct(d.gpu.tightness.hopper)}. Spot is capped just under list, so higher means less spare capacity.</>}
      />
      <Stat
        label="NBIS share price"
        value={d.stock.last ? usd(d.stock.last.close, { cents: true }) : "—"}
        delta={d.stock.last?.chg30d}
        note={d.stock.last ? `30-day change · close ${day(d.stock.last.date)}` : "No price data yet"}
      >
        <div className="mt-1">
          <Sparkline values={stock90} color={p.series[0]!} width={140} />
        </div>
      </Stat>
      <Stat
        label="Reported ARR"
        value={lastQ?.arr ? usdM(lastQ.arr) : "—"}
        note={lastQ ? `As of ${day(lastQ.end, true)}. Guidance ${usdM(d.fundamentals.guidance.arrExit[0])}–${usdM(d.fundamentals.guidance.arrExit[1])} by year-end.` : undefined}
      />
      <Stat label="Insider sales, last 90 days" value={usd(d.sec.totals90d.sold)} note={`Purchases ${usd(d.sec.totals90d.bought)}. From Form 4 filings.`} />
      <Stat
        label="Token Factory on OpenRouter, 7 days"
        value={`${tokens(d.tokens.week.tokens)} tokens`}
        delta={d.tokens.week.change}
        note={market ? `Rank ${market.rank} of ${market.providers} providers · ${pct(market.share, { digits: 2 })} of OpenRouter` : undefined}
      />
      <Stat label="Customers on Nebius Atlas" value={d.atlas.total.toLocaleString()} note={`${recentAtlas} listed in the last 7 days · ${d.atlas.tokenFactory} use Token Factory`} />
      <Stat label="Open roles" value={d.jobs.total.toLocaleString()} note={`${dc} in data center & power · ${d.jobs.new7d} new this week`} />
      {next ? (
        <Stat
          label={`${next.quarter.replace(/(\d{4})-(Q\d)/, "$2 $1")} revenue nowcast`}
          value={usdM(next.estimate)}
          note={
            <>
              {next.anchor.kind === "consensus" ? `${pct(next.estimate / next.anchor.value - 1, { signed: true, digits: 1 })} vs ${usdM(next.anchor.value)} consensus · ` : ""}
              <a href="#nowcast" className="font-medium text-accent hover:underline">
                {next.lean === "beat" ? "Lean beat" : next.lean === "miss" ? "Lean miss" : next.lean === "in line" ? "In line" : "See nowcast"}
              </a>
            </>
          }
        />
      ) : (
        <Stat label={lastQ ? `${lastQ.quarter.replace(/(\d{4})-(Q\d)/, "$2 $1")} revenue` : "Latest quarterly revenue"} value={lastQ ? usdM(lastQ.revenue) : "—"} />
      )}
    </div>
  );
}

export function StockChart({ d, p, range }: { d: Dashboard; p: Palette; range: Range }) {
  const rows = useMemo(() => d.stock.series.map(([date, close]) => ({ date, close })), [d.stock.series]);
  if (rows.length < 2) return null;
  return (
    <TimeSeriesCard
      title="NBIS share price"
      sub="Daily close, with earnings, financings, list-price changes and capacity go-lives marked"
      p={p}
      globalRange={range}
      rows={rows}
      series={[{ key: "close", label: "NBIS", color: p.series[0]! }]}
      format={(v) => usd(v, { cents: true })}
      axisFormat={(v) => `$${Math.round(v)}`}
      yDomain={["auto", "auto"]}
      events={d.events}
      csvName="nbis-daily-close"
      height={260}
    />
  );
}

const SOURCE_LABEL: Record<string, string> = {
  regions: "Regions",
  news: "Site news",
  "gpu-ondemand": "GPU rate card",
  "gpu-spot": "Spot prices",
  openrouter: "OpenRouter",
  "openrouter-market": "OpenRouter market",
  atlas: "Atlas",
  sec: "SEC",
  jobs: "Hiring",
  stock: "Stock",
};

export function Alerts({ d }: { d: Dashboard }) {
  const [filter, setFilter] = useState<"all" | Severity>("all");
  const [expanded, setExpanded] = useState(false);
  const list = useMemo(() => d.alerts.filter((a) => filter === "all" || a.severity === filter), [d.alerts, filter]);
  const shown = expanded ? list : list.slice(0, 8);

  return (
    <Card>
      <CardTitle
        title="What changed"
        sub="Alerts from the daily run: price changes, capacity shifts, filings and new customers."
        right={
          <Segmented
            label="Alert severity"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: "All" },
              { value: "high", label: "High" },
              { value: "medium", label: "Medium" },
              { value: "info", label: "Info" },
            ]}
          />
        }
      />
      {shown.length === 0 ? (
        <p className="py-4 text-sm text-ink-3">No alerts {filter === "all" ? "yet" : `at ${filter} severity`}. They appear as the daily run spots changes.</p>
      ) : (
        <ul className="divide-y divide-[var(--border)]">
          {shown.map((a) => (
            <li key={a.id} className="flex gap-3 py-2.5">
              <div className="w-14 shrink-0 pt-0.5 text-xs text-ink-3 tnum">{day(a.date)}</div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <SeverityBadge severity={a.severity} />
                  <span className="text-[11px] text-ink-3">{SOURCE_LABEL[a.source] ?? a.source}</span>
                </div>
                <p className="mt-1 text-sm font-medium text-ink">{a.url ? <ExtLink href={a.url} className="no-underline hover:underline">{a.title}</ExtLink> : a.title}</p>
                {a.detail && <p className="mt-0.5 text-[13px] text-ink-2">{a.detail}</p>}
              </div>
            </li>
          ))}
        </ul>
      )}
      {list.length > 8 && (
        <button type="button" onClick={() => setExpanded((v) => !v)} className="mt-2 text-sm font-medium text-accent hover:underline">
          {expanded ? "Show fewer" : `Show all ${list.length}`}
        </button>
      )}
    </Card>
  );
}

function addDays(date: string, n: number) {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
