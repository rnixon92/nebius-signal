// SEC asks automated clients to identify themselves; everyone else gets a normal browser UA.
export const SEC_UA = process.env.SEC_USER_AGENT ?? "nebius-signal research collector (contact via GitHub repo)";
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36";

type FetchOpts = { ua?: string; timeoutMs?: number; retries?: number; headers?: Record<string, string> };

export async function fetchText(url: string, opts: FetchOpts = {}): Promise<string> {
  const { ua = BROWSER_UA, timeoutMs = 30_000, retries = 2, headers = {} } = opts;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "user-agent": ua, accept: "*/*", ...headers },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.text();
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await sleep(1000 * 2 ** attempt);
    }
  }
  throw lastErr;
}

export async function fetchJson<T>(url: string, opts: FetchOpts = {}): Promise<T> {
  return JSON.parse(await fetchText(url, { ...opts, headers: { accept: "application/json", ...opts.headers } })) as T;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
