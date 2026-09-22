"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { updateAutomation } from "@/app/(app)/automations/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { BLOG_DELIVERY_LABEL, type BlogAutomationConfig } from "@/types/blog-automation";
import type { AutomationSchedule } from "@/types/automation";

type BlogSettings = Pick<BlogAutomationConfig, "objective" | "keywords" | "tone" | "deliveryMode"> & {
  wordpressSiteUrl?: string;
  wordpressUsername?: string;
  hasStoredWordPress: boolean;
  legacy: boolean;
};

const WEEKDAYS = [
  { value: 1, label: "월" }, { value: 2, label: "화" }, { value: 3, label: "수" },
  { value: 4, label: "목" }, { value: 5, label: "금" }, { value: 6, label: "토" }, { value: 0, label: "일" },
];

export function AutomationSettingsDialog({
  automationId, name, businessId, businesses, schedule, blogSettings, hasInFlightRun,
}: {
  automationId: string;
  name: string;
  businessId: string;
  businesses: { id: string; name: string }[];
  schedule: AutomationSchedule;
  blogSettings?: BlogSettings;
  hasInFlightRun: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [frequency, setFrequency] = useState<"DAILY" | "WEEKLY">(schedule.frequency === "DAILY" ? "DAILY" : "WEEKLY");
  const [days, setDays] = useState<number[]>(schedule.daysOfWeek ?? []);
  const [deliveryMode, setDeliveryMode] = useState<BlogAutomationConfig["deliveryMode"]>(blogSettings?.deliveryMode ?? "app_draft");
  const [siteUrl, setSiteUrl] = useState(blogSettings?.wordpressSiteUrl ?? "");
  const [username, setUsername] = useState(blogSettings?.wordpressUsername ?? "");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setError("");
    startTransition(async () => {
      try {
        const result = await updateAutomation(automationId, formData);
        if (result.error) { setError(result.error); return; }
        toast.success("자동화 설정을 저장했습니다.");
        setOpen(false);
        router.refresh();
      } catch {
        setError("설정을 저장하지 못했습니다. 잠시 후 다시 시도해주세요.");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!isPending) { setOpen(nextOpen); setError(""); } }}>
      <DialogTrigger asChild><Button variant="outline" disabled={hasInFlightRun}>설정 수정</Button></DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>자동화 설정 수정</DialogTitle>
          <DialogDescription>저장하면 다음 예약 실행부터 새 설정이 적용됩니다. 현재 실행 중일 때는 완료 후 수정할 수 있습니다.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-6">
          <section className="space-y-4">
            <h3 className="font-medium">기본 정보</h3>
            <div className="space-y-2"><Label htmlFor="edit-automation-name">자동화 이름</Label><Input id="edit-automation-name" name="name" defaultValue={name} maxLength={100} required /></div>
            <div className="space-y-2"><Label htmlFor="edit-automation-business">사업체</Label>
              <select id="edit-automation-business" name="businessId" defaultValue={businessId} className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm">
                {businesses.map((business) => <option key={business.id} value={business.id}>{business.name}</option>)}
              </select>
            </div>
          </section>

          <section className="space-y-4 border-t pt-5">
            <h3 className="font-medium">실행 일정</h3>
            <div className="space-y-2"><Label htmlFor="edit-frequency">주기</Label>
              <select id="edit-frequency" name="frequency" value={frequency} onChange={(event) => setFrequency(event.target.value as "DAILY" | "WEEKLY")} className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm">
                <option value="DAILY">매일</option><option value="WEEKLY">요일 선택</option>
              </select>
            </div>
            {frequency === "WEEKLY" && <fieldset className="space-y-2"><legend className="text-sm font-medium">실행 요일</legend><div className="flex flex-wrap gap-2">
              {WEEKDAYS.map((day) => <button key={day.value} type="button" aria-pressed={days.includes(day.value)} onClick={() => setDays((current) => current.includes(day.value) ? current.filter((value) => value !== day.value) : [...current, day.value])} className={`h-9 w-9 rounded-md border text-sm font-medium ${days.includes(day.value) ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground"}`}>{day.label}</button>)}
            </div></fieldset>}
            {frequency === "WEEKLY" && days.map((day) => <input key={day} type="hidden" name="daysOfWeek" value={day} />)}
            <div className="space-y-2"><Label htmlFor="edit-time">실행 시간 (한국 시간)</Label><Input id="edit-time" name="timeOfDay" type="time" defaultValue={schedule.timeOfDay} required /></div>
          </section>

          {blogSettings && <section className="space-y-4 border-t pt-5">
            <h3 className="font-medium">블로그 글 설정</h3>
            {blogSettings.legacy && <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">이 자동화는 이전 설정 형식입니다. 저장하면 아래 설정이 적용됩니다. WordPress 발행을 계속하려면 연결 정보를 입력해주세요.</p>}
            <div className="space-y-2"><Label htmlFor="edit-objective">게시 목적</Label><Textarea id="edit-objective" name="objective" defaultValue={blogSettings.objective} maxLength={300} rows={3} required /></div>
            <div className="space-y-2"><Label htmlFor="edit-keywords">키워드 (쉼표 또는 줄바꿈으로 구분)</Label><Textarea id="edit-keywords" name="keywords" defaultValue={blogSettings.keywords.join(", ")} rows={2} required /></div>
            <div className="space-y-2"><Label htmlFor="edit-tone">글의 톤</Label><Input id="edit-tone" name="tone" defaultValue={blogSettings.tone} maxLength={100} required /></div>
            <div className="space-y-2"><Label htmlFor="edit-delivery">글 저장 방식</Label>
              <select id="edit-delivery" name="deliveryMode" value={deliveryMode} onChange={(event) => setDeliveryMode(event.target.value as BlogAutomationConfig["deliveryMode"])} className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm">
                {(Object.keys(BLOG_DELIVERY_LABEL) as BlogAutomationConfig["deliveryMode"][]).map((mode) => <option key={mode} value={mode}>{BLOG_DELIVERY_LABEL[mode]}</option>)}
              </select>
              {deliveryMode === "wordpress_publish" && <p className="text-xs text-muted-foreground">Run Now 또는 예약 실행 시 글이 즉시 공개됩니다.</p>}
            </div>
            {deliveryMode !== "app_draft" && <div className="space-y-4 rounded-lg border p-4">
              <p className="text-sm font-medium">WordPress 연결</p>
              <div className="space-y-2"><Label htmlFor="edit-wp-site">사이트 주소</Label><Input id="edit-wp-site" name="wordpressSiteUrl" type="url" value={siteUrl} onChange={(event) => setSiteUrl(event.target.value)} placeholder="https://example.com" required /></div>
              <div className="space-y-2"><Label htmlFor="edit-wp-username">사용자명</Label><Input id="edit-wp-username" name="wordpressUsername" value={username} onChange={(event) => setUsername(event.target.value)} required /></div>
              <div className="space-y-2"><Label htmlFor="edit-wp-password">새 Application Password</Label><Input id="edit-wp-password" name="wordpressAppPassword" type="password" autoComplete="new-password" placeholder={blogSettings.hasStoredWordPress ? "기존 연결 유지 시 비워두세요" : "Application Password 입력"} />
                <p className="text-xs text-muted-foreground">{blogSettings.hasStoredWordPress ? "사이트 주소와 사용자명이 같으면 비워둬도 됩니다. 연결 변경 시 새 비밀번호를 입력하세요." : "WordPress 연결을 처음 설정할 때 필요합니다."}</p>
              </div>
            </div>}
          </section>}

          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <DialogClose asChild><Button type="button" variant="outline" disabled={isPending}>취소</Button></DialogClose>
            <Button type="submit" disabled={isPending || hasInFlightRun}>{isPending ? "저장 중..." : "변경 저장"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
