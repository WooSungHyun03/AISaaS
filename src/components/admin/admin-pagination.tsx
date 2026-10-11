import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ADMIN_PAGE_SIZE } from "@/server/admin/operations";

export function AdminPagination({ page, total, href }: { page: number; total: number; href: (page: number) => string }) {
  const pages = Math.max(1, Math.ceil(total / ADMIN_PAGE_SIZE));
  if (pages <= 1) return null;
  return <nav aria-label="페이지 이동" className="flex items-center justify-between border-t px-4 py-3">
    <p className="text-xs text-muted-foreground">{page.toLocaleString()} / {pages.toLocaleString()} 페이지 · 총 {total.toLocaleString()}건</p>
    <div className="flex gap-2">
      <Button asChild variant="outline" size="sm" aria-disabled={page <= 1}><Link href={href(Math.max(1, page - 1))} tabIndex={page <= 1 ? -1 : undefined}><ChevronLeft aria-hidden="true" />이전</Link></Button>
      <Button asChild variant="outline" size="sm" aria-disabled={page >= pages}><Link href={href(Math.min(pages, page + 1))} tabIndex={page >= pages ? -1 : undefined}>다음<ChevronRight aria-hidden="true" /></Link></Button>
    </div>
  </nav>;
}
