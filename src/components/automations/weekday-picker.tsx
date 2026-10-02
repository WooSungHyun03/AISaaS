import { cn } from "@/lib/utils";

const WEEKDAYS = [
  { value: 1, label: "월" }, { value: 2, label: "화" }, { value: 3, label: "수" },
  { value: 4, label: "목" }, { value: 5, label: "금" }, { value: 6, label: "토" }, { value: 0, label: "일" },
];

/** 요일 토글. 선택값은 부모가 들고 있고, 폼 전송용 hidden input은 부모가 만듭니다. */
export function WeekdayPicker({
  legend,
  value,
  onChange,
  disabled,
}: {
  legend: string;
  value: number[];
  onChange: (next: number[]) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-semibold">{legend}</legend>
      <div className="grid grid-cols-7 gap-1.5 sm:flex sm:gap-2">
        {WEEKDAYS.map((day) => {
          const active = value.includes(day.value);
          return (
            <button
              type="button"
              key={day.value}
              aria-pressed={active}
              aria-label={`${day.label}요일`}
              disabled={disabled}
              onClick={() => onChange(active ? value.filter((d) => d !== day.value) : [...value, day.value])}
              className={cn(
                "h-11 w-full cursor-pointer rounded-lg sm:w-11 border text-sm font-semibold transition-colors focus-visible:ring-3 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50",
                active ? "border-primary bg-primary text-primary-foreground" : "border-input bg-card text-muted-foreground hover:border-primary/50 hover:text-foreground",
              )}
            >
              {day.label}
            </button>
          );
        })}
      </div>
      {value.length === 0 ? <p className="text-[13px] text-destructive">요일을 하나 이상 골라주세요.</p> : null}
    </fieldset>
  );
}
