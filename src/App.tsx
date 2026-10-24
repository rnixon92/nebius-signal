import { useEffect, useState } from "react";
import type { Dashboard } from "../shared/dashboard.ts";
import { Segmented } from "./components/ui.tsx";
import { relativeTime } from "./lib/format.ts";
import { RANGES, readStoredRange, type Range } from "./lib/range.ts";
import { useTheme, type ThemePref } from "./lib/theme.ts";
import { CustomersSection, FilingsSection, FinancialsSection, HiringSection, SourcesSection } from "./sections/Company.tsx";
import { DataCentersSection } from "./sections/DataCenters.tsx";
import { GpuSection } from "./sections/Gpu.tsx";
import { NowcastSection } from "./sections/Nowcast.tsx";
import { Alerts, KpiRow, StockChart } from "./sections/Overview.tsx";
import { TokensSection } from "./sections/Tokens.tsx";

const NAV = [
  { id: "overview", label: "Overview" },
  { id: "nowcast", label: "Nowcast" },
  { id: "gpu", label: "GPU pricing" },
  { id: "datacenters", label: "Data centers" },
  { id: "tokens", label: "Token Factory" },
  { id: "customers", label: "Customers" },
  { id: "hiring", label: "Hiring" },
  { id: "filings", label: "Filings" },
  { id: "financials", label: "Financials" },
  { id: "sources", label: "Sources" },
];

export default function App() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<Range>(readStoredRange);
  const { pref, setPref, palette } = useTheme();

  useEffect(() => {
    fetch("data/dashboard.json", { cache: "no-cache" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, []);

  const changeRange = (r: Range) => {
    setRange(r);
    try {
      localStorage.setItem("range", r);
    } catch {
      // per-visit only
    }
  };

  const failing = data?.sources.filter((s) => !s.ok || s.stale) ?? [];

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-line bg-[color-mix(in_srgb,var(--page)_85%,transparent)] backdrop-blur-md">
        <div className="mx-auto flex max-w-[1280px] items-center gap-4 px-4 py-3 sm:px-6">
          <a href="#overview" className="flex shrink-0 items-center gap-2 font-semibold tracking-tight text-ink">
            <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden>
              <rect width="32" height="32" rx="8" fill={palette.series[0]} />
              <path d="M8 22l5-7 4 4 7-10" stroke="white" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Nebius Signal
          </a>
          <nav aria-label="Sections" className="hidden min-w-0 flex-1 overflow-x-auto md:block">
            <ul className="flex gap-1">
              {NAV.map((n) => (
                <li key={n.id}>
                  <a href={`#${n.id}`} className="block whitespace-nowrap rounded-md px-2.5 py-1.5 text-[13px] text-ink-2 hover:bg-surface-2 hover:text-ink">
                    {n.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <div className="ml-auto shrink-0">
            <Segmented<ThemePref>
              label="Theme"
              value={pref}
              onChange={setPref}
              options={[
                { value: "system", label: "Auto" },
                { value: "light", label: "Light" },
                { value: "dark", label: "Dark" },
              ]}
            />
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-[1280px] flex-col gap-12 px-4 pb-20 pt-8 sm:px-6">
        {error && (
          <div role="alert" className="rounded-xl border border-line bg-surface p-6 text-sm">
            <p className="font-semibold">Couldn't load the dataset.</p>
            <p className="mt-1 text-ink-2">
              {error}. Run <code className="rounded bg-surface-2 px-1">npm run collect</code> to build <code className="rounded bg-surface-2 px-1">public/data/dashboard.json</code>.
            </p>
          </div>
        )}
        {!data && !error && <Skeleton />}
        {data && (
          <>
            <section id="overview" aria-labelledby="overview-title" className="scroll-mt-20">
              <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h1 id="overview-title" className="text-2xl font-semibold tracking-tight sm:text-3xl">
                    Nebius, from public data
                  </h1>
                  <p className="mt-1 max-w-2xl text-sm text-ink-2">
                    GPU pricing and spare capacity, Token Factory traffic, customers, hiring and filings, collected daily.{" "}
                    <span className="text-ink-3">Updated {relativeTime(data.generatedAt)}.</span>
                    {failing.length > 0 && (
                      <a href="#sources" className="ml-1 font-medium text-warn hover:underline">
                        {failing.length} source{failing.length > 1 ? "s" : ""} need attention
                      </a>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-ink-3">Default range</span>
                  <Segmented label="Default time range for all charts" value={range} onChange={changeRange} options={RANGES.map((r) => ({ value: r, label: r }))} />
                </div>
              </div>
              <div className="flex flex-col gap-4">
                <KpiRow d={data} p={palette} />
                <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                  <StockChart d={data} p={palette} range={range} />
                  <Alerts d={data} />
                </div>
              </div>
            </section>
            <NowcastSection d={data} p={palette} range={range} />
            <GpuSection d={data} p={palette} range={range} />
            <DataCentersSection d={data} />
            <TokensSection d={data} p={palette} range={range} />
            <CustomersSection d={data} p={palette} range={range} />
            <HiringSection d={data} p={palette} range={range} />
            <FilingsSection d={data} />
            <FinancialsSection d={data} p={palette} />
            <SourcesSection d={data} />
          </>
        )}
      </main>
    </div>
  );
}

function Skeleton() {
  return (
    <div aria-busy="true" aria-label="Loading" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="h-28 animate-pulse rounded-xl border border-line bg-surface" />
      ))}
    </div>
  );
}
