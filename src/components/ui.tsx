import { useId, useState, type ReactNode } from "react";
import type { Severity } from "../../shared/dashboard.ts";
import { pct } from "../lib/format.ts";

export function Card({ children, className = "", pad = true }: { children: ReactNode; className?: string; pad?: boolean }) {
  return <div className={`rounded-xl border border-line bg-surface ${pad ? "p-4 sm:p-5" : ""} ${className}`}>{children}</div>;
}

export function Section({ id, title, kicker, intro, children }: { id: string; title: string; kicker?: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-20">
      <header className="mb-4 flex flex-col gap-1">
        {kicker && <p className="text-xs font-medium uppercase tracking-[0.08em] text-ink-3">{kicker}</p>}
        <h2 id={`${id}-title`} className="text-xl font-semibold tracking-tight text-ink sm:text-2xl">
          {title}
        </h2>
        {intro && <p className="max-w-3xl text-sm leading-relaxed text-ink-2">{intro}</p>}
      </header>
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  );
}

export function CardTitle({ title, sub, right }: { title: string; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
      <div className="min-w-0">
        <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
        {sub && <p className="mt-0.5 text-[13px] leading-snug text-ink-3">{sub}</p>}
      </div>
      {right}
    </div>
  );
}

/** Stat tile: label · value · optional delta and note. Value uses proportional figures. */
export function Stat({ label, value, delta, deltaGoodWhenUp = true, note, children }: {
  label: string;
  value: ReactNode;
  delta?: number | null;
  deltaGoodWhenUp?: boolean;
  note?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <Card className="flex min-w-0 flex-col gap-1">
      <p className="text-[13px] text-ink-2">{label}</p>
      <div className="flex flex-wrap items-baseline gap-x-2">
        <p className="text-2xl font-semibold tracking-tight text-ink">{value}</p>
        {delta != null && <Delta value={delta} goodWhenUp={deltaGoodWhenUp} />}
      </div>
      {note && <p className="text-xs leading-snug text-ink-3">{note}</p>}
      {children}
    </Card>
  );
}

export function Delta({ value, goodWhenUp = true, digits = 0 }: { value: number; goodWhenUp?: boolean; digits?: number }) {
  const up = value > 0;
  const good = up === goodWhenUp;
  const color = value === 0 ? "text-ink-3" : good ? "text-good" : "text-bad";
  return (
    <span className={`tnum inline-flex items-center gap-0.5 text-[13px] font-medium ${color}`}>
      <span aria-hidden>{value === 0 ? "→" : up ? "↑" : "↓"}</span>
      <span className="sr-only">{up ? "up" : "down"}</span>
      {pct(Math.abs(value), { digits })}
    </span>
  );
}

const SEVERITY: Record<Severity, { label: string; icon: string; cls: string }> = {
  high: { label: "High", icon: "●", cls: "text-bad bg-[color-mix(in_srgb,var(--bad)_12%,transparent)]" },
  medium: { label: "Medium", icon: "▲", cls: "text-warn bg-[color-mix(in_srgb,var(--warn)_14%,transparent)]" },
  info: { label: "Info", icon: "◆", cls: "text-ink-2 bg-surface-2" },
};

export function SeverityBadge({ severity }: { severity: Severity }) {
  const s = SEVERITY[severity];
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${s.cls}`}>
      <span aria-hidden className="text-[9px]">{s.icon}</span>
      {s.label}
    </span>
  );
}

export function Pill({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "accent" }) {
  return (
    <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium ${tone === "accent" ? "bg-accent-wash text-accent" : "bg-surface-2 text-ink-2"}`}>
      {children}
    </span>
  );
}

