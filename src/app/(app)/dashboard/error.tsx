"use client";

import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default function DashboardError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div className="mx-auto max-w-2xl py-12">
      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-red-50 text-red-700"><AlertCircle className="size-6" /></span>
          <div>
            <h1 className="text-lg font-semibold">대시보드를 불러오지 못했습니다</h1>
            <p className="mt-2 text-sm text-muted-foreground">잠시 후 다시 시도해주세요. 데이터는 변경되지 않았습니다.</p>
          </div>
          <Button onClick={retry}>다시 시도</Button>
        </CardContent>
      </Card>
    </div>
  );
}
