import Link from "next/link";
import { Activity, ArrowRight, BookOpen, CalendarDays, Video } from "lucide-react";
import { Mascot } from "@/components/brand/mascot";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const FEATURES = [
  { title: "마케팅 진단", description: "홈페이지와 유튜브·블로그 채널을 살펴보고 마케팅 상태를 점수로 알려드려요. 먼저 고칠 것도 짚어드려요.", icon: Activity, href: "/diagnosis", cta: "진단받으러 가기", free: true },
  { title: "마케팅 캘린더", description: "콘텐츠를 올릴 날, 이벤트, 휴무일을 한곳에 적어두세요. 반복 일정과 월·주·일 보기를 지원해요.", icon: CalendarDays, href: "/calendar", cta: "캘린더 열기", free: true },
  { title: "AI 블로그 글 작성", description: "우리 가게·상품 이야기로 제목, 소제목, 검색 키워드까지 갖춘 블로그 글을 써드려요.", icon: BookOpen, href: "/blog", cta: "글 만들러 가기", free: false },
  { title: "AI 숏폼 제작", description: "참고 이미지로 대본과 장면을 짜고 세로형 숏폼 영상을 만들어드려요. 올리기 전에 미리 볼 수 있어요.", icon: Video, href: "/shorts", cta: "영상 만들러 가기", free: false },
];

const FAQS = [
  {
    q: "Easy Marketing으로 어떤 일을 할 수 있나요?",
    a: "마케팅 진단으로 현재 상태를 점수로 확인하고, 캘린더로 일정을 관리하고, AI로 블로그 글과 숏폼 영상을 만들 수 있어요. 진단과 캘린더는 무료예요.",
  },
  {
    q: "마케팅 진단은 어떻게 이용하나요?",
    a: "가입 후 가게 정보를 등록하고 ‘마케팅 진단’에서 홈페이지 주소를 넣으면 돼요. 유튜브·네이버 블로그·티스토리 채널도 추가해서 진단할 수 있어요. 홈페이지가 없어도 채널만으로 시작할 수 있어요.",
  },
  {
    q: "마케팅 캘린더는 어떻게 활용하나요?",
    a: "콘텐츠를 올릴 날, 이벤트, 휴무일 같은 일정을 자유롭게 적어두세요. 매주 반복되는 일정도 한 번에 등록하고, 월·주·일 보기로 확인할 수 있어요.",
  },
  {
    q: "AI 블로그는 어떤 글을 작성하나요?",
    a: "등록한 가게·상품·플랫폼 정보에 맞춰 제목, 소제목, 검색 키워드가 있는 글을 써드려요. 네이버 블로그와 티스토리 중 올릴 곳을 고를 수 있어요. 만든 글은 확인하고 고친 뒤 직접 올려주세요.",
  },
  {
    q: "숏폼은 어떤 방식으로 제작되나요?",
    a: "상품·매장 사진 같은 참고 이미지를 올리면 AI가 그 모습을 살려 9:16 세로 광고 영상을 만들어요. 만든 영상은 미리 보고 확인한 뒤 내려받아 내 채널에 직접 올려요.",
  },
  {
    q: "이용권은 어떻게 사용하나요?",
    a: "블로그와 숏폼을 만들 때 해당 이용권이 1회씩 사용돼요. 구독 없이 필요한 만큼만 구매하고, 유효기간 안에 쓰면 돼요. 만들기에 실패하면 이용권은 돌려드려요. 자세한 내용은 요금제 페이지에서 확인하세요.",
  },
];

