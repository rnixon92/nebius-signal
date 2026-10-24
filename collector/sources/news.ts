// Headlines about Nebius data centers from Google News RSS, matched to sites in data/sites.json and
// tagged as risk (lawsuits, halts, delays) or progress (power delivered, online, operational).
// Local news is often the first place site problems or milestones show up.
import { fetchText } from "../lib/http.ts";
import { readJson, today, writeJson } from "../lib/store.ts";
import type { Alert, SourceResult } from "../lib/types.ts";

const QUERIES = ['Nebius "data center"', 'Nebius "data centre"', "Nebius AI factory", "Nebius campus"];
const KEEP_DAYS = 400;

export type Site = {
  id: string;
  /** Matching data-center name in Epoch AI's satellite dataset, when Epoch tracks the site. */
  epoch?: string;
  name: string;
  country: string;
  model: string;
  mw: number | null;
  mwNote?: string;
  status: "live" | "ramping" | "construction" | "planned" | "contracted" | "unconfirmed";
  expected?: string;
  region?: string | null;
  keywords: string[];
  note?: string;
  sources: string[];
};

export type NewsItem = { title: string; publisher: string; date: string; url: string; sites: string[]; tag: "risk" | "progress" | null; firstSeen: string };

// Decisive outcomes for the project win over mentions of the fight around it: "judge rejects referendum
// petition" or "breaks ground amid opposition" are progress for Nebius, not risk.
const STRONG_PROGRESS = /break(s|ing)? ground|groundbreaking|moves? forward|to move forward|approv(es|ed|al)|(judge|court) (rejects|dismisses|tosses|denies)|(rejects|dismisses|denies) (the )?(referendum|petition|lawsuit|suit|appeal)|lawsuit (dismissed|tossed)|energi[sz]ed|power block|goes live|operational|comes online|first (phase|capacity)/i;
const RISK = /lawsuit|sue[sd]?\b|halt|injunction|postpone|delay|oppos|moratorium|backlash|restrict|denied|reject|protest|petition|appeal|zoning fight|pause|cancel|scrap|withdraw/i;
const PROGRESS = /online|launch|opens?\b|completes?|completed|delivered|ready|secures?|signs? (on|for|a |an |deal|agreement|contract|lease)/i;

export function tagHeadline(title: string): "risk" | "progress" | null {
  if (STRONG_PROGRESS.test(title)) return "progress";
  if (RISK.test(title)) return "risk";
  if (PROGRESS.test(title)) return "progress";
  return null;
}

const decode = (s: string) =>
  s.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();

function parseRss(xml: string): { title: string; publisher: string; date: string; url: string }[] {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, item]) => {
    const raw = decode(item!.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? "");
    const publisher = decode(item!.match(/<source[^>]*>([\s\S]*?)<\/source>/)?.[1] ?? "");
    // Google appends " - Publisher" to every title.
    const title = publisher && raw.endsWith(` - ${publisher}`) ? raw.slice(0, -publisher.length - 3) : raw;
    const pub = item!.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1];
    return { title, publisher, date: pub ? new Date(pub).toISOString().slice(0, 10) : today(), url: decode(item!.match(/<link>([\s\S]*?)<\/link>/)?.[1] ?? "") };
  });
}

export function matchSites(text: string, sites: Site[]): string[] {
  return sites.filter((s) => s.keywords.some((k) => new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text))).map((s) => s.id);
}

export async function collectNews(): Promise<SourceResult> {
  const date = today();
  const sites = await readJson<Site[]>("sites.json", []);
  const store = await readJson<Record<string, NewsItem>>("news/items.json", {});
  const bootstrap = Object.keys(store).length === 0;
  const alerts: Alert[] = [];
  let fetched = 0;
  // Google News resurfaces old articles; only fresh ones are news to us.
  const alertCutoff = new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10);

  for (const q of QUERIES) {
    const xml = await fetchText(`https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`);
    for (const it of parseRss(xml)) {
      fetched++;
      // Syndicated copies share a headline; key on the normalized title.
      const key = it.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 140);
      if (!key || store[key]) continue;
      const siteIds = matchSites(it.title, sites);
      const tag = tagHeadline(it.title);
      store[key] = { ...it, sites: siteIds, tag, firstSeen: date };
      if (!bootstrap && siteIds.length && tag && it.date >= alertCutoff) {
        const names = siteIds.map((id) => sites.find((s) => s.id === id)?.name ?? id).join(", ");
        alerts.push({
          id: `news-${key.slice(0, 80)}`,
          date,
          source: "news",
          severity: tag === "risk" ? "medium" : "info",
          title: `${tag === "risk" ? "Site risk" : "Site progress"} (${names}): ${it.title}`,
          detail: it.publisher,
          url: it.url,
        });
      }
    }
  }

  // Re-tag stored items too, so improvements to the tagger apply to history.
  for (const v of Object.values(store)) v.tag = tagHeadline(v.title);
  const cutoff = new Date(Date.now() - KEEP_DAYS * 864e5).toISOString().slice(0, 10);
  const kept = Object.fromEntries(Object.entries(store).filter(([, v]) => v.date >= cutoff));
  await writeJson("news/items.json", kept);
  const tagged = Object.values(kept).filter((v) => v.sites.length).length;
  return { summary: `${fetched} headlines fetched; ${Object.keys(kept).length} kept, ${tagged} matched to sites`, alerts };
}
