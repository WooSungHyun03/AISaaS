"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createSetupRequest, type SetupRequestState } from "@/app/(public)/pricing/actions";

const AUTOMATION_TYPES = [
  { value: "job-postings", label: "채용공고 매일 탐색" },
  { value: "article-collection", label: "관심주제 기사·글 수집" },
  { value: "blog-marketing", label: "블로그 마케팅" },
  { value: "shorts", label: "유튜브 쇼츠 제작" },
  { value: "other", label: "기타 / 잘 모르겠음" },
];

const BUDGET_RANGES = ["10만원 미만", "10~30만원", "30~50만원", "50만원 이상", "상담 후 결정"];

const initialState: SetupRequestState = {};

export function SetupRequestDialog({ isAuthenticated }: { isAuthenticated: boolean }) {
  const [state, formAction, isPending] = useActionState(createSetupRequest, initialState);

  if (!isAuthenticated) {
    return (
      <Button asChild size="lg" className="h-11 rounded-lg bg-blue-600 px-5 text-white hover:bg-blue-700">
        <a href="/login?redirectTo=%2Fpricing%23setup-service">로그인 후 신청하기</a>
      </Button>
    );
  }

  if (state.success) {
    return <p className="text-sm text-slate-200">요청이 접수되었습니다. 빠른 시일 내에 연락드리겠습니다.</p>;
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="lg" className="h-11 rounded-lg bg-blue-600 px-5 text-white hover:bg-blue-700">구축 상담 요청하기</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>자동화 구축 대행 요청</DialogTitle>
          <DialogDescription>필요한 자동화와 예산을 알려주시면 담당자가 연락드립니다.</DialogDescription>
        </DialogHeader>
        <form action={formAction} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="automationType">필요한 자동화</Label>
            <Select name="automationType" required>
              <SelectTrigger id="automationType">
                <SelectValue placeholder="자동화 유형을 선택하세요" />
              </SelectTrigger>
              <SelectContent>
                {AUTOMATION_TYPES.map((type) => (
                  <SelectItem key={type.value} value={type.value}>
                    {type.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="budgetRange">예산 범위</Label>
            <Select name="budgetRange">
              <SelectTrigger id="budgetRange">
                <SelectValue placeholder="선택 (선택사항)" />
              </SelectTrigger>
              <SelectContent>
                {BUDGET_RANGES.map((range) => (
                  <SelectItem key={range} value={range}>
                    {range}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="description">상세 설명</Label>
            <Textarea id="description" name="description" placeholder="사업 소개와 원하는 자동화를 간단히 적어주세요." rows={4} />
          </div>
          {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending ? "요청 중..." : "요청 보내기"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
