export type Severity = "high" | "medium" | "info";

export type Alert = {
  /** Stable id so re-running the collector never duplicates an alert. */
  id: string;
  date: string;
  source: SourceId;
  severity: Severity;
  title: string;
  detail?: string;
  url?: string;
};

export type SourceId = "gpu-ondemand" | "gpu-spot" | "regions" | "news" | "epoch" | "openrouter" | "openrouter-market" | "atlas" | "sec" | "jobs" | "stock";

export type SourceResult = {
  summary: string;
  alerts: Alert[];
};

export type RunStatus = {
  ok: boolean;
  lastAttempt: string;
  lastSuccess: string | null;
  summary?: string;
  error?: string;
};
