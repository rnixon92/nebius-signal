import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { Dashboard } from "../../shared/dashboard.ts";
import { Card, CardTitle, DataTable, ExtLink, Stat } from "../components/ui.tsx";
import { day, pct, usd, usdM } from "../lib/format.ts";
import type { Palette } from "../lib/theme.ts";

const KEY = "valuationInputs";

type Inputs = {
  price: number | null;
  clickhouse: number | null;
  toloka: number | null;
  other: Record<string, number>;
  // Capacity scenario
  mw: number;
  perMw: number;
  multiple: number;
  netDebtB: number;
  dilution: number;
};

const DEFAULTS: Omit<Inputs, "price" | "clickhouse" | "toloka"> = { other: {}, mw: 1000, perMw: 15, multiple: 6, netDebtB: 15, dilution: 0.1 };

function readInputs(): Partial<Inputs> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Inputs>;
  } catch {
    return {};
  }
}

const x = (v: number) => `${v >= 10 ? v.toFixed(1) : v.toFixed(2)}x`;

function NumberField({ label, value, onChange, step = 1, prefix, suffix, hint, width = "w-28" }: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  prefix?: string;
  suffix?: string;
  hint?: ReactNode;
  width?: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-[13px]">
      <span className="text-ink-2">{label}</span>
      <span className="flex items-center gap-1.5">
        {prefix && <span className="text-ink-3">{prefix}</span>}
        <input
          type="number"
          step={step}
          value={Number.isFinite(value) ? value : 0}
          onChange={(e) => onChange(Number(e.target.value))}
          className={`tnum ${width} rounded-md border border-line bg-surface-2 px-2 py-1 text-right text-ink`}
        />
        {suffix && <span className="text-ink-3">{suffix}</span>}
      </span>
      {hint && <span className="text-xs text-ink-3">{hint}</span>}
    </label>
  );
}

function Slider({ label, value, min, max, step, onChange, display, marks }: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  display: string;
  marks?: { at: number; label: string }[];
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="flex items-baseline justify-between text-[13px]">
        <span className="text-ink-2">{label}</span>
        <span className="tnum font-semibold text-ink">{display}</span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full" />
      {marks && (
        <span className="relative h-4 text-[10px] text-ink-3" aria-hidden>
          {marks.map((m) => (
            <span key={m.label} className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: `${((m.at - min) / (max - min)) * 100}%` }}>
              {m.label}
            </span>
          ))}
        </span>
      )}
    </label>
  );
}

/**
 * Sum-of-the-parts: market cap → enterprise value → strip out the investment stakes and the non-cloud
 * businesses → the enterprise value being paid for the AI cloud, against ARR and power. Then a capacity
 * scenario: MW live × revenue per MW × multiple → implied price. All arithmetic runs here so readers can
 * change any assumption; inputs persist in this browser.
 */
