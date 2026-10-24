import { useMemo } from "react";
import type { Dashboard } from "../../shared/dashboard.ts";
import { SummaryCard } from "../components/SummaryCard.tsx";
import { Card, CardTitle, ExtLink } from "../components/ui.tsx";
import { day, pct, relativeTime, tokens, usd, usdM } from "../lib/format.ts";
import type { Range } from "../lib/range.ts";
import { href } from "../lib/router.ts";
import type { Palette } from "../lib/theme.ts";
import { Alerts, StockChart } from "../sections/Overview.tsx";

const BLACKWELL = ["GB300", "B300", "GB200", "B200"];
const HOPPER = ["H200", "H100"];
const quarterLabel = (q: string) => q.replace(/(\d{4})-(Q\d)/, "$2 $1");

export function Home({ d, p, range }: { d: Dashboard; p: Palette; range: Range }) {
  const next = d.nowcast.quarters[0];
  const lastQ = d.fundamentals.quarters.at(-1);
  const failing = d.sources.filter((s) => !s.ok || s.stale);

  const trends = useMemo(() => {
    const famAvg = (fams: string[]) =>
      d.gpu.ratioDaily.flatMap((r) => {
        const vs = fams.map((f) => r[f]).filter((v): v is number => typeof v === "number");
        return vs.length ? [{ date: r.date, v: vs.reduce((a, b) => a + b, 0) / vs.length }] : [];
      });
    return {
      blackwell: famAvg(BLACKWELL),
      hopper: famAvg(HOPPER),
      tokens: d.tokens.daily.filter((x) => !x.partial).slice(-60).map((x) => ({ date: x.date, v: x.total })),
      customers: d.atlas.cumulative.map((c) => ({ date: c.date, v: c.total })),
      roles: d.jobs.daily.map((x) => ({ date: x.date, v: x.total })),
      revenue: d.fundamentals.quarters.map((q) => ({ date: q.end, v: q.revenue })),
      arr: d.fundamentals.quarters.filter((q) => q.arr).map((q) => ({ date: q.end, v: q.arr! })),
    };
  }, [d]);

  const ramping = d.sites.mwByStatus.find((s) => s.status === "ramping");
  const construction = d.sites.mwByStatus.find((s) => s.status === "construction");
  const siteRisk = d.sites.rows.reduce((a, r) => a + r.risk90d, 0);
  const sitesLive = d.sites.rows.filter((r) => r.status === "live").length;
  const recentAtlas = d.atlas.cumulative.filter((c) => c.date >= shift(d.generatedAt.slice(0, 10), -7)).reduce((a, c) => a + c.added, 0);
  const dc = d.jobs.byFunction.find((f) => f.name === "Data center & power")?.count ?? 0;
  const market = d.tokens.market.at(-1);

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="home-title" className="relative overflow-hidden rounded-3xl text-white" style={{ background: "var(--hero)" }}>
        <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-[#e0ff4f] opacity-[0.07] blur-2xl" />
        <div className="relative grid grid-cols-1 gap-8 p-6 sm:p-8 lg:grid-cols-[minmax(0,6fr)_minmax(0,5fr)] lg:items-end">
          <div className="flex flex-col gap-3">
            <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-[11px] font-medium text-white/80">
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[#e0ff4f]" />
              Independent community tracker · not affiliated with Nebius
            </span>
            <h1 id="home-title" className="text-3xl font-semibold tracking-tight sm:text-4xl">
              Nebius, from public data
            </h1>
            <p className="max-w-xl text-[15px] leading-relaxed text-white/75">
              GPU pricing and spare capacity, data-center build-out, Token Factory traffic, customers, hiring and filings, rolled into one quarterly revenue guess.
            </p>
            <p className="text-xs text-white/55">
              Updated {relativeTime(d.generatedAt)} · fast sources hourly, the rest daily
              {failing.length > 0 && (
                <a href={href("sources")} className="ml-2 font-medium text-[#f2b84b] hover:underline">
                  {failing.length} source{failing.length > 1 ? "s" : ""} need attention
                </a>
              )}
            </p>
          </div>
          {next ? <NowcastHero d={d} /> : null}
        </div>
      </section>

      <StockChart d={d} p={p} range={range} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          label="Blackwell spot vs list price"
          value={pct(d.gpu.tightness.blackwell)}
          note={<>Hopper {pct(d.gpu.tightness.hopper)}. Higher means less spare capacity; the cap is 100%.</>}
          trend={trends.blackwell}
          trendFormat={(v) => pct(v)}
          p={p}
          to={href("gpu")}
          toLabel="GPU pricing"
        />
        <SummaryCard
          label="Data-center capacity ramping"
          value={ramping ? `${Math.round(ramping.mw)} MW` : "—"}
          note={`${sitesLive} live sites · ${construction ? `${(construction.mw / 1000).toFixed(1)} GW under construction` : ""} · ${siteRisk} risk headlines in 90 days`}
          p={p}
          to={href("datacenters")}
          toLabel="Data centers"
        />
        <SummaryCard
          label="Token Factory on OpenRouter, 7 days"
          value={`${tokens(d.tokens.week.tokens)} tokens`}
          delta={d.tokens.week.change}
          deltaLabel="w/w"
          note={market ? `Rank ${market.rank} of ${market.providers} providers on OpenRouter` : undefined}
          trend={trends.tokens}
          trendFormat={(v) => tokens(v, 1)}
          p={p}
          to={href("tokens")}
          toLabel="Token Factory"
        />
        <SummaryCard
          label="Customers on Nebius Atlas"
          value={d.atlas.total.toLocaleString()}
          note={`${recentAtlas} listed in the last 7 days · ${d.atlas.tokenFactory} use Token Factory`}
          trend={trends.customers}
          trendFormat={(v) => v.toLocaleString()}
          p={p}
          to={href("customers")}
          toLabel="Customers"
        />
        <SummaryCard
          label="Open roles"
          value={d.jobs.total.toLocaleString()}
          note={`${dc} in data center & power · ${d.jobs.closed30d} closed in 30 days · ${d.jobs.medianDaysToClose ?? "—"} days median to close`}
          trend={trends.roles}
          trendFormat={(v) => `${v} roles`}
          p={p}
          to={href("hiring")}
          toLabel="Hiring"
        />
        <SummaryCard
          label="Insider sales, last 90 days"
          value={usd(d.sec.totals90d.sold)}
          note={`Purchases ${usd(d.sec.totals90d.bought)} · Form 144 planned ${usd(d.sec.totals90d.planned)}`}
          p={p}
          to={href("filings")}
          toLabel="Filings"
        />
        <SummaryCard
          label="Reported ARR"
          value={lastQ?.arr ? usdM(lastQ.arr) : "—"}
          note={lastQ ? `As of ${day(lastQ.end, true)} · guidance ${usdM(d.fundamentals.guidance.arrExit[0])}–${usdM(d.fundamentals.guidance.arrExit[1])} by year-end` : undefined}
          trend={trends.arr}
          trendFormat={(v) => usdM(v)}
          p={p}
          to={href("financials")}
          toLabel="Financials"
        />
        <SummaryCard
          label={lastQ ? `${quarterLabel(lastQ.quarter)} revenue` : "Latest revenue"}
          value={lastQ ? usdM(lastQ.revenue) : "—"}
          note={d.fundamentals.neededPerQuarter ? `Guidance needs ${usdM(d.fundamentals.neededPerQuarter[0])}–${usdM(d.fundamentals.neededPerQuarter[1])} a quarter for the rest of the year` : undefined}
          trend={trends.revenue}
          trendFormat={(v) => usdM(v)}
          p={p}
          to={href("financials")}
          toLabel="Financials"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Alerts d={d} limit={6} moreHref={href("alerts")} />
        <SiteNews d={d} />
      </div>
    </div>
  );
}

/** The headline guess, sitting inside the navy hero banner. */
function NowcastHero({ d }: { d: Dashboard }) {
  const q = d.nowcast.quarters[0]!;
  const lean = q.lean === "beat" ? { t: "Lean beat", i: "▲" } : q.lean === "miss" ? { t: "Lean miss", i: "▼" } : q.lean === "in line" ? { t: "In line with consensus", i: "●" } : { t: "No consensus yet", i: "○" };
  const later = d.nowcast.quarters.slice(1);
  return (
    <a href={href("nowcast")} className="group flex flex-col gap-2.5 rounded-2xl border border-white/12 bg-white/[0.06] p-5 backdrop-blur-sm transition-colors hover:border-[#e0ff4f]/50 hover:bg-white/[0.09]">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[13px] text-white/70">
          {quarterLabel(q.quarter)} revenue nowcast · {q.status === "ended" ? "ended, not yet reported" : "in progress"}
        </p>
        <span className="shrink-0 whitespace-nowrap text-xs text-white/50 group-hover:text-[#e0ff4f]" aria-hidden>
          Details →
        </span>
      </div>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="text-5xl font-semibold tracking-tight text-[#e0ff4f]">{usdM(q.estimate)}</p>
        <span className="rounded-md bg-white/10 px-2 py-1 text-xs font-semibold text-white">
          <span aria-hidden>{lean.i}</span> {lean.t}
        </span>
      </div>
      <p className="text-sm text-white/75">
        {q.anchor.kind === "consensus" ? (
          <>
            {pct(q.estimate / q.anchor.value - 1, { signed: true, digits: 1 })} vs {usdM(q.anchor.value)} consensus · range {usdM(q.low)}–{usdM(q.high)}
          </>
        ) : (
          <>Anchored on guidance · range {usdM(q.low)}–{usdM(q.high)}</>
        )}
      </p>
      {q.expectedReport && (
        <p className="text-xs text-white/55">
          Results expected {day(q.expectedReport, true)}
          {q.reportDateConfirmed ? "" : " (estimated)"} · confidence {q.coverage < 0.5 ? "low" : "moderate"}, {pct(q.coverage)} of signals have data
        </p>
      )}
      {later.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-x-6 gap-y-1 border-t border-white/10 pt-3 text-[13px]">
          {later.map((l) => (
            <span key={l.quarter} className="text-white/70">
              {quarterLabel(l.quarter)}: <span className="font-semibold text-white">{usdM(l.estimate)}</span>
              <span className="text-white/50"> ({l.anchor.kind === "consensus" ? "vs consensus" : "guidance-anchored"})</span>
            </span>
          ))}
        </div>
      )}
    </a>
  );
}

