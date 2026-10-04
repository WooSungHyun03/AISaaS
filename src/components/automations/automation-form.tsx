"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormMessage } from "@/components/ui/form-message";
import { NativeSelect } from "@/components/ui/native-select";
import { ScheduleFields, ScheduleHiddenInputs, scheduleToValue } from "@/components/automations/schedule-fields";
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
  const [schedule, setSchedule] = useState(() => scheduleToValue(null));

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

      <ScheduleFields idPrefix="automation" value={schedule} onChange={setSchedule} disabled={isPending} />
      <ScheduleHiddenInputs value={schedule} />

      {state.error ? <FormMessage id="automation-form-error">{state.error}</FormMessage> : null}

      <Button type="submit" size="lg" className="w-full" disabled={isPending || businesses.length === 0}>
        {isPending ? "만드는 중…" : "설정 만들기"}
      </Button>
    </form>
  );
}
