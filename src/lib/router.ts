import { useEffect, useState } from "react";

// Hash routing (#/gpu): works on static hosting like GitHub Pages with no server rewrites,
// and the browser back button behaves as expected.

export const PAGES = [
  { id: "overview", label: "Overview", title: "Overview" },
  { id: "nowcast", label: "Nowcast", title: "Quarter nowcast" },
  { id: "gpu", label: "GPU pricing", title: "GPU pricing" },
  { id: "datacenters", label: "Data centers", title: "Data centers and power" },
  { id: "tokens", label: "Token Factory", title: "Token Factory" },
  { id: "customers", label: "Customers", title: "Customers" },
  { id: "hiring", label: "Hiring", title: "Hiring" },
  { id: "filings", label: "Filings", title: "Filings" },
  { id: "financials", label: "Financials", title: "Financials and valuation" },
  { id: "alerts", label: "Alerts", title: "Alerts" },
  { id: "sources", label: "Sources", title: "Sources and method" },
] as const;

export type PageId = (typeof PAGES)[number]["id"];

const isPage = (s: string): s is PageId => PAGES.some((p) => p.id === s);

/** "#/gpu" → "gpu"; old single-page anchors like "#gpu" still resolve. Unknown → overview. */
function parse(hash: string): PageId {
  const id = hash.replace(/^#\/?/, "").split(/[/?]/)[0] ?? "";
  return isPage(id) ? id : "overview";
}

export const href = (id: PageId) => (id === "overview" ? "#/" : `#/${id}`);

export function useRoute(): PageId {
  const [page, setPage] = useState<PageId>(() => parse(location.hash));
  useEffect(() => {
    const on = () => {
      setPage(parse(location.hash));
      window.scrollTo({ top: 0 });
    };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  useEffect(() => {
    const p = PAGES.find((x) => x.id === page)!;
    document.title = page === "overview" ? "NBIS Signal" : `${p.title} · NBIS Signal`;
  }, [page]);
  return page;
}
