import Link from "next/link";
import { Logo } from "@/components/brand/logo";

const FOOTER_LINKS = [
  {
    title: "서비스",
    links: [
      { href: "/#features", label: "무엇을 해주나요" },
      { href: "/#how", label: "이용 방법" },
      { href: "/pricing", label: "요금제" },
    ],
  },
];

export function PublicFooter() {
  return (
    <footer className="border-t border-border bg-card">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-[1.4fr_1fr]">
        <div className="max-w-sm">
          <Logo />
          <p className="mt-4 text-sm leading-6 text-muted-foreground">
            1인 사업자와 소규모 가게를 위한 AI 마케팅 도우미. 진단부터 블로그 글, 숏폼 영상까지 한곳에서 준비하세요.
          </p>
        </div>
        {FOOTER_LINKS.map((group) => (
          <nav key={group.title} aria-label={group.title}>
            <p className="text-sm font-bold">{group.title}</p>
            <ul className="mt-3 space-y-2">
              {group.links.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="text-sm text-muted-foreground transition-colors hover:text-foreground hover:underline">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-5 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>&copy; {new Date().getFullYear()} Easy Marketing · 학교 프로젝트 데모 서비스(결제는 테스트 모드, 실제 청구 없음)</p>
          <nav aria-label="정책" className="flex gap-4">
            <Link href="/terms" className="hover:text-foreground hover:underline">이용약관</Link>
            <Link href="/privacy" className="font-semibold hover:text-foreground hover:underline">개인정보처리방침</Link>
          </nav>
        </div>
      </div>
    </footer>
  );
}
