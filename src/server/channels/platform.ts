import { z } from "zod";

/**
 * Single source of truth for `tracked_channels.platform` (and the same
 * values reused on `channel_diagnoses.platform` lookups via the
 * tracked_channels join). Mirrors the directory domain's taxonomy/status
 * pattern: any change here must ship with a new migration that re-creates
 * `tracked_channels_platform_check` (same constraint name) with the same
 * values — platform.test.ts finds the highest-numbered migration
 * mentioning that name and asserts it matches this list.
 *
 * Lowercase, matching this project's existing provider/platform-type
 * column convention (`integration_connections.provider`,
 * `calendar_items.platform`) rather than the uppercase lifecycle-status
 * convention.
 *
 * Scope for ticket 1-1: only the three platforms the URL parser can
 * recognize today. Other `businesses.sns_links` channels (instagram,
 * facebook, naver_place, kakao_channel) are out of scope until a later
 * ticket adds their parser support.
 */
export const CHANNEL_PLATFORMS = ["youtube", "naver_blog", "tistory"] as const;

export type ChannelPlatform = (typeof CHANNEL_PLATFORMS)[number];

export const channelPlatformSchema = z.enum(CHANNEL_PLATFORMS);
