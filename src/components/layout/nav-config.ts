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
}

export interface NavSection {
  label?: string;
  items: NavItem[];
}

/**
 * 사용자의 핵심 동선: 진단 → 사업 정보 → 캘린더 → 콘텐츠 → 성장 리포트.
 * AI 도구 모음은 보조 자료이므로 맨 아래에 둡니다.
 */
export const APP_NAV: NavSection[] = [
  {
    items: [{ href: "/dashboard", label: "홈", icon: House, exact: true }],
  },
  {
    label: "마케팅 계획",
    items: [
      { href: "/marketing/diagnosis", label: "마케팅 진단", icon: Activity },
      { href: "/calendar", label: "마케팅 캘린더", icon: CalendarDays },
    ],
  },
  {
    label: "콘텐츠 만들기",
    items: [
      { href: "/automations/marketplace", label: "블로그·숏폼 시작", icon: Sparkles },
      { href: "/automations", label: "만들기 설정", icon: ListChecks, exact: true },
      { href: "/automations/history", label: "제작 기록", icon: History },
      { href: "#growth-report", label: "성장 리포트", icon: TrendingUp, comingSoon: true },
    ],
  },
  {
    label: "내 계정",
    items: [
      { href: "/business", label: "사업 정보", icon: Building2 },
      { href: "/billing", label: "요금제·결제", icon: CreditCard },
      { href: "/settings", label: "설정", icon: Settings },
    ],
  },
  {
    label: "도움말",
    items: [
      { href: "/guides", label: "활용 가이드", icon: BookOpen },
      { href: "/directory", label: "AI 도구 모음", icon: Compass },
    ],
  },
];

export function isNavActive(pathname: string, item: Pick<NavItem, "href" | "exact">): boolean {
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}
