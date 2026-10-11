import type { EventColor } from "@/types/calendar-events";

/** Event colours, all dark enough for white text (WCAG AA). Hex because the calendar widget paints events inline. */
export const EVENT_COLOR_HEX: Record<EventColor, string> = {
  blue: "#1d5fe8",
  green: "#0a7f5c",
  red: "#c8283a",
  orange: "#b45309",
  purple: "#6d28d9",
  gray: "#475569",
};
