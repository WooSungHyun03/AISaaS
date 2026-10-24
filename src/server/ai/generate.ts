import "server-only";
import type { ZodType } from "zod";
import { logger } from "@/lib/logger";
import { BudgetError } from "@/server/budget/errors";
import { currentBudgetScope } from "@/server/budget/scope";
import { runPaidCall } from "@/server/budget/spend";
import { AIProviderError } from "./errors";
import { getAIProvider } from "./index";
import { claudeCostUsd } from "./models";
import type { AIImageInput, GenerateTextParams, GenerateTextResult } from "./provider";

/** Failures that mean the provider refused the request before doing any work: nothing was billed. */
const UNBILLED_CODES: ReadonlySet<string> = new Set(["MISSING_API_KEY", "BAD_REQUEST", "UNSUPPORTED_INPUT", "RATE_LIMITED", "PROVIDER_UNAVAILABLE"]);

/**
 * One AI call. A call with a `role` is a step of a paid pipeline: it must run inside a budget scope, its worst case is
 * reserved in the spend ledger first and settled to the real token cost afterwards. Mock calls cost nothing and are not
 * metered. Calls without a role (the small helper features) are not part of the two budgeted pipelines.
 */
export async function generateTextWithUsage(params: GenerateTextParams): Promise<GenerateTextResult> {
  const provider = getAIProvider();
  if (!params.role || provider.name === "mock") {
    const result = await provider.generateText(params);
    if (result.usage) logger.info("ai_call_usage", { provider: provider.name, role: params.role, purpose: params.purpose, model: result.model, ...result.usage });
    return result;
  }

  const scope = currentBudgetScope();
  if (!scope) throw new BudgetError("BUDGET_SCOPE_MISSING", `A paid AI call (${params.purpose ?? params.role}) was made outside a budget scope.`);
  const estimate = provider.estimateCall?.(params);
  if (!estimate) throw new BudgetError("BUDGET_UNPRICEABLE", `The ${provider.name} provider cannot price a ${params.role} call.`);

  return runPaidCall<GenerateTextResult>({
    kind: scope.kind,
    runId: scope.runId,
    step: params.purpose ?? params.role,
    attempt: scope.attempt,
    provider: provider.name,
    model: estimate.model,
    reserveUsd: estimate.worstCaseUsd,
    run: async () => {
      const result = await provider.generateText(params);
      const model = result.model ?? estimate.model;
      const usd = result.usage ? claudeCostUsd(model, result.usage) : estimate.worstCaseUsd;
      logger.info("ai_call_usage", { provider: provider.name, role: params.role, purpose: params.purpose, model, usd, ...(result.usage ?? {}) });
      return { value: result, actualUsd: usd, usage: { model, ...(result.usage ?? {}) } };
    },
    onError: (error) => {
      if (error instanceof AIProviderError) {
        if (error.billed) return { actualUsd: claudeCostUsd(error.billed.model, error.billed.usage), usage: { model: error.billed.model, ...error.billed.usage, failed: error.code } };
        if (UNBILLED_CODES.has(error.code)) return "release";
      }
      return undefined;
    },
  });
}

export async function generateText(params: GenerateTextParams): Promise<string> {
  const { text } = await generateTextWithUsage(params);
  return text;
}

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (fenced ? fenced[1] : text).trim();
}

export interface GenerateStructuredParams<T> {
  system?: string;
  prompt: string;
  schema: ZodType<T>;
  maxTokens?: number;
  temperature?: number;
  tier?: GenerateTextParams["tier"];
  images?: AIImageInput[];
  role?: GenerateTextParams["role"];
  effort?: GenerateTextParams["effort"];
  purpose?: string;
}

/**
 * Generates text and parses/validates it as JSON against `schema`. Built on
 * top of generateText() so every provider gets structured output for free
 * without implementing its own JSON mode. Retries once (never more — Rule:
 * no infinite retries) if the first response fails to parse or validate.
 */
export async function generateStructured<T>({
  system,
  prompt,
  schema,
  maxTokens,
  temperature,
  tier,
  images,
  role,
  effort,
  purpose,
}: GenerateStructuredParams<T>): Promise<T> {
  const jsonInstruction =
    "Respond with ONLY valid JSON matching the requested shape. No markdown fences, no commentary.";
  const providerName = getAIProvider().name;

  // What was wrong with the previous attempt: sent back to the model on the retry and kept in the final error, so a
  // rejected plan names the rule it broke instead of only a truncated copy of the answer.
  let problem = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const text = await generateText({
      system: system ? `${system}\n\n${jsonInstruction}` : jsonInstruction,
      prompt: attempt === 0 ? prompt : `${prompt}\n\nYour previous response was rejected: ${problem}. Return the complete JSON again with every problem fixed.`,
      maxTokens,
      ...(temperature !== undefined ? { temperature } : {}),
      ...(tier ? { tier } : {}),
      ...(images ? { images } : {}),
      ...(role ? { role } : {}),
      ...(effort ? { effort } : {}),
      ...(purpose ? { purpose } : {}),
    });

    try {
      const parsed = JSON.parse(extractJson(text));
      const result = schema.safeParse(parsed);
      if (result.success) return result.data;
      problem = `it did not match the required structure: ${result.error.issues.slice(0, 6).map((issue) => `${issue.path.join(".") || "(root)"} ${issue.message}`).join("; ")}`;
    } catch {
      problem = "it was not valid JSON";
    }

    if (attempt === 1) {
      throw new AIProviderError(
        "INVALID_STRUCTURED_RESPONSE",
        providerName,
        `AI response did not match the expected structure after 2 attempts (${problem}). Raw: ${text.slice(0, 300)}`,
      );
    }
  }

  // Unreachable, satisfies TypeScript's control-flow analysis.
  throw new AIProviderError("INVALID_STRUCTURED_RESPONSE", providerName, "generateStructured: unreachable");
}
