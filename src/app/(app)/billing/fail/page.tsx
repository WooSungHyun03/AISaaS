import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Mascot } from "@/components/brand/mascot";

const FRIENDLY_MESSAGES: Record<string, string> = {
  PAY_PROCESS_CANCELED: "결제를 취소했어요. 원할 때 다시 시작할 수 있어요.",
  PAY_PROCESS_ABORTED: "카드 인증을 끝내지 못했어요. 카드 정보를 확인하고 다시 시도해 주세요.",
  REJECT_CARD_COMPANY: "카드사에서 결제를 승인하지 않았어요. 다른 카드로 시도해 주세요.",
  CHECKOUT_EXPIRED: "결제 요청 시간이 지났어요. 요금제를 다시 골라주세요.",
  CHECKOUT_IN_PROGRESS: "결제를 처리하고 있어요. 잠시 후 요금제·결제 화면에서 확인해 주세요.",
  CUSTOMER_KEY_MISMATCH: "결제 요청을 확인하지 못했어요. 요금제를 다시 골라주세요.",
  MISSING_API_KEY: "테스트 결제 설정이 아직 끝나지 않았어요. 관리자에게 문의해 주세요.",
  SUBSCRIPTION_NOT_ACTIVE: "결제는 처리됐지만 구독 상태를 확인하지 못했어요. 잠시 후 다시 확인해 주세요.",
  CHECKOUT_START_FAILED: "결제 요청을 시작하지 못했어요. 잠시 후 다시 시도해 주세요.",
};

export default async function BillingFailPage({ searchParams }: PageProps<"/billing/fail">) {
  const params = await searchParams;
  const rawCode = typeof params.code === "string" ? params.code : "CHECKOUT_FAILED";
  const code = /^[A-Z0-9_]{1,80}$/.test(rawCode) ? rawCode : "CHECKOUT_FAILED";
  const message = FRIENDLY_MESSAGES[code] ?? "결제를 끝내지 못했어요. 잠시 후 다시 시도해 주세요.";

  return (
    <div className="mx-auto max-w-lg py-8 text-center sm:py-14">
      <Mascot pose="guide" size={140} className="mx-auto" />
      <h1 className="mt-6 text-2xl font-extrabold tracking-[-0.04em]">결제가 끝나지 않았어요</h1>
      <p role="alert" className="mt-2 text-[15px] leading-7 text-muted-foreground">{message}</p>
      <p className="mx-auto mt-5 w-fit rounded-lg bg-muted px-3 py-1.5 font-mono text-xs text-muted-foreground">문의용 코드 · {code}</p>
      <div className="mt-8 flex flex-col gap-2 sm:flex-row sm:justify-center">
        <Button asChild size="lg"><Link href="/billing">다시 시도하기</Link></Button>
        <Button asChild size="lg" variant="outline"><Link href="/dashboard">홈으로 가기</Link></Button>
      </div>
    </div>
  );
}
