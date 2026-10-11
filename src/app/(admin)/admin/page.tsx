import Link from "next/link";
import { Activity, Banknote, CircleAlert, Clapperboard, FileText, MessageCircleQuestion, ReceiptText, RotateCcw, ShieldCheck, Users } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/page-state";
import { requireAdmin } from "@/server/admin/access";
import { getAdminDashboardData } from "@/server/admin/dashboard";

export const metadata = { title: "관리자 대시보드" };

const dateFormat = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

function MetricCard({ label, value, description, icon: Icon }: { label: string; value: number; description: string; icon: typeof Users }) {
  return <article className="rounded-2xl border bg-card p-5"><div className="flex items-center justify-between gap-3"><span className="text-sm font-semibold text-muted-foreground">{label}</span><span className="flex size-9 items-center justify-center rounded-xl bg-brand-soft text-primary"><Icon className="size-4" aria-hidden="true" /></span></div><p className="tabular mt-4 text-3xl font-extrabold tracking-[-0.04em]">{value.toLocaleString()}</p><p className="mt-1 text-xs text-muted-foreground">{description}</p></article>;
}

function Section({ title, icon: Icon, children, action }: { title: string; icon: typeof Users; children: React.ReactNode; action?: React.ReactNode }) {
  return <section className="overflow-hidden rounded-2xl border bg-card"><div className="flex items-center justify-between gap-3 border-b px-5 py-4"><h2 className="flex items-center gap-2 font-extrabold tracking-[-0.02em]"><Icon className="size-4 text-primary" aria-hidden="true" />{title}</h2>{action}</div>{children}</section>;
}

function EmptyRows({ label }: { label: string }) {
  return <div className="px-5 py-8 text-center text-sm text-muted-foreground">최근 {label} 내역이 없어요.</div>;
}

export default async function AdminDashboardPage() {
  const { admin } = await requireAdmin({ action: "ADMIN_DASHBOARD_VIEW", targetType: "route", targetId: "/admin", onDenied: "navigate" });
  const data = await getAdminDashboardData(admin);

  return (
    <div className="space-y-8">
      <PageHeader title="관리자 대시보드" description="사용자·결제·콘텐츠 생성과 운영 이슈를 한곳에서 확인합니다." actions={<Badge variant="brand"><ShieldCheck aria-hidden="true" />보안 영역</Badge>} />

      <section aria-label="서비스 주요 지표" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <MetricCard label="총 사용자" value={data.counts.totalUsers} description="가입 프로필 기준" icon={Users} />
        <MetricCard label="활성 사용자" value={data.counts.activeUsers} description="최근 30일 제작 활동" icon={Activity} />
        <MetricCard label="유료 사용자" value={data.counts.paidUsers} description="결제 완료 주문 보유" icon={Banknote} />
        <MetricCard label="블로그 생성" value={data.counts.blogGenerations} description="전체 생성 콘텐츠" icon={FileText} />
        <MetricCard label="숏폼 생성" value={data.counts.shortsGenerations} description="전체 생성 콘텐츠" icon={Clapperboard} />
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        <Section title="최근 결제" icon={ReceiptText}>
          {data.recentPayments.length === 0 ? <EmptyRows label="결제" /> : <ul className="divide-y">{data.recentPayments.map((item) => <li key={item.id} className="flex items-center justify-between gap-4 px-5 py-4"><div className="min-w-0"><p className="truncate text-sm font-semibold">{item.productName}</p><p className="truncate text-xs text-muted-foreground">{item.userEmail} · {dateFormat.format(new Date(item.createdAt))}</p></div><div className="text-right"><p className="tabular text-sm font-bold">{item.amountKrw.toLocaleString()}원</p><Badge variant={item.status === "PAID" ? "success" : "secondary"}>{item.status}</Badge></div></li>)}</ul>}
        </Section>

        <Section title="최근 실행 오류" icon={CircleAlert}>
          {data.recentErrors.length === 0 ? <EmptyRows label="오류" /> : <ul className="divide-y">{data.recentErrors.map((item) => <li key={item.id} className="px-5 py-4"><div className="flex items-start justify-between gap-3"><p className="font-semibold">{item.automationName}</p><time className="tabular shrink-0 text-xs text-muted-foreground">{dateFormat.format(new Date(item.createdAt))}</time></div><p className="mt-1 line-clamp-2 text-sm text-destructive">{item.message}</p><p className="mt-1 truncate text-xs text-muted-foreground">{item.userEmail}</p></li>)}</ul>}
        </Section>

        <Section title="최근 환불 요청" icon={RotateCcw}>
          {data.recentRefunds.length === 0 ? <EmptyRows label="환불 요청" /> : <ul className="divide-y">{data.recentRefunds.map((item) => <li key={item.id} className="flex items-center justify-between gap-4 px-5 py-4"><div className="min-w-0"><p className="truncate text-sm font-semibold">{item.productName}</p><p className="truncate text-xs text-muted-foreground">{item.userEmail} · {dateFormat.format(new Date(item.createdAt))}</p></div><div className="text-right"><p className="tabular text-sm font-bold">{item.expectedRefundKrw.toLocaleString()}원</p><Badge variant="warning">{item.status}</Badge></div></li>)}</ul>}
        </Section>

        <Section title="최근 문의" icon={MessageCircleQuestion} action={<Link href="/admin/inquiries" className="text-xs font-semibold text-primary hover:underline">전체 보기</Link>}>
          {data.recentInquiries.length === 0 ? <EmptyRows label="문의" /> : <ul className="divide-y">{data.recentInquiries.map((item) => <li key={item.id}><Link href={`/admin/inquiries/${item.id}`} className="block px-5 py-4 hover:bg-muted/50"><div className="flex items-start justify-between gap-3"><p className="truncate font-semibold">{item.subject}</p><Badge variant="secondary">{item.status}</Badge></div><p className="mt-1 truncate text-xs text-muted-foreground">{item.category} · {item.userEmail} · {dateFormat.format(new Date(item.createdAt))}</p></Link></li>)}</ul>}
        </Section>
      </div>

      <Section title="최근 관리자 감사 로그" icon={ShieldCheck}>
        {data.recentAudit.length === 0 ? <EmptyState icon={<ShieldCheck className="size-6" />} title="감사 기록이 없어요" description="관리자 화면 접근과 변경 작업이 여기에 기록됩니다." className="rounded-none border-0" /> : <ul className="divide-y">{data.recentAudit.map((item) => <li key={item.id} className="grid gap-1 px-5 py-3 text-sm sm:grid-cols-[1fr_1fr_auto]"><span className="font-semibold">{item.action}</span><span className="truncate text-muted-foreground">{item.actorEmail} · {item.targetType}</span><time className="tabular text-xs text-muted-foreground">{dateFormat.format(new Date(item.createdAt))}</time></li>)}</ul>}
      </Section>
    </div>
  );
}

