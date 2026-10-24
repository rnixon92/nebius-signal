// Nebius's own record of where capacity is live: the regions page in its docs lists every region and
// which GPU platforms run there. A new region, or a new GPU platform in a region, means hardware went
// live, which is the closest public proxy for capacity starting to bill.
import { fetchText } from "../lib/http.ts";
import { readJson, today, writeJson } from "../lib/store.ts";
import type { Alert, SourceResult } from "../lib/types.ts";
import { gpuFamily } from "./gpu.ts";

const URL = "https://docs.nebius.com/overview/regions.md";

export type RegionsFile = {
  lastChecked: string;
  regions: Record<string, { location: string; public: boolean; firstSeen: string }>;
  /** GPU family → region codes where it is offered. */
  platforms: Record<string, string[]>;
  changes: { date: string; kind: "region-added" | "region-removed" | "region-public" | "platform-added" | "platform-removed"; region: string; platform?: string }[];
};

export function parseRegions(md: string): { regions: Record<string, { location: string; public: boolean }>; platforms: Record<string, string[]> } {
  const clean = md.replace(/&#x20;/g, " ");
  const regions: Record<string, { location: string; public: boolean }> = {};
  const privStart = clean.search(/^## Private regions/m);
  for (const m of clean.matchAll(/^\* `([a-z]+-[a-z]+\d)`: (.+)$/gm)) {
    regions[m[1]!] = { location: m[2]!.trim(), public: privStart === -1 || m.index! < privStart };
  }

  // The platform table: header row of region codes, then one ✓/— row per platform.
  const platforms: Record<string, string[]> = {};
  const table = clean.slice(clean.search(/^## Availability of platforms/m));
  const rows = table.split("\n").filter((l) => l.startsWith("|"));
  const header = rows[0]?.split("|").map((c) => c.trim().replace(/`/g, "")) ?? [];
  for (const row of rows.slice(2)) {
    const cells = row.split("|").map((c) => c.trim());
    const family = gpuFamily(cells[1] ?? "");
    if (!family) continue;
    const where = header.map((code, i) => (cells[i] === "✓" ? code : null)).filter((c): c is string => !!c && /^[a-z]+-[a-z]+\d$/.test(c));
    platforms[family] = [...new Set([...(platforms[family] ?? []), ...where])].sort();
  }
  return { regions, platforms };
}

export async function collectRegions(): Promise<SourceResult> {
  const date = today();
  const { regions, platforms } = parseRegions(await fetchText(URL));
  if (Object.keys(regions).length < 5 || Object.keys(platforms).length < 3) throw new Error(`parsed ${Object.keys(regions).length} regions, ${Object.keys(platforms).length} GPU platforms`);

  const prev = await readJson<RegionsFile>("capacity/regions.json", { lastChecked: "", regions: {}, platforms: {}, changes: [] });
  const bootstrap = !prev.lastChecked;
  const changes: RegionsFile["changes"] = [];
  if (!bootstrap) {
    for (const [code, r] of Object.entries(regions)) {
      const before = prev.regions[code];
      if (!before) changes.push({ date, kind: "region-added", region: code });
      else if (!before.public && r.public) changes.push({ date, kind: "region-public", region: code });
    }
    for (const code of Object.keys(prev.regions)) if (!regions[code]) changes.push({ date, kind: "region-removed", region: code });
    for (const fam of new Set([...Object.keys(platforms), ...Object.keys(prev.platforms)])) {
      const now = new Set(platforms[fam] ?? []);
      const then = new Set(prev.platforms[fam] ?? []);
      for (const r of now) if (!then.has(r)) changes.push({ date, kind: "platform-added", region: r, platform: fam });
      for (const r of then) if (!now.has(r)) changes.push({ date, kind: "platform-removed", region: r, platform: fam });
    }
  }

  const merged: RegionsFile = {
    lastChecked: date,
    regions: Object.fromEntries(Object.entries(regions).map(([c, r]) => [c, { ...r, firstSeen: prev.regions[c]?.firstSeen ?? date }])),
    platforms,
    changes: [...prev.changes, ...changes],
  };
  await writeJson("capacity/regions.json", merged);

  const label = (c: string) => `${c} (${regions[c]?.location ?? prev.regions[c]?.location ?? "?"})`;
  const alerts: Alert[] = changes.map((c) => ({
    id: `regions-${c.kind}-${c.region}-${c.platform ?? ""}-${date}`,
    date,
    source: "regions" as const,
    severity: c.kind === "region-added" || c.kind === "platform-added" || c.kind === "region-public" ? "high" : "medium",
    title:
      c.kind === "region-added" ? `New Nebius region live: ${label(c.region)}`
      : c.kind === "region-public" ? `Region opened to all customers: ${label(c.region)}`
      : c.kind === "region-removed" ? `Region no longer listed: ${label(c.region)}`
      : c.kind === "platform-added" ? `${c.platform} now offered in ${label(c.region)}`
      : `${c.platform} no longer offered in ${label(c.region)}`,
    detail: c.kind === "platform-added" || c.kind === "region-added" ? "New capacity going live, per Nebius's regions documentation." : undefined,
    url: "https://docs.nebius.com/overview/regions",
  }));
  return { summary: `${Object.keys(regions).length} regions, ${Object.keys(platforms).length} GPU platforms${changes.length ? `, ${changes.length} changes` : ""}`, alerts };
}
