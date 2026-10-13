/**
 * Daily collection is anchored to 06:00 Asia/Seoul — a fixed wall-clock time, not "24 hours after the last run" — so
 * every channel's snapshot lands on the same KST date and the cron tick that finds it due runs right after 06:00.
 * KST has no daylight saving time, so 06:00 KST is always 21:00 UTC of the previous day (cron `0 21 * * *`).
 * Pure functions: no I/O, trivially testable.
 */
export const COLLECTION_HOUR_KST = 6;
const KST_OFFSET_MS = 9 * 3_600_000;
const DAY_MS = 86_400_000;

/** KST calendar date (YYYY-MM-DD) of an instant. */
export function kstDateString(now: Date | number): string {
  const ms = typeof now === "number" ? now : now.getTime();
  return new Date(ms + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/** The first 06:00 KST strictly after `now`, as a UTC instant. */
export function nextDailyCollectionAt(now: Date): Date {
  const kstMidnightMs = Date.parse(`${kstDateString(now)}T00:00:00.000Z`) - KST_OFFSET_MS;
  const todayAt = kstMidnightMs + COLLECTION_HOUR_KST * 3_600_000;
  return new Date(todayAt > now.getTime() ? todayAt : todayAt + DAY_MS);
}

/** The most recent 06:00 KST at or before `now`: the slot a collection happening now belongs to. */
export function currentCollectionSlot(now: Date): Date {
  return new Date(nextDailyCollectionAt(now).getTime() - DAY_MS);
}

/** After a failed attempt: try again soon (the cause is usually transient), but only a few times a day. */
export const RETRY_DELAY_MS = 30 * 60_000;
export const MAX_RETRIES_PER_SLOT = 3;
