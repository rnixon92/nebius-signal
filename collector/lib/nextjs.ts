// Next.js App Router pages stream their data as `self.__next_f.push([1, "<chunk>"])` script calls.
// Concatenating the string chunks yields the RSC payload, which embeds the JSON the page renders from.

/** Decode every streamed RSC chunk on the page into one string. */
export function rscPayload(html: string): string {
  const out: string[] = [];
  const marker = "self.__next_f.push(";
  for (let i = html.indexOf(marker); i !== -1; i = html.indexOf(marker, i + marker.length)) {
    const start = i + marker.length;
    const end = valueEnd(html, start);
    if (end === -1) continue;
    try {
      const arr = JSON.parse(html.slice(start, end)) as unknown[];
      if (typeof arr[1] === "string") out.push(arr[1]);
    } catch {
      // not a data chunk
    }
  }
  return out.join("");
}

/**
 * Index just past the JSON array/object that opens at `start`, or -1.
 * String- and escape-aware, so brackets inside strings don't confuse the depth count.
 */
export function valueEnd(src: string, start: number): number {
  let depth = 0;
  let inStr = false;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (inStr) {
      if (c === "\\") i++;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === "{" || c === "[") depth++;
    else if ((c === "}" || c === "]") && --depth === 0) return i + 1;
  }
  return -1;
}

function parseAt(src: string, start: number): { value: unknown; end: number } | null {
  const end = valueEnd(src, start);
  if (end === -1) return null;
  try {
    return { value: JSON.parse(src.slice(start, end)), end };
  } catch {
    return null;
  }
}

/** Every JSON object in `src` whose text starts with `prefix`, e.g. `{"firstListedAt"`. */
export function objectsStartingWith<T = unknown>(src: string, prefix: string): T[] {
  const out: T[] = [];
  for (let i = src.indexOf(prefix); i !== -1; i = src.indexOf(prefix, i + prefix.length)) {
    const parsed = parseAt(src, i);
    if (parsed) out.push(parsed.value as T);
  }
  return out;
}

/** The innermost JSON object that spans position `pos`, found by walking back to an enclosing "{". */
export function enclosingObject<T = unknown>(src: string, pos: number, maxBack = 50_000): T | null {
  for (let i = pos; i >= Math.max(0, pos - maxBack); i--) {
    if (src[i] !== "{") continue;
    const parsed = parseAt(src, i);
    if (parsed && parsed.end > pos) return parsed.value as T;
  }
  return null;
}
