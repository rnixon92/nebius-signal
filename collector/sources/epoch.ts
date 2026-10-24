// Satellite-observed power at Nebius data centers, from Epoch AI's Frontier Data Centers hub (CC BY).
// Epoch estimates IT power from imagery of cooling equipment and buildings, so it is an independent
// read on how much capacity is actually running, between Nebius's quarterly disclosures.
import { parseCsv } from "../lib/csv.ts";
import { fetchText } from "../lib/http.ts";
import { readJson, today, writeJson } from "../lib/store.ts";
import type { Alert, SourceResult } from "../lib/types.ts";

const BASE = "https://epoch.ai/data/data_centers";

export type EpochPoint = { date: string; itMw: number; buildings: number | null; status?: string; projected: boolean };
export type EpochSite = { name: string; owner: string; users: string; chips: string; country: string; address: string; currentMw: number | null; timeline: EpochPoint[] };
export type EpochFile = { updatedAt: string; sites: Record<string, EpochSite> };

const num = (s: string | undefined) => (s && s.trim() !== "" && Number.isFinite(Number(s)) ? Number(s) : null);
/** Epoch annotates fields with confidence tags like "Nebius #confident". */
const clean = (s: string | undefined) => (s ?? "").replace(/\s*#\w+/g, "").trim();

export async function collectEpoch(): Promise<SourceResult> {
  const date = today();
  const centers = parseCsv(await fetchText(`${BASE}/data_centers.csv`));
  const timelines = parseCsv(await fetchText(`${BASE}/data_center_timelines.csv`));
  if (centers.length < 50) throw new Error(`only ${centers.length} data centers parsed`);

  const nebius = centers.filter((c) => /nebius/i.test(`${c["Name"]} ${c["Owner"]} ${c["Users"]}`));
  const prev = await readJson<EpochFile>("capacity/epoch.json", { updatedAt: "", sites: {} });
  const sites: Record<string, EpochSite> = {};
  for (const c of nebius) {
    const name = c["Name"]!;
    const timeline = timelines
      .filter((t) => t["Data center"] === name && t["Date"])
      .map((t) => ({ date: t["Date"]!.slice(0, 10), itMw: num(t["IT power (MW)"]) ?? 0, buildings: num(t["Buildings operational"]), status: t["Construction status"] || undefined, projected: t["Date"]!.slice(0, 10) > date }))
      .sort((a, b) => a.date.localeCompare(b.date));
    sites[name] = { name, owner: clean(c["Owner"]), users: clean(c["Users"]), chips: c["Current chip types"] ?? "", country: c["Country"] ?? "", address: c["Address"] ?? "", currentMw: num(c["Current power (MW)"]), timeline };
  }
  await writeJson("capacity/epoch.json", { updatedAt: date, sites });

  // Alert on a newly observed (not projected) step up in IT power, or a new Nebius site in the hub.
  const alerts: Alert[] = [];
  const observed = (s: EpochSite | undefined) => s?.timeline.filter((p) => !p.projected).at(-1);
  for (const [name, s] of Object.entries(sites)) {
    const now = observed(s);
    const before = observed(prev.sites[name]);
    if (!prev.updatedAt) continue;
    if (!prev.sites[name]) {
      alerts.push({ id: `epoch-new-${name}`, date, source: "epoch", severity: "medium", title: `Epoch AI now tracks a Nebius site: ${name}`, detail: now ? `${now.itMw} MW IT power observed (${now.date})` : undefined, url: "https://epoch.ai/data/data-centers" });
    } else if (now && before && now.itMw > before.itMw) {
      alerts.push({ id: `epoch-up-${name}-${now.date}`, date, source: "epoch", severity: "high", title: `Satellite data shows more power live at ${name}: ${before.itMw} → ${now.itMw} MW`, detail: `Observed ${now.date} by Epoch AI${now.status ? ` · ${now.status}` : ""}`, url: "https://epoch.ai/data/data-centers" });
    }
  }
  const total = Object.values(sites).reduce((a, s) => a + (observed(s)?.itMw ?? 0), 0);
  return { summary: `${Object.keys(sites).length} Nebius sites, ${total} MW IT power observed`, alerts };
}
