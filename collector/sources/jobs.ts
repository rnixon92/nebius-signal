// Open roles from Nebius's Greenhouse job board. Hiring by function and region is a slow but honest
// read on where the company is building, especially data-center and sales roles in new locations.
import { fetchJson } from "../lib/http.ts";
import { readJson, sortKeys, today, writeJson } from "../lib/store.ts";
import type { Alert, SourceResult } from "../lib/types.ts";

type GhJob = { id: number; title: string; location?: { name?: string }; absolute_url: string };
type GhDept = { id: number; name: string; parent_id: number | null; jobs: GhJob[] };

/** `posted` is Greenhouse's first_published date; `firstSeen` is when this collector first saw the role. */
export type Job = { title: string; dept: string; function: string; location: string; region: string; posted: string; firstSeen: string; closedAt?: string };
export type JobsDay = { total: number; byFunction: Record<string, number>; byRegion: Record<string, number> };

export const FUNCTIONS = ["Data center & power", "Sales & go-to-market", "Engineering & product", "G&A & other"] as const;

function classify(chain: string, title: string): (typeof FUNCTIONS)[number] {
  const t = `${chain} ${title}`;
  if (/data ?cent|\bDC\b|construction|facilit|electrical|mechanical|\bpower\b|energy|site (lead|manager|selection)|real estate|commissioning/i.test(t)) return "Data center & power";
  if (/sales|account (exec|manag)|solutions? (architect|engineer)|partner|channel|alliances|marketing|\bBDR\b|\bSDR\b|business development|customer success|go[- ]to[- ]market|\bGTM\b|\b(AMER|EMEA|APAC)\b/i.test(t)) return "Sales & go-to-market";
  if (/engineer|developer|backend|frontend|software|platform|\bML\b|\bAI\b|research|product|data|security|infra|\bSRE\b|devops|architect|scientist/i.test(t)) return "Engineering & product";
  return "G&A & other";
}

function region(location: string): string {
  if (/united states|\bUSA?\b|new york|san francisco|california|texas|kansas|missouri|new jersey|seattle|chicago|boston|canada|toronto|vancouver|americas|mexico|brazil/i.test(location)) return "Americas";
  if (/israel|tel aviv/i.test(location)) return "Israel";
  if (/singapore|japan|tokyo|india|asia|korea|seoul|australia|sydney|apac|taiwan|hong kong/i.test(location)) return "Asia-Pacific";
  if (/remote$|anywhere|worldwide/i.test(location)) return "Remote";
  return "Europe & other";
}

export async function collectJobs(): Promise<SourceResult> {
  const date = today();
  const { departments } = await fetchJson<{ departments: GhDept[] }>("https://boards-api.greenhouse.io/v1/boards/nebius/departments");
  // The departments view lacks posting dates; the flat jobs list has them.
  const { jobs } = await fetchJson<{ jobs: { id: number; first_published?: string }[] }>("https://boards-api.greenhouse.io/v1/boards/nebius/jobs");
  const postedOf = new Map(jobs.map((j) => [String(j.id), j.first_published?.slice(0, 10)]));
  const byId = new Map(departments.map((d) => [d.id, d]));
  const chainOf = (d: GhDept) => {
    const names: string[] = [];
    for (let cur: GhDept | undefined = d; cur; cur = cur.parent_id ? byId.get(cur.parent_id) : undefined) names.unshift(cur.name);
    return names.join(" › ");
  };

  const open = new Map<string, Omit<Job, "firstSeen">>();
  for (const d of departments) {
    const chain = chainOf(d);
    for (const j of d.jobs) {
      const location = j.location?.name ?? "Unknown";
      const posted = postedOf.get(String(j.id)) ?? date;
      open.set(String(j.id), { title: j.title, dept: chain, function: classify(chain, j.title), location, region: region(location), posted });
    }
  }
  if (open.size < 20) throw new Error(`only ${open.size} open roles parsed`);

  const prev = await readJson<Record<string, Job>>("jobs/roles.json", {});
  const bootstrap = Object.keys(prev).length === 0;
  const roles: Record<string, Job> = {};
  for (const [id, j] of open) roles[id] = { ...j, firstSeen: prev[id]?.firstSeen ?? date };
  // Keep closed roles for 120 days so time-to-fill and churn stay computable.
  const keepClosedAfter = new Date(Date.now() - 120 * 864e5).toISOString().slice(0, 10);
  for (const [id, j] of Object.entries(prev)) {
    if (open.has(id)) continue;
    const closedAt = j.closedAt ?? date;
    if (closedAt >= keepClosedAfter) roles[id] = { ...j, closedAt };
  }
  await writeJson("jobs/roles.json", sortKeys(roles));

  const day: JobsDay = { total: open.size, byFunction: {}, byRegion: {} };
  for (const j of open.values()) {
    day.byFunction[j.function] = (day.byFunction[j.function] ?? 0) + 1;
    day.byRegion[j.region] = (day.byRegion[j.region] ?? 0) + 1;
  }
  const daily = await readJson<Record<string, JobsDay>>("jobs/daily.json", {});
  daily[date] = day;
  await writeJson("jobs/daily.json", sortKeys(daily));

  const alerts: Alert[] = [];
  if (!bootstrap) {
    // New hiring locations for data-center work usually precede a site announcement.
    const knownDcLocations = new Set(Object.values(prev).filter((j) => j.function === "Data center & power").map((j) => j.location));
    const newDc = [...open.entries()].filter(([id, j]) => !prev[id] && j.function === "Data center & power" && !knownDcLocations.has(j.location));
    for (const [id, j] of newDc) {
      alerts.push({ id: `jobs-dcloc-${id}`, date, source: "jobs", severity: "medium", title: `Data-center hiring in a new location: ${j.location}`, detail: `${j.title} (posted ${j.posted})`, url: `https://careers.nebius.com/job?gh_jid=${id}` });
    }
    const weekAgo = Object.keys(daily).filter((d) => d <= new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10)).at(-1);
    const then = weekAgo ? daily[weekAgo]!.total : null;
    if (then && Math.abs(open.size / then - 1) >= 0.1) {
      const up = open.size > then;
      alerts.push({ id: `jobs-wow-${date}`, date, source: "jobs", severity: "info", title: `Open roles ${up ? "up" : "down"} ${Math.round(Math.abs(open.size / then - 1) * 100)}% in a week`, detail: `${then} → ${open.size}` });
    }
  }
  const newToday = [...open.keys()].filter((id) => !prev[id] && !bootstrap).length;
  return { summary: `${open.size} open roles (${bootstrap ? "first run" : `${newToday} new`})`, alerts };
}
