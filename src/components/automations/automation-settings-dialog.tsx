"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { updateAutomation } from "@/app/(app)/automations/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { ScheduleFields, ScheduleHiddenInputs, scheduleToValue } from "@/components/automations/schedule-fields";
import { FormMessage } from "@/components/ui/form-message";
import { Textarea } from "@/components/ui/textarea";
import { BLOG_DELIVERY_LABEL, type BlogAutomationConfig } from "@/types/blog-automation";
import type { AutomationSchedule } from "@/types/automation";

type BlogSettings = Pick<BlogAutomationConfig, "objective" | "keywords" | "tone" | "deliveryMode"> & {
  wordpressSiteUrl?: string;
  wordpressUsername?: string;
  hasStoredWordPress: boolean;
  legacy: boolean;
};

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
  const [scheduleValue, setScheduleValue] = useState(() => scheduleToValue(schedule));
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
        toast.success("설정을 저장했어요.");
        setOpen(false);
        router.refresh();
      } catch {
        setError("설정을 저장하지 못했어요. 잠시 후 다시 시도해주세요.");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!isPending) { setOpen(nextOpen); setError(""); } }}>
      <DialogTrigger asChild><Button variant="outline" disabled={hasInFlightRun}>설정 수정</Button></DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>만들기 설정 수정</DialogTitle>
          <DialogDescription>저장하면 다음 제작부터 새 설정이 적용돼요. 지금 만드는 중이면 끝난 뒤에 수정할 수 있어요.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-6">
          <section className="space-y-4">
            <h3 className="text-[15px] font-bold">기본 정보</h3>
            <div className="space-y-2"><Label htmlFor="edit-automation-name">설정 이름</Label><Input id="edit-automation-name" name="name" defaultValue={name} maxLength={100} required /></div>
            <div className="space-y-2"><Label htmlFor="edit-automation-business">사업체</Label>
              <NativeSelect id="edit-automation-business" name="businessId" defaultValue={businessId}>
                {businesses.map((business) => <option key={business.id} value={business.id}>{business.name}</option>)}
              </NativeSelect>
            </div>
          </section>

          <section className="space-y-4 border-t pt-5">
            <h3 className="text-[15px] font-bold">만드는 때</h3>
            <ScheduleFields idPrefix="edit" value={scheduleValue} onChange={setScheduleValue} />
            <ScheduleHiddenInputs value={scheduleValue} />
          </section>

          {blogSettings && <section className="space-y-4 border-t pt-5">
            <h3 className="text-[15px] font-bold">블로그 글 설정</h3>
            {blogSettings.legacy && <p className="rounded-lg bg-muted p-3 text-sm leading-6 text-muted-foreground">이 설정은 이전 형식이에요. 저장하면 아래 내용이 적용돼요. WordPress로 계속 보내려면 연결 정보를 입력해주세요.</p>}
            <div className="space-y-2"><Label htmlFor="edit-objective">글의 목적</Label><Textarea id="edit-objective" name="objective" defaultValue={blogSettings.objective} maxLength={300} rows={3} required /></div>
            <div className="space-y-2"><Label htmlFor="edit-keywords">키워드 (쉼표 또는 줄바꿈으로 구분)</Label><Textarea id="edit-keywords" name="keywords" defaultValue={blogSettings.keywords.join(", ")} rows={2} required /></div>
            <div className="space-y-2"><Label htmlFor="edit-tone">글의 말투</Label><Input id="edit-tone" name="tone" defaultValue={blogSettings.tone} maxLength={100} required /></div>
            <div className="space-y-2"><Label htmlFor="edit-delivery">글 저장 위치</Label>
              <NativeSelect id="edit-delivery" name="deliveryMode" value={deliveryMode} onChange={(event) => setDeliveryMode(event.target.value as BlogAutomationConfig["deliveryMode"])}>
                {(Object.keys(BLOG_DELIVERY_LABEL) as BlogAutomationConfig["deliveryMode"][]).map((mode) => <option key={mode} value={mode}>{BLOG_DELIVERY_LABEL[mode]}</option>)}
              </NativeSelect>
              {deliveryMode === "wordpress_publish" && <p className="text-xs text-muted-foreground">만들어진 글이 바로 공개돼요. 신중히 골라주세요.</p>}
            </div>
            {deliveryMode !== "app_draft" && <div className="space-y-4 rounded-xl bg-muted p-4">
              <p className="text-sm font-medium">WordPress 연결</p>
              <div className="space-y-2"><Label htmlFor="edit-wp-site">사이트 주소</Label><Input id="edit-wp-site" name="wordpressSiteUrl" type="url" autoComplete="url" spellCheck={false} value={siteUrl} onChange={(event) => setSiteUrl(event.target.value)} placeholder="https://example.com" required /></div>
              <div className="space-y-2"><Label htmlFor="edit-wp-username">사용자명</Label><Input id="edit-wp-username" name="wordpressUsername" autoComplete="username" spellCheck={false} value={username} onChange={(event) => setUsername(event.target.value)} required /></div>
              <div className="space-y-2"><Label htmlFor="edit-wp-password">새 Application Password</Label><Input id="edit-wp-password" name="wordpressAppPassword" type="password" autoComplete="new-password" placeholder={blogSettings.hasStoredWordPress ? "그대로 쓰려면 비워두세요" : "Application Password 입력"} />
                <p className="text-xs text-muted-foreground">{blogSettings.hasStoredWordPress ? "사이트 주소와 사용자명이 같으면 비워둬도 됩니다. 연결 변경 시 새 비밀번호를 입력하세요." : "WordPress 연결을 처음 설정할 때 필요합니다."}</p>
              </div>
            </div>}
          </section>}

          {error && <FormMessage>{error}</FormMessage>}
          <DialogFooter>
            <DialogClose asChild><Button type="button" variant="outline" disabled={isPending}>취소</Button></DialogClose>
            <Button type="submit" disabled={isPending || hasInFlightRun}>{isPending ? "저장하는 중…" : "변경 저장"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
