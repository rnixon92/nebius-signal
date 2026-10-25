import { useMemo, useState } from "react";
import type { Dashboard, Severity } from "../../shared/dashboard.ts";
import { TimeSeriesCard } from "../components/TimeSeriesCard.tsx";
import { Card, CardTitle, ExtLink, Segmented, SeverityBadge } from "../components/ui.tsx";
import { day, usd } from "../lib/format.ts";
import type { Range } from "../lib/range.ts";
import type { Palette } from "../lib/theme.ts";

export function StockChart({ d, p, range }: { d: Dashboard; p: Palette; range: Range }) {
  const [mode, setMode] = useState<"price" | "peers">("price");
  const rows = useMemo(() => d.stock.series.map(([date, close]) => ({ date, close })), [d.stock.series]);
  // Peers merged onto NBIS trading days; each series is re-based to 100 at the start of the visible range.
  const peerRows = useMemo(() => {
    const maps = d.stock.peers.map((pr) => [pr.ticker, new Map(pr.series)] as const);
    return d.stock.series.map(([date, close]) => ({ date, NBIS: close, ...Object.fromEntries(maps.map(([t, m]) => [t, m.get(date)])) }));
  }, [d.stock]);
  if (rows.length < 2) return null;

  const toggle = (
    <Segmented
      label="Share price view"
      value={mode}
      onChange={setMode}
      options={[
        { value: "price", label: "Price" },
        { value: "peers", label: "vs peers" },
      ]}
    />
  );

  if (mode === "peers") {
    return (
      <TimeSeriesCard
        title="NBIS against peers"
        sub="Indexed to 100 at the start of the range: CoreWeave (closest listed neocloud), Nvidia, Oracle and the semiconductor sector (SMH)"
        p={p}
        globalRange={range}
        rows={peerRows}
        series={[
          { key: "NBIS", label: "NBIS", color: p.accent },
          ...d.stock.peers.map((pr, i) => ({ key: pr.ticker, label: `${pr.ticker} · ${pr.name}`, color: p.series[i + 1]! })),
        ]}
        rebase
        format={(v) => v.toFixed(0)}
        yDomain={["auto", "auto"]}
        events={d.events.filter((e) => e.kind === "earnings")}
        csvName="nbis-vs-peers-indexed"
        height={240}
        controls={toggle}
        note="Change shown is the return over the visible range. CoreWeave listed in March 2025, so longer ranges start it later. Click a ticker to hide it."
      />
    );
  }
  return (
    <TimeSeriesCard
      title="NBIS share price"
      sub="Daily close, with earnings, contracts, financings, list-price changes and capacity go-lives marked"
      p={p}
      globalRange={range}
      rows={rows}
      series={[{ key: "close", label: "NBIS", color: p.accent }]}
      format={(v) => usd(v, { cents: true })}
      axisFormat={(v) => `$${Math.round(v)}`}
      yDomain={["auto", "auto"]}
      events={d.events.filter((e) => e.kind !== "model" && e.kind !== "product")}
      csvName="nbis-daily-close"
      height={240}
      controls={toggle}
    />
  );
}

const SOURCE_LABEL: Record<string, string> = {
  "gpu-ondemand": "GPU rate card",
  "gpu-spot": "Spot prices",
  regions: "Regions",
  news: "Site news",
  openrouter: "OpenRouter",
  "openrouter-market": "OpenRouter market",
  atlas: "Atlas",
  sec: "SEC",
  jobs: "Hiring",
  stock: "Stock",
};

/** Alert feed. On the landing page it shows the latest few with a link to the full list. */
export function Alerts({ d, limit, moreHref }: { d: Dashboard; limit?: number; moreHref?: string }) {
  const [filter, setFilter] = useState<"all" | Severity>("all");
  const [expanded, setExpanded] = useState(false);
  const list = useMemo(() => d.alerts.filter((a) => filter === "all" || a.severity === filter), [d.alerts, filter]);
  const cap = limit ?? 12;
  const shown = expanded ? list : list.slice(0, cap);

  return (
    <Card>
      <CardTitle
        title="What changed"
        sub="Alerts from the collector: price changes, capacity, filings, site news and new customers"
        right={
          moreHref ? (
            <a href={moreHref} className="text-sm font-medium text-accent hover:underline">
              All alerts →
            </a>
          ) : (
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
          )
        }
      />
      {shown.length === 0 ? (
        <p className="py-4 text-sm text-ink-3">No alerts {filter === "all" ? "yet" : `at ${filter} severity`}. They appear as the collector spots changes.</p>
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
      {!moreHref && list.length > cap && (
        <button type="button" onClick={() => setExpanded((v) => !v)} className="mt-2 text-sm font-medium text-accent hover:underline">
          {expanded ? "Show fewer" : `Show all ${list.length}`}
        </button>
      )}
    </Card>
  );
}
