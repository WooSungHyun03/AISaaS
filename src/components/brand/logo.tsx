import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/utils";

interface LogoProps {
  href?: string;
  /** `dark` 는 네이비 배경(사이드바) 위에서 사용합니다. */
  tone?: "light" | "dark";
  size?: "sm" | "md" | "lg";
  className?: string;
  /** 링크 없이 로고만 표시할 때 사용합니다. */
  asStatic?: boolean;
}

const SIZES = {
  sm: { mark: 28, text: "text-[15px]" },
  md: { mark: 34, text: "text-[17px]" },
  lg: { mark: 44, text: "text-[22px]" },
} as const;

export function Logo({ href = "/", tone = "light", size = "md", className, asStatic = false }: LogoProps) {
  const { mark, text } = SIZES[size];
  const content = (
    <>
      <Image src="/brand/mark.webp" alt="" width={mark} height={mark} unoptimized priority className="shrink-0" aria-hidden="true" />
      <span translate="no" className={cn("font-extrabold tracking-[-0.04em]", text)}>
        <span className={tone === "dark" ? "text-white" : "text-ink"}>Easy</span>{" "}
        <span className={tone === "dark" ? "text-[#8fb4ff]" : "text-primary"}>Marketing</span>
      </span>
    </>
  );

  if (asStatic) return <span className={cn("inline-flex items-center gap-2", className)}>{content}</span>;
  return (
    <Link href={href} aria-label="Easy Marketing 홈" className={cn("inline-flex items-center gap-2 rounded-md", className)}>
      {content}
    </Link>
  );
}
