import { useState } from "react";
import type { Dashboard, SiteRow } from "../../shared/dashboard.ts";
import { Card, CardTitle, DataTable, ExtLink, Pill, Section, Segmented, Stat } from "../components/ui.tsx";
import { day } from "../lib/format.ts";
import type { Palette } from "../lib/theme.ts";
import { PowerPanel } from "./Power.tsx";

const STATUS: Record<SiteRow["status"], { label: string; cls: string }> = {
  live: { label: "Live", cls: "text-good bg-[color-mix(in_srgb,var(--good)_12%,transparent)]" },
  ramping: { label: "Ramping", cls: "text-accent bg-accent-wash" },
  construction: { label: "Construction", cls: "text-warn bg-[color-mix(in_srgb,var(--warn)_14%,transparent)]" },
  contracted: { label: "Contracted", cls: "text-ink-2 bg-surface-2" },
  planned: { label: "Planned", cls: "text-ink-2 bg-surface-2" },
  unconfirmed: { label: "Unconfirmed", cls: "text-ink-3 bg-surface-2" },
};

const mw = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)} GW` : `${Math.round(v)} MW`);

function Tag({ tag }: { tag: "risk" | "progress" | null }) {
  if (!tag) return null;
  return tag === "risk" ? (
    <span className="shrink-0 text-[11px] font-semibold text-bad">
      <span aria-hidden>▲</span> Risk
    </span>
  ) : (
    <span className="shrink-0 text-[11px] font-semibold text-good">
      <span aria-hidden>●</span> Progress
    </span>
  );
}

export function DataCentersSection({ d, p }: { d: Dashboard; p: Palette }) {
  const s = d.sites;
  const [filter, setFilter] = useState<"all" | "risk" | "progress">("all");
  const news = s.news.filter((n) => filter === "all" || n.tag === filter);
  const siteName = new Map(s.rows.map((r) => [r.id, r.name]));
  const by = (st: SiteRow["status"]) => s.mwByStatus.find((x) => x.status === st);

  return (
    <Section
      id="datacenters"
      kicker="Capacity"
      title="Data centers and power"
      intro={
        <>
          Revenue follows power: capacity only bills once it's built, connected and running GPUs. Nebius reports three kinds of power: <b>contracted</b> (land and power
          secured), <b>connected</b> (built data centers) and <b>active</b> (running, revenue-generating). Figures come from its shareholder letters (kept in{" "}
          <code className="rounded bg-surface-2 px-1 text-[12px]">data/power.json</code>); sites from announcements and third-party research.
        </>
      }
    >
      <h2 className="mt-2 text-lg font-semibold tracking-tight">Power</h2>
      <PowerPanel d={d} p={p} />

      <h2 className="mt-6 text-lg font-semibold tracking-tight">Sites</h2>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Live" value={by("live") ? `${by("live")!.sites} sites` : "—"} note={by("live")?.mw ? `${mw(by("live")!.mw)} disclosed; most live sites don't publish MW` : undefined} />
        <Stat label="Ramping" value={by("ramping") ? mw(by("ramping")!.mw) : "—"} note={by("ramping") ? `${by("ramping")!.sites} sites coming online now` : undefined} />
        <Stat label="Under construction" value={by("construction") ? mw(by("construction")!.mw) : "—"} note={by("construction") ? `${by("construction")!.sites} sites, mostly 2027` : undefined} />
        <Stat label="Planned or contracted" value={mw((by("planned")?.mw ?? 0) + (by("contracted")?.mw ?? 0))} note={`${(by("planned")?.sites ?? 0) + (by("contracted")?.sites ?? 0)} sites`} />
      </div>

      <Card>
        <CardTitle title="Sites" sub="Status, scale and the live signals around each one" />
        <DataTable
          caption="Nebius data-center sites"
          maxHeight={560}
          rows={s.rows}
          columns={[
            {
              key: "site",
              label: "Site",
              render: (r) => (
                <div className="min-w-44">
                  <p className="font-medium">{r.name}</p>
                  <p className="text-xs text-ink-3">
                    {r.country} · {r.model}
                  </p>
                </div>
              ),
            },
            { key: "status", label: "Status", render: (r) => <span className={`whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${STATUS[r.status].cls}`}>{STATUS[r.status].label}</span> },
            { key: "mw", label: "MW", align: "right", render: (r) => (r.mw ? <span title={r.mwNote}>{r.mw.toLocaleString()}{r.mwNote ? "*" : ""}</span> : <span className="text-ink-3">{r.mwNote ?? "—"}</span>) },
            {
              key: "gpus",
              label: "GPUs live",
              render: (r) =>
                r.platforms.length ? (
                  <span className="flex flex-wrap gap-1">
                    {r.platforms.map((f) => (
                      <Pill key={f}>{f}</Pill>
                    ))}
                    {r.region && <span className="font-mono text-[11px] text-ink-3">{r.region}</span>}
                  </span>
                ) : (
                  <span className="text-ink-3">—</span>
                ),
            },
            { key: "roles", label: "DC roles", align: "right", render: (r) => (r.dcRolesOpen ? <span title={`${r.dcRolesPosted90d} posted in the last 90 days`}>{r.dcRolesOpen}</span> : <span className="text-ink-3">0</span>) },
            {
              key: "news",
              label: "News, 90 days",
              align: "right",
              render: (r) =>
                r.news90d ? (
                  <span className="whitespace-nowrap">
                    {r.news90d}
                    {r.risk90d > 0 && <span className="ml-1.5 text-bad">▲{r.risk90d}</span>}
                    {r.progress90d > 0 && <span className="ml-1.5 text-good">●{r.progress90d}</span>}
                  </span>
                ) : (
                  <span className="text-ink-3">0</span>
                ),
            },
            {
              key: "latest",
              label: "Latest",
              render: (r) =>
                r.latest ? (
                  <div className="min-w-56 max-w-80">
                    <ExtLink href={r.latest.url} className="no-underline hover:underline">
                      {r.latest.title}
                    </ExtLink>
                    <p className="text-xs text-ink-3">{day(r.latest.date, true)}</p>
                  </div>
                ) : (
                  <span className="text-xs text-ink-3">{r.note ?? "—"}</span>
                ),
            },
            { key: "exp", label: "Expected", render: (r) => <span className="whitespace-nowrap text-ink-2">{r.expected ?? "—"}</span> },
          ]}
        />
        <p className="mt-3 text-xs text-ink-3">
          ▲ risk headlines (lawsuits, halts, delays) · ● progress headlines (power delivered, online, approvals). * see note on hover. Region-to-site mapping for the two UK regions is an
          assumption.
        </p>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardTitle
            title="Site news"
            sub="Headlines matched to a site, from Google News"
            right={
              <Segmented
                label="News filter"
                value={filter}
                onChange={setFilter}
                options={[
                  { value: "all", label: "All" },
                  { value: "risk", label: "Risk" },
                  { value: "progress", label: "Progress" },
                ]}
              />
            }
          />
          <ul className="max-h-[420px] divide-y divide-[var(--border)] overflow-y-auto">
            {news.map((n) => (
              <li key={n.url} className="flex gap-3 py-2.5">
                <span className="tnum w-14 shrink-0 pt-0.5 text-xs text-ink-3">{day(n.date)}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Tag tag={n.tag} />
                    <span className="text-[11px] text-ink-3">{n.sites.map((id) => siteName.get(id) ?? id).join(", ")}</span>
                  </div>
                  <p className="mt-0.5 text-sm">
                    <ExtLink href={n.url} className="no-underline hover:underline">
                      {n.title}
                    </ExtLink>
                  </p>
                  <p className="text-xs text-ink-3">{n.publisher}</p>
                </div>
              </li>
            ))}
          </ul>
        </Card>
        <Card className="lg:col-span-2">
          <CardTitle title="Capacity go-lives" sub={<>New regions and GPU types in <ExtLink href="https://docs.nebius.com/overview/regions">Nebius's regions docs</ExtLink></>} />
          {s.regionChanges.length === 0 ? (
            <p className="text-sm leading-relaxed text-ink-2">
              No changes since tracking began. When Nebius adds a region or a GPU type to a region, it appears here, raises a high alert and counts toward the nowcast.
            </p>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {s.regionChanges.map((c, i) => (
                <li key={i} className="flex gap-3">
                  <span className="tnum w-16 shrink-0 text-xs text-ink-3">{day(c.date)}</span>
                  <span>
                    {c.kind.replace("-", " ")}: <span className="font-medium">{c.platform ? `${c.platform} in ` : ""}{c.region}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </Section>
  );
}
