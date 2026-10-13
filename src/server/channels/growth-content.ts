import "server-only";
import { createClient } from "@/lib/supabase/server";
import { ChannelsError } from "./summary";
import { kstDateString } from "./schedule";

const DAY_MS = 86_400_000;
const PAGE_SIZE = 1_000;
const MAX_PAGES = 10;
const LIST_SIZE = 8;

/** One video or post as last seen by the daily collection. Every count is optional: a number the platform did not show is absent, never 0. */
export interface ContentItem {
  id: string;
  title: string | null;
  url: string | null;
  publishedAt: string | null;
  viewCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
  /** Views gained inside the period (last snapshot − first snapshot of the period); null with fewer than two snapshots. */
  viewsGained: number | null;
}

export interface WeeklyPublishCount {
  /** Monday of the week (KST date). */
  weekStart: string;
  count: number;
}

export interface ChannelContentReport {
  channelId: string;
  kind: "VIDEOS" | "POSTS";
  /** Newest published first, at most LIST_SIZE. */
  items: ContentItem[];
  /** Items published per week inside the period, among the items the collection has seen (the platform's recent window). */
  weekly: WeeklyPublishCount[];
  /** How many different items the collection has seen in the period. */
  observedItems: number;
  /** KST date of the newest snapshot, or null when nothing was collected yet. */
  lastSnapshotDate: string | null;
}

type Row = { channel_id: string; external_content_id: string; title: string | null; url: string | null; published_at: string | null; snapshot_date: string; metrics: unknown };

function metricOf(metrics: unknown, key: string): number | null {
  if (!metrics || typeof metrics !== "object" || Array.isArray(metrics)) return null;
  const value = (metrics as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function weekStartOf(isoOrDate: string): string {
  const date = kstDateString(Date.parse(isoOrDate));
  const ms = Date.parse(`${date}T00:00:00Z`);
  return new Date(ms - ((new Date(ms).getUTCDay() + 6) % 7) * DAY_MS).toISOString().slice(0, 10);
}

/** Pure part: turns the snapshot rows of ONE channel into the report. Exported for tests. */
export function buildContentReport(channelId: string, kind: "VIDEOS" | "POSTS", rows: Row[], periodStartKst: string, now: Date): ChannelContentReport {
  const byItem = new Map<string, Row[]>();
  for (const row of rows) byItem.set(row.external_content_id, [...(byItem.get(row.external_content_id) ?? []), row]);

  const items: ContentItem[] = [];
  for (const [id, snapshots] of byItem) {
    const sorted = [...snapshots].sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date));
    const inPeriod = sorted.filter((row) => row.snapshot_date >= periodStartKst);
    const last = sorted[sorted.length - 1];
    const first = inPeriod[0];
    const lastViews = metricOf(last.metrics, "viewCount");
    const firstViews = first ? metricOf(first.metrics, "viewCount") : null;
    items.push({
      id,
      title: last.title,
      url: last.url,
      publishedAt: last.published_at,
      viewCount: lastViews,
      likeCount: metricOf(last.metrics, "likeCount"),
      commentCount: metricOf(last.metrics, "commentCount"),
      viewsGained: inPeriod.length >= 2 && lastViews !== null && firstViews !== null && lastViews >= firstViews ? lastViews - firstViews : null,
    });
  }
  items.sort((a, b) => Date.parse(b.publishedAt ?? "1970-01-01") - Date.parse(a.publishedAt ?? "1970-01-01"));

  const periodStartMs = Date.parse(`${periodStartKst}T00:00:00Z`) - 9 * 3_600_000;
  const weeks = new Map<string, number>();
  for (const item of items) {
    if (!item.publishedAt) continue;
    const publishedMs = Date.parse(item.publishedAt);
    if (publishedMs < periodStartMs || publishedMs > now.getTime()) continue;
    const week = weekStartOf(item.publishedAt);
    weeks.set(week, (weeks.get(week) ?? 0) + 1);
  }
  const lastSnapshotDate = rows.reduce<string | null>((latest, row) => (latest === null || row.snapshot_date > latest ? row.snapshot_date : latest), null);

  return {
    channelId,
    kind,
    items: items.slice(0, LIST_SIZE),
    weekly: [...weeks.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([weekStart, count]) => ({ weekStart, count })),
    observedItems: items.length,
    lastSnapshotDate,
  };
}

/** Per-video (YouTube) and per-post (blogs) performance of every channel of a business, from the daily content snapshots. */
export async function getChannelContentReports(businessId: string, channels: Array<{ channelId: string; platform: string }>, options: { days?: number; now?: Date } = {}): Promise<Map<string, ChannelContentReport>> {
  const days = options.days ?? 30;
  const now = options.now ?? new Date();
  const result = new Map<string, ChannelContentReport>();
  if (channels.length === 0) return result;

  const supabase = await createClient();
  const periodStartKst = kstDateString(now.getTime() - days * DAY_MS);
  const rows: Row[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await supabase
      .from("channel_content_snapshots")
      .select("channel_id, external_content_id, title, url, published_at, snapshot_date, metrics")
      .in("channel_id", channels.map((channel) => channel.channelId))
      .gte("snapshot_date", kstDateString(now.getTime() - (days + 1) * DAY_MS))
      .order("snapshot_date", { ascending: true })
      .order("external_content_id", { ascending: true })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (error) throw new ChannelsError("DATABASE_ERROR", "게시물별 통계를 불러오지 못했습니다.", { cause: error });
    rows.push(...((data ?? []) as Row[]));
    if ((data ?? []).length < PAGE_SIZE) break;
  }
  void businessId; // channels are already scoped to the business by the caller's RLS-checked list

  for (const channel of channels) {
    const own = rows.filter((row) => row.channel_id === channel.channelId);
    if (own.length === 0) continue;
    result.set(channel.channelId, buildContentReport(channel.channelId, channel.platform === "youtube" ? "VIDEOS" : "POSTS", own, periodStartKst, now));
  }
  return result;
}
