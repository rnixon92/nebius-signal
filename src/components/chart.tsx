import type { Palette } from "../lib/theme.ts";
import { day } from "../lib/format.ts";

/** The subset of Recharts' tooltip props our tooltip bodies use. */
export type TipProps = {
  active?: boolean;
  label?: string | number;
  payload?: readonly { dataKey?: unknown; value?: unknown; color?: string; name?: unknown; payload?: Record<string, unknown> }[];
};

export const CHART_MARGIN = { top: 8, right: 12, bottom: 0, left: 0 };

/** Recessive axes: muted ink, hairline baseline, no tick marks. */
export function axisX(p: Palette, extra: Record<string, unknown> = {}) {
  return {
    dataKey: "date",
    tickFormatter: (d: string) => day(d),
    tick: { fill: p.ink3, fontSize: 11 },
    tickLine: false,
    axisLine: { stroke: p.rule },
    minTickGap: 28,
    tickMargin: 6,
    ...extra,
  };
}

export function axisY(p: Palette, format: (v: number) => string, extra: Record<string, unknown> = {}) {
  return {
    tickFormatter: format,
    tick: { fill: p.ink3, fontSize: 11 },
    tickLine: false,
    axisLine: false,
    width: 48,
    ...extra,
  };
}

export const grid = (p: Palette) => ({ stroke: p.grid, vertical: false });

/** Crosshair: a single hairline that snaps to the nearest date. */
export const cursor = (p: Palette) => ({ stroke: p.rule, strokeWidth: 1 });
