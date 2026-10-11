import { CalendarClock, Check, Clapperboard, FileText, ReceiptText } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { serverEnv } from "@/lib/env/server";
import { ALL_PRODUCTS, getProductConfig, isProductId, type CreditKind, type ProductConfig } from "@/server/billing/products";
import { getCreditBillingOverview } from "@/server/billing/read-model";
import { Badge } from "@/components/ui/badge";
import { FormMessage } from "@/components/ui/form-message";
import { PageHeader } from "@/components/layout/page-header";
import { BillingSubmitButton } from "@/components/billing/billing-submit-button";
import { cn } from "@/lib/utils";
import { cancelSubscriptionAction, startProductOrder } from "./actions";

const KIND_COPY: Record<CreditKind, { title: string; description: string }> = {
  BLOG: { title: "블로그 포스팅", description: "네이버 블로그에 옮겨 쓸 수 있는 포스팅을 생성해요." },
  SHORTS: { title: "숏폼 제작", description: "세로형 숏폼을 만들고 연결한 채널에 게시해요." },
};

const ORDER_STATUS = {
  PENDING: { label: "결제 대기", variant: "secondary" as const },
  PAID: { label: "결제 완료", variant: "success" as const },
  CANCELED: { label: "취소", variant: "secondary" as const },
  REFUNDED: { label: "환불", variant: "secondary" as const },
};

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "short", day: "numeric" }).format(new Date(value));
}

function ProductCard({ product, selected }: { product: ProductConfig; selected: boolean }) {
  return (
    <article className={cn("flex flex-col rounded-2xl border bg-card p-5", selected && "border-primary ring-2 ring-primary/15")}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-extrabold tracking-[-0.02em]">{product.name}</h3>
          <p className="mt-1 text-sm text-muted-foreground">결제일부터 {product.validityDays}일 동안 사용</p>
        </div>
        {selected ? <Badge variant="brand">선택</Badge> : null}
      </div>
      <p className="tabular mt-5 text-3xl font-extrabold tracking-[-0.04em]">{product.priceKrw.toLocaleString()}원</p>
      <p className="tabular mt-1 text-sm font-semibold text-muted-foreground">1회당 약 {Math.ceil(product.priceKrw / product.credits).toLocaleString()}원</p>
      <ul className="mt-5 flex-1 space-y-2 text-sm">
        <li className="flex items-center gap-2"><Check className="size-4 text-success" aria-hidden="true" />{product.credits}회 제작 크레딧</li>
        <li className="flex items-center gap-2"><Check className="size-4 text-success" aria-hidden="true" />추가 구매 시 크레딧 합산</li>
      </ul>
      <form action={startProductOrder.bind(null, product.id)} className="mt-5">
        <BillingSubmitButton className="w-full" pendingLabel="결제 준비 중…">{product.name} 구매</BillingSubmitButton>
      </form>
    </article>
  );
}

