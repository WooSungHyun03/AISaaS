import Link from "next/link";
import { Search, Users } from "lucide-react";
import { AdminPagination } from "@/components/admin/admin-pagination";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAdmin } from "@/server/admin/access";
import { listAdminUsers } from "@/server/admin/operations";

export const metadata = { title: "사용자 관리" };
export default async function AdminUsersPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const params = await searchParams;
  const { admin } = await requireAdmin({ action: "ADMIN_USERS_VIEW", targetType: "route", targetId: "/admin/users", onDenied: "navigate" });
  const data = await listAdminUsers(admin, { search: params.q, page: Number(params.page) || 1 });
  const href = (page: number) => `/admin/users?${new URLSearchParams({ ...(params.q ? { q: params.q } : {}), ...(page > 1 ? { page: String(page) } : {}) })}`;
  return <div className="space-y-6">
    <PageHeader title="사용자" description="이메일로 사용자를 찾고 이용권, 잔여 크레딧, 계정 상태를 확인합니다." />
    <form className="flex max-w-xl gap-2"><Input name="q" defaultValue={params.q} placeholder="이메일 검색" aria-label="사용자 이메일 검색" /><Button type="submit" variant="outline"><Search aria-hidden="true" />검색</Button></form>
    <section className="overflow-hidden rounded-2xl border bg-card">
      {data.items.length === 0 ? <div className="p-10 text-center text-sm text-muted-foreground"><Users className="mx-auto mb-3 size-7" />검색된 사용자가 없습니다.</div> : <Table><TableHeader><TableRow><TableHead>사용자</TableHead><TableHead>상품</TableHead><TableHead>블로그</TableHead><TableHead>숏폼</TableHead><TableHead>상태</TableHead><TableHead /></TableRow></TableHeader><TableBody>{data.items.map((item) => <TableRow key={item.id}><TableCell><p className="font-semibold">{item.email}</p><p className="text-xs text-muted-foreground">{item.displayName ?? "이름 미입력"}</p></TableCell><TableCell className="max-w-56 truncate">{[...new Set(item.products)].join(", ") || "구매 없음"}</TableCell><TableCell>{item.balances.BLOG}회</TableCell><TableCell>{item.balances.SHORTS}회</TableCell><TableCell><Badge variant={item.accountStatus === "ACTIVE" ? "success" : "destructive"}>{item.accountStatus === "ACTIVE" ? "활성" : "정지"}</Badge></TableCell><TableCell><Button asChild size="sm" variant="outline"><Link href={`/admin/users/${item.id}`}>상세</Link></Button></TableCell></TableRow>)}</TableBody></Table>}
      <AdminPagination page={data.page} total={data.total} href={href} />
    </section>
  </div>;
}
