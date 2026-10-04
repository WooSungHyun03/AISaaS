import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { WeekdayPicker } from "@/components/automations/weekday-picker";
import type { AutomationSchedule } from "@/types/automation";

export interface ScheduleValue {
  frequency: AutomationSchedule["frequency"];
  daysOfWeek: number[];
  dayOfMonth: number;
  timeOfDay: string;
}

export function scheduleToValue(schedule: Partial<AutomationSchedule> | null | undefined, fallback?: Partial<ScheduleValue>): ScheduleValue {
  return {
    frequency: schedule?.frequency ?? fallback?.frequency ?? "WEEKLY",
    daysOfWeek: schedule?.daysOfWeek ?? fallback?.daysOfWeek ?? [1, 3, 5],
    dayOfMonth: schedule?.dayOfMonth ?? fallback?.dayOfMonth ?? 1,
    timeOfDay: schedule?.timeOfDay ?? fallback?.timeOfDay ?? "09:00",
  };
}

/** 주기(매일·요일·매월)와 시간을 고르는 공통 입력. 값은 부모가 들고 있습니다. */
export function ScheduleFields({
  idPrefix,
  value,
  onChange,
  disabled,
  label = "만드는",
}: {
  idPrefix: string;
  value: ScheduleValue;
  onChange: (next: ScheduleValue) => void;
  disabled?: boolean;
  /** "만드는 주기" 처럼 앞에 붙는 말 */
  label?: string;
}) {
  const patch = (partial: Partial<ScheduleValue>) => onChange({ ...value, ...partial });
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-frequency`}>{label} 주기</Label>
        <NativeSelect
          id={`${idPrefix}-frequency`}
          value={value.frequency}
          onChange={(event) => patch({ frequency: event.target.value as ScheduleValue["frequency"] })}
          disabled={disabled}
        >
          <option value="DAILY">매일</option>
          <option value="WEEKLY">정한 요일마다</option>
          <option value="MONTHLY">매월 정한 날</option>
        </NativeSelect>
      </div>
      {value.frequency === "WEEKLY" ? (
        <WeekdayPicker legend={`${label} 요일`} value={value.daysOfWeek} onChange={(daysOfWeek) => patch({ daysOfWeek })} disabled={disabled} />
      ) : null}
      {value.frequency === "MONTHLY" ? (
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-day`}>{label} 날짜</Label>
          <NativeSelect id={`${idPrefix}-day`} value={value.dayOfMonth} onChange={(event) => patch({ dayOfMonth: Number(event.target.value) })} disabled={disabled} className="sm:w-44">
            {Array.from({ length: 31 }, (_, index) => index + 1).map((day) => <option key={day} value={day}>{day}일</option>)}
          </NativeSelect>
          {value.dayOfMonth > 28 ? <p className="text-[13px] text-muted-foreground">짧은 달에는 그 달의 마지막 날에 만들어요.</p> : null}
        </div>
      ) : null}
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-time`}>{label} 시간 (한국 시간)</Label>
        <Input id={`${idPrefix}-time`} type="time" value={value.timeOfDay} onChange={(event) => patch({ timeOfDay: event.target.value })} disabled={disabled} required className="sm:w-44" />
      </div>
    </div>
  );
}

/** 서버 액션이 읽는 폼 필드(frequency, timeOfDay, daysOfWeek, dayOfMonth). */
export function ScheduleHiddenInputs({ value }: { value: ScheduleValue }) {
  return (
    <>
      <input type="hidden" name="frequency" value={value.frequency} />
      <input type="hidden" name="timeOfDay" value={value.timeOfDay} />
      {value.frequency === "WEEKLY" ? value.daysOfWeek.map((day) => <input key={day} type="hidden" name="daysOfWeek" value={day} />) : null}
      {value.frequency === "MONTHLY" ? <input type="hidden" name="dayOfMonth" value={value.dayOfMonth} /> : null}
    </>
  );
}
