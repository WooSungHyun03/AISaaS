"use client";

import { useState, useTransition, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Camera, CheckCircle2, CircleOff, Globe2, Mail, RefreshCw, Unplug } from "lucide-react";
import { toast } from "sonner";
import { connectWordPress, disconnectIntegration, type SettingsActionState } from "@/app/(app)/settings/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form-message";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import type { ConnectionStatus, IntegrationProvider, Json } from "@/types/domain";

export interface SafeConnection {
  id: string;
  provider: IntegrationProvider;
  account_identifier: string | null;
  status: ConnectionStatus;
  metadata: Json;
  connected_at: string;
  updated_at: string;
}

const STATUS_COPY: Record<ConnectionStatus, { label: string; variant: "success" | "warning" | "destructive" | "secondary"; icon: ReactNode }> = {
  CONNECTED: { label: "연결됨", variant: "success", icon: <CheckCircle2 className="size-3.5" aria-hidden="true" /> },
  EXPIRED: { label: "다시 연결 필요", variant: "warning", icon: <AlertTriangle className="size-3.5" aria-hidden="true" /> },
  ERROR: { label: "오류", variant: "destructive", icon: <AlertTriangle className="size-3.5" aria-hidden="true" /> },
  DISCONNECTED: { label: "연결 안 됨", variant: "secondary", icon: <CircleOff className="size-3.5" aria-hidden="true" /> },
};

function metadata(value: Json): Record<string, Json | undefined> {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function displayStatus(connection?: SafeConnection): ConnectionStatus {
  if (!connection) return "DISCONNECTED";
  const expiresAt = metadata(connection.metadata).expiresAt;
  if (connection.status === "CONNECTED" && typeof expiresAt === "string" && Date.parse(expiresAt) <= Date.now()) return "EXPIRED";
  return connection.status;
}

function StatusBadge({ connection }: { connection?: SafeConnection }) {
  const status = displayStatus(connection);
  const copy = STATUS_COPY[status];
  return <Badge variant={copy.variant}>{copy.icon}{copy.label}</Badge>;
}

function DisconnectButton({ businessId, provider }: { businessId: string; provider: IntegrationProvider }) {
  const router = useRouter();
  return <ConfirmationDialog
    trigger={<Button type="button" variant="ghost" size="sm"><Unplug aria-hidden="true" />연결 해제</Button>}
    title="연결을 해제할까요?"
    description="이 연결을 쓰는 만들기 설정은 다음부터 WordPress로 글을 보내지 못할 수 있어요. 언제든 다시 연결할 수 있어요."
    confirmLabel="해제하기"
    pendingLabel="해제하는 중…"
    destructive
    onConfirm={async () => {
      let errorShown = false;
      try {
        const result = await disconnectIntegration(businessId, provider);
        if (result.error) {
          toast.error(result.error);
          errorShown = true;
          throw new Error(result.error);
        }
        toast.success("연결을 해제했어요.");
        router.refresh();
      } catch (error) {
        if (!errorShown) toast.error("연결을 해제하지 못했어요. 잠시 후 다시 시도해주세요.");
        throw error;
      }
    }}
  />;
}

function WordPressDialog({ businessId, connection }: { businessId: string; connection?: SafeConnection }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const meta = connection ? metadata(connection.metadata) : {};

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setError("");
    startTransition(async () => {
      try {
        const result: SettingsActionState = await connectWordPress({}, formData);
        if (result.error) { setError(result.error); return; }
        toast.success("WordPress 연결을 확인하고 저장했어요.");
        setOpen(false);
        router.refresh();
      } catch {
        setError("WordPress 연결을 저장하지 못했어요. 잠시 후 다시 시도해주세요.");
      }
    });
  }

  return <Dialog open={open} onOpenChange={(value) => { if (!isPending) { setOpen(value); setError(""); } }}>
    <DialogTrigger asChild><Button size="sm" variant={connection ? "outline" : "default"}>{connection ? <RefreshCw aria-hidden="true" /> : null}{connection ? "다시 연결" : "WordPress 연결"}</Button></DialogTrigger>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>WordPress 연결</DialogTitle>
        <DialogDescription>WordPress 사용자 프로필에서 Application Password를 만들어 입력하세요. 저장하기 전에 연결과 글 작성 권한을 확인해요.</DialogDescription>
      </DialogHeader>
      <form onSubmit={handleSubmit} className="space-y-4">
        <input type="hidden" name="businessId" value={businessId} />
        <div className="space-y-2"><Label htmlFor="wp-site-url">사이트 주소</Label><Input id="wp-site-url" name="siteUrl" type="url" autoComplete="url" spellCheck={false} defaultValue={connection?.account_identifier ?? ""} placeholder="https://example.com" required /></div>
        <div className="space-y-2"><Label htmlFor="wp-username">사용자명</Label><Input id="wp-username" name="username" defaultValue={typeof meta.username === "string" ? meta.username : ""} autoComplete="username" required /></div>
        <div className="space-y-2"><Label htmlFor="wp-app-password">Application Password</Label><Input id="wp-app-password" name="appPassword" type="password" autoComplete="new-password" required /><p className="text-xs text-muted-foreground">저장된 비밀번호는 보여주지 않아요. 다시 연결할 땐 새로 입력해주세요.</p></div>
        {error && <FormMessage>{error}</FormMessage>}
        <DialogFooter><DialogClose asChild><Button type="button" variant="outline" disabled={isPending}>취소</Button></DialogClose><Button type="submit" disabled={isPending}>{isPending ? "연결 확인하는 중…" : "확인하고 저장"}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}

