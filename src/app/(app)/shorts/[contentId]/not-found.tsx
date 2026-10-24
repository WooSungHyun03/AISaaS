import Link from "next/link";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/page-state";

export default function ShortsContentNotFound() {
  return (
    <div className="mx-auto max-w-3xl">
      <EmptyState
        mascot="guide"
        title="영상을 찾을 수 없어요"
        description="삭제됐거나 주소가 잘못됐을 수 있어요. 내 영상 목록에서 다시 찾아보세요."
        action={<Button asChild><Link href="/shorts/library">내 영상 보기</Link></Button>}
      />
    </div>
  );
}
