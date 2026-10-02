import Link from "next/link";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/page-state";

export default function NotFound() {
  return (
    <main id="main-content" className="mx-auto flex min-h-[70vh] w-full max-w-3xl items-center px-4 py-16">
      <EmptyState
        className="w-full"
        mascot="point"
        title="페이지를 찾을 수 없어요"
        description="주소가 바뀌었거나 볼 수 없는 페이지예요. 홈에서 다시 시작해보세요."
        action={<Button asChild><Link href="/">홈으로 가기</Link></Button>}
      />
    </main>
  );
}
