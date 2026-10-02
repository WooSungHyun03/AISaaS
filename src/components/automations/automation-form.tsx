"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormMessage } from "@/components/ui/form-message";
import { NativeSelect } from "@/components/ui/native-select";
import { WeekdayPicker } from "@/components/automations/weekday-picker";
import { createAutomation, type AutomationActionState } from "@/app/(app)/automations/actions";
import type { AutomationTemplate, Business } from "@/types/domain";

const initialState: AutomationActionState = {};

export function AutomationForm({
  businesses,
  templates,
  defaultTemplateId,
}: {
  businesses: Business[];
  templates: AutomationTemplate[];
  defaultTemplateId?: string;
}) {
  const [state, formAction, isPending] = useActionState(createAutomation, initialState);
  const [frequency, setFrequency] = useState<"DAILY" | "WEEKLY">("WEEKLY");
  const [selectedDays, setSelectedDays] = useState<number[]>([1, 3, 5]);

  return (
    <form action={formAction} className="space-y-5 rounded-2xl border bg-card px-5 py-6 sm:px-8 sm:py-8" aria-describedby={state.error ? "automation-form-error" : undefined}>
      <div className="space-y-2">
        <Label htmlFor="businessId">사업체</Label>
        <NativeSelect id="businessId" name="businessId" required defaultValue={businesses[0]?.id} disabled={isPending}>
          {businesses.map((business) => <option key={business.id} value={business.id}>{business.name}</option>)}
        </NativeSelect>
      </div>

      <div className="space-y-2">
        <Label htmlFor="templateId">만들 콘텐츠</Label>
        <NativeSelect id="templateId" name="templateId" required defaultValue={defaultTemplateId ?? templates[0]?.id} disabled={isPending}>
          {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
        </NativeSelect>
      </div>

      <div className="space-y-2">
        <Label htmlFor="name">설정 이름</Label>
        <Input id="name" name="name" placeholder="예: 헬스장 숏폼 만들기" required maxLength={100} disabled={isPending} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="frequency">만드는 주기</Label>
        <NativeSelect id="frequency" name="frequency" value={frequency} onChange={(event) => setFrequency(event.target.value as "DAILY" | "WEEKLY")} disabled={isPending}>
          <option value="DAILY">매일</option>
          <option value="WEEKLY">정한 요일마다</option>
        </NativeSelect>
      </div>

      {frequency === "WEEKLY" ? (
        <>
          <WeekdayPicker legend="만드는 요일" value={selectedDays} onChange={setSelectedDays} disabled={isPending} />
          {selectedDays.map((day) => <input key={day} type="hidden" name="daysOfWeek" value={day} />)}
        </>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="timeOfDay">만드는 시간 (한국 시간)</Label>
        <Input id="timeOfDay" name="timeOfDay" type="time" defaultValue="09:00" required disabled={isPending} className="sm:w-44" />
      </div>

      {state.error ? <FormMessage id="automation-form-error">{state.error}</FormMessage> : null}

      <Button type="submit" size="lg" className="w-full" disabled={isPending || businesses.length === 0}>
        {isPending ? "만드는 중…" : "설정 만들기"}
      </Button>
    </form>
  );
}
