"use client";

import { useActionState, useEffect } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import {
  generateMarketingCalendar,
  type GenerateCalendarActionState,
} from "@/app/(app)/marketing/calendar/actions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

const initialState: GenerateCalendarActionState = {};

export function CalendarPlanGenerator({
  businessId,
  disabled = false,
}: {
  businessId: string;
  disabled?: boolean;
}) {
  const [state, formAction, isPending] = useActionState(generateMarketingCalendar, initialState);

  useEffect(() => {
    if (!state.completedAt || !state.message) return;
    if (state.status === "success") toast.success(state.message);
    if (state.status === "error") toast.error(state.message);
  }, [state.completedAt, state.message, state.status]);

  return (
    <form action={formAction} className="flex flex-col gap-3 sm:flex-row sm:items-end" aria-describedby={state.status === "error" ? "calendar-plan-error" : undefined}>
      <input type="hidden" name="businessId" value={businessId} />
      <div className="space-y-1.5">
        <Label htmlFor="calendar-weeks">계획 기간</Label>
        <select
          id="calendar-weeks"
          name="weeks"
          defaultValue="2"
          disabled={disabled || isPending}
          className="h-11 w-full cursor-pointer rounded-lg border border-input bg-card px-3.5 text-[15px] outline-none focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-50 sm:w-32"
        >
          <option value="2">2주</option>
          <option value="3">3주</option>
          <option value="4">4주</option>
        </select>
      </div>
      <Button type="submit" disabled={disabled || isPending}>
        {isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Sparkles aria-hidden="true" />}
        {isPending ? "계획을 짜는 중…" : "계획 만들기"}
      </Button>
      {state.status === "error" ? <p id="calendar-plan-error" className="sr-only" role="alert">{state.message}</p> : null}
      {state.status === "success" ? <span className="sr-only" role="status">{state.message}</span> : null}
    </form>
  );
}
