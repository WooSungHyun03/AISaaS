import Link from "next/link";
import { XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const FRIENDLY_MESSAGES: Record<string, string> = {
  PAY_PROCESS_CANCELED: "결제가 취소되었습니다. 원할 때 다시 시작할 수 있습니다.",
  PAY_PROCESS_ABORTED: "카드 인증을 완료하지 못했습니다. 카드 정보를 확인하고 다시 시도해 주세요.",
  REJECT_CARD_COMPANY: "카드사에서 결제를 승인하지 않았습니다. 다른 카드를 이용해 주세요.",
  CHECKOUT_EXPIRED: "결제 요청 시간이 만료되었습니다. 플랜을 다시 선택해 주세요.",
  CHECKOUT_IN_PROGRESS: "결제를 처리하고 있습니다. 잠시 후 Billing 화면에서 상태를 확인해 주세요.",
  CUSTOMER_KEY_MISMATCH: "결제 요청 검증에 실패했습니다. 플랜을 다시 선택해 주세요.",
  MISSING_API_KEY: "테스트 결제 설정이 완료되지 않았습니다. 관리자에게 문의해 주세요.",
  SUBSCRIPTION_NOT_ACTIVE: "결제는 처리되었지만 구독 상태를 확인하지 못했습니다. 잠시 후 다시 확인해 주세요.",
  CHECKOUT_START_FAILED: "결제 요청을 시작하지 못했습니다. 설정을 확인하거나 잠시 후 다시 시도해 주세요.",
};

export default async function BillingFailPage({ searchParams }: PageProps<"/billing/fail">) {
  const params = await searchParams;
  const rawCode = typeof params.code === "string" ? params.code : "CHECKOUT_FAILED";
  const code = /^[A-Z0-9_]{1,80}$/.test(rawCode) ? rawCode : "CHECKOUT_FAILED";
  const message = FRIENDLY_MESSAGES[code] ?? "결제를 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.";

  return (
    <div className="mx-auto max-w-lg py-10 sm:py-16">
      <Card className="border-red-200">
        <CardHeader className="items-center text-center">
          <XCircle className="mb-2 size-12 text-red-500" />
          <CardTitle>결제가 완료되지 않았습니다</CardTitle>
          <p className="text-sm leading-6 text-muted-foreground">{message}</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg bg-muted px-3 py-2 text-center font-mono text-xs text-muted-foreground">오류 코드: {code}</div>
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
            <Button asChild><Link href="/billing">다시 시도하기</Link></Button>
            <Button asChild variant="outline"><Link href="/dashboard">대시보드로 이동</Link></Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
