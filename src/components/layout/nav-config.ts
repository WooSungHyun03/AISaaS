import {
  Activity,
  BookOpen,
  CalendarDays,
  CreditCard,
  History,
  House,
  MessageCircleQuestion,
  Settings,
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

/** 신규 사용자가 실제로 사용하는 화면을 작업 순서대로 보여줍니다. */
export const APP_NAV: NavSection[] = [
  {
    items: [
      { href: "/dashboard", label: "대시보드", icon: House, exact: true },
      { href: "/diagnosis", label: "마케팅 진단", icon: Activity, activePaths: ["/marketing/diagnosis"] },
      { href: "/calendar", label: "마케팅 캘린더", icon: CalendarDays },
      { href: "/blog", label: "블로그", icon: BookOpen },
      { href: "/shorts", label: "숏폼", icon: Video },
      { href: "/usage", label: "이용내역", icon: History, activePaths: ["/automations/history"] },
      { href: "/growth-report", label: "성장 리포트", icon: TrendingUp },
      { href: "/billing", label: "요금제·결제", icon: CreditCard },
      { href: "/support", label: "문의", icon: MessageCircleQuestion },
      { href: "/settings", label: "설정", icon: Settings },
    ],
  },
];

export function isNavActive(pathname: string, item: Pick<NavItem, "href" | "exact" | "activePaths">): boolean {
  const paths = [item.href, ...(item.activePaths ?? [])];
  if (item.exact) return paths.includes(pathname);
  return paths.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

/** 데스크톱과 모바일이 같은 우선순위로 하나의 활성 메뉴만 표시하게 합니다. */
export function getActiveNavItem(pathname: string): NavItem | undefined {
  return APP_NAV
    .flatMap((section) => section.items)
    .filter((item) => !item.comingSoon && isNavActive(pathname, item))
    .sort((a, b) => {
      const longestA = Math.max(a.href.length, ...(a.activePaths ?? []).map((path) => path.length));
      const longestB = Math.max(b.href.length, ...(b.activePaths ?? []).map((path) => path.length));
      return longestB - longestA;
    })[0];
}
