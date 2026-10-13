"use client";

import { useActionState } from "react";
import { LoaderCircle, RefreshCw } from "lucide-react";
import type { AdminActionState } from "@/app/(admin)/admin/users/[id]/actions";
import { Button } from "@/components/ui/button";

const initialState: AdminActionState = { ok: false, message: "" };

export function CollectNowForm({ action }: { action: (state: AdminActionState) => Promise<AdminActionState> }) {
  const [state, formAction, pending] = useActionState(action, initialState);
  return (
    <form action={formAction} className="space-y-2" onSubmit={(event) => { if (!window.confirm("등록된 모든 채널의 공개 지표를 지금 수집할까요? YouTube API 할당량을 사용합니다.")) event.preventDefault(); }}>
      <Button type="submit" disabled={pending}>
        {pending ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}지금 수집
      </Button>
      {state.message && <p role="status" className={state.ok ? "text-sm text-success" : "text-sm text-destructive"}>{state.message}</p>}
    </form>
  );
}
