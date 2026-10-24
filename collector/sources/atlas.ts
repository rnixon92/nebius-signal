// Customer list from Nebius Atlas (nebiusatlas.com), a community tracker of companies with public
// evidence of using Nebius. Note: "firstListedAt" is when Atlas found the customer, not when Nebius
// signed them, so growth here partly reflects the researcher's pace.
import { fetchText } from "../lib/http.ts";
import { objectsStartingWith, rscPayload } from "../lib/nextjs.ts";
import { readJson, sortKeys, today, writeJson } from "../lib/store.ts";
import type { Alert, SourceResult } from "../lib/types.ts";

type AtlasRaw = {
  slug: string;
  name: string;
  category?: string;
  cardUse?: string;
  disclosedServices?: string[];
  observedWorkloads?: string[];
  evidenceType?: string;
  firstListedAt?: string;
  firstListedKind?: string;
  latestEvidenceDate?: string;
};

export type Customer = {
  name: string;
  category: string;
  use: string;
  services: string[];
  workloads: string[];
  evidence: string;
  firstListedAt: string;
  baseline: boolean;
  latestEvidence: string | null;
  removedAt?: string;
};

export async function collectAtlas(): Promise<SourceResult> {
  const date = today();
  const payload = rscPayload(await fetchText("https://nebiusatlas.com/"));
  const raw = objectsStartingWith<AtlasRaw>(payload, '{"firstListedAt"').filter((c) => c.slug && c.name);

  const prev = await readJson<Record<string, Customer>>("atlas/customers.json", {});
  const prevActive = Object.entries(prev).filter(([, c]) => !c.removedAt);
  // A layout change that breaks parsing must not wipe the history.
  if (raw.length < Math.max(20, prevActive.length * 0.5)) throw new Error(`parsed ${raw.length} customers, expected ~${prevActive.length}`);

  const next: Record<string, Customer> = {};
  for (const c of raw) {
    next[c.slug] = {
      name: c.name,
      category: c.category ?? "Other",
      use: c.cardUse ?? "",
      services: c.disclosedServices ?? [],
      workloads: c.observedWorkloads ?? [],
      evidence: c.evidenceType ?? "",
      firstListedAt: c.firstListedAt ?? date,
      baseline: c.firstListedKind === "baseline",
      latestEvidence: c.latestEvidenceDate ?? null,
    };
  }
  for (const [slug, c] of Object.entries(prev)) {
    if (!next[slug]) next[slug] = { ...c, removedAt: c.removedAt ?? date };
  }

  const alerts: Alert[] = [];
  const added = raw.filter((c) => !prev[c.slug]);
  if (prevActive.length > 0 && added.length > 0) {
    const tf = added.filter((c) => c.disclosedServices?.includes("Nebius Token Factory"));
    alerts.push({
      id: `atlas-added-${date}`,
      date,
      source: "atlas",
      severity: "info",
      title: `${added.length} new customer${added.length > 1 ? "s" : ""} on Nebius Atlas${tf.length ? ` (${tf.length} using Token Factory)` : ""}`,
      detail: added.slice(0, 12).map((c) => c.name).join(", ") + (added.length > 12 ? ", …" : ""),
      url: "https://nebiusatlas.com/",
    });
  }

  await writeJson("atlas/customers.json", sortKeys(next));
  const daily = await readJson<Record<string, { total: number; tokenFactory: number; aiCloud: number }>>("atlas/daily.json", {});
  daily[date] = {
    total: raw.length,
    tokenFactory: raw.filter((c) => c.disclosedServices?.includes("Nebius Token Factory")).length,
    aiCloud: raw.filter((c) => c.disclosedServices?.includes("Nebius AI Cloud")).length,
  };
  await writeJson("atlas/daily.json", sortKeys(daily));
  return { summary: `${raw.length} customers (${added.length} new since last run)`, alerts };
}