export default async function BillingPage({ searchParams }: PageProps<"/billing">) {
  const params = await searchParams;
  const selectedProduct = typeof params.product === "string" && isProductId(params.product) ? params.product : null;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { balances, orders, legacySubscription } = await getCreditBillingOverview(user.id);
  const isTestBilling = serverEnv.BILLING_PROVIDER === "mock" || serverEnv.TOSS_SECRET_KEY?.startsWith("test_");
  const providerLabel = serverEnv.BILLING_PROVIDER === "toss" ? "토스페이먼츠 테스트" : "모의 결제";
  const hasLegacySubscription = legacySubscription?.status === "ACTIVE" || legacySubscription?.status === "TRIALING";

  return (
    <div className="mx-auto max-w-6xl space-y-10 pb-10">
      <PageHeader title="요금제·결제" description="필요한 제작 횟수만 구매하고, 남은 크레딧과 주문을 한곳에서 확인하세요." />

      {isTestBilling ? (
        <FormMessage variant="info"><strong>테스트 결제 환경 · 실제 청구 없음</strong> · {providerLabel}로 주문부터 크레딧 지급까지 확인할 수 있어요.</FormMessage>
      ) : null}

      <section aria-labelledby="credits-heading" className="space-y-4">
        <div>
          <h2 id="credits-heading" className="text-lg font-extrabold tracking-[-0.03em]">남은 크레딧</h2>
          <p className="mt-1 text-sm text-muted-foreground">유효기간이 남은 크레딧만 합산했어요. 먼저 만료되는 크레딧부터 사용돼요.</p>
        </div>
        <div className="grid gap-px overflow-hidden rounded-2xl border bg-border sm:grid-cols-2">
          {(["BLOG", "SHORTS"] as const).map((kind) => {
            const balance = balances[kind];
            const Icon = kind === "BLOG" ? FileText : Clapperboard;
            return (
              <div key={kind} className="bg-card px-6 py-6">
                <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground"><Icon className="size-4" aria-hidden="true" />{KIND_COPY[kind].title}</div>
                <p className="tabular mt-3 text-4xl font-extrabold tracking-[-0.05em]">{balance.remaining}<span className="ml-1 text-base font-semibold text-muted-foreground">회</span></p>
                <p className="mt-2 flex items-center gap-1.5 text-[13px] text-muted-foreground"><CalendarClock className="size-3.5" aria-hidden="true" />{balance.nextExpiry ? `가장 빠른 만료일 ${formatDate(balance.nextExpiry)}` : "사용 가능한 크레딧이 없어요"}</p>
              </div>
            );
          })}
        </div>
      </section>

      {(["BLOG", "SHORTS"] as const).map((kind) => (
        <section key={kind} aria-labelledby={`products-${kind}`} className="space-y-4">
          <div>
            <h2 id={`products-${kind}`} className="text-lg font-extrabold tracking-[-0.03em]">{KIND_COPY[kind].title} 상품</h2>
            <p className="mt-1 text-sm text-muted-foreground">{KIND_COPY[kind].description}</p>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {ALL_PRODUCTS.filter((product) => product.kind === kind).map((product) => (
              <ProductCard key={product.id} product={product} selected={selectedProduct === product.id} />
            ))}
          </div>
        </section>
      ))}

      <section aria-labelledby="orders-heading" className="space-y-4">
        <div>
          <h2 id="orders-heading" className="flex items-center gap-2 text-lg font-extrabold tracking-[-0.03em]"><ReceiptText className="size-5" aria-hidden="true" />주문 내역</h2>
          <p className="mt-1 text-sm text-muted-foreground">최근 주문 20건을 보여드려요.</p>
        </div>
        {orders.length === 0 ? (
          <div className="rounded-2xl border border-dashed px-6 py-10 text-center text-sm text-muted-foreground">아직 구매한 상품이 없어요.</div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border">
            <table className="w-full min-w-[700px] text-left text-sm">
              <thead className="bg-muted/60 text-[13px] text-muted-foreground"><tr><th className="px-5 py-3 font-semibold">상품</th><th className="px-5 py-3 font-semibold">크레딧</th><th className="px-5 py-3 font-semibold">결제 금액</th><th className="px-5 py-3 font-semibold">상태</th><th className="px-5 py-3 font-semibold">주문일</th></tr></thead>
              <tbody className="divide-y">
                {orders.map((order) => {
                  const productName = isProductId(order.product_id) ? getProductConfig(order.product_id).name : order.product_id;
                  const status = ORDER_STATUS[order.status];
                  return <tr key={order.id}><td className="px-5 py-4 font-semibold">{productName}</td><td className="tabular px-5 py-4">{order.credit_amount}회</td><td className="tabular px-5 py-4">{order.price_krw.toLocaleString()}원</td><td className="px-5 py-4"><Badge variant={status.variant}>{status.label}</Badge></td><td className="tabular px-5 py-4 text-muted-foreground">{formatDate(order.paid_at ?? order.created_at)}</td></tr>;
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {hasLegacySubscription ? (
        <section aria-labelledby="legacy-heading" className="flex flex-col gap-4 rounded-2xl border px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div><h2 id="legacy-heading" className="font-bold">이전 월 구독</h2><p className="mt-1 text-sm text-muted-foreground">{legacySubscription.plan} 구독이 남아 있어요. 종료일 {formatDate(legacySubscription.current_period_end)}</p></div>
          <form action={cancelSubscriptionAction}><BillingSubmitButton variant="outline" pendingLabel="해지하는 중…" confirmMessage="이전 월 구독을 해지할까요?">이전 구독 해지</BillingSubmitButton></form>
        </section>
      ) : null}
    </div>
  );
}
