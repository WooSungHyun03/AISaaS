import { Activity, Bot, Braces, CheckCircle2, Clapperboard, FileText } from "lucide-react";
import { AdminPagination } from "@/components/admin/admin-pagination";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAdmin } from "@/server/admin/access";
import { getAdminUsage } from "@/server/admin/operations";

const format = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "short", timeStyle: "short" });
function Metric({ label, value, icon: Icon }: { label: string; value: number; icon: typeof Activity }) { return <article className="rounded-2xl border bg-card p-4"><div className="flex items-center justify-between text-sm font-semibold text-muted-foreground"><span>{label}</span><Icon className="size-4 text-primary" /></div><p className="mt-3 text-2xl font-extrabold">{value.toLocaleString()}</p></article>; }
export default async function AdminUsagePage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; q?: string; page?: string }> }) {
  const params = await searchParams;
  const { admin } = await requireAdmin({ action: "ADMIN_USAGE_VIEW", targetType: "route", targetId: "/admin/usage", onDenied: "navigate" });
  const data = await getAdminUsage(admin, { from: params.from, to: params.to, search: params.q, page: Number(params.page) || 1 });
  const href = (page: number) => `/admin/usage?${new URLSearchParams({ ...(params.from ? { from: params.from } : {}), ...(params.to ? { to: params.to } : {}), ...(params.q ? { q: params.q } : {}), ...(page > 1 ? { page: String(page) } : {}) })}`;
  return <div className="space-y-6"><PageHeader title="서비스 사용량" description="자동화 실행 행에서 AI 생성과 외부 API 호출 수를 집계합니다." />
    <form className="flex flex-wrap items-end gap-2"><label className="space-y-1 text-xs font-semibold">사용자 이메일<Input name="q" defaultValue={params.q} placeholder="이메일 검색" /></label><label className="space-y-1 text-xs font-semibold">시작일<Input type="date" name="from" defaultValue={params.from} /></label><label className="space-y-1 text-xs font-semibold">종료일<Input type="date" name="to" defaultValue={params.to} /></label><Button type="submit" variant="outline">조건 적용</Button></form>
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6"><Metric label="전체 실행" value={data.summary.runs} icon={Activity} /><Metric label="성공" value={data.summary.successfulRuns} icon={CheckCircle2} /><Metric label="AI 생성" value={data.summary.aiGenerations} icon={Bot} /><Metric label="외부 API" value={data.summary.externalApiCalls} icon={Braces} /><Metric label="블로그" value={data.summary.blogRuns} icon={FileText} /><Metric label="숏폼" value={data.summary.shortsRuns} icon={Clapperboard} /></section>
    <section className="overflow-hidden rounded-2xl border bg-card"><Table><TableHeader><TableRow><TableHead>일시</TableHead><TableHead>사용자</TableHead><TableHead>기능</TableHead><TableHead>상태</TableHead><TableHead>AI</TableHead><TableHead>외부 API</TableHead></TableRow></TableHeader><TableBody>{data.items.map((item) => <TableRow key={item.id}><TableCell>{format.format(new Date(item.created_at))}</TableCell><TableCell>{item.userEmail}</TableCell><TableCell>{item.feature}<br /><span className="text-xs text-muted-foreground">{item.automationName}</span></TableCell><TableCell><Badge variant={item.status === "SUCCESS" ? "success" : item.status === "FAILED" ? "destructive" : "secondary"}>{item.status}</Badge></TableCell><TableCell>{item.ai_generation_count}</TableCell><TableCell>{item.external_api_call_count}</TableCell></TableRow>)}</TableBody></Table>{data.items.length === 0 && <p className="p-10 text-center text-sm text-muted-foreground">선택한 기간의 사용량이 없습니다.</p>}<AdminPagination page={data.page} total={data.total} href={href} /></section>
  </div>;
}
