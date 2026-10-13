"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Camera, CheckCircle2, CircleOff, RefreshCw, Unplug, Video } from "lucide-react";
import { toast } from "sonner";
import { disconnectIntegration } from "@/app/(app)/settings/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import type { ConnectionStatus, IntegrationProvider, Json } from "@/types/domain";
import { YOUTUBE_ANALYTICS_SCOPE } from "@/lib/youtube-scopes";
import type { IntegrationConfigStatus, OAuthProvider } from "@/server/connectors/config-status";

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
    description="이 연결을 사용하는 자동화는 다음부터 외부 서비스로 결과를 보내지 못할 수 있어요. 언제든 다시 연결할 수 있어요."
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

/** Without the provider's OAuth credentials the button is honestly disabled instead of bouncing the user back with an error. */
function ConnectButton({ configured, href, connected, label }: { configured: boolean; href: string; connected: boolean; label: string }) {
  if (!configured) return <Button type="button" size="sm" variant="outline" disabled aria-disabled="true">연동 준비 중</Button>;
  return <Button asChild size="sm" variant={connected ? "outline" : "default"}><a href={href}>{connected ? <RefreshCw aria-hidden="true" /> : null}{connected ? "다시 연결" : label}</a></Button>;
}

function IntegrationRow({ icon, title, description, connection, setup, children }: { icon: ReactNode; title: string; description: string; connection?: SafeConnection; setup?: ReactNode; children: ReactNode }) {
  return <li className="grid gap-4 px-5 py-5 sm:px-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto] lg:items-center lg:gap-6">
    <div className="flex items-start gap-4">
      <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-primary">{icon}</span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2"><h3 className="font-bold">{title}</h3><StatusBadge connection={connection} /></div>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">{description}</p>
        {setup}
      </div>
    </div>
    <div className="min-w-0 text-sm">
      {connection && connection.status !== "DISCONNECTED" ? <><p className="truncate font-semibold">{connection.account_identifier ?? "계정 연결됨"}</p><p className="text-[13px] text-muted-foreground">마지막 확인 {new Date(connection.updated_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" })}</p></> : <p className="text-muted-foreground">연결된 계정이 없어요.</p>}
    </div>
    <div className="flex flex-wrap items-center gap-2">{children}</div>
  </li>;
}

/** Shown to admins only: which variables and console settings are still missing for this provider. */
function SetupDetails({ provider, status }: { provider: OAuthProvider; status: IntegrationConfigStatus }) {
  const where = provider === "youtube" ? "Google Cloud Console → 사용자 인증 정보 → OAuth 클라이언트(웹 애플리케이션)의 ‘승인된 리디렉션 URI’" : "Meta 개발자 앱 → Instagram API(Instagram 로그인) → 비즈니스 로그인 설정의 ‘OAuth 리디렉션 URL’";
  return <div className="mt-3 rounded-lg border border-dashed bg-muted/40 px-3.5 py-3 text-[13px] leading-6 text-muted-foreground">
    <p className="font-semibold text-foreground">관리자용 설정 안내</p>
    <p>비어 있는 환경변수: <code>{status.missing.join(", ")}</code> (Vercel → Settings → Environment Variables에 넣고 다시 배포)</p>
    <p>{where}에 <code className="break-all">{status.redirectUri}</code> 를 등록해요.</p>
    <p>요청 권한: <code className="break-all">{status.scopes.join(", ")}</code></p>
  </div>;
}

export function IntegrationSettings({ businessId, connections, configStatus, showSetupDetails = false }: { businessId: string; connections: SafeConnection[]; configStatus: Record<OAuthProvider, IntegrationConfigStatus>; showSetupDetails?: boolean }) {
  const get = (provider: IntegrationProvider) => connections.find((connection) => connection.provider === provider && connection.status !== "DISCONNECTED");
  const instagram = get("instagram");
  const youtube = get("youtube");
  const youtubeNeedsAnalyticsConsent = youtube?.status === "CONNECTED" && !String(metadata(youtube.metadata).scope ?? "").split(/\s+/).includes(YOUTUBE_ANALYTICS_SCOPE);

  // Only what the product uses today: YouTube (Shorts posting, growth numbers) and Instagram (Reels).
  return <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
    <IntegrationRow icon={<Video className="size-5" aria-hidden="true" />} title="YouTube" description={youtubeNeedsAnalyticsConsent ? "숏폼을 내 채널에 비공개로 올려요. 조회수·시청 시간·구독자 증감을 성장 리포트에 보려면 ‘다시 연결’에서 Analytics 권한도 허용해주세요." : "숏폼을 내 채널에 비공개로 올리고, 성장 리포트에 조회수·시청 시간·구독자 증감을 보여줘요."} connection={youtube} setup={showSetupDetails && !configStatus.youtube.configured ? <SetupDetails provider="youtube" status={configStatus.youtube} /> : undefined}>
      <ConnectButton configured={configStatus.youtube.configured} href={`/api/integrations/youtube/connect?businessId=${encodeURIComponent(businessId)}`} connected={Boolean(youtube)} label="YouTube 연결" />
      {youtube && <DisconnectButton businessId={businessId} provider="youtube" />}
    </IntegrationRow>
    <IntegrationRow icon={<Camera className="size-5" aria-hidden="true" />} title="인스타그램" description="만든 숏폼을 인스타그램 릴스로 올릴 때 연결해요. 비즈니스·크리에이터 계정이 필요해요." connection={instagram} setup={showSetupDetails && !configStatus.instagram.configured ? <SetupDetails provider="instagram" status={configStatus.instagram} /> : undefined}>
      <ConnectButton configured={configStatus.instagram.configured} href={`/api/integrations/instagram/connect?businessId=${encodeURIComponent(businessId)}`} connected={Boolean(instagram)} label="인스타그램 연결" />
      {instagram && <DisconnectButton businessId={businessId} provider="instagram" />}
    </IntegrationRow>
  </ul>;
}
