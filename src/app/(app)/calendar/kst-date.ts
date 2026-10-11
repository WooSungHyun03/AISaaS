/**
 * KST (UTC+9) calendar date (YYYY-MM-DD) for `now` — decides which day is
 * "오늘" in the calendar UI. Uses `Intl.DateTimeFormat` with an explicit
 * `Asia/Seoul` timezone (the IANA tz database), not manual `+9h` offset
 * arithmetic, so this is correct regardless of the server process's own
 * local timezone (e.g. Vercel/most hosts run in UTC).
 *
 * `now` defaults to the real current time but is injectable (ticket 1-9)
 * so the KST midnight boundary — 15:00 UTC, the one moment a day's "오늘"
 * status actually flips — can be tested directly; see kst-date.test.ts.
 */
export function currentKstDate(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}
