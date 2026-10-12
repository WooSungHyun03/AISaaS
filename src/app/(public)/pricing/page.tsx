import Link from "next/link";
import { ArrowRight, Check, Clapperboard, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Mascot } from "@/components/brand/mascot";
import { ALL_PRODUCTS, type CreditKind, type ProductConfig } from "@/server/billing/products";
import { createClient } from "@/lib/supabase/server";
import { serverEnv } from "@/lib/env/server";
import { startProductOrder } from "@/app/(app)/billing/actions";

export const metadata = { title: "요금제" };

const KIND_COPY: Record<CreditKind, { title: string; description: string }> = {
  BLOG: { title: "블로그 포스팅", description: "네이버 블로그용 글을 필요한 횟수만 구매하세요." },
  SHORTS: { title: "숏폼 제작", description: "세로형 캐릭터 숏폼 영상 제작에 사용해요." },
};

function ProductAction({ product, isAuthenticated }: { product: ProductConfig; isAuthenticated: boolean }) {
  if (!isAuthenticated) {
    return (
      <Button asChild size="lg" className="w-full">
        <Link href={`/login?redirectTo=${encodeURIComponent(`/billing?product=${product.id}`)}`}>로그인하고 구매 <ArrowRight aria-hidden="true" /></Link>
      </Button>
    );
  }
  return (
    <form action={startProductOrder.bind(null, product.id)}>
      <Button type="submit" size="lg" className="w-full">{product.name} 구매 <ArrowRight aria-hidden="true" /></Button>
    </form>
  );
}

export default async function PricingPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const isTestBilling = serverEnv.BILLING_PROVIDER === "mock" || serverEnv.TOSS_SECRET_KEY?.startsWith("test_");

  return (
    <>
      <section className="border-b bg-brand-soft/60" aria-labelledby="pricing-title">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-6 px-4 py-14 text-center sm:px-6 lg:flex-row lg:justify-between lg:py-16 lg:text-left">
          <div className="max-w-2xl">
            <h1 id="pricing-title" className="text-4xl font-extrabold leading-[1.2] tracking-[-0.045em] sm:text-5xl">필요한 콘텐츠만,<br className="hidden sm:block" /> 필요한 횟수만 구매하세요</h1>
            <p className="mt-5 text-base leading-7 text-muted-foreground sm:text-lg">마케팅 진단과 캘린더는 무료예요. 블로그와 숏폼은 월 구독 없이 필요한 제작 횟수를 골라 사용할 수 있어요.</p>
          </div>
          <Mascot pose="present" size={200} priority className="shrink-0" />
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6" aria-labelledby="free-title">
        <div className="rounded-2xl border bg-card p-6 sm:p-8">
          <div className="flex flex-wrap items-center gap-3"><h2 id="free-title" className="text-2xl font-extrabold tracking-[-0.03em]">무료 기능</h2><Badge variant="success">계속 무료</Badge></div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {["홈페이지·SNS 마케팅 진단", "날짜별 마케팅 캘린더"].map((feature) => <p key={feature} className="flex items-center gap-2 text-[15px]"><Check className="size-4 text-success" aria-hidden="true" />{feature}</p>)}
          </div>
          <Button asChild variant="outline" size="lg" className="mt-6"><Link href={user ? "/diagnosis" : "/signup"}>무료로 시작하기 <ArrowRight aria-hidden="true" /></Link></Button>
        </div>
      </section>

      {(["BLOG", "SHORTS"] as const).map((kind) => {
        const Icon = kind === "BLOG" ? FileText : Clapperboard;
        return (
          <section key={kind} className="mx-auto max-w-6xl px-4 pb-14 sm:px-6" aria-labelledby={`pricing-${kind}`}>
            <div className="mb-6">
              <h2 id={`pricing-${kind}`} className="flex items-center gap-2 text-2xl font-extrabold tracking-[-0.03em] sm:text-3xl"><Icon className="size-6 text-primary" aria-hidden="true" />{KIND_COPY[kind].title}</h2>
              <p className="mt-2 text-muted-foreground">{KIND_COPY[kind].description}</p>
            </div>
            <div className="grid gap-4 lg:grid-cols-3">
              {ALL_PRODUCTS.filter((product) => product.kind === kind).map((product, index) => (
                <article key={product.id} className="flex flex-col rounded-2xl border bg-card p-6 sm:p-7">
                  <div className="flex min-h-7 items-start justify-between gap-3"><h3 className="text-xl font-extrabold tracking-[-0.03em]">{product.credits}회</h3>{index === 1 ? <Badge variant="spark">추천</Badge> : null}</div>
                  <p className="tabular mt-4 text-4xl font-extrabold tracking-[-0.05em]">{product.priceKrw.toLocaleString()}원</p>
                  <p className="tabular mt-1 text-sm text-muted-foreground">1회당 약 {Math.ceil(product.priceKrw / product.credits).toLocaleString()}원</p>
                  <ul className="my-6 flex-1 space-y-2.5 text-[15px]"><li className="flex gap-2"><Check className="mt-0.5 size-4 text-success" aria-hidden="true" />{product.name}</li><li className="flex gap-2"><Check className="mt-0.5 size-4 text-success" aria-hidden="true" />결제일부터 {product.validityDays}일</li><li className="flex gap-2"><Check className="mt-0.5 size-4 text-success" aria-hidden="true" />추가 구매 시 잔여 횟수 합산</li></ul>
                  <ProductAction product={product} isAuthenticated={Boolean(user)} />
                </article>
              ))}
            </div>
          </section>
        );
      })}

      <section className="border-t bg-muted/30">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-8 text-[13px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>모든 상품 가격·횟수·유효기간은 결제 화면과 동일하게 적용돼요.{isTestBilling ? " 현재는 테스트 결제 환경이며 실제 청구되지 않아요." : ""}</p>
          <Link href="/billing" className="inline-flex shrink-0 items-center gap-1 font-semibold text-primary hover:underline">잔여 이용권과 주문 보기 <ArrowRight className="size-3.5" aria-hidden="true" /></Link>
        </div>
      </section>
    </>
  );
}
