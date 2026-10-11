import { AlertTriangle, Search } from "lucide-react";
import { AdminPagination } from "@/components/admin/admin-pagination";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { requireAdmin } from "@/server/admin/access";
import { listAdminErrors } from "@/server/admin/operations";

const format = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "medium", timeStyle: "short" });
export default async function AdminErrorsPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const params = await searchParams;
  const { admin } = await requireAdmin({ action: "ADMIN_ERRORS_VIEW", targetType: "route", targetId: "/admin/errors", onDenied: "navigate" });
  const data = await listAdminErrors(admin, { search: params.q, page: Number(params.page) || 1 });
  const href = (page: number) => `/admin/errors?${new URLSearchParams({ ...(params.q ? { q: params.q } : {}), ...(page > 1 ? { page: String(page) } : {}) })}`;
  return <div className="space-y-6"><PageHeader title="최근 실패 작업" description="자동화 실행 오류를 사용자와 작업 단위로 확인합니다. 입력값과 비밀정보는 표시하지 않습니다." />
    <form className="flex max-w-xl gap-2"><Input name="q" defaultValue={params.q} placeholder="사용자 이메일" /><Button type="submit" variant="outline"><Search />검색</Button></form>
    <section className="overflow-hidden rounded-2xl border bg-card">{data.items.length ? <ul className="divide-y">{data.items.map((item) => <li key={item.id} className="p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-bold">{item.automationName}</p><p className="text-xs text-muted-foreground">{item.userEmail} · {format.format(new Date(item.completed_at ?? item.created_at))}</p></div><Badge variant="destructive">FAILED</Badge></div><p className="mt-3 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{item.error_message ?? "오류 상세가 기록되지 않았습니다."}</p><p className="mt-2 text-xs text-muted-foreground">실행 ID {item.id} · {item.source}</p></li>)}</ul> : <div className="p-10 text-center text-sm text-muted-foreground"><AlertTriangle className="mx-auto mb-3 size-7" />실패 작업이 없습니다.</div>}<AdminPagination page={data.page} total={data.total} href={href} /></section>
  </div>;
}
