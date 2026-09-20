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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Business } from "@/types/domain";
import { createBusiness, updateBusiness, type BusinessActionState } from "@/app/(app)/business/actions";

const initialState: BusinessActionState = {};

export function BusinessFormDialog({ business, trigger }: { business?: Business; trigger: React.ReactNode }) {
  const action = business ? updateBusiness.bind(null, business.id) : createBusiness;
  const [state, formAction, isPending] = useActionState(action, initialState);

  return (
    <Dialog>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{business ? "사업체 정보 수정" : "사업체 등록"}</DialogTitle>
          <DialogDescription>AI가 자동화 콘텐츠를 생성할 때 사용하는 정보입니다.</DialogDescription>
        </DialogHeader>
        <form action={formAction} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">사업체 이름 *</Label>
            <Input id="name" name="name" defaultValue={business?.name} required />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="industry">업종</Label>
              <Input id="industry" name="industry" defaultValue={business?.industry ?? ""} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="location">위치</Label>
              <Input id="location" name="location" defaultValue={business?.location ?? ""} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="description">사업 소개</Label>
            <Textarea id="description" name="description" defaultValue={business?.description ?? ""} rows={3} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="targetCustomer">타겟 고객</Label>
            <Input id="targetCustomer" name="targetCustomer" defaultValue={business?.target_customer ?? ""} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="brandTone">브랜드 톤</Label>
            <Input
              id="brandTone"
              name="brandTone"
              placeholder="예: 친근하고 활기찬"
              defaultValue={business?.brand_tone ?? ""}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="keywords">키워드 (쉼표로 구분)</Label>
            <Input id="keywords" name="keywords" defaultValue={business?.keywords.join(", ") ?? ""} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="website">웹사이트</Label>
            <Input id="website" name="website" type="url" defaultValue={business?.website ?? ""} />
          </div>
          {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending ? "저장 중..." : "저장"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
