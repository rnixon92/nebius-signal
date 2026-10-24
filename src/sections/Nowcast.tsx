import type { Dashboard, Nowcast } from "../../shared/dashboard.ts";
import { TimeSeriesCard } from "../components/TimeSeriesCard.tsx";
import { Card, CardTitle, DataTable, EmptyNote, ExtLink, Meter, Section } from "../components/ui.tsx";
import { day, pct, usdM } from "../lib/format.ts";
import type { Range } from "../lib/range.ts";
import type { Palette } from "../lib/theme.ts";

const quarterLabel = (q: string) => q.replace(/(\d{4})-(Q\d)/, "$2 $1");

const LEAN: Record<Nowcast["lean"], { label: string; icon: string; cls: string }> = {
  beat: { label: "Lean beat", icon: "▲", cls: "text-good bg-[color-mix(in_srgb,var(--good)_12%,transparent)]" },
  miss: { label: "Lean miss", icon: "▼", cls: "text-bad bg-[color-mix(in_srgb,var(--bad)_12%,transparent)]" },
  "in line": { label: "In line", icon: "●", cls: "text-ink-2 bg-surface-2" },
  "no consensus": { label: "No consensus yet", icon: "○", cls: "text-ink-3 bg-surface-2" },
};

export function NowcastSection({ d, p, range }: { d: Dashboard; p: Palette; range: Range }) {
  const n = d.nowcast;
  const graded = n.scorecard.filter((s) => s.nowcast !== null).length;
  return (
    <Section
      id="nowcast"
      kicker="Overall guess"
      title="Quarter nowcast"
      intro={
        <>
          One number per unreported quarter: the analyst consensus, nudged by the signals this tracker collects. Each signal is scored, weighted by importance and by how much of
          the quarter its data covers. The weights are starting assumptions; the scorecard below grades every guess against the reported result, so after a few quarters you
          can see whether the signals are worth anything.
        </>
      }
    >
      {n.quarters.map((q) => (
        <QuarterCard key={q.quarter} q={q} p={p} graded={graded} />
      ))}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {n.history.length >= 2 ? (
          <TimeSeriesCard
            title="How the guess has moved"
            sub="Daily estimate per quarter, USD"
            p={p}
            globalRange={range}
            rows={n.history}
            series={n.quarters.map((q, i) => ({ key: q.quarter, label: quarterLabel(q.quarter), color: p.series[i]! }))}
            format={(v) => usdM(v)}
            yDomain={["auto", "auto"]}
            csvName="nebius-nowcast-history"
            height={220}
          />
        ) : (
          <Card>
            <CardTitle title="How the guess has moved" />
            <EmptyNote>The estimate is recorded on every daily run from {day(n.history[0]?.date ?? d.generatedAt, true)}. A line appears after the second run.</EmptyNote>
          </Card>
        )}
        <Card>
          <CardTitle title="Scorecard" sub="Each reported quarter against consensus, and whether the nowcast called the direction" />
          <DataTable
            caption="Nowcast scorecard"
            rows={n.scorecard}
            columns={[
              { key: "q", label: "Quarter", render: (r) => quarterLabel(r.quarter) },
              { key: "c", label: "Consensus", align: "right", render: (r) => usdM(r.consensus) },
              { key: "a", label: "Actual", align: "right", render: (r) => usdM(r.actual) },
              { key: "s", label: "Surprise", align: "right", render: (r) => <span className={r.surprise >= 0 ? "text-good" : "text-bad"}>{pct(r.surprise, { signed: true, digits: 1 })}</span> },
              { key: "n", label: "Nowcast", align: "right", render: (r) => (r.nowcast === null ? <span className="text-ink-3">not tracked</span> : usdM(r.nowcast)) },
              { key: "ok", label: "Called it", align: "right", render: (r) => (r.correctDirection === null ? "—" : r.correctDirection ? <span className="text-good">✓ Yes</span> : <span className="text-bad">✕ No</span>) },
            ]}
          />
          <p className="mt-3 text-xs text-ink-3">
            {graded === 0 ? "No graded quarters yet: Q3 2026 will be the first." : `${n.scorecard.filter((s) => s.correctDirection).length} of ${graded} called correctly.`} Revenue
            has run at {n.realization ? pct(n.realization) : "—"} of average in-quarter ARR ÷ 4 in quarters where both ends are reported.
          </p>
        </Card>
      </div>
    </Section>
  );
}

