"use client";

import { Building2, Laptop, Package } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { PROMOTION_FORM, PROMOTION_TYPES, type PromotionFieldKey, type PromotionFieldSpec, type PromotionType } from "@/types/promotion";

/** Every answer the promotion questions can produce, by the form field name the business actions read. */
export type PromotionValues = Record<PromotionFieldKey, string>;

export const EMPTY_PROMOTION_VALUES: PromotionValues = {
  name: "",
  industry: "",
  location: "",
  mainOffering: "",
  strengths: "",
  targetCustomer: "",
  website: "",
  problem: "",
  priceInfo: "",
  actionUrl: "",
  flow: "",
};

const ICON: Record<PromotionType, typeof Building2> = { STORE: Building2, PRODUCT: Package, PLATFORM: Laptop };

/** Three big choices: what is being promoted. Always one is selected, so the form can never be sent without it. */
export function PromotionTypePicker({ value, onChange, disabled }: { value: PromotionType; onChange: (type: PromotionType) => void; disabled?: boolean }) {
  return (
    <fieldset className="space-y-2" disabled={disabled}>
      <legend className="text-sm font-medium leading-none">무엇을 홍보하시나요?</legend>
      <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="홍보 대상 유형">
        {PROMOTION_TYPES.map((type) => {
          const Icon = ICON[type];
          const selected = value === type;
          return (
            <label
              key={type}
              className={cn(
                "flex min-h-24 cursor-pointer flex-col gap-1 rounded-xl border bg-card p-4 transition-colors has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/25",
                selected ? "border-primary bg-brand-soft/60 ring-2 ring-primary/15" : "hover:border-primary/40",
              )}
            >
              <input type="radio" name="promotionTypePicker" value={type} checked={selected} onChange={() => onChange(type)} className="sr-only" />
              <span className="flex items-center gap-2 font-bold"><Icon className="size-4" aria-hidden="true" />{PROMOTION_FORM[type].title.replace(" 홍보", "")}</span>
              <span className="text-[13px] leading-5 text-muted-foreground">{PROMOTION_FORM[type].hint}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export function PromotionFieldInput({
  spec,
  value,
  onChange,
  idPrefix,
  disabled,
}: {
  spec: PromotionFieldSpec;
  value: string;
  onChange: (value: string) => void;
  idPrefix: string;
  disabled?: boolean;
}) {
  const id = `${idPrefix}-${spec.key}`;
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>
        {spec.label}
        {spec.required ? <><span className="text-destructive" aria-hidden="true"> *</span><span className="sr-only">(필수)</span></> : <span className="font-normal text-muted-foreground"> (선택)</span>}
      </Label>
      {spec.long ? (
        <Textarea id={id} name={spec.key} value={value} onChange={(event) => onChange(event.target.value)} placeholder={spec.placeholder} rows={2} maxLength={500} disabled={disabled} className="min-h-16" />
      ) : (
        <Input
          id={id}
          name={spec.key}
          type={spec.kind === "url" ? "url" : "text"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={spec.placeholder}
          maxLength={spec.kind === "url" ? 500 : 200}
          required={spec.required}
          disabled={disabled}
          spellCheck={spec.kind === "url" ? false : undefined}
        />
      )}
    </div>
  );
}

/** Hidden inputs for every answer so a field that is not asked for the current type keeps the value it already had. */
export function PromotionHiddenInputs({ values, type, keys }: { values: PromotionValues; type: PromotionType; keys?: PromotionFieldKey[] }) {
  return (
    <>
      <input type="hidden" name="promotionType" value={type} />
      {(Object.keys(values) as PromotionFieldKey[]).filter((key) => !keys || keys.includes(key)).map((key) => <input key={key} type="hidden" name={key} value={values[key]} />)}
    </>
  );
}
