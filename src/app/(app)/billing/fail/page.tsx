import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Mascot } from "@/components/brand/mascot";
import { getAuthUser } from "@/lib/supabase/server";
import { isAdminUser } from "@/server/admin/access";

const FRIENDLY_MESSAGES: Record<string, string> = {
  PAY_PROCESS_CANCELED: "결제를 취소했어요. 원할 때 다시 시작할 수 있어요.",
  PAY_PROCESS_ABORTED: "카드 인증을 끝내지 못했어요. 카드 정보를 확인하고 다시 시도해 주세요.",
  REJECT_CARD_COMPANY: "카드사에서 결제를 승인하지 않았어요. 다른 카드로 시도해 주세요.",
  CHECKOUT_EXPIRED: "결제 요청 시간이 지났어요. 이용권을 다시 골라주세요.",
  CHECKOUT_IN_PROGRESS: "결제를 처리하고 있어요. 잠시 후 요금제 화면에서 확인해 주세요.",
  CUSTOMER_KEY_MISMATCH: "결제 요청을 확인하지 못했어요. 이용권을 다시 골라주세요.",
  MISSING_API_KEY: "테스트 결제 설정이 아직 끝나지 않았어요. 관리자에게 문의해 주세요.",
  SUBSCRIPTION_NOT_ACTIVE: "결제는 처리됐지만 구독 상태를 확인하지 못했어요. 잠시 후 다시 확인해 주세요.",
  ORDER_NOT_PAID: "결제는 처리됐지만 주문과 이용권 상태를 확인하지 못했어요. 잠시 후 다시 확인해 주세요.",
  ORDER_MISMATCH: "결제 요청과 승인 정보가 일치하지 않아요. 이용권을 다시 골라주세요.",
  AMOUNT_MISMATCH: "결제 금액이 상품 가격과 일치하지 않아요. 이용권을 다시 골라주세요.",
  INVALID_PRODUCT: "선택한 상품을 찾을 수 없어요. 이용권을 다시 골라주세요.",
  CHECKOUT_START_FAILED: "결제 요청을 시작하지 못했어요. 잠시 후 다시 시도해 주세요.",
  BILLING_NOT_CONFIGURED: "결제 설정이 아직 끝나지 않았어요. 서비스 관리자가 결제 설정을 마쳐야 해요. 문의용 코드를 알려주시면 빠르게 확인할게요.",
  BILLING_CLIENT_KEY_MISSING: "결제창을 열 수 있는 설정(토스 클라이언트 키)이 아직 등록되지 않았어요. 서비스 관리자가 등록하면 바로 결제할 수 있어요. 문의용 코드를 알려주세요.",
  BILLING_SECRET_KEY_MISSING: "결제를 승인하는 설정(토스 시크릿 키)이 아직 등록되지 않았어요. 서비스 관리자가 등록하면 바로 결제할 수 있어요. 문의용 코드를 알려주세요.",
  BILLING_KEYS_NOT_TEST: "지금은 테스트 결제만 쓸 수 있어요. 등록된 결제 키가 테스트 키가 아니라서 결제를 시작하지 않았어요. 실제 금액은 청구되지 않았어요.",
  BILLING_PROVIDER_MOCK: "결제 방식이 아직 실제 결제(토스페이먼츠)로 바뀌지 않았어요. 서비스 관리자가 결제 방식을 바꾸면 결제할 수 있어요. 문의용 코드를 알려주세요.",
  BILLING_SCHEMA_OUTDATED: "결제 기능을 준비하는 중이에요. 서비스 관리자가 데이터베이스 업데이트를 마쳐야 해요. 문의용 코드를 알려주시면 빠르게 확인할게요.",
  BILLING_DB_ERROR: "주문을 저장하지 못했어요. 잠시 후 다시 시도해 주세요. 계속되면 문의용 코드를 알려주세요.",
};

/** What an administrator has to change, per code. Shown only to administrators: names of settings, never values. */
const ADMIN_HINTS: Record<string, string> = {
  BILLING_CLIENT_KEY_MISSING: "Vercel 환경변수 NEXT_PUBLIC_TOSS_CLIENT_KEY(또는 TOSS_CLIENT_KEY)에 토스 테스트 클라이언트 키(test_ck_…)를 넣고 다시 배포하세요.",
  BILLING_SECRET_KEY_MISSING: "Vercel 환경변수 TOSS_SECRET_KEY에 토스 테스트 시크릿 키(test_sk_…)를 넣고 다시 배포하세요.",
  BILLING_KEYS_NOT_TEST: "토스 키가 test_ 로 시작하지 않아요. 개발자센터의 테스트 키(test_ck_…, test_sk_…)로 바꾸세요. 라이브 키는 코드가 거절해요.",
  BILLING_PROVIDER_MOCK: "Vercel 환경변수 BILLING_PROVIDER 를 toss 로 바꾸고 다시 배포하세요. (데모 배포라면 ALLOW_MOCK_BILLING=true)",
  BILLING_NOT_CONFIGURED: "BILLING_PROVIDER, TOSS_SECRET_KEY, NEXT_PUBLIC_TOSS_CLIENT_KEY 를 확인하세요. docs/BILLING_SETUP.md 에 순서가 있어요.",
  MISSING_API_KEY: "토스 테스트 클라이언트 키가 없거나 test_ 로 시작하지 않아요. NEXT_PUBLIC_TOSS_CLIENT_KEY 를 확인하세요.",
};

export default async function BillingFailPage({ searchParams }: PageProps<"/billing/fail">) {
  const params = await searchParams;
  const rawCode = typeof params.code === "string" ? params.code : "CHECKOUT_FAILED";
  const code = /^[A-Z0-9_]{1,80}$/.test(rawCode) ? rawCode : "CHECKOUT_FAILED";
  const message = FRIENDLY_MESSAGES[code] ?? "결제를 끝내지 못했어요. 잠시 후 다시 시도해 주세요.";
  const user = await getAuthUser();
  const adminHint = user && ADMIN_HINTS[code] && (await isAdminUser(user.id).catch(() => false)) ? ADMIN_HINTS[code] : null;

  return (
    <div className="mx-auto max-w-lg py-8 text-center sm:py-14">
      <Mascot pose="guide" size={140} className="mx-auto" />
      <h1 className="mt-6 text-2xl font-extrabold tracking-[-0.04em]">결제가 끝나지 않았어요</h1>
      <p role="alert" className="mt-2 text-[15px] leading-7 text-muted-foreground">{message}</p>
      <p className="mx-auto mt-5 w-fit rounded-lg bg-muted px-3 py-1.5 font-mono text-xs text-muted-foreground">문의용 코드 · {code}</p>
      {adminHint ? <p className="mx-auto mt-3 max-w-md rounded-lg border border-dashed px-3 py-2 text-left text-[13px] leading-6 text-muted-foreground"><strong className="text-foreground">관리자 안내</strong> · {adminHint}</p> : null}
      <div className="mt-8 flex flex-col gap-2 sm:flex-row sm:justify-center">
        <Button asChild size="lg"><Link href="/billing">다시 시도하기</Link></Button>
        <Button asChild size="lg" variant="outline"><Link href="/dashboard">홈으로 가기</Link></Button>
      </div>
    </div>
  );
}
