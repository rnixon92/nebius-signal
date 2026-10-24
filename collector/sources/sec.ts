// SEC EDGAR filings for Nebius Group N.V. (a foreign private issuer, so results come as 6-Ks), plus
// insider trades (Form 4) and planned insider sales (Form 144). Parsed filings are cached, so each
// one is fetched exactly once.
import { SEC_UA, fetchJson, fetchText, sleep } from "../lib/http.ts";
import { readJson, today, writeJson } from "../lib/store.ts";
import type { Alert, SourceResult } from "../lib/types.ts";

const CIK = "1513845";
const SINCE = "2025-01-01";
const DETAIL_WINDOW_DAYS = 365;

export type InsiderTrade = { date: string; code: string; shares: number; price: number | null; acquired: boolean };
export type Filing = {
  accession: string;
  form: string;
  filed: string;
  url: string;
  title?: string;
  /** Form 4 */
  owner?: string;
  role?: string;
  trades?: InsiderTrade[];
  plan10b5?: boolean;
  /** Form 144 */
  proposedShares?: number;
  proposedValue?: number;
  /** 6-K: sentences about contracted/connected/active power, from every exhibit (shareholder letters). */
  powerMentions?: string[];
};

const POWER_SENTENCE = /\b\d[\d,.]*\s*\+?\s*(MW|GW|megawatts?|gigawatts?)\b/i;
const POWER_CONTEXT = /contracted|connected|active power|capacity|secured|deploy|online|data cent|AI factor/i;

