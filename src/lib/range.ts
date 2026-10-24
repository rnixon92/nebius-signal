export type Range = "1M" | "3M" | "6M" | "YTD" | "1Y" | "All";

export const RANGES: Range[] = ["1M", "3M", "6M", "YTD", "1Y", "All"];

const DAYS: Partial<Record<Range, number>> = { "1M": 30, "3M": 91, "6M": 182, "1Y": 365 };

/** First date (exclusive for day-count ranges) shown for `range`, measured back from `last`. */
export function rangeStart(range: Range, last: string): string | null {
  if (range === "All") return null;
  if (range === "YTD") return `${last.slice(0, 4)}-01-01`;
  const d = new Date(last + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - DAYS[range]!);
  return d.toISOString().slice(0, 10);
}

/** Keep rows whose `date` falls inside the range, measured back from the latest row. */
export function clip<T extends { date: string }>(rows: T[], range: Range): T[] {
  if (rows.length === 0) return rows;
  const from = rangeStart(range, rows.at(-1)!.date);
  return from ? rows.filter((r) => r.date >= from) : rows;
}

/** Ranges worth offering for a series spanning `first`…`last`: drop any that would show the same as All. */
export function availableRanges(first: string | undefined, last: string | undefined): Range[] {
  if (!first || !last) return ["All"];
  return RANGES.filter((r) => {
    const from = rangeStart(r, last);
    return from === null || from > first;
  });
}

export function readStoredRange(): Range {
  try {
    const v = localStorage.getItem("range") as Range | null;
    return v && RANGES.includes(v) ? v : "3M";
  } catch {
    return "3M";
  }
}
