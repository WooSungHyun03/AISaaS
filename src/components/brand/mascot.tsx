import Image from "next/image";
import { cn } from "@/lib/utils";

const MASCOT_POSES = {
  /** 윙크하며 손 인사 — 랜딩 히어로 */
  hero: { src: "/brand/mascot-hero.webp", width: 720, height: 795 },
  /** 손 인사 — 로그인/회원가입 */
  wave: { src: "/brand/mascot-wave.webp", width: 720, height: 752 },
  /** 엄지 척 (윙크) — 높은 점수, 완료 */
  thumbsUp: { src: "/brand/mascot-thumbs-up.webp", width: 720, height: 814 },
  /** 엄지 척 (눈 크게) — 저장/생성 성공 */
  thumbsUp2: { src: "/brand/mascot-thumbs-up-2.webp", width: 720, height: 805 },
  /** 점프하며 환호 — 결제/큰 성공, 로딩 */
  cheer: { src: "/brand/mascot-cheer.webp", width: 720, height: 740 },
  /** 양손으로 소개 — 빈 화면, 404 */
  present: { src: "/brand/mascot-present.webp", width: 720, height: 741 },
  /** 한 손으로 안내 — 빈 상태 */
  guide: { src: "/brand/mascot-guide.webp", width: 720, height: 771 },
  /** 두 팔 벌려 환영 — 온보딩 */
  welcome: { src: "/brand/mascot-welcome.webp", width: 720, height: 739 },
  /** 손가락으로 가리킴 — 진단 개선 안내, 다음 할 일 */
  point: { src: "/brand/mascot-point.webp", width: 720, height: 786 },
} as const;

export type MascotPose = keyof typeof MASCOT_POSES;

interface MascotProps {
  pose: MascotPose;
  /** 렌더링 너비(px). 높이는 원본 비율로 자동 계산됩니다. */
  size?: number;
  className?: string;
  priority?: boolean;
  /** 의미 있는 이미지일 때만 지정하세요. 기본은 장식용(스크린리더 무시)입니다. */
  alt?: string;
}

export function Mascot({ pose, size = 160, className, priority = false, alt = "" }: MascotProps) {
  const asset = MASCOT_POSES[pose];
  return (
    <Image
      src={asset.src}
      alt={alt}
      width={size}
      height={Math.round((size * asset.height) / asset.width)}
      priority={priority}
      unoptimized
      draggable={false}
      aria-hidden={alt === "" ? true : undefined}
      className={cn("h-auto select-none", className)}
    />
  );
}
