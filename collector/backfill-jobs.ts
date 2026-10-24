// One-off (safe to re-run): reconstruct hiring history from Internet Archive snapshots of Nebius's
// Greenhouse feed. Each snapshot lists every role open at that moment, so stitching them together gives
// open-role counts back to late 2024, plus roles that have since closed (dated to the first snapshot
// they're missing from, so closure dates are approximate).
//
//   npm run backfill:jobs
import { gunzipSync } from "node:zlib";
import { sleep } from "./lib/http.ts";
import { readJson, sortKeys, writeJson } from "./lib/store.ts";
import { FUNCTIONS, classify, region, type Job, type JobsDay } from "./sources/jobs.ts";

type GhJob = { id: number; title: string; location?: { name?: string }; first_published?: string; updated_at?: string; departments?: { name: string }[] };
const UA = { "user-agent": "nebius-signal backfill (github.com/rnixon92/nebius-signal)" };

async function get(url: string): Promise<Buffer> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(60_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      return buf[0] === 0x1f && buf[1] === 0x8b ? gunzipSync(buf) : buf; // the archive serves the original gzip bytes
    } catch (err) {
      if (attempt === 2) throw err;
      await sleep(3000 * (attempt + 1));
    }
  }
  throw new Error("unreachable");
}

const cdx = JSON.parse(
  (await get("https://web.archive.org/cdx/search/cdx?url=boards-api.greenhouse.io/v1/boards/nebius/jobs*&output=json&fl=timestamp,original&filter=statuscode:200")).toString(),
) as string[][];

// One snapshot per day; prefer the content=true variant because it carries departments.
const perDay = new Map<string, { ts: string; url: string }>();
for (const [ts, url] of cdx.slice(1) as [string, string][]) {
  const date = `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}`;
  const cur = perDay.get(date);
  if (!cur || (url.includes("content=true") && !cur.url.includes("content=true"))) perDay.set(date, { ts, url });
}

const snapshots: { date: string; jobs: GhJob[] }[] = [];
for (const [date, { ts, url }] of [...perDay.entries()].sort(([a], [b]) => a.localeCompare(b))) {
  try {
    const body = JSON.parse((await get(`https://web.archive.org/web/${ts}id_/${url}`)).toString()) as { jobs?: GhJob[] };
    if (body.jobs?.length) snapshots.push({ date, jobs: body.jobs });
    console.log(`  ${date}: ${body.jobs?.length ?? 0} roles`);
  } catch (err) {
    console.log(`  ${date}: skipped (${(err as Error).message})`);
  }
  await sleep(1200); // be polite to the archive
}
if (snapshots.length === 0) throw new Error("no usable snapshots");

const roles = await readJson<Record<string, Job>>("jobs/roles.json", {});
const daily = await readJson<Record<string, JobsDay>>("jobs/daily.json", {});
const firstLive = Object.entries(daily).filter(([, d]) => d.source !== "archive").map(([d]) => d).sort()[0] ?? "9999-12-31";
const open = new Set(Object.entries(roles).filter(([, j]) => !j.closedAt).map(([id]) => id));

// Where each role was seen, and the role details from its latest sighting.
const seen = new Map<string, { dates: string[]; job: GhJob }>();
for (const s of snapshots) {
  for (const j of s.jobs) {
    const id = String(j.id);
    const entry = seen.get(id) ?? { dates: [], job: j };
    entry.dates.push(s.date);
    entry.job = j;
    seen.set(id, entry);
  }
}

let added = 0;
let closed = 0;
for (const [id, { dates, job }] of seen) {
  const first = dates[0]!;
  const last = dates.at(-1)!;
  const existing = roles[id];
  if (existing) {
    if (first < existing.firstSeen) existing.firstSeen = first;
    continue;
  }
  if (open.has(id)) continue;
  // Closed: dated to the first snapshot after its last sighting, or the first live run if none.
  const nextSnap = snapshots.find((s) => s.date > last)?.date;
  const closedAt = nextSnap && nextSnap < firstLive ? nextSnap : firstLive;
  const location = job.location?.name ?? "Unknown";
  const dept = job.departments?.map((d) => d.name).join(" › ") ?? "";
  roles[id] = {
    title: job.title,
    dept,
    function: classify(dept, job.title),
    location,
    region: region(location),
    posted: job.first_published?.slice(0, 10) ?? first,
    firstSeen: first,
    closedAt,
    closedApprox: true,
  };
  added++;
  closed++;
}

// Open-role counts on snapshot days (never overwrite a live collector day).
for (const s of snapshots) {
  if (daily[s.date] && daily[s.date]!.source !== "archive") continue;
  const day: JobsDay = { total: s.jobs.length, byFunction: Object.fromEntries(FUNCTIONS.map((f) => [f, 0])), byRegion: {}, source: "archive" };
  for (const j of s.jobs) {
    const dept = j.departments?.map((d) => d.name).join(" › ") ?? roles[String(j.id)]?.dept ?? "";
    const fn = classify(dept, j.title);
    day.byFunction[fn] = (day.byFunction[fn] ?? 0) + 1;
    const r = region(j.location?.name ?? "");
    day.byRegion[r] = (day.byRegion[r] ?? 0) + 1;
  }
  daily[s.date] = day;
}

await writeJson("jobs/roles.json", sortKeys(roles));
await writeJson("jobs/daily.json", sortKeys(daily));
console.log(`Backfill: ${snapshots.length} snapshots (${snapshots[0]!.date} → ${snapshots.at(-1)!.date}), ${seen.size} distinct roles, ${added} closed roles added (${closed} closures dated approximately).`);