function IntegrationRow({ icon, title, description, connection, children }: { icon: ReactNode; title: string; description: string; connection?: SafeConnection; children: ReactNode }) {
  return <li className="grid gap-4 px-5 py-5 sm:px-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto] lg:items-center lg:gap-6">
    <div className="flex items-start gap-4">
      <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-primary">{icon}</span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2"><h3 className="font-bold">{title}</h3><StatusBadge connection={connection} /></div>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">{description}</p>
      </div>
    </div>
    <div className="min-w-0 text-sm">
      {connection && connection.status !== "DISCONNECTED" ? <><p className="truncate font-semibold">{connection.account_identifier ?? "계정 연결됨"}</p><p className="text-[13px] text-muted-foreground">마지막 확인 {new Date(connection.updated_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" })}</p></> : <p className="text-muted-foreground">연결된 계정이 없어요.</p>}
    </div>
    <div className="flex flex-wrap items-center gap-2">{children}</div>
  </li>;
}

export function IntegrationSettings({ businessId, connections }: { businessId: string; connections: SafeConnection[] }) {
  const get = (provider: IntegrationProvider) => connections.find((connection) => connection.provider === provider && connection.status !== "DISCONNECTED");
  const wordpress = get("wordpress");
  const instagram = get("instagram");
  const email = get("email");

  return <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
    <IntegrationRow icon={<Globe2 className="size-5" aria-hidden="true" />} title="WordPress" description="만든 블로그 글을 내 WordPress에 초안으로 보내고 싶을 때 연결해요." connection={wordpress}>
      <WordPressDialog businessId={businessId} connection={wordpress} />
      {wordpress && <DisconnectButton businessId={businessId} provider="wordpress" />}
    </IntegrationRow>
    <IntegrationRow icon={<Camera className="size-5" aria-hidden="true" />} title="인스타그램" description="비즈니스·크리에이터 계정을 연결해 두면 콘텐츠를 만들 때 참고해요." connection={instagram}>
      <Button asChild size="sm" variant={instagram ? "outline" : "default"}><a href={`/api/integrations/instagram/connect?businessId=${encodeURIComponent(businessId)}`}>{instagram ? <RefreshCw aria-hidden="true" /> : null}{instagram ? "다시 연결" : "인스타그램 연결"}</a></Button>
      {instagram && <DisconnectButton businessId={businessId} provider="instagram" />}
    </IntegrationRow>
    <IntegrationRow icon={<Mail className="size-5" aria-hidden="true" />} title="이메일" description="뉴스레터용 이메일 서비스 연결 상태를 확인해요." connection={email}>
      {email ? <DisconnectButton businessId={businessId} provider="email" /> : <Button size="sm" variant="outline" disabled>준비 중</Button>}
    </IntegrationRow>
  </ul>;
}