export default function LandingPage() {
  return (
    <div className="text-foreground">
      {/* Hero */}
      <section className="overflow-hidden bg-brand-soft" aria-labelledby="hero-title">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 pb-14 pt-12 sm:px-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:gap-6 lg:pb-20 lg:pt-16">
          <div className="max-w-xl">
            <h1 id="hero-title" className="text-[2.25rem] font-extrabold leading-[1.22] tracking-[-0.045em] sm:text-5xl lg:text-[3.4rem]">
              마케팅을 AI로
              <br />
              진단하고, 계획하고,
              <br />
              만들어요
            </h1>
            <p className="mt-6 max-w-lg text-[17px] leading-8 text-muted-foreground">
              사업자를 위한 AI 마케팅 도우미예요. 지금 마케팅 상태를 점수로 확인하고, 일정을 관리하고, 블로그 글과 숏폼 영상까지 한곳에서 만들어보세요.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg">
                <Link href="/signup">
                  무료로 마케팅 진단받기 <ArrowRight aria-hidden="true" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="#features">기능 둘러보기</Link>
              </Button>
            </div>
            <p className="mt-5 text-sm text-muted-foreground">마케팅 진단과 캘린더는 무료로 쓸 수 있어요</p>
          </div>

          <div className="relative mx-auto w-full max-w-md lg:max-w-none">
            <Mascot pose="hero" size={440} priority className="relative z-10 mx-auto w-[min(72vw,340px)] lg:ml-auto lg:mr-4 lg:w-[400px]" />
            <div className="relative z-20 -mt-14 sm:-mt-20 lg:absolute lg:-bottom-2 lg:left-0 lg:mt-0 lg:w-[300px]">
              <div aria-hidden="true" className="rounded-2xl border border-border bg-card p-4 shadow-[0_18px_44px_-18px_rgb(14_30_69/0.35)]">
                <p className="text-xs font-semibold text-muted-foreground">오늘의 마케팅 점수 (예시)</p>
                <div className="mt-2 flex items-end justify-between">
                  <p className="tabular text-4xl font-extrabold tracking-[-0.04em]">
                    68<span className="ml-1 text-sm font-medium text-muted-foreground">/ 100</span>
                  </p>
                  <span className="rounded-full bg-warning-soft px-2.5 py-1 text-xs font-semibold text-warning">블로그가 비어 있어요</span>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
                  <div className="h-full w-[68%] rounded-full bg-primary" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 핵심 기능 */}
      <section id="features" className="scroll-mt-20 border-b border-border bg-card" aria-labelledby="features-title">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-20">
          <h2 id="features-title" className="max-w-xl text-3xl font-extrabold tracking-[-0.04em] sm:text-4xl">
            마케팅에 필요한 네 가지,
            <br />
            한곳에서 해결해요
          </h2>
          <ul className="mt-10 grid gap-5 sm:grid-cols-2">
            {FEATURES.map((feature) => (
              <li key={feature.title}>
                <Link href={feature.href} className="group flex h-full flex-col rounded-2xl border border-border bg-background p-6 transition-colors hover:border-primary/50 hover:bg-brand-soft/40 sm:p-7">
                  <div className="flex items-start justify-between gap-3">
                    <span className="flex size-12 items-center justify-center rounded-xl bg-brand-soft text-primary"><feature.icon className="size-6" aria-hidden="true" /></span>
                    <Badge variant={feature.free ? "success" : "secondary"}>{feature.free ? "무료" : "이용권으로 제작"}</Badge>
                  </div>
                  <h3 className="mt-5 text-xl font-extrabold tracking-[-0.03em]">{feature.title}</h3>
                  <p className="mt-2 flex-1 text-[15px] leading-7 text-muted-foreground">{feature.description}</p>
                  <span className="mt-5 inline-flex items-center gap-1 text-sm font-semibold text-primary">{feature.cta} <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" aria-hidden="true" /></span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* FAQ */}
      <section className="border-y border-border bg-card" aria-labelledby="faq-title">
        <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 lg:py-20">
          <h2 id="faq-title" className="text-3xl font-extrabold tracking-[-0.04em]">자주 묻는 질문</h2>
          <Accordion type="single" collapsible className="mt-8 divide-y divide-border border-y border-border">
            {FAQS.map((faq) => (
              <AccordionItem key={faq.q} value={faq.q} className="border-0">
                <AccordionTrigger className="py-5 text-left text-base font-bold hover:no-underline">{faq.q}</AccordionTrigger>
                <AccordionContent className="pb-5 text-[15px] leading-7 text-muted-foreground">{faq.a}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </section>

      {/* 마무리 CTA */}
      <section className="bg-ink text-white" aria-labelledby="cta-title">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-8 px-4 py-14 sm:px-6 md:flex-row md:justify-between lg:py-16">
          <div className="max-w-xl text-center md:text-left">
            <h2 id="cta-title" className="text-3xl font-extrabold leading-snug tracking-[-0.04em] sm:text-4xl">
              오늘 가게 주소를 알려주세요.
              <br />
              마케팅 점수부터 확인해드려요.
            </h2>
            <Button asChild variant="spark" size="lg" className="mt-7">
              <Link href="/signup">
                무료로 시작하기 <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
          </div>
          <Mascot pose="welcome" size={220} className="w-[180px] shrink-0 md:w-[220px]" />
        </div>
      </section>
    </div>
  );
}
