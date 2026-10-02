import { Check } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { Mascot } from "@/components/brand/mascot";

const POINTS = ["홈페이지·SNS 주소만 넣으면 무료 마케팅 진단", "진단 결과로 이번 달 콘텐츠 계획 만들기", "블로그 글과 숏폼 영상까지 한곳에서 제작"];

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <aside className="relative hidden overflow-hidden bg-ink text-white lg:flex lg:flex-col lg:gap-10 lg:px-14 lg:py-10">
        <Logo tone="dark" />
        <div className="max-w-md">
          <h2 className="text-[2rem] font-extrabold leading-[1.3] tracking-[-0.035em]">
            마케팅, 이제 혼자
            <br />
            고민하지 마세요.
          </h2>
          <ul className="mt-8 space-y-3.5">
            {POINTS.map((point) => (
              <li key={point} className="flex items-start gap-3 text-[15px] leading-6 text-white/85">
                <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-spark text-ink">
                  <Check className="size-3.5" strokeWidth={3} aria-hidden="true" />
                </span>
                {point}
              </li>
            ))}
          </ul>
        </div>
        <Mascot pose="wave" size={300} priority className="mt-auto -mr-6 max-h-[36vh] w-auto self-end" />
      </aside>
      <main id="main-content" tabIndex={-1} className="flex flex-col bg-card px-5 py-8 sm:px-10">
        <div className="lg:hidden">
          <Logo />
        </div>
        <div className="mx-auto flex w-full max-w-[26rem] flex-1 flex-col justify-center py-10">{children}</div>
      </main>
    </div>
  );
}
