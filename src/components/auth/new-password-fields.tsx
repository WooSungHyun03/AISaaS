import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PASSWORD_MAX, PASSWORD_MIN } from "@/lib/auth-validation";

/** New password + confirmation, shared by the reset page and settings. */
export function NewPasswordFields({ idPrefix }: { idPrefix: string }) {
  return (
    <>
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-password`}>새 비밀번호</Label>
        <Input id={`${idPrefix}-password`} name="password" type="password" autoComplete="new-password" required minLength={PASSWORD_MIN} maxLength={PASSWORD_MAX} aria-describedby={`${idPrefix}-password-help`} />
        <p id={`${idPrefix}-password-help`} className="text-[13px] text-muted-foreground">{PASSWORD_MIN}자 이상으로 입력해주세요.</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-confirm`}>새 비밀번호 확인</Label>
        <Input id={`${idPrefix}-confirm`} name="confirmPassword" type="password" autoComplete="new-password" required minLength={PASSWORD_MIN} maxLength={PASSWORD_MAX} />
      </div>
    </>
  );
}
