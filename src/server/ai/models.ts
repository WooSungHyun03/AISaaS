/**
 * Claude models the content pipelines use, with the facts the request builder and the budget need. Pure data (no
 * env, no network) so it can be tested and shared. Prices are USD per million tokens from
 * https://platform.claude.com/docs/en/about-claude/pricing (checked 2026-10-12); update them here in one place.
 *
 * Request rules that differ by model (https://platform.claude.com/docs/en/models/opus-5-5/migration-guide):
 * - The 5.x models reject any non-default `temperature` / `top_p` / `top_k` with a 400.
 * - Opus 5.5 and Fable 5.1 always think (adaptive); `thinking: {type:"disabled"}` is rejected. Thinking tokens are
 *   billed as output and count toward `max_tokens`, and `output_config.effort` is the only control over them.
 * - Responses can start with `thinking` blocks, so text must be read by block type, never by position.
 */
export const CLAUDE_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type ClaudeEffort = (typeof CLAUDE_EFFORTS)[number];

export interface ClaudeModelSpec {
  id: string;
  label: string;
  inputPerMTok: number;
  outputPerMTok: number;
  cacheReadPerMTok: number;
  cacheWrite5mPerMTok: number;
  /** Accepts `temperature`. The 5.x family does not. */
  sampling: boolean;
  /** Accepts `output_config.effort`. */
  effort: boolean;
  /** Thinking cannot be turned off, so output tokens include reasoning. */
  alwaysThinks: boolean;
  defaultEffort: ClaudeEffort | null;
  maxOutputTokens: number;
}

export const CLAUDE_MODELS: Record<string, ClaudeModelSpec> = {
  "claude-fable-5-1": {
    id: "claude-fable-5-1", label: "Claude Fable 5.1",
    inputPerMTok: 10, outputPerMTok: 50, cacheReadPerMTok: 0.25, cacheWrite5mPerMTok: 12.5,
    sampling: false, effort: true, alwaysThinks: true, defaultEffort: "high", maxOutputTokens: 128_000,
  },
  "claude-opus-5-5": {
    id: "claude-opus-5-5", label: "Claude Opus 5.5",
    inputPerMTok: 4, outputPerMTok: 20, cacheReadPerMTok: 0.2, cacheWrite5mPerMTok: 5,
    sampling: false, effort: true, alwaysThinks: true, defaultEffort: "medium", maxOutputTokens: 128_000,
  },
  "claude-sonnet-5-5": {
    id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5",
    inputPerMTok: 2, outputPerMTok: 10, cacheReadPerMTok: 0.1, cacheWrite5mPerMTok: 2.5,
    sampling: false, effort: true, alwaysThinks: false, defaultEffort: "high", maxOutputTokens: 128_000,
  },
  "claude-haiku-4-5-20251001": {
    id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5",
    inputPerMTok: 1, outputPerMTok: 5, cacheReadPerMTok: 0.1, cacheWrite5mPerMTok: 1.25,
    sampling: true, effort: false, alwaysThinks: false, defaultEffort: null, maxOutputTokens: 64_000,
  },
};

/** Priced like the most expensive model, with the strictest request rules, when an id is not in the table. */
const UNKNOWN_MODEL: ClaudeModelSpec = { ...CLAUDE_MODELS["claude-fable-5-1"], id: "unknown", label: "unknown model" };

export function claudeModelSpec(id: string): ClaudeModelSpec {
  return CLAUDE_MODELS[id] ?? { ...UNKNOWN_MODEL, id };
}

/** What each step of the pipelines needs. The model for a role can be overridden per deployment (env). */
export type AiRole = "planner" | "writer" | "reviewer" | "vision";

export const DEFAULT_ROLE_MODELS: Record<AiRole, string> = {
  planner: "claude-opus-5-5",
  writer: "claude-fable-5-1",
  reviewer: "claude-sonnet-5-5",
  vision: "claude-sonnet-5-5",
};

export interface ClaudeUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export const EMPTY_USAGE: ClaudeUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

/** Dollars for a finished call. Output includes thinking tokens, which the API reports inside `output_tokens`. */
export function claudeCostUsd(modelId: string, usage: ClaudeUsage): number {
  const spec = claudeModelSpec(modelId);
  return (
    (usage.inputTokens * spec.inputPerMTok +
      usage.outputTokens * spec.outputPerMTok +
      usage.cacheReadTokens * spec.cacheReadPerMTok +
      usage.cacheWriteTokens * spec.cacheWrite5mPerMTok) / 1_000_000
  );
}

/** A deliberately high guess of the input tokens of a text: Hangul and other CJK count about one token per character. */
export function estimateInputTokens(text: string): number {
  let cjk = 0;
  for (const char of text) if (/[ᄀ-ᇿ㄰-㆏가-힯぀-ヿ一-鿿]/.test(char)) cjk += 1;
  const other = text.length - cjk;
  return Math.ceil(cjk * 1.3 + other * 0.4) + 50;
}

/** Tokens one image can cost at most (long edge ≤ 1568 px: width × height / 750). */
export const MAX_IMAGE_TOKENS = 3_300;

/**
 * The most a call can cost: the whole prompt at the input price plus `max_tokens` at the output price. `max_tokens`
 * is a hard limit on thinking plus text, so the output side is a true upper bound; the input side is an estimate that
 * is deliberately high.
 */
export function claudeWorstCaseUsd(modelId: string, input: { system?: string; prompt: string; images?: number; maxTokens: number }): number {
  const inputTokens = estimateInputTokens(`${input.system ?? ""}\n${input.prompt}`) + (input.images ?? 0) * MAX_IMAGE_TOKENS;
  return claudeCostUsd(modelId, { ...EMPTY_USAGE, inputTokens, outputTokens: input.maxTokens });
}