export function ValuationPanel({ d, p }: { d: Dashboard; p: Palette }) {
  const v = d.valuation;
  const bs = v.balanceSheet;
  const stored = readInputs();
  const [inp, setInp] = useState<Inputs>({
    price: stored.price ?? null,
    clickhouse: stored.clickhouse ?? null,
    toloka: stored.toloka ?? null,
    other: stored.other ?? {},
    mw: stored.mw ?? DEFAULTS.mw,
    perMw: stored.perMw ?? DEFAULTS.perMw,
    multiple: stored.multiple ?? DEFAULTS.multiple,
    netDebtB: stored.netDebtB ?? DEFAULTS.netDebtB,
    dilution: stored.dilution ?? DEFAULTS.dilution,
  });
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(inp));
    } catch {
      // per-visit only
    }
  }, [inp]);
  const set = (patch: Partial<Inputs>) => setInp((s) => ({ ...s, ...patch }));

  const calc = useMemo(() => {
    if (!bs || !v.price) return null;
    const price = inp.price ?? v.price.value;
    const sharesM = bs.shares / 1e6;
    const mcap = price * sharesM;
    const ev = mcap + bs.debt - bs.cash;
    const clickhouse = inp.clickhouse ?? v.sotp?.clickhouse.value ?? bs.clickhouse;
    const toloka = inp.toloka ?? v.sotp?.toloka.value ?? bs.toloka;
    const investments = clickhouse + toloka + bs.otherInvestments;
    const others = v.otherBusinesses.map((b) => ({ ...b, value: inp.other[b.name] ?? b.defaultValue ?? 0 }));
    const othersTotal = others.reduce((a, b) => a + b.value, 0);
    const coreEv = ev - investments - othersTotal;
    return { price, sharesM, mcap, ev, clickhouse, toloka, investments, others, othersTotal, coreEv };
  }, [bs, v, inp]);

  if (!calc || !bs || !v.price) return <Card>Valuation inputs are missing from fundamentals.json.</Card>;

  const arr = v.arr?.value ?? null;
  const [g0, g1] = v.arrGuidance;
  const scenario = (mw: number, perMw: number) => {
    const arrS = mw * perMw;
    const coreEv = arrS * inp.multiple;
    const equity = coreEv + calc.investments + calc.othersTotal - inp.netDebtB * 1000;
    return equity / (calc.sharesM * (1 + inp.dilution));
  };
  const implied = scenario(inp.mw, inp.perMw);
  const mwRows = [500, 1000, 1500, 2000, 3000];
  const perMwCols = [12, 15, 20, 25, 40];
  const changed = inp.price !== null || inp.clickhouse !== null || inp.toloka !== null || Object.keys(inp.other).length > 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Market cap" value={usdM(calc.mcap)} note={`${usd(calc.price, { cents: true })} × ${calc.sharesM.toFixed(1)}M shares`} />
        <Stat label="Enterprise value" value={usdM(calc.ev)} note={`Net debt ${usdM(bs.debt - bs.cash)} at ${day(bs.date, true)}`} />
        <Stat label="AI cloud EV ÷ ARR" value={arr ? x(calc.coreEv / arr) : "—"} note={arr ? `On ${usdM(arr)} ARR (${day(v.arr!.date, true)}); ${x(calc.coreEv / g1)}–${x(calc.coreEv / g0)} on year-end guidance` : undefined} />
        <Stat
          label="AI cloud EV per MW"
          value={v.connectedTarget ? `${usdM(calc.coreEv / ((v.connectedTarget[0] + v.connectedTarget[1]) / 2))}` : "—"}
          note={v.connectedTarget ? `Per MW of connected power guided for year-end (${v.connectedTarget[0]}–${v.connectedTarget[1]} MW)${v.contractedMw ? `; ${usdM(calc.coreEv / v.contractedMw)} per MW secured` : ""}` : undefined}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardTitle
            title="Sum of the parts"
            sub="What the market price implies for the AI cloud alone, after the stakes and other businesses"
            right={
              changed ? (
                <button type="button" onClick={() => set({ price: null, clickhouse: null, toloka: null, other: {} })} className="text-sm font-medium text-accent hover:underline">
                  Reset
                </button>
              ) : undefined
            }
          />
          <table className="w-full border-collapse text-[13px]">
            <caption className="sr-only">Sum-of-the-parts bridge</caption>
            <tbody>
              {[
                { label: "Market cap", value: calc.mcap, edit: <NumberField label="" value={calc.price} step={0.5} prefix="$" width="w-24" onChange={(n) => set({ price: n })} />, strong: true, hint: "Share price: edit to test another price" },
                { label: "+ Debt", value: bs.debt },
                { label: "− Cash", value: -bs.cash },
                { label: "= Enterprise value", value: calc.ev, strong: true, rule: true },
                { label: "− ClickHouse stake", value: -calc.clickhouse, edit: <NumberField label="" value={calc.clickhouse} step={50} prefix="$" suffix="M" width="w-24" onChange={(n) => set({ clickhouse: n })} />, hint: v.sotp?.clickhouse.note ?? "Balance-sheet value, re-marked on a Jan 2026 transaction" },
                { label: "− Toloka stake", value: -calc.toloka, edit: <NumberField label="" value={calc.toloka} step={10} prefix="$" suffix="M" width="w-24" onChange={(n) => set({ toloka: n })} />, hint: v.sotp?.toloka.note ?? "Balance-sheet value of the preferred shares" },
                { label: "− Other investments", value: -bs.otherInvestments, hint: "Venture fund and smaller stakes, at book value." },
                ...calc.others.map((o) => ({
                  label: `− ${o.name}`,
                  value: -o.value,
                  edit: <NumberField label="" value={o.value} step={50} prefix="$" suffix="M" width="w-24" onChange={(n) => set({ other: { ...inp.other, [o.name]: n } })} />,
                  hint: `${o.what}. ${o.note}`,
                })),
                { label: "= AI cloud enterprise value", value: calc.coreEv, strong: true, rule: true },
              ].map((r) => (
                <tr key={r.label} className={r.rule ? "border-t border-line" : ""}>
                  <td className={`py-2 pr-3 align-top ${r.strong ? "font-semibold text-ink" : "text-ink-2"}`}>
                    {r.label}
                    {"hint" in r && r.hint && <p className="mt-0.5 text-xs font-normal text-ink-3">{r.hint}</p>}
                  </td>
                  <td className="py-2 pr-3 align-top">{"edit" in r ? r.edit : null}</td>
                  <td className={`tnum whitespace-nowrap py-2 text-right align-top ${r.strong ? "font-semibold text-ink" : "text-ink-2"}`}>{usdM(r.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-xs leading-relaxed text-ink-3">
            Balance sheet at {day(bs.date, true)} (<ExtLink href={bs.source} className="text-ink-3">filing</ExtLink>). ClickHouse and Toloka start from fair-value estimates above those carrying values; Avride stays at zero because it has no priced round. Since then the $775M secured loan and ~$5.75B of convertible
            notes added roughly equal cash and debt, and Q3 capex has been spending cash, so net debt today is likely higher; the next quarterly report updates it. Leases are left
            out. Your edits are saved in this browser.
          </p>
        </Card>

        <Card className="lg:col-span-2">
          <CardTitle title="Dilution" sub="Shares outstanding (Class A + B) and capacity to issue more" />
          <ul className="flex flex-col gap-2.5">
            {v.sharesHistory.map((s, i) => {
              const max = Math.max(...v.sharesHistory.map((h) => h.shares));
              const prev = v.sharesHistory[i - 1];
              return (
                <li key={s.date} className="grid grid-cols-[5.5rem_1fr_4.5rem_3.5rem] items-center gap-2 text-[13px]">
                  <span className="text-ink-3">{day(s.date, true)}</span>
                  <span className="h-2 rounded-full bg-surface-2" aria-hidden>
                    <span className="block h-full rounded-r-[4px] rounded-l-full" style={{ width: `${(s.shares / max) * 100}%`, background: p.accent }} />
                  </span>
                  <span className="tnum text-right">{(s.shares / 1e6).toFixed(1)}M</span>
                  <span className="tnum text-right text-xs text-ink-3">{prev ? pct(s.shares / prev.shares - 1, { signed: true, digits: 1 }) : ""}</span>
                </li>
              );
            })}
          </ul>
          {v.atmRemainingShares && (
            <p className="mt-3 text-[13px] text-ink-2">
              {(v.atmRemainingShares / 1e6).toFixed(1)}M more Class A shares can still be sold under the at-the-market program (
              {pct(v.atmRemainingShares / bs.shares, { digits: 1 })} of shares outstanding).
            </p>
          )}
          <p className="mt-2 text-xs text-ink-3">Convertible notes can also convert into shares if the price rises far enough; the March 2026 notes convert at about $183.</p>
        </Card>
      </div>

      <Card>
        <CardTitle
          title="Capacity scenario"
          sub="If Nebius runs this many MW at this revenue per MW, valued at this multiple, what is a share worth? A scenario, not a forecast."
          right={
            <button type="button" onClick={() => set({ mw: DEFAULTS.mw, perMw: DEFAULTS.perMw, multiple: DEFAULTS.multiple, netDebtB: DEFAULTS.netDebtB, dilution: DEFAULTS.dilution })} className="text-sm font-medium text-accent hover:underline">
              Reset
            </button>
          }
        />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <div className="flex flex-col gap-4">
            <Slider
              label="Active power"
              value={inp.mw}
              min={200}
              max={3000}
              step={50}
              onChange={(n) => set({ mw: n })}
              display={inp.mw >= 1000 ? `${(inp.mw / 1000).toFixed(2)} GW` : `${inp.mw} MW`}
              marks={[
                { at: 900, label: "YE26 guide" },
                { at: 1900, label: "YE27 at +1 GW/yr" },
              ]}
            />
            <Slider
              label="Revenue per MW per year"
              value={inp.perMw}
              min={8}
              max={50}
              step={1}
              onChange={(n) => set({ perMw: n })}
              display={`$${inp.perMw}M`}
              marks={[
                { at: 12, label: "base" },
                { at: 22.5, label: "mid-term" },
                { at: 45, label: "short-term" },
              ]}
            />
            <Slider label="EV ÷ ARR multiple" value={inp.multiple} min={2} max={20} step={0.5} onChange={(n) => set({ multiple: n })} display={x(inp.multiple)} />
            <div className="flex flex-wrap gap-4">
              <NumberField label="Net debt then" value={inp.netDebtB} step={1} prefix="$" suffix="B" width="w-20" onChange={(n) => set({ netDebtB: n })} hint="Capex is debt-funded" />
              <NumberField label="Extra dilution" value={Math.round(inp.dilution * 100)} step={1} suffix="%" width="w-20" onChange={(n) => set({ dilution: n / 100 })} hint="New shares by then" />
            </div>
          </div>
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-3 gap-3">
              <div>
                <p className="text-[13px] text-ink-2">Implied ARR</p>
                <p className="text-2xl font-semibold tracking-tight">{usdM(inp.mw * inp.perMw)}</p>
              </div>
              <div>
                <p className="text-[13px] text-ink-2">Implied price</p>
                <p className="text-2xl font-semibold tracking-tight">{usd(implied, { cents: true })}</p>
              </div>
              <div>
                <p className="text-[13px] text-ink-2">vs today</p>
                <p className={`text-2xl font-semibold tracking-tight ${implied >= calc.price ? "text-good" : "text-bad"}`}>{pct(implied / calc.price - 1, { signed: true })}</p>
              </div>
            </div>
            <div className="-mx-1 overflow-x-auto px-1">
              <table className="w-full border-collapse text-[13px]">
                <caption className="mb-1.5 text-left text-xs text-ink-3">
                  Implied share price at {x(inp.multiple)} EV/ARR: active power (rows) × revenue per MW per year (columns). Today: {usd(calc.price, { cents: true })}.
                </caption>
                <thead>
                  <tr>
                    <th scope="col" className="px-2 py-1.5 text-left font-medium text-ink-3">MW</th>
                    {perMwCols.map((c) => (
                      <th key={c} scope="col" className="px-2 py-1.5 text-right font-medium text-ink-3">
                        ${c}M
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {mwRows.map((m) => (
                    <tr key={m} className="border-t border-line">
                      <th scope="row" className="tnum px-2 py-1.5 text-left font-medium text-ink-2">
                        {m >= 1000 ? `${m / 1000} GW` : m}
                      </th>
                      {perMwCols.map((c) => {
                        const val = scenario(m, c);
                        const up = val / calc.price - 1;
                        const tint = Math.min(0.28, Math.abs(up) * 0.25);
                        return (
                          <td
                            key={c}
                            className={`tnum px-2 py-1.5 text-right ${up >= 0 ? "text-good" : "text-bad"} ${m === inp.mw && c === inp.perMw ? "font-bold outline outline-1 outline-[var(--accent)]" : ""}`}
                            style={{ background: `color-mix(in srgb, var(${up >= 0 ? "--good" : "--bad"}) ${Math.round(tint * 100)}%, transparent)` }}
                            title={`${pct(up, { signed: true })} vs today`}
                          >
                            {val > 0 ? usd(val) : "<$0"}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs leading-relaxed text-ink-3">
              Per-MW reference points from the Q2 2026 letter: 2026 base fleet ~$12M, mid-term deals $20–25M, short-term capacity $40–50M. Implied price = (ARR × multiple + stakes and
              other businesses − net debt) ÷ (shares × (1 + dilution)).
            </p>
          </div>
        </div>
      </Card>

      <Card>
        <CardTitle title="Capital raised" sub="How the build-out is being funded: convertible notes, share sales and secured debt" />
        <DataTable
          caption="Capital raised"
          rows={v.capitalRaised}
          columns={[
            { key: "d", label: "Date", render: (r) => <span className="whitespace-nowrap text-ink-3">{day(r.date, true)}</span> },
            { key: "k", label: "Type", render: (r) => <span className="whitespace-nowrap font-medium">{r.kind}</span> },
            { key: "a", label: "Amount", align: "right", render: (r) => usdM(r.amount) },
            { key: "x", label: "Detail", render: (r) => <span className="text-ink-2">{r.detail}</span> },
            { key: "s", label: "", render: (r) => <ExtLink href={r.source} className="text-xs text-ink-3">source</ExtLink> },
          ]}
        />
        <p className="mt-3 text-xs text-ink-3">
          Total since mid-2025: {usdM(v.capitalRaised.reduce((a, c) => a + c.amount, 0))}, against 2026 capex guidance of $20–25B. Nebius also expects over $9B of customer prepayments in
          2026.
        </p>
      </Card>
    </div>
  );
}
