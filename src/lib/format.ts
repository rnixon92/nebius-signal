const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** 251337450631 → "251B", 1.2e12 → "1.2T". */
export function tokens(n: number, digits = 0): string {
  const abs = Math.abs(n);
  if (abs >= 1e12) return `${(n / 1e12).toFixed(abs >= 1e13 ? 0 : 1)}T`;
  if (abs >= 1e9) return `${(n / 1e9).toFixed(abs >= 1e11 ? 0 : digits || 1)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(0)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return String(Math.round(n));
}

/** Compact dollars: $1.2B, $582M, $38K, $4.50. */
export function usd(n: number, opts: { cents?: boolean } = {}): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(abs >= 1e10 ? 0 : 1)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(abs >= 1e8 ? 0 : 1)}M`;
  if (abs >= 1e4) return `${sign}$${Math.round(abs / 1e3)}K`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${opts.cents ? abs.toFixed(2) : Math.round(abs)}`;
}

/** Millions in, compact dollars out (fundamentals are stored in $M). */
export const usdM = (m: number) => usd(m * 1e6);

export function pct(n: number | null | undefined, opts: { signed?: boolean; digits?: number } = {}): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const v = (n * 100).toFixed(opts.digits ?? 0);
  if (!opts.signed) return `${v}%`;
  return n > 0 ? `+${v}%` : n < 0 ? `−${v.replace("-", "")}%` : "0%";
}

/** "2026-10-23" → "Oct 23". With year: "Oct 23, 2026". */
export function day(iso: string, withYear = false): string {
  const [y, m, d] = iso.slice(0, 10).split("-");
  const base = `${MONTHS[Number(m) - 1]} ${Number(d)}`;
  return withYear ? `${base}, ${y}` : base;
}

export function relativeTime(iso: string | null, now = Date.now()): string {
  if (!iso) return "never";
  const mins = Math.round((now - Date.parse(iso)) / 60000);
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 36) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

/**
 * Short model label from its OpenRouter slug, without the vendor prefix:
 * "deepseek/deepseek-v4.1-flash-1017" → "deepseek-v4.1-flash-1017". Prefers the variant slug
 * (`name`) over the dated chart key, which keeps re-dated variants distinguishable.
 */
export function modelLabel(id: string, name?: string): string {
  if (id === "Others") return "Other models";
  return (name ?? id).split("/").pop()!.replace(/-\d{8}$/, "");
}
