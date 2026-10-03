import {
  Activity,
  BookOpen,
  Building2,
  CalendarDays,
  Compass,
  CreditCard,
  History,
  House,
  ListChecks,
  Settings,
  Sparkles,
  TrendingUp,
  Video,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** true 이면 정확히 일치할 때만 활성 표시 */
  exact?: boolean;
  /** 아직 제공되지 않는 메뉴. 링크 대신 "준비 중"으로 표시합니다. */
  comingSoon?: boolean;
  /** 호환/통합 라우트로 이동한 뒤에도 같은 메뉴를 활성 표시합니다. */
  activePaths?: string[];
}

export interface NavSection {
  label?: string;
  items: NavItem[];
}

/**
 * 신규 사용자의 핵심 동선을 한 섹션에 그대로 배치합니다.
 * 자동화 관리와 실행 기록은 필요할 때 찾는 고급 설정으로 분리합니다.
 */
export const APP_NAV: NavSection[] = [
  {
    items: [
      { href: "/dashboard", label: "대시보드", icon: House, exact: true },
      { href: "/diagnosis", label: "마케팅 진단", icon: Activity, activePaths: ["/marketing/diagnosis"] },
      { href: "/business", label: "사업 정보", icon: Building2 },
      { href: "/calendar", label: "마케팅 캘린더", icon: CalendarDays },
      { href: "/blog", label: "블로그", icon: BookOpen },
      { href: "/shorts", label: "숏폼", icon: Video },
      { href: "/growth-report", label: "성장 리포트", icon: TrendingUp, comingSoon: true },
    ],
  },
  {
    label: "고급 설정",
    items: [
      { href: "/automations/marketplace", label: "자동화 둘러보기", icon: Sparkles },
      { href: "/automations", label: "내 자동화", icon: ListChecks, exact: true },
      { href: "/automations/history", label: "실행 기록", icon: History },
    ],
  },
  {
    label: "내 계정",
    items: [
      { href: "/billing", label: "요금제·결제", icon: CreditCard },
      { href: "/settings", label: "설정", icon: Settings },
    ],
  },
  {
    label: "리소스",
    items: [
      { href: "/directory", label: "AI 서비스", icon: Compass },
      { href: "/guides", label: "활용 가이드", icon: BookOpen },
    ],
  },
];

export function isNavActive(pathname: string, item: Pick<NavItem, "href" | "exact" | "activePaths">): boolean {
  const paths = [item.href, ...(item.activePaths ?? [])];
  if (item.exact) return paths.includes(pathname);
  return paths.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}
