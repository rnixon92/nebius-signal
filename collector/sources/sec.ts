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
};

type Submissions = {
  filings: { recent: { accessionNumber: string[]; form: string[]; filingDate: string[]; primaryDocument: string[] } };
};

const tag = (xml: string, name: string) => xml.match(new RegExp(`<${name}>\\s*([\\s\\S]*?)\\s*</${name}>`))?.[1]?.trim();
const valueOf = (xml: string, name: string) => {
  const block = tag(xml, name);
  return block === undefined ? undefined : (tag(block, "value") ?? block);
};
const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&#8217;|&rsquo;/g, "’").replace(/&nbsp;|&#160;/g, " ").replace(/&[a-z#0-9]+;/gi, "");

const archive = (acc: string) => `https://www.sec.gov/Archives/edgar/data/${CIK}/${acc.replace(/-/g, "")}`;
const get = (url: string) => fetchText(url, { ua: SEC_UA });

async function detail6K(f: Filing): Promise<void> {
  const index = await fetchJson<{ directory: { item: { name: string }[] } }>(`${archive(f.accession)}/index.json`, { ua: SEC_UA });
  const exhibit = index.directory.item.map((i) => i.name).find((n) => /ex99[-_]?1.*\.htm/i.test(n)) ?? index.directory.item.map((i) => i.name).find((n) => /ex99.*\.htm/i.test(n));
  if (!exhibit) return;
  const html = await get(`${archive(f.accession)}/${exhibit}`);
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

  await writeJson("sec/filings.json", cache);
  return { summary: `${Object.keys(cache).length} filings since ${SINCE} (${fetched} parsed this run)`, alerts };
}

function alertFor(f: Filing, date: string): Alert[] {
  const base = { id: `sec-${f.accession}`, date, source: "sec" as const, url: f.url };
  if (f.form === "6-K" || f.form === "20-F") return [{ ...base, severity: "high", title: `New ${f.form}: ${f.title ?? "filing"}` }];
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
