import { useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Dashboard } from "../../shared/dashboard.ts";
import { CHART_MARGIN, axisY, grid, type TipProps } from "../components/chart.tsx";
import { TimeSeriesCard } from "../components/TimeSeriesCard.tsx";
import type { Range } from "../lib/range.ts";
import { ValuationPanel } from "./Valuation.tsx";

const FUNCTION_ORDER = ["Engineering & product", "Sales & go-to-market", "Data center & power", "G&A & other"];
import { Card, CardTitle, ChartFrame, DataTable, EmptyNote, ExtLink, Pill, Section, Segmented, Stat, TooltipCard } from "../components/ui.tsx";
import { day, pct, usd, usdM } from "../lib/format.ts";
import type { Palette } from "../lib/theme.ts";

/** Horizontal single-color bars for a ranked list (one series → one color). */
function BarList({ items, color, total, suffix = "" }: { items: { name: string; count: number }[]; color: string; total?: number; suffix?: string }) {
  const max = Math.max(...items.map((i) => i.count), 1);
  return (
    <ul className="flex flex-col gap-2">
      {items.map((i) => (
        <li key={i.name} className="grid grid-cols-[minmax(0,10rem)_1fr_3rem] items-center gap-3 text-[13px]">
          <span className="truncate text-ink-2" title={i.name}>
            {i.name}
          </span>
          <span className="h-2" aria-hidden>
            <span className="block h-full rounded-r-[4px]" style={{ width: `${(i.count / max) * 100}%`, background: color }} />
          </span>
          <span className="tnum text-right text-ink">
            {i.count}{suffix}
            {total ? <span className="sr-only"> of {total}</span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function CustomersSection({ d, p, range }: { d: Dashboard; p: Palette; range: Range }) {
  const a = d.atlas;
  return (
    <Section
      id="customers"
      kicker="Demand breadth"
      title="Customers"
      intro={
        <>
          From <ExtLink href="https://nebiusatlas.com/">Nebius Atlas</ExtLink>, a community tracker of companies with public evidence of using Nebius. It shows breadth,
          not contract size, and the dates are when Atlas found each customer, so the growth curve partly reflects research pace.
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label="Customers listed" value={a.total.toLocaleString()} />
        <Stat label="Using AI Cloud (GPUs)" value={a.aiCloud.toLocaleString()} />
        <Stat label="Using Token Factory" value={a.tokenFactory.toLocaleString()} />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <TimeSeriesCard
            title="Customers listed over time"
            sub="Cumulative, by the date Atlas listed each one"
            p={p}
            globalRange={range}
            rows={a.cumulative}
            series={[{ key: "total", label: "Customers", color: p.accent }]}
            kind="step"
            format={(v) => v.toLocaleString()}
            tooltipFooter={(r) => `+${r.added} that day`}
            csvName="nebius-atlas-customers"
            height={240}
          />
        </div>
        <Card className="lg:col-span-2">
          <CardTitle title="By category" />
          <BarList items={a.byCategory.slice(0, 10)} color={p.accent} total={a.total} />
        </Card>
      </div>
      <Card>
        <CardTitle title="Recently listed" sub="Newest additions to Atlas, excluding its launch baseline" />
        <DataTable
          caption="Recently listed customers"
          maxHeight={420}
          rows={a.recent}
          columns={[
            { key: "date", label: "Listed", render: (r) => <span className="tnum whitespace-nowrap text-ink-3">{day(r.date)}</span> },
            { key: "name", label: "Company", render: (r) => <span className="font-medium">{r.name}</span> },
            { key: "cat", label: "Category", render: (r) => <span className="whitespace-nowrap text-ink-2">{r.category}</span> },
            { key: "svc", label: "Uses", render: (r) => <span className="flex flex-wrap gap-1">{r.services.map((s) => <Pill key={s} tone={s.includes("Token Factory") ? "accent" : "neutral"}>{s.replace("Nebius ", "")}</Pill>)}</span> },
            { key: "use", label: "What for", render: (r) => <span className="text-ink-2">{r.use}</span> },
          ]}
        />
      </Card>
    </Section>
  );
}

export function HiringSection({ d, p, range }: { d: Dashboard; p: Palette; range: Range }) {
  const j = d.jobs;
  const [split, setSplit] = useState<"status" | "function">("status");
  const fnColor = (f: string) => p.series[FUNCTION_ORDER.indexOf(f)] ?? p.other;
  const since = j.trackedSince ? day(j.trackedSince, true) : "the first run";
  return (
    <Section
      id="hiring"
      kicker="Build-out"
      title="Hiring"
      intro={
        <>
          Every role on Nebius's Greenhouse board since {since}: open now, and closed (filled or withdrawn; the board doesn't say which). History before the collector started
          comes from Internet Archive snapshots of the board. Data-center hiring in a new location tends to come before a site announcement, so new locations raise an alert.
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Open roles" value={j.total.toLocaleString()} note={`${j.new7d} posted in the last 7 days`} />
        <Stat label="Roles tracked" value={j.tracked.toLocaleString()} note={`Open and closed, since ${since}`} />
        <Stat label="Closed in the last 30 days" value={j.closed30d.toLocaleString()} note="Left the board: filled or withdrawn" />
        <Stat label="Median days to close" value={j.medianDaysToClose === null ? "—" : `${j.medianDaysToClose} days`} note="Posting to closing, roles closed in the last 180 days" />
      </div>

      <TimeSeriesCard
        title="Roles over time"
        sub="Open roles as observed, and cumulative roles posted and closed among all roles tracked. Click a series to hide it."
        p={p}
        globalRange={range}
        rows={j.daily}
        series={[
          { key: "total", label: "Open", color: p.series[0]! },
          { key: "posted", label: "Total posted", color: p.series[1]! },
          { key: "closed", label: "Total closed", color: p.series[2]! },
        ]}
        format={(v) => Math.round(v).toLocaleString()}
        change="pct"
        tooltipFooter={(r) => (r.archive ? "From an Internet Archive snapshot" : "From the daily collector")}
        csvName="nebius-roles-over-time"
        height={280}
        note="Before the collector started, points come from sparse archive snapshots (gaps of weeks to months), so closure dates there are approximate: a role is dated to the first snapshot it's missing from. Roles that opened and closed between snapshots are invisible."
      />

      <TimeSeriesCard
        title="Roles by month posted"
        sub={split === "status" ? "Each bar is every role posted that month: still open plus already closed" : "Every role posted that month, by function"}
        p={p}
        globalRange="All"
        rows={j.postedByMonth}
        series={
          split === "status"
            ? [
                { key: "Closed", label: "Closed", color: p.series[2]! },
                { key: "Still open", label: "Still open", color: p.series[0]! },
              ]
            : FUNCTION_ORDER.map((f) => ({ key: f, label: f, color: fnColor(f) }))
        }
        kind="stacked"
        format={(v) => String(v)}
        change="none"
        controls={
          <Segmented
            label="Split roles by"
            value={split}
            onChange={setSplit}
            options={[
              { value: "status", label: "Status" },
              { value: "function", label: "Function" },
            ]}
          />
        }
        tooltipFooter={(r) => `${Number(r["Still open"]) + Number(r["Closed"])} posted`}
        csvName="nebius-roles-by-month"
        height={260}
        note="Recent months are mostly still open because roles take ~3 months to close. Months before the archive history starts would undercount, so they're not shown."
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <CardTitle title="Open roles by function" />
          <BarList items={j.byFunction} color={p.accent} />
        </Card>
        <Card>
          <CardTitle title="Open roles by region" />
          <BarList items={j.byRegion} color={p.accent} />
        </Card>
        <Card>
          <CardTitle title="Median days to close" sub="By function, roles closed in the last 180 days" />
          {j.daysToCloseByFunction.length === 0 ? (
            <EmptyNote>Appears once roles have been seen closing.</EmptyNote>
          ) : (
            <BarList items={j.daysToCloseByFunction.map((f) => ({ name: f.name, count: f.days }))} color={p.accent} suffix=" d" />
          )}
          <p className="mt-3 text-xs text-ink-3">Longer means harder to hire, or roles kept open as standing pipelines.</p>
        </Card>
      </div>
      <Card>
        <CardTitle title="Data center & power roles" sub="Where Nebius is staffing physical build-out" />
        <DataTable
          caption="Data center and power roles"
          maxHeight={360}
          rows={j.dcRoles}
          columns={[
            { key: "title", label: "Role", render: (r) => <ExtLink href={r.url} className="no-underline hover:underline">{r.title}</ExtLink> },
            { key: "loc", label: "Location", render: (r) => <span className="text-ink-2">{r.location}</span> },
            { key: "posted", label: "Posted", align: "right", render: (r) => day(r.posted, r.posted.slice(0, 4) !== d.generatedAt.slice(0, 4)) },
          ]}
        />
      </Card>
    </Section>
  );
}

const KIND_LABEL = { results: "Results", corporate: "Company news", insider: "Insider", ownership: "Ownership", other: "Other" } as const;

export function FilingsSection({ d }: { d: Dashboard }) {
  const [kind, setKind] = useState<"all" | "company" | "insider">("company");
  const s = d.sec;
  const filings = s.filings.filter((f) => (kind === "all" ? true : kind === "insider" ? f.kind === "insider" : f.kind === "results" || f.kind === "corporate"));
  return (
    <Section id="filings" kicker="Company disclosures" title="SEC filings and insider trades" intro="Every Nebius filing on EDGAR. As a foreign private issuer, Nebius reports results and material news on Form 6-K. Insiders report trades on Form 4 and planned sales on Form 144, which often precedes the matching Form 4.">
      <Card>
        <CardTitle title="Insider activity, last 90 days" sub="Form 4 sales and purchases at reported prices; Form 144 planned sales shown separately" />
        <DataTable
          caption="Insider activity"
          rows={s.insiders}
          columns={[
            { key: "who", label: "Insider", render: (r) => <span className="font-medium">{r.owner}</span> },
            { key: "role", label: "Role", render: (r) => <span className="text-ink-2">{r.role || "—"}</span> },
            { key: "sold", label: "Sold", align: "right", render: (r) => (r.sold ? usd(r.sold) : "—") },
            { key: "bought", label: "Bought", align: "right", render: (r) => (r.bought ? <span className="text-good">{usd(r.bought)}</span> : "—") },
            { key: "planned", label: "Form 144 planned", align: "right", render: (r) => (r.planned ? usd(r.planned) : "—") },
            { key: "last", label: "Latest", align: "right", render: (r) => day(r.lastDate) },
          ]}
        />
      </Card>
      <Card>
        <CardTitle
          title="Filings"
          right={
            <Segmented
              label="Filing type"
              value={kind}
              onChange={setKind}
              options={[
                { value: "company", label: "Company" },
                { value: "insider", label: "Insider" },
                { value: "all", label: "All" },
              ]}
            />
          }
        />
        <DataTable
          caption="SEC filings"
          maxHeight={480}
          rows={filings}
          columns={[
            { key: "date", label: "Filed", render: (r) => <span className="tnum whitespace-nowrap text-ink-3">{day(r.filed, true)}</span> },
            { key: "form", label: "Form", render: (r) => <span className="whitespace-nowrap font-mono text-[12px]">{r.form}</span> },
            { key: "kind", label: "Type", render: (r) => <Pill tone={r.kind === "results" ? "accent" : "neutral"}>{KIND_LABEL[r.kind]}</Pill> },
            { key: "title", label: "Summary", render: (r) => <ExtLink href={r.url} className="no-underline hover:underline">{r.title}</ExtLink> },
          ]}
        />
      </Card>
    </Section>
  );
}

export function FinancialsSection({ d, p }: { d: Dashboard; p: Palette }) {
  const f = d.fundamentals;
  const g = f.guidance;
  const year = String(g.year);
  const needed = f.neededPerQuarter;
  // Reported quarters, then the remaining quarters of the guidance year as low–high ranges.
  const rows = [
    ...f.quarters.map((q) => ({ quarter: q.quarter.replace(/(\d{4})-(Q\d)/, "$2 '$1").replace("'20", "'"), revenue: q.revenue, low: 0, span: 0, kind: "reported" as const, arr: q.arr })),
    ...(needed
      ? Array.from({ length: f.remainingQuarters }, (_, i) => ({ quarter: `Q${4 - f.remainingQuarters + i + 1} '${year.slice(2)}`, revenue: 0, low: needed[0], span: needed[1] - needed[0], kind: "needed" as const, arr: null }))
      : []),
  ];
  return (
    <Section
      id="financials"
      kicker="Reported"
      title="Financials and valuation"
      intro={
        <>
          What you're paying for the AI cloud once the ClickHouse and Toloka stakes, Avride and TripleTen are stripped out, how far a capacity build-out could take it, and the
          reported results behind it. Figures are kept by hand in <code className="rounded bg-surface-2 px-1 text-[12px]">data/fundamentals.json</code> from Nebius's filings.
        </>
      }
    >
      {f.newerResults && (
        <Card className="border-[color-mix(in_srgb,var(--warn)_45%,transparent)]">
          <p className="text-sm">
            <span className="font-semibold">Newer results are out.</span> {f.newerResults.title} (filed {day(f.newerResults.filed, true)}).{" "}
            <ExtLink href={f.newerResults.url}>Read the 6-K</ExtLink> and add the quarter to <code>data/fundamentals.json</code>.
          </p>
        </Card>
      )}
      <h2 className="mt-2 text-lg font-semibold tracking-tight">Valuation</h2>
      <ValuationPanel d={d} p={p} />
      <h2 className="mt-6 text-lg font-semibold tracking-tight">Results and guidance</h2>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <ChartFrame
            title="Quarterly revenue"
            sub={`Reported, and the per-quarter run needed for ${year} guidance of ${usdM(g.revenue[0])}–${usdM(g.revenue[1])}`}
            chart={
              <div className="h-64">
                <ResponsiveContainer>
                  <BarChart data={rows} margin={CHART_MARGIN} barCategoryGap="30%">
                    <CartesianGrid {...grid(p)} />
                    <XAxis dataKey="quarter" tick={{ fill: p.ink3, fontSize: 11 }} tickLine={false} axisLine={{ stroke: p.rule }} tickMargin={6} />
                    <YAxis {...axisY(p, (v) => usdM(v))} />
                    <Tooltip cursor={{ fill: p.grid, opacity: 0.5 }} content={(t) => <RevenueTip {...(t as TipProps)} />} />
                    <Bar dataKey="revenue" stackId="r" fill={p.accent} radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
                    <Bar dataKey="low" stackId="r" fill={p.accent} fillOpacity={0.25} maxBarSize={24} isAnimationActive={false} />
                    <Bar dataKey="span" stackId="r" fill={p.accent} fillOpacity={0.12} maxBarSize={24} radius={[4, 4, 0, 0]} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            }
            rows={rows}
            columns={[
              { key: "q", label: "Quarter", render: (r) => r.quarter },
              { key: "rev", label: "Revenue", align: "right", render: (r) => (r.kind === "reported" ? usdM(r.revenue) : `${usdM(r.low)}–${usdM(r.low + r.span)} needed`) },
              { key: "arr", label: "ARR at quarter end", align: "right", render: (r) => (r.arr ? usdM(r.arr) : "—") },
            ]}
          />
        </div>
        <Card className="lg:col-span-2">
          <CardTitle title={`${year} guidance`} sub={<>As of {day(g.asOf, true)} · <ExtLink href={g.source}>source</ExtLink></>} />
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <Item k="Exit ARR" v={`${usdM(g.arrExit[0])}–${usdM(g.arrExit[1])}`} />
            <Item k="Revenue" v={`${usdM(g.revenue[0])}–${usdM(g.revenue[1])}`} />
            <Item k="Capex" v={`${usdM(g.capex[0])}–${usdM(g.capex[1])}`} />
            <Item k="Adj. EBITDA margin" v={`~${pct(g.adjEbitdaMargin)}`} />
            <Item k="Contracted power" v={`${g.contractedPowerGw} GW`} />
            <Item k="Latest ARR" v={f.quarters.at(-1)?.arr ? usdM(f.quarters.at(-1)!.arr!) : "—"} />
          </dl>
          {needed && (
            <p className="mt-4 border-t border-line pt-3 text-[13px] leading-relaxed text-ink-2">
              To land in range, the remaining {f.remainingQuarters} quarters must average <span className="font-semibold text-ink">{usdM(needed[0])}–{usdM(needed[1])}</span>, versus{" "}
              {usdM(f.quarters.at(-1)!.revenue)} last quarter.
            </p>
          )}
        </Card>
      </div>
    </Section>
  );
}

function Item({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-xs text-ink-3">{k}</dt>
      <dd className="font-semibold text-ink">{v}</dd>
    </div>
  );
}

function RevenueTip({ active, payload }: TipProps) {
  const r = payload?.[0]?.payload as { quarter: string; revenue: number; low: number; span: number; kind: string; arr: number | null } | undefined;
  if (!active || !r) return null;
  const rows =
    r.kind === "reported"
      ? [{ name: "Revenue", value: usdM(r.revenue) }, ...(r.arr ? [{ name: "ARR at quarter end", value: usdM(r.arr) }] : [])]
      : [{ name: "Needed for guidance", value: `${usdM(r.low)}–${usdM(r.low + r.span)}` }];
  return <TooltipCard title={r.quarter} rows={rows} />;
}

export function SourcesSection({ d }: { d: Dashboard }) {
  return (
    <Section id="sources" kicker="Method" title="Sources and health" intro="Every number on this page comes from a free public source, collected once a day. A source that fails keeps its last good data and is flagged here.">
      <Card>
        <DataTable
          caption="Data sources"
          rows={d.sources}
          columns={[
            {
              key: "status",
              label: "Status",
              render: (r) => (
                <span className={`inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium ${!r.ok ? "text-bad" : r.stale ? "text-warn" : "text-good"}`}>
                  <span aria-hidden>{!r.ok ? "✕" : r.stale ? "!" : "✓"}</span>
                  {!r.ok ? "Failed" : r.stale ? "Stale" : "OK"}
                </span>
              ),
            },
            { key: "src", label: "Source", render: (r) => <ExtLink href={r.url}>{r.label}</ExtLink> },
            { key: "sum", label: "Last result", render: (r) => <span className="text-ink-2">{r.error ? `Error: ${r.error}` : r.summary}</span> },
            { key: "when", label: "Last success", align: "right", render: (r) => (r.lastSuccess ? day(r.lastSuccess, true) : "never") },
          ]}
        />
      </Card>
      <Card>
        <CardTitle title="How to read this" />
        <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed text-ink-2">
          <li>Spot ÷ on-demand compares each region's spot price with the single published list price. Regional list prices may differ, so read levels loosely and trends closely.</li>
          <li>OpenRouter token counts include cached tokens. Revenue estimates apply OpenRouter list prices; models whose Nebius endpoint is gone use the OpenRouter catalog price, and the long tail is priced at $0.15/$0.60 per million.</li>
          <li>Atlas dates are discovery dates. Hiring "new" counts start from the first run. Insider values use reported transaction prices.</li>
          <li>Not investment advice. Public data, best-effort parsing, no guarantees.</li>
        </ul>
      </Card>
    </Section>
  );
}
