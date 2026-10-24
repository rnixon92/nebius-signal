import type { ReactNode } from "react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, YAxis } from "recharts";
import { day } from "../lib/format.ts";
import type { Palette } from "../lib/theme.ts";
import { Delta } from "./ui.tsx";

/**
 * Landing-page tile: one headline number, its change, a one-line read, and a mini trend.
 * The whole tile links to the detail page; the mini chart has a hover readout but no axes.
 */
export function SummaryCard({ label, value, delta, deltaLabel, note, trend, trendFormat, color, p, to, toLabel }: {
  label: string;
  value: ReactNode;
  delta?: number | null;
  deltaLabel?: string;
  note?: ReactNode;
  trend?: { date: string; v: number }[];
  trendFormat?: (v: number) => string;
  color?: string;
  p: Palette;
  to: string;
  toLabel: string;
}) {
  const c = color ?? p.accent;
  return (
    <a href={to} className="group flex min-w-0 flex-col gap-1 rounded-2xl border border-line bg-surface p-4 shadow-card transition-colors hover:border-[color-mix(in_srgb,var(--accent)_45%,transparent)] sm:p-5">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[13px] text-ink-2">{label}</p>
        <span className="shrink-0 whitespace-nowrap pt-0.5 text-xs text-ink-3 transition-colors group-hover:text-accent" aria-hidden>
          {toLabel} →
        </span>
      </div>
      <div className="flex flex-wrap items-baseline gap-x-2">
        <p className="text-2xl font-semibold tracking-tight text-ink">{value}</p>
        {delta != null && (
          <span className="flex items-baseline gap-1">
            <Delta value={delta} />
            {deltaLabel && <span className="text-xs text-ink-3">{deltaLabel}</span>}
          </span>
        )}
      </div>
      {note && <p className="text-xs leading-snug text-ink-3">{note}</p>}
      {trend && trend.length > 1 && (
        <div className="mt-2 h-14" onClick={(e) => e.preventDefault()}>
          <ResponsiveContainer>
            <AreaChart data={trend} margin={{ top: 4, right: 2, bottom: 2, left: 2 }}>
              <defs>
                <linearGradient id={`g-${label.replace(/\W/g, "")}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={c} stopOpacity={0.18} />
                  <stop offset="100%" stopColor={c} stopOpacity={0} />
                </linearGradient>
              </defs>
              <YAxis hide domain={["auto", "auto"]} />
              <Tooltip
                cursor={{ stroke: p.rule, strokeWidth: 1 }}
                content={({ active, payload }) => {
                  const row = payload?.[0]?.payload as { date: string; v: number } | undefined;
                  if (!active || !row) return null;
                  return (
                    <div className="rounded-md border border-line bg-surface px-2 py-1 text-xs shadow-md">
                      <span className="tnum font-semibold text-ink">{trendFormat ? trendFormat(row.v) : row.v}</span> <span className="text-ink-3">{day(row.date, true)}</span>
                    </div>
                  );
                }}
              />
              <Area dataKey="v" type="monotone" stroke={c} strokeWidth={1.75} fill={`url(#g-${label.replace(/\W/g, "")})`} dot={false} activeDot={{ r: 3, stroke: p.surface, strokeWidth: 1.5 }} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </a>
  );
}
