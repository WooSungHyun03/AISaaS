import { AppError } from "@/server/shared/errors";

export type BudgetErrorCode =
  | "BUDGET_NOT_CONFIGURED"
  | "BUDGET_PERIOD_CLOSED"
  | "BUDGET_FROZEN"
  | "PAID_CALLS_DISABLED"
  | "BUDGET_CAP_EXCEEDED"
  | "BUDGET_ITEM_LIMIT"
  | "BUDGET_ITEM_CAP_EXCEEDED"
  | "BUDGET_UNPRICEABLE"
  | "BUDGET_SCOPE_MISSING"
  | "BUDGET_LEDGER_UNAVAILABLE";

/**
 * A paid call was refused (or could not be priced) by the spend ledger. Not retryable and not the owner's doing:
 * the runner parks nothing in ERROR for it, and the owner is told why in plain Korean.
 */
export class BudgetError extends AppError {
  declare readonly code: BudgetErrorCode;

  constructor(code: BudgetErrorCode, message: string, options?: { cause?: unknown }) {
    super("budget", code, message, { cause: options?.cause, retryable: false });
    this.name = "BudgetError";
  }
}

export function isBudgetError(error: unknown): error is BudgetError {
  return error instanceof BudgetError;
}

/** What the owner reads. The English `message` stays for logs. */
export const BUDGET_MESSAGES_KO: Record<BudgetErrorCode, string> = {
  BUDGET_NOT_CONFIGURED: "이번 운영 기간의 제작 예산이 아직 설정되지 않아 지금은 만들 수 없어요. 관리자에게 문의해주세요.",
  BUDGET_PERIOD_CLOSED: "지금은 운영 기간이 아니라서 만들 수 없어요. 이용권은 차감되지 않았어요.",
  BUDGET_FROZEN: "제작이 일시 중지되어 있어요. 이용권은 차감되지 않았어요. 관리자에게 문의해주세요.",
  PAID_CALLS_DISABLED: "AI 제작 서비스가 아직 켜져 있지 않아요. 이용권은 차감되지 않았어요. 관리자에게 문의해주세요.",
  BUDGET_CAP_EXCEEDED: "이번 달 제작 예산을 모두 사용해서 더 만들 수 없어요. 이용권은 차감되지 않았어요.",
  BUDGET_ITEM_LIMIT: "이번 달 제작 가능한 편수를 모두 채워서 더 만들 수 없어요. 이용권은 차감되지 않았어요.",
  BUDGET_ITEM_CAP_EXCEEDED: "한 편에 쓸 수 있는 제작 예산을 넘어서 다시 만들 수 없어요. 이용권은 돌려드렸어요.",
  BUDGET_UNPRICEABLE: "제작 비용을 계산할 수 없는 설정이라 만들 수 없어요. 관리자에게 문의해주세요.",
  BUDGET_SCOPE_MISSING: "제작 예산을 확인하지 못해 만들 수 없어요. 관리자에게 문의해주세요.",
  BUDGET_LEDGER_UNAVAILABLE: "제작 예산을 확인하지 못해 만들 수 없어요. 잠시 후 다시 시도해주세요.",
};
