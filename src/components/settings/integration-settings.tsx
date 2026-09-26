"use client";

import { useState, useTransition, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Camera, CheckCircle2, CircleOff, Globe2, Mail, RefreshCw, Unplug } from "lucide-react";
import { toast } from "sonner";
import { connectWordPress, disconnectIntegration, type SettingsActionState } from "@/app/(app)/settings/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

const STATUS_COPY: Record<ConnectionStatus, { label: string; className: string; icon: ReactNode }> = {
  CONNECTED: { label: "CONNECTED", className: "border-emerald-200 bg-emerald-50 text-emerald-700", icon: <CheckCircle2 className="size-3.5" /> },
  EXPIRED: { label: "EXPIRED", className: "border-amber-200 bg-amber-50 text-amber-700", icon: <AlertTriangle className="size-3.5" /> },
  ERROR: { label: "ERROR", className: "border-red-200 bg-red-50 text-red-700", icon: <AlertTriangle className="size-3.5" /> },
  DISCONNECTED: { label: "연결 안 됨", className: "border-slate-200 bg-slate-50 text-slate-600", icon: <CircleOff className="size-3.5" /> },
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
  return <Badge variant="outline" className={copy.className}>{copy.icon}{copy.label}</Badge>;
}

function DisconnectButton({ businessId, provider }: { businessId: string; provider: IntegrationProvider }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  return <Button variant="ghost" size="sm" disabled={isPending} onClick={() => startTransition(async () => {
    try {
      const result = await disconnectIntegration(businessId, provider);
      if (result.error) { toast.error(result.error); return; }
      toast.success("외부 서비스 연결을 해제했습니다.");
      router.refresh();
    } catch {
      toast.error("연결을 해제하지 못했습니다. 잠시 후 다시 시도해주세요.");
    }
  })}><Unplug />{isPending ? "해제 중..." : "연결 해제"}</Button>;
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
        toast.success("WordPress 연결을 확인하고 저장했습니다.");
        setOpen(false);
        router.refresh();
      } catch {
        setError("WordPress 연결을 저장하지 못했습니다. 잠시 후 다시 시도해주세요.");
      }
    });
  }

  return <Dialog open={open} onOpenChange={(value) => { if (!isPending) { setOpen(value); setError(""); } }}>
    <DialogTrigger asChild><Button size="sm" variant={connection ? "outline" : "default"}>{connection ? <RefreshCw /> : null}{connection ? "다시 연결" : "WordPress 연결"}</Button></DialogTrigger>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>WordPress 연결</DialogTitle>
        <DialogDescription>WordPress 사용자 프로필에서 Application Password를 만든 뒤 입력하세요. 저장 전에 연결과 글 작성 권한을 확인합니다.</DialogDescription>
      </DialogHeader>
      <form onSubmit={handleSubmit} className="space-y-4">
        <input type="hidden" name="businessId" value={businessId} />
        <div className="space-y-2"><Label htmlFor="wp-site-url">사이트 주소</Label><Input id="wp-site-url" name="siteUrl" type="url" defaultValue={connection?.account_identifier ?? ""} placeholder="https://example.com" required /></div>
        <div className="space-y-2"><Label htmlFor="wp-username">사용자명</Label><Input id="wp-username" name="username" defaultValue={typeof meta.username === "string" ? meta.username : ""} autoComplete="username" required /></div>
        <div className="space-y-2"><Label htmlFor="wp-app-password">Application Password</Label><Input id="wp-app-password" name="appPassword" type="password" autoComplete="new-password" required /><p className="text-xs text-muted-foreground">기존 비밀번호는 표시하지 않습니다. 다시 연결할 때 새 값을 입력해주세요.</p></div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter><DialogClose asChild><Button type="button" variant="outline" disabled={isPending}>취소</Button></DialogClose><Button type="submit" disabled={isPending}>{isPending ? "연결 확인 중..." : "확인 후 저장"}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}

function IntegrationCard({ icon, title, description, connection, children }: { icon: ReactNode; title: string; description: string; connection?: SafeConnection; children: ReactNode }) {
  return <Card className="flex h-full flex-col">
    <CardHeader className="space-y-4">
      <div className="flex items-start justify-between gap-3"><span className="flex size-10 items-center justify-center rounded-xl bg-slate-100 text-slate-700">{icon}</span><StatusBadge connection={connection} /></div>
      <div><CardTitle className="text-base">{title}</CardTitle><p className="mt-1 text-sm leading-6 text-muted-foreground">{description}</p></div>
    </CardHeader>
    <CardContent className="mt-auto space-y-4">
      <div className="min-h-10 text-sm">
        {connection && connection.status !== "DISCONNECTED" ? <><p className="font-medium">{connection.account_identifier ?? "계정 연결됨"}</p><p className="text-xs text-muted-foreground">최근 확인 {new Date(connection.updated_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })} KST</p></> : <p className="text-muted-foreground">연결된 계정이 없습니다.</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </CardContent>
  </Card>;
}

export function IntegrationSettings({ businessId, connections }: { businessId: string; connections: SafeConnection[] }) {
  const get = (provider: IntegrationProvider) => connections.find((connection) => connection.provider === provider && connection.status !== "DISCONNECTED");
  const wordpress = get("wordpress");
  const instagram = get("instagram");
  const email = get("email");

  return <div className="grid gap-4 md:grid-cols-3">
    <IntegrationCard icon={<Globe2 className="size-5" />} title="WordPress" description="AI가 만든 블로그 글을 초안으로 저장하거나 바로 발행합니다." connection={wordpress}>
      <WordPressDialog businessId={businessId} connection={wordpress} />
      {wordpress && <DisconnectButton businessId={businessId} provider="wordpress" />}
    </IntegrationCard>
    <IntegrationCard icon={<Camera className="size-5" />} title="Instagram" description="Professional 계정을 연결해 게시 자동화를 준비합니다." connection={instagram}>
      <Button asChild size="sm" variant={instagram ? "outline" : "default"}><a href={`/api/integrations/instagram/connect?businessId=${encodeURIComponent(businessId)}`}>{instagram ? <RefreshCw /> : null}{instagram ? "다시 연결" : "Connect Instagram"}</a></Button>
      {instagram && <DisconnectButton businessId={businessId} provider="instagram" />}
    </IntegrationCard>
    <IntegrationCard icon={<Mail className="size-5" />} title="Email" description="뉴스레터 발송용 이메일 서비스의 연결 상태를 확인합니다." connection={email}>
      {email ? <DisconnectButton businessId={businessId} provider="email" /> : <Button size="sm" variant="outline" disabled>연결 준비 중</Button>}
    </IntegrationCard>
  </div>;
}
