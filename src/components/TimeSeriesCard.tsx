import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Bar, Brush, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ChartEvent } from "../../shared/dashboard.ts";
import { day, pct } from "../lib/format.ts";
import { availableRanges, clip, type Range } from "../lib/range.ts";
import type { Palette } from "../lib/theme.ts";
import { CHART_MARGIN, axisX, axisY, cursor, grid, type TipProps } from "./chart.tsx";
import { Card, DataTable, Segmented, TooltipCard } from "./ui.tsx";

export type Series = { key: string; label: string; color: string };

type Props<R extends { date: string }> = {
  title: string;
  sub?: ReactNode;
  rows: R[];
  series: Series[];
  p: Palette;
  /** Page-wide default; the chart can override it locally until the page default changes again. */
  globalRange: Range;
  kind?: "line" | "step" | "stacked";
  format: (v: number) => string;
  axisFormat?: (v: number) => string;
  /** How to express change across the visible range: percent, or difference in the series' own units (e.g. points for ratios). */
  change?: "pct" | "diff" | "none";
  diffFormat?: (v: number) => string;
  yDomain?: [number | "auto", number | "auto"];
  yTicks?: number[];
  refY?: { y: number; label: string }[];
  events?: ChartEvent[];
  tooltipFooter?: (row: R) => ReactNode;
  /** Rows drawn faded (e.g. today's partial day). */
  dimRow?: (row: R) => boolean;
  controls?: ReactNode;
  csvName: string;
  height?: number;
  note?: ReactNode;
  /** Extra filters shown under the header (e.g. region chips), in both the card and the expanded view. */
  filters?: ReactNode;
  /** Index every series to 100 at the first visible point, so series on different scales compare as returns. */
  rebase?: boolean;
};

const EVENT_LABEL: Record<ChartEvent["kind"], string> = { earnings: "Earnings", price: "Price change", capacity: "Capacity live", financing: "Financing", site: "Site" };

