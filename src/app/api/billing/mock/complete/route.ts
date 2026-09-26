import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { MockBillingProvider } from "@/server/billing/providers/mock";
import { logger } from "@/lib/logger";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { sessionId?: unknown } | null;
  if (!body || typeof body.sessionId !== "string") {
    return NextResponse.json({ error: "잘못된 결제 요청입니다." }, { status: 400 });
  }

  try {
    const result = await new MockBillingProvider().completeCheckout({ userId: user.id, sessionId: body.sessionId });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "결제 처리에 실패했습니다.";
    logger.error("mock_checkout_complete_failed", { userId: user.id, message });
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
