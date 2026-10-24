# Nebius Signal

A daily collector and dashboard of public signals on Nebius (NBIS): GPU pricing and spare capacity, Token Factory traffic on OpenRouter, customers, hiring, SEC filings and reported financials.

## Run it

```sh
npm install
npm run collect     # fetch every source, update data/, raise alerts, rebuild public/data/dashboard.json
npm run dev         # dashboard at http://localhost:5173
```

`npm run collect gpu-spot sec` runs only the named sources. `npm run dashboard` rebuilds the dataset from `data/` without fetching.

## Sources

| Source | What it gives | Why it matters |
|---|---|---|
| `api.nebius.cloud/billing/v1alpha1/spot-price` | Live and 30-day hourly spot prices per GPU and region (public, no key) | Spot is capped just under list price, so spot ÷ list is a proxy for spare capacity. Nebius keeps only 30 days; this repo keeps it forever. |
| `nebius.com/prices` | On-demand rate card | Detects list-price changes (pricing power) |
| `openrouter.ai/provider/<slug>` | 90 days of daily tokens per model, for Nebius and 11 peers | Token Factory's competitive position |
| `jimmyresearch.com/openrouter` CSV | Whole-market OpenRouter tokens per provider | Nebius share and rank |
| `nebiusatlas.com` | Community-tracked customer list | Demand breadth (dates are discovery dates) |
| SEC EDGAR | 6-K headlines, Form 4 insider trades, Form 144 planned sales | Material news and insider behaviour |
| Greenhouse job board | Open roles by function and region | Build-out signal; new data-center hiring locations alert |
| Yahoo Finance chart API | NBIS daily close | Price context |
| `docs.nebius.com/overview/regions` | Live regions and the GPU types in each | A new region or GPU type = capacity going live (high alert) |
| Google News RSS | Data-center headlines, matched to sites and tagged risk/progress | Lawsuits, halts and power milestones show up in local news first |
| `data/sites.json` | Site registry: status, MW, region, timing (hand-maintained) | The capacity pipeline that revenue follows |
| `data/fundamentals.json` | Quarterly revenue, ARR, guidance (hand-maintained) | Update after each results 6-K; the dashboard flags when one is out |

## Daily updates

`.github/workflows/daily.yml` runs the collector at 06:17 UTC, commits the new data and deploys the dashboard to GitHub Pages. To enable it on a GitHub repo:

1. Settings → Pages → Source: **GitHub Actions**.
2. Secret `SEC_USER_AGENT` (e.g. `nebius-signal you@example.com`). SEC rejects automated requests without a real contact email; `gh secret set SEC_USER_AGENT --body "nebius-signal you@example.com"`.
3. Optional: secret `NTFY_TOPIC` to get high and medium alerts as push notifications via [ntfy](https://ntfy.sh).

Run it on demand from the Actions tab (**Daily collect and deploy → Run workflow**).

## Quarter nowcast

`collector/nowcast.ts` produces one revenue estimate per unreported quarter: consensus (or what guidance implies) tilted by the collected signals, each scored −1…+1 and weighted by importance × how much of the quarter its data covers. Every run records the estimate in `data/nowcast/history.json`; the scorecard grades it against reported results. The weights are priors until a few quarters have been graded. Keep `data/fundamentals.json` current: add each reported quarter (with the consensus it was measured against) and next quarter's consensus.

## Layout

```
collector/            fetchers (sources/), shared helpers (lib/), runner (index.ts), dataset builder
data/                 raw history, committed daily (git is the database)
shared/dashboard.ts   the dataset contract between collector and UI
src/                  React + Recharts dashboard
```

Not investment advice. Public data, best-effort parsing.
