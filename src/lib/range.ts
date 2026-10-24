export type Range = "30d" | "90d" | "all";

export const RANGE_OPTIONS: { value: Range; label: string }[] = [
  { value: "30d", label: "30 days" },
  { value: "90d", label: "90 days" },
  { value: "all", label: "All" },
];

/** Keep rows whose `date` falls inside the range, measured back from the latest row. */
export function clip<T extends { date: string }>(rows: T[], range: Range): T[] {
  if (range === "all" || rows.length === 0) return rows;
  const last = rows.at(-1)!.date;
  const d = new Date(last + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - (range === "30d" ? 30 : 90));
  const from = d.toISOString().slice(0, 10);
  return rows.filter((r) => r.date > from);
}
