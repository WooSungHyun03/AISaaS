"use client";

import dynamic from "next/dynamic";

/** The calendar widget measures the screen, so it renders on the client only. */
export const CalendarWorkspaceLoader = dynamic(() => import("./calendar-workspace").then((module) => module.CalendarWorkspace), {
  ssr: false,
  loading: () => <div className="h-[28rem] animate-pulse rounded-2xl border bg-card" role="status" aria-label="캘린더를 불러오는 중" />,
});
