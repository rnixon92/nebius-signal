import { useEffect, useState } from "react";
import type { Dashboard } from "../shared/dashboard.ts";
import { RANGES, readStoredRange, type Range } from "./lib/range.ts";
import { PAGES, href, useRoute, type PageId } from "./lib/router.ts";
import { useTheme, type ThemePref } from "./lib/theme.ts";
import { Home } from "./pages/Home.tsx";
import { CustomersSection, FilingsSection, FinancialsSection, HiringSection, SourcesSection } from "./sections/Company.tsx";
import { DataCentersSection } from "./sections/DataCenters.tsx";
import { GpuSection } from "./sections/Gpu.tsx";
import { NowcastSection } from "./sections/Nowcast.tsx";
import { Alerts } from "./sections/Overview.tsx";
import { TokensSection } from "./sections/Tokens.tsx";

const REPO = "https://github.com/rnixon92/nebius-signal";

export default function App() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<Range>(readStoredRange);
  const { pref, setPref, palette } = useTheme();
  const page = useRoute();

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

  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2">
        Skip to content
      </a>
      <header className="sticky top-0 z-30 border-b border-white/10 bg-[#052b42]/95 text-white backdrop-blur-md">
        <div className="mx-auto flex max-w-[1320px] items-center gap-3 px-4 py-2.5 sm:px-6">
          <a href={href("overview")} className="flex shrink-0 items-center gap-2.5" aria-label="NBIS Signal home">
            <Mark />
            <span className="flex flex-col leading-none">
              <span className="text-[15px] font-semibold tracking-tight">NBIS Signal</span>
              <span className="mt-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-[#e0ff4f]/80">Community tracker</span>
            </span>
          </a>
          <nav aria-label="Pages" className="no-scrollbar hidden min-w-0 flex-1 overflow-x-auto lg:block">
            <NavLinks page={page} />
          </nav>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <div className="hidden xl:block">
              <HeaderSegmented label="Default chart range" value={range} onChange={changeRange} options={RANGES.map((r) => ({ value: r, label: r }))} />
            </div>
            <HeaderSegmented<ThemePref>
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
        <nav aria-label="Pages" className="no-scrollbar overflow-x-auto border-t border-white/10 px-4 py-1.5 lg:hidden">
          <NavLinks page={page} />
        </nav>
      </header>

      <main id="main" className="mx-auto w-full max-w-[1320px] flex-1 px-4 pb-16 pt-6 sm:px-6 sm:pt-8">
        {error && (
          <div role="alert" className="rounded-2xl border border-line bg-surface p-6 text-sm">
            <p className="font-semibold">Couldn't load the dataset.</p>
            <p className="mt-1 text-ink-2">
              {error}. Run <code className="rounded bg-surface-2 px-1">npm run collect</code> to build <code className="rounded bg-surface-2 px-1">public/data/dashboard.json</code>.
            </p>
          </div>
        )}
        {!data && !error && <Skeleton />}
        {data && (
          <>
            {page !== "overview" && (
              <nav aria-label="Breadcrumb" className="mb-4 text-[13px] text-ink-3">
                <a href={href("overview")} className="hover:text-accent">
                  Overview
                </a>
                <span aria-hidden className="mx-1.5">
                  /
                </span>
                <span className="text-ink-2" aria-current="page">
                  {PAGES.find((p) => p.id === page)!.title}
                </span>
              </nav>
            )}
            <Page page={page} d={data} range={range} p={palette} />
          </>
        )}
      </main>

      <footer className="border-t border-line bg-surface">
        <div className="mx-auto flex max-w-[1320px] flex-col gap-3 px-4 py-6 text-xs leading-relaxed text-ink-3 sm:flex-row sm:items-start sm:justify-between sm:px-6">
          <p className="max-w-2xl">
            <span className="font-semibold text-ink-2">NBIS Signal is an independent community project.</span> It is not affiliated with, endorsed by or sponsored by Nebius Group
            N.V. Everything here comes from public sources and best-effort parsing. Not investment advice.
          </p>
          <p className="flex shrink-0 gap-4">
            <a href={href("sources")} className="hover:text-accent">
              Sources and method
            </a>
            <a href={REPO} target="_blank" rel="noreferrer noopener" className="hover:text-accent">
              Source code
            </a>
          </p>
        </div>
      </footer>
    </div>
  );
}

function Page({ page, d, range, p }: { page: PageId; d: Dashboard; range: Range; p: ReturnType<typeof useTheme>["palette"] }) {
  switch (page) {
    case "overview":
      return <Home d={d} p={p} range={range} />;
    case "nowcast":
      return <NowcastSection d={d} p={p} range={range} />;
    case "gpu":
      return <GpuSection d={d} p={p} range={range} />;
    case "datacenters":
      return <DataCentersSection d={d} />;
    case "tokens":
      return <TokensSection d={d} p={p} range={range} />;
    case "customers":
      return <CustomersSection d={d} p={p} range={range} />;
    case "hiring":
      return <HiringSection d={d} p={p} range={range} />;
    case "filings":
      return <FilingsSection d={d} />;
    case "financials":
      return <FinancialsSection d={d} p={p} />;
    case "alerts":
      return (
        <div className="flex flex-col gap-4">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Alerts</h1>
          <p className="max-w-3xl text-sm text-ink-2">Everything the collector flagged in the last 60 days. Collection runs hourly for fast-moving sources and daily for the rest.</p>
          <Alerts d={d} limit={50} />
        </div>
      );
    case "sources":
      return <SourcesSection d={d} />;
  }
}

function NavLinks({ page }: { page: PageId }) {
  return (
    <ul className="flex gap-0.5">
      {PAGES.filter((p) => p.id !== "alerts").map((p) => {
        const active = p.id === page;
        return (
          <li key={p.id}>
            <a
              href={href(p.id)}
              aria-current={active ? "page" : undefined}
              className={`block whitespace-nowrap rounded-md px-2.5 py-1.5 text-[13px] transition-colors ${active ? "bg-[#e0ff4f] font-semibold text-[#052b42]" : "text-white/75 hover:bg-white/10 hover:text-white"}`}
            >
              {p.label}
            </a>
          </li>
        );
      })}
    </ul>
  );
}

/** Segmented control styled for the navy header. */
function HeaderSegmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg bg-white/10 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${value === o.value ? "bg-white text-[#052b42]" : "text-white/70 hover:text-white"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Our own mark: a rising signal line. Deliberately not the Nebius logo. */
function Mark() {
  return (
    <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="9" fill="#e0ff4f" />
      <path d="M7 21.5l5-6.5 4 3.5 8.5-10" stroke="#052b42" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="24.5" cy="8.5" r="2.4" fill="#052b42" />
    </svg>
  );
}

function Skeleton() {
  return (
    <div aria-busy="true" aria-label="Loading" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="h-32 animate-pulse rounded-2xl border border-line bg-surface" />
      ))}
    </div>
  );
}