function SiteNews({ d }: { d: Dashboard }) {
  const names = new Map(d.sites.rows.map((r) => [r.id, r.name]));
  const items = d.sites.news.filter((n) => n.tag).slice(0, 6);
  return (
    <Card>
      <CardTitle
        title="Data-center news"
        sub="Latest risk and progress headlines matched to sites"
        right={
          <a href={href("datacenters")} className="text-sm font-medium text-accent hover:underline">
            All sites →
          </a>
        }
      />
      <ul className="divide-y divide-[var(--border)]">
        {items.map((n) => (
          <li key={n.url} className="flex gap-3 py-2.5">
            <span className="tnum w-14 shrink-0 pt-0.5 text-xs text-ink-3">{day(n.date)}</span>
            <div className="min-w-0">
              <p className="text-[11px]">
                <span className={`font-semibold ${n.tag === "risk" ? "text-bad" : "text-good"}`}>
                  <span aria-hidden>{n.tag === "risk" ? "▲" : "●"}</span> {n.tag === "risk" ? "Risk" : "Progress"}
                </span>{" "}
                <span className="text-ink-3">{n.sites.map((id) => names.get(id) ?? id).join(", ")}</span>
              </p>
              <p className="mt-0.5 text-sm">
                <ExtLink href={n.url} className="no-underline hover:underline">
                  {n.title}
                </ExtLink>
              </p>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function shift(date: string, n: number) {
  const x = new Date(date + "T00:00:00Z");
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}
