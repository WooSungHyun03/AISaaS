import type { ChannelPlatform } from "./platform";
import type { ChannelDiagnosisCompleteness } from "./completeness";
import type { ChannelSnapshotSource } from "./snapshot-source";

/**
 * Ticket 1-1's domain shape for one channel's diagnosis — the public,
 * camelCase shape callers (the dashboard, a later AI narrative step) work
 * with, kept separate from `channel_diagnoses`' snake_case DB row the same
 * way `WebsiteDiagnosisOutcome` is kept separate from the `MarketingDiagnosis`
 * row in diagnosis.ts.
 */
export interface ChannelDiagnosis {
  channel: ChannelPlatform;
  /** 0–100. All four scores are computed in code from `metrics`, never asked of the AI (see scoring.ts's rationale). */
  overallScore: number;
  activityScore: number;
  consistencyScore: number;
  contentScore: number;
  /** Raw measured values the scores were computed from (e.g. { subscriberCount: 1200, uploadsLast28Days: 3 }). Shape varies by platform. */
  metrics: Record<string, number>;
  findings: string[];
  recommendations: string[];
  dataSource: ChannelSnapshotSource;
  /** ISO timestamp — when this diagnosis was produced (`channel_diagnoses.created_at`). */
  collectedAt: string;
  completeness: ChannelDiagnosisCompleteness;
}

/** One tracked channel's latest diagnosis, for the dashboard list. */
export interface ChannelDiagnosisSummaryItem extends ChannelDiagnosis {
  channelId: string;
  externalId: string;
  url: string;
}

export interface ChannelDiagnosisSummary {
  businessId: string;
  /** One entry per tracked channel that has at least one diagnosis. Empty when none do yet — see `hasAnyData`. */
  channels: ChannelDiagnosisSummaryItem[];
  /** False when every tracked channel still has zero diagnoses (new business, or the snapshot job hasn't run yet) — the dashboard must show an explicit "진단 데이터 없음" state instead of an empty chart. */
  hasAnyData: boolean;
}

/** current vs. the `days`-before-that window for one channel's one metric. */
export interface ChannelMetricTrend {
  channelId: string;
  platform: ChannelPlatform;
  metric: string;
  /** Most recent value within the current window, or null if no snapshot fell in it. */
  current: number | null;
  /** Most recent value within the previous (comparison) window, or null if none fell in it. */
  previous: number | null;
  /** (current - previous) / previous * 100, rounded. Null when previous is null or zero (nothing to divide by). */
  deltaPercent: number | null;
}

export interface GrowthSummary {
  businessId: string;
  /** Size in days of the current/previous comparison windows. */
  days: number;
  /** One entry per (channel, metric) pair that has at least one snapshot in either window. Empty when none do yet — see `hasAnyData`. */
  trends: ChannelMetricTrend[];
  /** False when no tracked channel has any snapshot yet — the dashboard must show an explicit "데이터 없음" state instead of a zeroed-out chart. */
  hasAnyData: boolean;
}
