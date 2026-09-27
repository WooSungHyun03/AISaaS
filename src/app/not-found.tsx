import Link from "next/link";
import { SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/page-state";

export default function NotFound() {
  return (
    <main id="main-content" className="mx-auto flex min-h-[70vh] w-full max-w-3xl items-center px-4 py-16">
      <EmptyState
        className="w-full"
        icon={<SearchX className="size-5" />}
        title="요청한 페이지를 찾을 수 없습니다"
        description="주소가 변경되었거나 접근할 수 없는 페이지입니다. 홈에서 다시 시작할 수 있습니다."
        action={<Button asChild><Link href="/">홈으로 이동</Link></Button>}
      />
    </main>
  );
}