export function TimeSeriesCard<R extends { date: string }>(props: Props<R>) {
  const { title, sub, rows, series, p, globalRange, change = "pct", controls, csvName, note } = props;
  const [range, setRange] = useState<Range>(globalRange);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [view, setView] = useState<"chart" | "table">("chart");
  const [showEvents, setShowEvents] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => setRange(globalRange), [globalRange]);
  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (expanded && !d.open) d.showModal();
    if (!expanded && d.open) d.close();
  }, [expanded]);

  const ranges = availableRanges(rows[0]?.date, rows.at(-1)?.date);
  const effective = ranges.includes(range) ? range : "All";
  const visible = useMemo(() => {
    const clipped = clip(rows, effective);
    if (!props.rebase) return clipped;
    const base = Object.fromEntries(series.map((s) => [s.key, clipped.map((r) => (r as Record<string, unknown>)[s.key]).find((v): v is number => typeof v === "number" && v > 0)]));
    return clipped.map((r) => {
      const out: Record<string, unknown> = { ...r };
      for (const s of series) {
        const v = (r as Record<string, unknown>)[s.key];
        const b = base[s.key];
        out[s.key] = typeof v === "number" && b ? (v / b) * 100 : undefined;
      }
      return out as R;
    });
  }, [rows, effective, props.rebase, series]);
  // Lines use a true time axis so irregular sampling (archive snapshots, trading days) keeps honest
  // spacing; stacked bars need evenly spaced bands, so they stay categorical.
  const timeScale = props.kind !== "stacked";
  const plotted = useMemo(() => (timeScale ? visible.map((r) => ({ ...r, t: toTime(r.date) })) : visible), [visible, timeScale]);
  const axisTicks = useMemo(() => (visible.length > 1 ? timeTicks(toTime(visible[0]!.date), toTime(visible.at(-1)!.date)) : { ticks: [], format: (t: number) => day(new Date(t).toISOString()) }), [visible]);
  const shown = series.filter((s) => !hidden.has(s.key));
  const events = (props.events ?? []).filter((e) => visible.length && e.date >= visible[0]!.date && e.date <= visible.at(-1)!.date);

  const toggle = (key: string) =>
    setHidden((h) => {
      const next = new Set(h);
      if (next.has(key)) next.delete(key);
      else if (next.size < series.length - 1) next.add(key); // keep at least one series visible
      return next;
    });

  const toolbar = (
    <div className="flex flex-wrap items-center gap-2">
      {controls}
      {ranges.length > 1 && <Segmented label={`${title} time range`} value={effective} onChange={setRange} options={ranges.map((r) => ({ value: r, label: r }))} />}
      <Segmented label={`${title} view`} value={view} onChange={setView} options={[{ value: "chart", label: "Chart" }, { value: "table", label: "Table" }]} />
      <IconButton label="Download CSV" onClick={() => downloadCsv(csvName, visible, series)}>
        <path d="M8 2v8m0 0l-3-3m3 3l3-3M3 13h10" />
      </IconButton>
      {!expanded && (
        <IconButton label="Expand chart" onClick={() => setExpanded(true)}>
          <path d="M3 6V3h3M13 6V3h-3M3 10v3h3M13 10v3h-3" />
        </IconButton>
      )}
    </div>
  );

  const body = (big: boolean) => (
    <>
      {props.filters && <div className="mb-3">{props.filters}</div>}
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <LegendButtons series={series} hidden={hidden} onToggle={toggle} rows={visible} change={change} format={props.format} diffFormat={props.diffFormat} kind={props.kind} />
        {props.events && props.events.length > 0 && (
          <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-xs text-ink-2">
            <input type="checkbox" checked={showEvents} onChange={(e) => setShowEvents(e.target.checked)} className="accent-[var(--accent)]" />
            Events{events.length ? ` (${events.length})` : ""}
          </label>
        )}
      </div>
      {view === "chart" ? (
        <div style={{ height: big ? "min(62vh, 640px)" : (props.height ?? 280) }}>
          <ResponsiveContainer>
            <ComposedChart data={plotted} margin={{ ...CHART_MARGIN, top: big ? 18 : 8 }} barCategoryGap="12%">
              <CartesianGrid {...grid(p)} />
              {timeScale ? (
                <XAxis {...axisX(p)} dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} ticks={axisTicks.ticks} tickFormatter={axisTicks.format} interval={0} />
              ) : (
                <XAxis {...axisX(p)} />
              )}
              <YAxis {...axisY(p, props.axisFormat ?? props.format)} domain={props.yDomain ?? [0, "auto"]} ticks={props.yTicks} />
              {props.refY?.map((r) => <ReferenceLine key={r.label} y={r.y} stroke={p.rule} label={{ value: r.label, position: "insideTopRight", fill: p.ink3, fontSize: 11 }} />)}
              {showEvents &&
                events.map((e, i) => (
                  <ReferenceLine
                    key={`${e.date}-${i}`}
                    x={timeScale ? toTime(e.date) : e.date}
                    stroke={p.ink3}
                    strokeOpacity={0.55}
                    label={big ? { value: EVENT_LABEL[e.kind], position: "insideTopLeft", fill: p.ink3, fontSize: 10, offset: 4 } : undefined}
                  />
                ))}
              <Tooltip
                cursor={props.kind === "stacked" ? { fill: p.grid, opacity: 0.5 } : cursor(p)}
                content={(t) => <SeriesTip {...(t as TipProps)} series={shown} format={props.format} footer={props.tooltipFooter} events={showEvents ? events : []} stacked={props.kind === "stacked"} />}
              />
              {shown.map((s) =>
                props.kind === "stacked" ? (
                  <Bar
                    key={s.key}
                    dataKey={s.key}
                    stackId="s"
                    fill={s.color}
                    maxBarSize={24}
                    isAnimationActive={false}
                    shape={(b: unknown) => {
                      const r = b as { x: number; y: number; width: number; height: number; payload: R };
                      if (!(r.height > 0) || !(r.width > 0)) return <g />;
                      return <rect x={r.x} y={r.y} width={r.width} height={r.height} fill={s.color} opacity={props.dimRow?.(r.payload) ? 0.45 : 1} stroke={p.surface} strokeWidth={1} />;
                    }}
                  />
                ) : (
                  <Line
                    key={s.key}
                    dataKey={s.key}
                    name={s.label}
                    type={props.kind === "step" ? "stepAfter" : "monotone"}
                    stroke={s.color}
                    strokeWidth={2}
                    dot={visible.length < 3 ? { r: 4, fill: s.color, stroke: p.surface, strokeWidth: 2 } : false}
                    activeDot={{ r: 4.5, strokeWidth: 2, stroke: p.surface }}
                    connectNulls
                    isAnimationActive={false}
                  />
                ),
              )}
              {big && visible.length > 10 && <Brush dataKey="date" height={26} stroke={p.rule} fill={p.surface} travellerWidth={8} tickFormatter={(d: string) => day(d)} />}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <DataTable
          caption={title}
          maxHeight={big ? 600 : 360}
          rows={[...visible].reverse()}
          columns={[
            { key: "date", label: "Date", render: (r) => day(r.date, true) },
            ...series.map((s) => ({ key: s.key, label: s.label, align: "right" as const, render: (r: R) => fmtCell((r as Record<string, unknown>)[s.key], props.format) })),
          ]}
        />
      )}
      {note && <div className="mt-3 text-xs leading-relaxed text-ink-3">{note}</div>}
      {big && showEvents && events.length > 0 && (
        <ul className="mt-4 grid gap-1 border-t border-line pt-3 text-xs text-ink-2 sm:grid-cols-2">
          {events.map((e, i) => (
            <li key={i} className="flex gap-2">
              <span className="tnum w-20 shrink-0 text-ink-3">{day(e.date, true)}</span>
              <span>
                <span className="font-medium text-ink">{EVENT_LABEL[e.kind]}:</span> {e.label}
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );

  return (
    <>
      <Card>
        <Header title={title} sub={sub} right={toolbar} />
        {body(false)}
      </Card>
      <dialog
        ref={dialog}
        onClose={() => setExpanded(false)}
        onClick={(e) => e.target === dialog.current && setExpanded(false)}
        className="m-auto w-[min(1200px,calc(100vw-2rem))] max-h-[calc(100vh-2rem)] rounded-2xl border border-line bg-surface p-0 text-ink shadow-2xl backdrop:bg-black/50 backdrop:backdrop-blur-sm"
        aria-label={title}
      >
        {expanded && (
          <div className="p-5 sm:p-6">
            <Header
              title={title}
              sub={sub}
              right={
                <div className="flex flex-wrap items-center gap-2">
                  {toolbar}
                  <IconButton label="Close" onClick={() => setExpanded(false)}>
                    <path d="M4 4l8 8M12 4l-8 8" />
                  </IconButton>
                </div>
              }
            />
            {body(true)}
            <p className="mt-3 text-xs text-ink-3">Drag the handles under the chart to zoom. Esc closes.</p>
          </div>
        )}
      </dialog>
    </>
  );
}

function Header({ title, sub, right }: { title: string; sub?: ReactNode; right: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
        {sub && <p className="mt-0.5 text-[13px] leading-snug text-ink-3">{sub}</p>}
      </div>
      {right}
    </div>
  );
}

/** Legend that doubles as the series toggle and shows each series' latest value and change over the visible range. */
function LegendButtons<R extends { date: string }>({ series, hidden, onToggle, rows, change, format, diffFormat, kind }: {
  series: Series[];
  hidden: Set<string>;
  onToggle: (k: string) => void;
  rows: R[];
  change: "pct" | "diff" | "none";
  format: (v: number) => string;
  diffFormat?: (v: number) => string;
  kind?: string;
}) {
  const single = series.length === 1;
  return (
    <ul className="flex flex-wrap gap-x-1 gap-y-1" aria-label="Series">
      {series.map((s) => {
        const vals = rows.map((r) => (r as Record<string, unknown>)[s.key]).filter((v): v is number => typeof v === "number");
        const first = vals[0];
        const last = vals.at(-1);
        const delta = first !== undefined && last !== undefined ? (change === "pct" ? (first ? last / first - 1 : null) : change === "diff" ? last - first : null) : null;
        const off = hidden.has(s.key);
        const content = (
          <>
            <span aria-hidden className={kind === "stacked" ? "h-2.5 w-2.5 rounded-[3px]" : "h-0.5 w-3.5 rounded-full"} style={{ background: off ? "transparent" : s.color, outline: off ? `1px solid ${s.color}` : undefined }} />
            <span className={off ? "text-ink-3 line-through" : "text-ink-2"}>{s.label}</span>
            {!off && last !== undefined && <span className="tnum font-semibold text-ink">{format(last)}</span>}
            {!off && delta !== null && Number.isFinite(delta) && (
              <span className={`tnum ${delta > 0 ? "text-good" : delta < 0 ? "text-bad" : "text-ink-3"}`}>
                {delta > 0 ? "▲" : delta < 0 ? "▼" : ""} {change === "pct" ? pct(Math.abs(delta)) : (diffFormat ?? format)(Math.abs(delta))}
              </span>
            )}
          </>
        );
        return (
          <li key={s.key}>
            {single ? (
              <span className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs">{content}</span>
            ) : (
              <button type="button" aria-pressed={!off} onClick={() => onToggle(s.key)} title={off ? `Show ${s.label}` : `Hide ${s.label}`} className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs hover:bg-surface-2">
                {content}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function SeriesTip<R>({ active, label, payload, series, format, footer, events, stacked }: TipProps & {
  series: Series[];
  format: (v: number) => string;
  footer?: (row: R) => ReactNode;
  events: ChartEvent[];
  stacked: boolean;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload as Record<string, unknown> | undefined;
  if (!row) return null;
  // On a time axis the label is a timestamp; the row always carries its ISO date.
  label = String(row.date ?? label);
  const items = series
    .map((s) => ({ name: s.label, v: row[s.key], color: s.color }))
    .filter((x): x is { name: string; v: number; color: string } => typeof x.v === "number");
  const rows = (stacked ? [...items].reverse() : [...items].sort((a, b) => b.v - a.v)).map((x) => ({ name: x.name, value: format(x.v), color: x.color }));
  const evs = events.filter((e) => e.date === label);
  const extra = footer?.(row as R);
  return (
    <TooltipCard
      title={day(String(label), true)}
      rows={rows}
      footer={
        extra || evs.length ? (
          <div className="flex flex-col gap-0.5">
            {extra}
            {evs.map((e, i) => (
              <span key={i} className="text-ink-2">
                <span className="font-medium text-ink">{EVENT_LABEL[e.kind]}:</span> {e.label}
              </span>
            ))}
          </div>
        ) : undefined
      }
    />
  );
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} className="grid h-7 w-7 place-items-center rounded-lg border border-line bg-surface-2 text-ink-2 hover:text-ink">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {children}
      </svg>
    </button>
  );
}

const fmtCell = (v: unknown, format: (v: number) => string) => (typeof v === "number" ? format(v) : "—");

export const toTime = (date: string) => Date.parse(`${date.slice(0, 10)}T00:00:00Z`);

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Calendar-aligned ticks for a time axis: quarter or month starts for long spans, week starts for
 * medium ones, evenly stepped days for short ones. Labels gain a year when the span crosses one.
 */
export function timeTicks(min: number, max: number): { ticks: number[]; format: (t: number) => string } {
  const spanDays = (max - min) / 864e5;
  const d0 = new Date(min);
  const multiYear = d0.getUTCFullYear() !== new Date(max).getUTCFullYear();
  const ticks: number[] = [];
  if (spanDays > 120) {
    const step = spanDays > 900 ? 6 : spanDays > 400 ? 3 : spanDays > 200 ? 2 : 1;
    const m = new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + 1, 1));
    while (m.getUTCMonth() % step) m.setUTCMonth(m.getUTCMonth() + 1);
    for (; m.getTime() <= max; m.setUTCMonth(m.getUTCMonth() + step)) ticks.push(m.getTime());
    return { ticks, format: (t) => { const x = new Date(t); return multiYear ? `${MON[x.getUTCMonth()]} '${String(x.getUTCFullYear()).slice(2)}` : MON[x.getUTCMonth()]!; } };
  }
  const stepDays = spanDays > 45 ? 14 : spanDays > 20 ? 7 : spanDays > 8 ? 3 : 1;
  const start = new Date(min);
  if (stepDays >= 7) while (start.getUTCDay() !== 1) start.setUTCDate(start.getUTCDate() + 1); // Mondays
  for (let t = start.getTime(); t <= max; t += stepDays * 864e5) ticks.push(t);
  return { ticks, format: (t) => day(new Date(t).toISOString(), false) };
}

function downloadCsv<R extends { date: string }>(name: string, rows: R[], series: Series[]) {
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const lines = [["date", ...series.map((s) => s.label)].map(esc).join(","), ...rows.map((r) => [r.date, ...series.map((s) => String((r as Record<string, unknown>)[s.key] ?? ""))].map(esc).join(","))];
  try {
    const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `${name}.csv` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch {
    // downloads blocked in this context; the table view still shows every value
  }
}
