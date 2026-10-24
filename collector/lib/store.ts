import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const DATA_DIR = join(ROOT, "data");

export async function readJson<T>(rel: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(join(DATA_DIR, rel), "utf8")) as T;
  } catch {
    return fallback;
  }
}

export async function writeJson(rel: string, value: unknown, absolute = false): Promise<void> {
  const path = absolute ? rel : join(DATA_DIR, rel);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 1) + "\n");
}

/** UTC calendar date, YYYY-MM-DD. */
export const today = (d = new Date()) => d.toISOString().slice(0, 10);

export function addDays(date: string, n: number): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return today(d);
}

/** Sort an object's keys so committed JSON diffs stay small and stable. */
export function sortKeys<T extends Record<string, unknown>>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b))) as T;
}
