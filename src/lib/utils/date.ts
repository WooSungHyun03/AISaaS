/** Default timezone for schedules and usage-period bucketing. */
export const SERVICE_TIMEZONE = "Asia/Seoul";

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** Reads the wall-clock date/time an instant corresponds to in `timeZone`. */
export function getZonedParts(date: Date, timeZone: string): ZonedParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const parts = Object.fromEntries(formatter.formatToParts(date).map((p) => [p.type, p.value]));

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/** Converts a wall-clock date/time in `timeZone` to the UTC instant it represents. */
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const assumedUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  const asIfLocal = getZonedParts(new Date(assumedUtc), timeZone);
  const asIfLocalUtc = Date.UTC(asIfLocal.year, asIfLocal.month - 1, asIfLocal.day, asIfLocal.hour, asIfLocal.minute);
  const offsetMs = asIfLocalUtc - assumedUtc;
  return new Date(assumedUtc - offsetMs);
}

/** Usage-tracking period key ("YYYY-MM") for an instant, in the service timezone. */
export function getPeriodKey(date: Date = new Date(), timeZone: string = SERVICE_TIMEZONE): string {
  const { year, month } = getZonedParts(date, timeZone);
  return `${year}-${String(month).padStart(2, "0")}`;
}
