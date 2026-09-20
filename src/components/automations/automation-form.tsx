"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createAutomation, type AutomationActionState } from "@/app/(app)/automations/actions";
import type { AutomationTemplate, Business } from "@/types/domain";

const WEEKDAYS = [
  { value: 1, label: "월" },
  { value: 2, label: "화" },
  { value: 3, label: "수" },
  { value: 4, label: "목" },
  { value: 5, label: "금" },
  { value: 6, label: "토" },
  { value: 0, label: "일" },
];

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
    <Card>
      <CardHeader>
        <CardTitle>자동화 설정</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="businessId">사업체</Label>
            <Select name="businessId" required defaultValue={businesses[0]?.id}>
              <SelectTrigger id="businessId">
                <SelectValue placeholder="사업체를 선택하세요" />
              </SelectTrigger>
              <SelectContent>
                {businesses.map((business) => (
                  <SelectItem key={business.id} value={business.id}>
                    {business.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="templateId">자동화 유형</Label>
            <Select name="templateId" required defaultValue={defaultTemplateId ?? templates[0]?.id}>
              <SelectTrigger id="templateId">
                <SelectValue placeholder="자동화 유형을 선택하세요" />
              </SelectTrigger>
              <SelectContent>
                {templates.map((template) => (
                  <SelectItem key={template.id} value={template.id}>
                    {template.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="name">자동화 이름</Label>
            <Input id="name" name="name" placeholder="예: 헬스장 블로그 자동화" required />
          </div>

          <div className="space-y-2">
            <Label>실행 주기</Label>
            <Select name="frequency" value={frequency} onValueChange={(value) => setFrequency(value as "DAILY" | "WEEKLY")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="DAILY">매일</SelectItem>
                <SelectItem value="WEEKLY">매주 요일 선택</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {frequency === "WEEKLY" ? (
            <div className="space-y-2">
              <Label>요일 선택</Label>
              <div className="flex flex-wrap gap-2">
                {WEEKDAYS.map((day) => {
                  const active = selectedDays.includes(day.value);
                  return (
                    <button
                      type="button"
                      key={day.value}
                      onClick={() =>
                        setSelectedDays((prev) =>
                          prev.includes(day.value) ? prev.filter((d) => d !== day.value) : [...prev, day.value],
                        )
                      }
                      className={`h-9 w-9 rounded-md border text-sm font-medium ${
                        active ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground"
                      }`}
                    >
                      {day.label}
                    </button>
                  );
                })}
              </div>
              {selectedDays.map((day) => (
                <input key={day} type="hidden" name="daysOfWeek" value={day} />
              ))}
            </div>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="timeOfDay">실행 시각 (한국 시간)</Label>
            <Input id="timeOfDay" name="timeOfDay" type="time" defaultValue="09:00" required />
          </div>

          {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}

          <Button type="submit" className="w-full" disabled={isPending || businesses.length === 0}>
            {isPending ? "생성 중..." : "자동화 생성"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
