export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

export function isPlausibleEmail(email: string): boolean {
  return email.length > 0 && email.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** Returns a Korean error message, or null when the new password is acceptable. */
export function validateNewPassword(password: string, confirm: string): string | null {
  if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) return `비밀번호는 ${PASSWORD_MIN}~${PASSWORD_MAX}자로 입력해주세요.`;
  if (password !== confirm) return "새 비밀번호와 확인 값이 서로 달라요.";
  return null;
}
