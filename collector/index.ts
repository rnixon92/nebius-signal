// Daily collector: runs every source independently (one failure never blocks the rest), records
// per-source health, appends de-duplicated alerts, then rebuilds the dashboard dataset.
import { collectAtlas } from "./sources/atlas.ts";
import { collectOnDemand, collectSpot } from "./sources/gpu.ts";
import { collectJobs } from "./sources/jobs.ts";
import { collectOpenRouter } from "./sources/openrouter.ts";
import { collectOpenRouterMarket } from "./sources/openrouter-market.ts";
import { collectSec } from "./sources/sec.ts";
import { collectStock } from "./sources/stock.ts";
import { buildDashboard } from "./build-dashboard.ts";
import { readJson, writeJson } from "./lib/store.ts";
import type { Alert, RunStatus, SourceId, SourceResult } from "./lib/types.ts";

// Order matters: on-demand prices feed the spot near-cap check.
const SOURCES: [SourceId, () => Promise<SourceResult>][] = [
  ["gpu-ondemand", collectOnDemand],
  ["gpu-spot", collectSpot],
  ["openrouter", collectOpenRouter],
  ["openrouter-market", collectOpenRouterMarket],
  ["atlas", collectAtlas],
  ["sec", collectSec],
  ["jobs", collectJobs],
  ["stock", collectStock],
];

const only = process.argv.slice(2);
const runs = await readJson<Record<string, RunStatus>>("meta/runs.json", {});
const newAlerts: Alert[] = [];
let failed = 0;

for (const [id, collect] of SOURCES) {
  if (only.length && !only.includes(id)) continue;
  const started = Date.now();
  const prev = runs[id];
  try {
    const { summary, alerts } = await collect();
    runs[id] = { ok: true, lastAttempt: new Date().toISOString(), lastSuccess: new Date().toISOString(), summary };
    newAlerts.push(...alerts);
    console.log(`✓ ${id.padEnd(18)} ${summary}  (${((Date.now() - started) / 1000).toFixed(1)}s)`);
  } catch (err) {
    failed++;
    const message = err instanceof Error ? err.message : String(err);
    runs[id] = { ok: false, lastAttempt: new Date().toISOString(), lastSuccess: prev?.lastSuccess ?? null, summary: prev?.summary, error: message };
    console.error(`✗ ${id.padEnd(18)} ${message}`);
  }
}
await writeJson("meta/runs.json", runs);

const existing = await readJson<Alert[]>("alerts.json", []);
const known = new Set(existing.map((a) => a.id));
const fresh = newAlerts.filter((a) => !known.has(a.id));
await writeJson("alerts.json", [...fresh, ...existing].slice(0, 1000));
for (const a of fresh) console.log(`  ! [${a.severity}] ${a.title}`);

await notify(fresh.filter((a) => a.severity !== "info"));
await buildDashboard();
console.log(`Done: ${SOURCES.length - failed} ok, ${failed} failed, ${fresh.length} new alerts.`);
if (failed === SOURCES.length) process.exit(1);

/** Optional push via ntfy.sh. Only runs when NTFY_TOPIC is set (e.g. as a GitHub Actions secret). */
async function notify(alerts: Alert[]) {
  const topic = process.env.NTFY_TOPIC;
  if (!topic || alerts.length === 0) return;
  const body = alerts.map((a) => `• ${a.title}${a.detail ? ` (${a.detail})` : ""}`).join("\n");
  try {
    await fetch(`https://ntfy.sh/${encodeURIComponent(topic)}`, {
      method: "POST",
      headers: { Title: `Nebius Signal: ${alerts.length} new alert${alerts.length > 1 ? "s" : ""}`, Priority: alerts.some((a) => a.severity === "high") ? "high" : "default" },
      body,
    });
  } catch (err) {
    console.error("ntfy push failed:", (err as Error).message);
  }
}