/** Segmented control (radio-group semantics). */
export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg border border-line bg-surface-2 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${value === o.value ? "bg-surface text-ink shadow-sm" : "text-ink-2 hover:text-ink"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export type Column<R> = { key: string; label: string; render: (r: R) => ReactNode; align?: "left" | "right"; className?: string };

export function DataTable<R>({ rows, columns, caption, maxHeight }: { rows: R[]; columns: Column<R>[]; caption?: string; maxHeight?: number }) {
  return (
    <div className="-mx-1 overflow-x-auto px-1" style={maxHeight ? { maxHeight, overflowY: "auto" } : undefined}>
      <table className="w-full border-collapse text-[13px]">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead className="sticky top-0 bg-surface">
          <tr className="border-b border-line">
            {columns.map((c) => (
              <th key={c.key} scope="col" className={`whitespace-nowrap px-2 py-2 font-medium text-ink-3 ${c.align === "right" ? "text-right" : "text-left"}`}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-line last:border-0 hover:bg-surface-2/60">
              {columns.map((c) => (
                <td key={c.key} className={`px-2 py-2 align-top text-ink ${c.align === "right" ? "tnum text-right whitespace-nowrap" : ""} ${c.className ?? ""}`}>
                  {c.render(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Wraps a chart with a Chart/Table toggle so every value is reachable without hovering. */
export function ChartFrame<R>({ title, sub, controls, chart, rows, columns, legend }: {
  title: string;
  sub?: ReactNode;
  controls?: ReactNode;
  chart: ReactNode;
  rows: R[];
  columns: Column<R>[];
  legend?: ReactNode;
}) {
  const [view, setView] = useState<"chart" | "table">("chart");
  const id = useId();
  return (
    <Card>
      <CardTitle
        title={title}
        sub={sub}
        right={
          <div className="flex flex-wrap items-center gap-2">
            {controls}
            <Segmented label={`${title} view`} value={view} onChange={setView} options={[{ value: "chart", label: "Chart" }, { value: "table", label: "Table" }]} />
          </div>
        }
      />
      {legend && view === "chart" && <div className="mb-2">{legend}</div>}
      <div id={id}>{view === "chart" ? chart : <DataTable rows={[...rows].reverse()} columns={columns} caption={title} maxHeight={360} />}</div>
    </Card>
  );
}

export function Legend({ items }: { items: { label: string; color: string; shape?: "line" | "rect" }[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1.5" aria-label="Legend">
      {items.map((it) => (
        <li key={it.label} className="flex items-center gap-1.5 text-xs text-ink-2">
          {it.shape === "rect" ? (
            <span aria-hidden className="h-2.5 w-2.5 rounded-[3px]" style={{ background: it.color }} />
          ) : (
            <span aria-hidden className="h-0.5 w-3.5 rounded-full" style={{ background: it.color }} />
          )}
          {it.label}
        </li>
      ))}
    </ul>
  );
}

type TooltipRow = { name: string; value: string; color?: string };

/** Tooltip body: values lead, series names follow, line keys instead of boxes. */
export function TooltipCard({ title, rows, footer }: { title: string; rows: TooltipRow[]; footer?: ReactNode }) {
  return (
    <div className="pointer-events-none min-w-40 rounded-lg border border-line bg-surface px-3 py-2 shadow-lg shadow-black/10">
      <p className="mb-1.5 text-xs text-ink-3">{title}</p>
      <ul className="flex flex-col gap-1">
        {rows.map((r) => (
          <li key={r.name} className="flex items-center gap-2 text-xs">
            {r.color && <span aria-hidden className="h-0.5 w-3 shrink-0 rounded-full" style={{ background: r.color }} />}
            <span className="tnum font-semibold text-ink">{r.value}</span>
            <span className="truncate text-ink-2">{r.name}</span>
          </li>
        ))}
      </ul>
      {footer && <div className="mt-1.5 border-t border-line pt-1.5 text-xs text-ink-3">{footer}</div>}
    </div>
  );
}

/** Tiny inline trend line. Decorative; the value it accompanies is always shown as text. */
export function Sparkline({ values, color, width = 96, height = 24 }: { values: number[]; color: string; width?: number; height?: number }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * (width - 4) + 2},${height - 3 - ((v - min) / span) * (height - 6)}`).join(" ");
  const [lx, ly] = pts.split(" ").at(-1)!.split(",");
  return (
    <svg width={width} height={height} aria-hidden className="block overflow-visible">
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lx} cy={ly} r={2.5} fill={color} />
    </svg>
  );
}

/** Horizontal meter for a 0–1 share; the track is a lighter step of the fill's own hue. */
export function Meter({ value, color, label }: { value: number; color: string; label: string }) {
  const v = Math.max(0, Math.min(1, value));
  return (
    <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v * 100)} className="h-1.5 w-full overflow-hidden rounded-full" style={{ background: `color-mix(in srgb, ${color} 18%, transparent)` }}>
      <div className="h-full rounded-full" style={{ width: `${v * 100}%`, background: color }} />
    </div>
  );
}

export function EmptyNote({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border border-dashed border-line px-4 py-6 text-center text-sm text-ink-3">{children}</p>;
}

export function ExtLink({ href, children, className = "" }: { href: string; children: ReactNode; className?: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer noopener" className={`underline decoration-rule underline-offset-2 hover:text-accent hover:decoration-accent ${className}`}>
      {children}
    </a>
  );
}