/** Sentences that state an amount of power, so new letters can be reviewed for data/power.json. */
export function extractPowerMentions(html: string): string[] {
  const text = decode(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ");
  const out = new Set<string>();
  for (const s of text.split(/(?<=[.;])\s+(?=[A-Z•○●])/)) {
    // Long runs are usually page headers or chart labels glued together, not statements.
    if (s.length < 30 || s.length > 320 || /^dear shareholders/i.test(s)) continue;
    if (POWER_SENTENCE.test(s) && POWER_CONTEXT.test(s)) out.add(s.trim());
  }
  return [...out].slice(0, 25);
}

type Submissions = {
  filings: { recent: { accessionNumber: string[]; form: string[]; filingDate: string[]; primaryDocument: string[] } };
};

const tag = (xml: string, name: string) => xml.match(new RegExp(`<${name}>\\s*([\\s\\S]*?)\\s*</${name}>`))?.[1]?.trim();
const valueOf = (xml: string, name: string) => {
  const block = tag(xml, name);
  return block === undefined ? undefined : (tag(block, "value") ?? block);
};
const NAMED: Record<string, string> = { amp: "&", nbsp: " ", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", ndash: "–", mdash: "—", quot: '"', apos: "'", lt: "<", gt: ">", cir: "○", bull: "•" };
const decode = (s: string) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => NAMED[n.toLowerCase()] ?? m)
    .replace(/ /g, " ");

const archive = (acc: string) => `https://www.sec.gov/Archives/edgar/data/${CIK}/${acc.replace(/-/g, "")}`;
const get = (url: string) => fetchText(url, { ua: SEC_UA });

async function detail6K(f: Filing): Promise<void> {
  const index = await fetchJson<{ directory: { item: { name: string }[] } }>(`${archive(f.accession)}/index.json`, { ua: SEC_UA });
  const exhibits = index.directory.item.map((i) => i.name).filter((n) => /ex99.*\.htm/i.test(n));
  const exhibit = exhibits.find((n) => /ex99[-_]?1.*\.htm/i.test(n)) ?? exhibits[0];
  if (!exhibit) return;
  const html = await get(`${archive(f.accession)}/${exhibit}`);
  // Power figures usually live in the shareholder letter (exhibit 99.2), not the press release.
  const mentions = new Set(extractPowerMentions(html));
  for (const other of exhibits.filter((n) => n !== exhibit)) {
    await sleep(150);
    for (const m of extractPowerMentions(await get(`${archive(f.accession)}/${other}`))) mentions.add(m);
  }
  if (mentions.size) f.powerMentions = [...mentions].slice(0, 25);
  // Inline tags split headlines mid-sentence, so drop them before breaking on block elements;
  // the first block that names Nebius is reliably the press-release headline.
  const blocks = html.replace(/<\/?(span|font|b|strong|i|em|a|u|sup|sub)\b[^>]*>/gi, "").replace(/<[^>]+>/g, "\n");
  const text = decode(blocks).split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter((l) => l.length > 12 && !/^(exhibit|ex-)\s*99/i.test(l));
  let at = text.findIndex((l) => /nebius/i.test(l) && l.length < 220);
  if (at === -1) at = 0;
  let title = text[at];
  // Headlines wrapped with <br> arrive as fragments; a continuation line starts lowercase.
  while (title && /^[a-z]/.test(text[at + 1] ?? "") && title.length < 200) title += " " + text[++at];
  if (title) f.title = title.slice(0, 220);
  f.url = `${archive(f.accession)}/${exhibit}`;
}

async function detailForm4(f: Filing, doc: string): Promise<void> {
  const xml = await get(`${archive(f.accession)}/${doc.replace(/^xsl[^/]+\//, "")}`);
  f.owner = tag(xml, "rptOwnerName");
  f.role = tag(xml, "officerTitle") ?? (tag(xml, "isDirector") === "1" ? "Director" : tag(xml, "isTenPercentOwner") === "1" ? "10% owner" : undefined);
  f.plan10b5 = /10b5-1/i.test(xml);
  f.trades = [...xml.matchAll(/<nonDerivativeTransaction>([\s\S]*?)<\/nonDerivativeTransaction>/g)].map(([, t]) => ({
    date: valueOf(t!, "transactionDate") ?? f.filed,
    code: tag(t!, "transactionCode") ?? "?",
    shares: Number(valueOf(t!, "transactionShares") ?? 0),
    price: valueOf(t!, "transactionPricePerShare") ? Number(valueOf(t!, "transactionPricePerShare")) : null,
    acquired: valueOf(t!, "transactionAcquiredDisposedCode") === "A",
  }));
}

async function detailForm144(f: Filing, doc: string): Promise<void> {
  const xml = await get(`${archive(f.accession)}/${doc.replace(/^xsl[^/]+\//, "")}`);
  f.owner = tag(xml, "nameOfPersonForWhoseAccountTheSecuritiesAreToBeSold");
  f.role = tag(xml, "relationshipToIssuer");
  f.proposedShares = Number(tag(xml, "noOfUnitsSold") ?? 0);
  f.proposedValue = Number(tag(xml, "aggregateMarketValue") ?? 0);
}

const money = (n: number) => (n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${Math.round(n / 1e3)}K`);

export async function collectSec(): Promise<SourceResult> {
  const date = today();
  const sub = await fetchJson<Submissions>(`https://data.sec.gov/submissions/CIK${CIK.padStart(10, "0")}.json`, { ua: SEC_UA });
  const r = sub.filings.recent;
  const cache = await readJson<Record<string, Filing>>("sec/filings.json", {});
  const bootstrap = Object.keys(cache).length === 0;
  const detailCutoff = new Date(Date.now() - DETAIL_WINDOW_DAYS * 864e5).toISOString().slice(0, 10);
  const alerts: Alert[] = [];
  let fetched = 0;

  for (let i = 0; i < r.form.length; i++) {
    const filed = r.filingDate[i]!;
    if (filed < SINCE) continue;
    const accession = r.accessionNumber[i]!;
    if (cache[accession]) continue;
    const form = r.form[i]!;
    const doc = r.primaryDocument[i]!;
    const f: Filing = { accession, form, filed, url: `${archive(accession)}/${doc.replace(/^xsl[^/]+\//, "")}` };
    if (filed >= detailCutoff) {
      try {
        if (form === "6-K") await detail6K(f);
        else if (form === "4") await detailForm4(f, doc);
        else if (form === "144") await detailForm144(f, doc);
        fetched++;
      } catch {
        // keep the bare filing; details are best-effort
      }
      await sleep(150); // SEC fair-access limit is 10 req/s
    }
    cache[accession] = f;
    if (!bootstrap) alerts.push(...alertFor(f, date));
  }

  // One-time fill: results filings cached before power extraction existed.
  for (const f of Object.values(cache)) {
    if (f.form !== "6-K" || f.powerMentions !== undefined || f.filed < detailCutoff || !/results|quarter/i.test(f.title ?? "")) continue;
    try {
      const index = await fetchJson<{ directory: { item: { name: string }[] } }>(`${archive(f.accession)}/index.json`, { ua: SEC_UA });
      const mentions = new Set<string>();
      for (const n of index.directory.item.map((i) => i.name).filter((n) => /ex99.*\.htm/i.test(n))) {
        await sleep(150);
        for (const m of extractPowerMentions(await get(`${archive(f.accession)}/${n}`))) mentions.add(m);
      }
      f.powerMentions = [...mentions].slice(0, 25);
      fetched++;
    } catch {
      // retry next run
    }
  }

  await writeJson("sec/filings.json", cache);
  return { summary: `${Object.keys(cache).length} filings since ${SINCE} (${fetched} parsed this run)`, alerts };
}

function alertFor(f: Filing, date: string): Alert[] {
  const base = { id: `sec-${f.accession}`, date, source: "sec" as const, url: f.url };
  if (f.form === "6-K" || f.form === "20-F") {
    const out: Alert[] = [{ ...base, severity: "high", title: `New ${f.form}: ${f.title ?? "filing"}` }];
    if (f.powerMentions?.length) {
      out.push({ ...base, id: `sec-power-${f.accession}`, severity: "high", title: `New power figures disclosed (${f.powerMentions.length} statements): update data/power.json`, detail: f.powerMentions.slice(0, 3).join(" · ") });
    }
    return out;
  }
  if (f.form === "4" && f.trades?.length) {
    const sold = f.trades.filter((t) => t.code === "S").reduce((a, t) => a + t.shares * (t.price ?? 0), 0);
    const bought = f.trades.filter((t) => t.code === "P").reduce((a, t) => a + t.shares * (t.price ?? 0), 0);
    if (bought > 0) return [{ ...base, severity: "medium", title: `Insider purchase: ${f.owner} bought ${money(bought)}`, detail: f.plan10b5 ? "Under a 10b5-1 plan" : undefined }];
    if (sold >= 1e6) return [{ ...base, severity: "medium", title: `Insider sale: ${f.owner} sold ${money(sold)}`, detail: f.plan10b5 ? "Under a 10b5-1 plan" : undefined }];
    return [];
  }
  if (f.form === "144" && (f.proposedValue ?? 0) >= 1e6) {
    return [{ ...base, severity: "info", title: `Planned insider sale (Form 144): ${f.owner}, ${money(f.proposedValue!)}` }];
  }
  if (/^SC 13|^SCHEDULE 13/.test(f.form)) return [{ ...base, severity: "info", title: `Ownership filing: ${f.form}` }];
  return [];
}
