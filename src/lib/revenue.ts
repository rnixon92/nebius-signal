import type { ModelPricing } from "../../shared/dashboard.ts";

export type RevenueAssumptions = {
  /** Share of input tokens served from Nebius's prompt cache (billed at the cached-input price). */
  cacheHit: number;
  /** Share of tokens that are output (OpenRouter's chart counts input and output together). */
  outputShare: number;
};

/** Price for the long tail OpenRouter folds into "Others": typical small open model, no caching. */
const FALLBACK: Pick<ModelPricing, "input" | "output" | "cacheRead"> = { input: 0.15, output: 0.6, cacheRead: null };

/** Estimated revenue in dollars for one day's per-model token counts, at OpenRouter list prices. */
export function dayRevenue(byModel: Record<string, number>, pricing: Record<string, ModelPricing>, a: RevenueAssumptions): number {
  let total = 0;
  for (const [model, tokens] of Object.entries(byModel)) {
    const p = pricing[model] ?? FALLBACK;
    // Embedding models have no output; every token is input.
    const outShare = p.output === 0 ? 0 : a.outputShare;
    const input = tokens * (1 - outShare);
    const output = tokens * outShare;
    const cached = p.cacheRead === null ? 0 : input * a.cacheHit;
    total += ((input - cached) * p.input + cached * (p.cacheRead ?? 0) + output * p.output) / 1e6;
  }
  return total;
}
