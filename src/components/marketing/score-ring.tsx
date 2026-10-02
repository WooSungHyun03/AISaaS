import { cn } from "@/lib/utils";

interface ScoreRingProps {
  /** 0–100 */
  score: number;
  size?: number;
  className?: string;
}

/** 점수에 따라 색을 나눕니다. 색만으로 의미를 전달하지 않도록 항상 숫자와 문구를 함께 표시하세요. */
export function scoreTone(score: number): { label: string; stroke: string; text: string } {
  if (score >= 80) return { label: "아주 좋아요", stroke: "var(--success)", text: "text-success" };
  if (score >= 50) return { label: "조금만 더 채우면 돼요", stroke: "var(--primary)", text: "text-primary" };
  return { label: "기본부터 차근차근", stroke: "var(--chart-4)", text: "text-destructive" };
}

export function ScoreRing({ score, size = 148, className }: ScoreRingProps) {
  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  const stroke = 12;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const tone = scoreTone(clamped);

  return (
    <div className={cn("relative shrink-0", className)} style={{ width: size, height: size }} role="img" aria-label={`마케팅 점수 100점 만점에 ${clamped}점`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--muted)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={tone.stroke}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - clamped / 100)}
          className="transition-[stroke-dashoffset] duration-700 motion-reduce:transition-none"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="tabular text-[2.5rem] font-extrabold leading-none tracking-[-0.04em]">{clamped}</span>
        <span className="mt-1 text-xs font-medium text-muted-foreground">/ 100점</span>
      </div>
    </div>
  );
}