function QuarterCard({ q, p, graded }: { q: Nowcast; p: Palette; graded: number }) {
  const lean = LEAN[q.lean];
  const conf = q.coverage < 0.5 || graded < 3 ? "Low" : q.coverage < 0.8 ? "Medium" : "Higher";
  // The track-record adjustment isn't a weighted signal, but it moves the estimate, so it gets a row.
  const rows = [
    ...q.signals,
    {
      id: "track-record",
      label: "Track record",
      value: q.priorFromLastSurprise ? `Last quarter ${q.priorFromLastSurprise > 0 ? "beat" : "missed"} by ~${pct(Math.abs(q.priorFromLastSurprise * 2), { digits: 1 })}` : "No scored quarter yet",
      score: 0,
      weight: 0,
      coverage: q.priorFromLastSurprise ? 1 : 0,
      contribution: q.priorFromLastSurprise,
      note: "Half of the last quarter's surprise vs consensus, capped at ±3%. Companies that beat tend to keep beating, modestly.",
    },
  ];
  const maxAbs = Math.max(0.005, ...rows.map((s) => Math.abs(s.contribution)));
  return (
    <Card>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[15px] font-semibold">{quarterLabel(q.quarter)} revenue</h3>
            <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[11px] text-ink-2">{q.status === "ended" ? "Quarter ended, not yet reported" : "In progress"}</span>
          </div>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <p className="text-5xl font-semibold tracking-tight">{usdM(q.estimate)}</p>
            <span className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold ${lean.cls}`}>
              <span aria-hidden>{lean.icon}</span>
              {lean.label}
            </span>
          </div>
          <p className="text-sm text-ink-2">
            Range {usdM(q.low)}–{usdM(q.high)} ·{" "}
            {q.anchor.kind === "consensus" ? (
              <>
                {pct(q.estimate / q.anchor.value - 1, { signed: true, digits: 1 })} vs {usdM(q.anchor.value)} consensus
                {q.anchor.range && ` (${usdM(q.anchor.range[0])}–${usdM(q.anchor.range[1])})`}
                {q.anchor.source && (
                  <>
                    {" "}
                    · <ExtLink href={q.anchor.source}>source</ExtLink>
                  </>
                )}
              </>
            ) : (
              <>anchored on what full-year guidance implies; add consensus to fundamentals.json when available</>
            )}
          </p>
          {q.expectedReport && (
            <p className="text-xs text-ink-3">
              Results expected {day(q.expectedReport, true)}
              {q.reportDateConfirmed ? "" : " (estimated from last year; not confirmed)"}
            </p>
          )}
          <NumberLine q={q} p={p} />
          <p className="text-xs leading-relaxed text-ink-3">
            Confidence: <span className="font-medium text-ink-2">{conf}</span>. {pct(q.coverage)} of the model's weight has data behind it, and {graded} past quarter
            {graded === 1 ? " has" : "s have"} been graded. Track-record adjustment from the last surprise: {pct(q.priorFromLastSurprise, { signed: true, digits: 1 })}.
          </p>
        </div>

        <div className="min-w-0">
          <p className="mb-2 text-[13px] font-medium text-ink-2">What's moving the guess</p>
          <DataTable
            caption={`${quarterLabel(q.quarter)} signals`}
            rows={rows}
            columns={[
              { key: "s", label: "Signal", render: (s) => <span className="font-medium" title={s.note}>{s.label}</span> },
              { key: "v", label: "Reading", render: (s) => <span className="text-ink-2">{s.value}</span> },
              { key: "e", label: "Effect on estimate", render: (s) => <EffectBar value={s.contribution} max={maxAbs} p={p} /> },
              {
                key: "c",
                label: "Data",
                render: (s) => (
                  <div className="flex w-20 items-center gap-1.5" title={`${pct(s.coverage)} of the quarter covered · weight ${s.weight}`}>
                    <Meter value={s.coverage} color={p.ink3} label={`${s.label} coverage ${pct(s.coverage)}`} />
                  </div>
                ),
              },
            ]}
          />
          <p className="mt-2 text-xs text-ink-3">Hover a signal name for how it's read. Signals with no data yet have no effect.</p>
        </div>
      </div>
    </Card>
  );
}

/** Diverging bar from a center line: right = pushes the estimate up. */
function EffectBar({ value, max, p }: { value: number; max: number; p: Palette }) {
  const w = (Math.abs(value) / max) * 50;
  return (
    <div className="flex min-w-36 items-center gap-2">
      <div className="relative h-2 w-24" aria-hidden>
        <div className="absolute inset-y-[-3px] left-1/2 w-px" style={{ background: p.rule }} />
        {value !== 0 && <div className="absolute inset-y-0 rounded-[2px]" style={{ left: value > 0 ? "50%" : `${50 - w}%`, width: `${w}%`, background: value > 0 ? "var(--good)" : "var(--bad)" }} />}
      </div>
      <span className={`tnum text-xs ${value > 0 ? "text-good" : value < 0 ? "text-bad" : "text-ink-3"}`}>{value === 0 ? "none" : Math.abs(value) < 0.0005 ? "~0" : pct(value, { signed: true, digits: 1 })}</span>
    </div>
  );
}

/** Where the estimate sits between the no-growth floor, consensus and the straight-line ARR path to guidance. */
function NumberLine({ q, p }: { q: Nowcast; p: Palette }) {
  const pts = [q.context.floor, q.context.pathLow, q.context.pathHigh, q.low, q.high, q.anchor.value, ...(q.anchor.range ?? [])].filter((v): v is number => v !== null);
  const lo = Math.min(...pts) * 0.97;
  const hi = Math.max(...pts) * 1.02;
  const x = (v: number) => `${((v - lo) / (hi - lo)) * 100}%`;
  const marks: { v: number; label: string; strong?: boolean }[] = [
    ...(q.context.floor ? [{ v: q.context.floor, label: "No growth" }] : []),
    { v: q.anchor.value, label: q.anchor.kind === "consensus" ? "Consensus" : "Guidance-implied" },
    ...(q.context.pathMid ? [{ v: q.context.pathMid, label: "Straight-line ARR" }] : []),
  ];
  return (
    <figure className="mt-1" aria-label={`Estimate ${usdM(q.estimate)} relative to anchors`}>
      <div className="relative h-10">
        <div className="absolute inset-x-0 top-4 h-px" style={{ background: p.rule }} />
        {q.context.pathLow && q.context.pathHigh && (
          <div className="absolute top-3 h-2 rounded-full" style={{ left: x(q.context.pathLow), width: `calc(${x(q.context.pathHigh)} - ${x(q.context.pathLow)})`, background: p.muted }} title="ARR path to guidance, low–high" />
        )}
        {q.anchor.range && (
          <div className="absolute top-2.5 h-3 rounded-full" style={{ left: x(q.anchor.range[0]), width: `calc(${x(q.anchor.range[1])} - ${x(q.anchor.range[0])})`, background: `color-mix(in srgb, ${p.accent} 22%, transparent)` }} title="Analyst range" />
        )}
        {marks.map((m) => (
          <div key={m.label} className="absolute top-1.5 h-5 w-px" style={{ left: x(m.v), background: p.ink3 }} />
        ))}
        <div className="absolute top-1.5 h-5 w-5 -translate-x-1/2 rounded-full border-2" style={{ left: x(q.estimate), background: p.accent, borderColor: p.surface }} title={`Nowcast ${usdM(q.estimate)}`} />
      </div>
      <figcaption className="relative h-8 text-[11px] text-ink-3">
        {marks.map((m) => (
          <span key={m.label} className="absolute -translate-x-1/2 whitespace-nowrap text-center leading-tight" style={{ left: x(m.v) }}>
            {m.label}
            <br />
            <span className="tnum text-ink-2">{usdM(m.v)}</span>
          </span>
        ))}
      </figcaption>
    </figure>
  );
}
