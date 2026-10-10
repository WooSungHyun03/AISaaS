/**
 * Supabase Auth returns English messages; show Korean ones instead and never
 * echo the raw text (it can leak configuration details).
 */
const AUTH_ERROR_MESSAGES: Record<string, string> = {
  user_already_exists: "이미 가입된 이메일이에요. 로그인하거나 비밀번호를 재설정해주세요.",
  email_exists: "이미 가입된 이메일이에요. 로그인하거나 비밀번호를 재설정해주세요.",
  weak_password: "비밀번호가 너무 쉬워요. 영문·숫자·기호를 섞어 더 길게 만들어주세요.",
  same_password: "지금 쓰는 비밀번호와 다른 비밀번호를 입력해주세요.",
  email_address_invalid: "사용할 수 없는 이메일 주소예요. 다른 주소를 입력해주세요.",
  over_email_send_rate_limit: "메일 발송 요청이 너무 많아요. 잠시 후 다시 시도해주세요.",
  over_request_rate_limit: "요청이 너무 많아요. 잠시 후 다시 시도해주세요.",
  signup_disabled: "지금은 신규 가입을 받지 않고 있어요.",
  email_not_confirmed: "이메일 인증을 먼저 마쳐주세요. 받은편지함을 확인해주세요.",
  reauthentication_needed: "보안을 위해 다시 로그인한 뒤 시도해주세요.",
  session_not_found: "로그인이 만료됐어요. 다시 로그인해주세요.",
};

export function describeAuthError(error: { code?: string; message?: string } | null | undefined, fallback = "요청을 처리하지 못했어요. 잠시 후 다시 시도해주세요."): string {
  if (!error) return fallback;
  if (error.code && AUTH_ERROR_MESSAGES[error.code]) return AUTH_ERROR_MESSAGES[error.code];
  // Older GoTrue versions omit `code`; fall back to the stable message text.
  const message = error.message?.toLowerCase() ?? "";
  if (message.includes("already registered")) return AUTH_ERROR_MESSAGES.user_already_exists;
  if (message.includes("rate limit")) return AUTH_ERROR_MESSAGES.over_request_rate_limit;
  if (message.includes("password should")) return AUTH_ERROR_MESSAGES.weak_password;
  return fallback;
}
