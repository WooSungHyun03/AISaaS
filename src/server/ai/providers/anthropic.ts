import "server-only";
import { serverEnv } from "@/lib/env/server";
import { AIProviderError } from "../errors";
import { fetchWithRetry } from "../http";
import {
  claudeModelSpec,
  claudeWorstCaseUsd,
  DEFAULT_ROLE_MODELS,
  type AiRole,
  type ClaudeEffort,
  type ClaudeUsage,
} from "../models";
import type { AICallEstimate, AIProvider, GenerateTextParams, GenerateTextResult } from "../provider";

/** Claude Haiku 4.5 — what calls without a role use; override with AI_MODEL (e.g. a Sonnet id) without a code change. */
export const ANTHROPIC_DEFAULT_MODEL = "claude-haiku-4-5-20251001";
const PROVIDER_NAME = "anthropic";
const API_VERSION = "2023-06-01";
const DEFAULT_MAX_TOKENS = 1_000;

/** How hard each pipeline step thinks unless the call says otherwise. Lower than the API defaults: they are costly. */
const ROLE_EFFORT: Record<AiRole, ClaudeEffort> = { planner: "medium", writer: "medium", reviewer: "medium", vision: "medium" };

function roleModelOverride(role: AiRole): string | undefined {
  switch (role) {
    case "planner": return serverEnv.AI_MODEL_PLANNER;
    case "writer": return serverEnv.AI_MODEL_WRITER;
    case "reviewer": return serverEnv.AI_MODEL_REVIEWER;
    case "vision": return serverEnv.AI_MODEL_VISION;
  }
}

/** The model id of a call: its role's model, else the quality / default model of the deployment. */
export function resolveAnthropicModel(params: Pick<GenerateTextParams, "role" | "tier">): string {
  if (params.role) return roleModelOverride(params.role) ?? DEFAULT_ROLE_MODELS[params.role];
  return (params.tier === "quality" ? serverEnv.AI_QUALITY_MODEL : undefined) ?? serverEnv.AI_MODEL ?? ANTHROPIC_DEFAULT_MODEL;
}

/**
 * The request body for one model. What a model accepts differs: the 5.x models reject `temperature` and always think
 * (so `max_tokens` must leave room for thinking and effort is the only control), Haiku 4.5 takes sampling parameters
 * and has no effort setting.
 */
export function buildAnthropicBody(params: GenerateTextParams, model: string): Record<string, unknown> {
  const spec = claudeModelSpec(model);
  const effort = spec.effort ? params.effort ?? (params.role ? ROLE_EFFORT[params.role] : undefined) : undefined;
  const maxTokens = Math.min(params.maxTokens ?? DEFAULT_MAX_TOKENS, spec.maxOutputTokens);
  return {
    model,
    max_tokens: maxTokens,
    ...(spec.sampling ? { temperature: params.temperature ?? 0.7 } : {}),
    ...(effort ? { output_config: { effort } } : {}),
    ...(params.system ? { system: params.system } : {}),
    messages: [{
      role: "user",
      content: params.images && params.images.length > 0
        ? [
          ...params.images.map((image) => ({ type: "image", source: { type: "base64", media_type: image.mediaType, data: image.base64 } })),
          { type: "text", text: params.prompt },
        ]
        : params.prompt,
    }],
  };
}

interface AnthropicResponse {
  content?: Array<{ type: string; text?: string }>;
  stop_reason?: string;
  stop_details?: { category?: string };
  model?: string;
  usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
}

export function usageOf(response: AnthropicResponse): ClaudeUsage {
  return {
    inputTokens: response.usage?.input_tokens ?? 0,
    outputTokens: response.usage?.output_tokens ?? 0,
    cacheReadTokens: response.usage?.cache_read_input_tokens ?? 0,
    cacheWriteTokens: response.usage?.cache_creation_input_tokens ?? 0,
  };
}

/** Thin fetch-based adapter for the Messages API — no SDK dependency, same shape as the OpenAI/Gemini adapters. */
export class AnthropicProvider implements AIProvider {
  readonly name = PROVIDER_NAME;

  estimateCall(params: GenerateTextParams): AICallEstimate {
    const model = resolveAnthropicModel(params);
    const maxTokens = Math.min(params.maxTokens ?? DEFAULT_MAX_TOKENS, claudeModelSpec(model).maxOutputTokens);
    return { model, worstCaseUsd: claudeWorstCaseUsd(model, { system: params.system, prompt: params.prompt, images: params.images?.length ?? 0, maxTokens }) };
  }

  async generateText(params: GenerateTextParams): Promise<GenerateTextResult> {
    const apiKey = serverEnv.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new AIProviderError("MISSING_API_KEY", PROVIDER_NAME, "ANTHROPIC_API_KEY is not set (see .env.example).");
    }

    const model = resolveAnthropicModel(params);
    // A pipeline step (it has a role) is a long, paid call: wait for it, and never send it twice on a timeout.
    const paid = Boolean(params.role);
    const response = await fetchWithRetry(
      "https://api.anthropic.com/v1/messages",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": API_VERSION,
        },
        body: JSON.stringify(buildAnthropicBody(params, model)),
      },
      { provider: PROVIDER_NAME, ...(paid ? { timeoutMs: serverEnv.AI_LONG_REQUEST_TIMEOUT_MS, retryTimeouts: false } : {}) },
    );

    const data = (await response.json()) as AnthropicResponse;
    const usage = usageOf(data);
    const billed = { model: data.model ?? model, usage };

    // Models that think put `thinking` blocks first: the answer is the `text` blocks, wherever they are.
    const text = data.content?.filter((block) => block.type === "text").map((block) => block.text ?? "").join("");
    if (data.stop_reason === "refusal") {
      throw new AIProviderError("REFUSED", PROVIDER_NAME, `The model declined this request${data.stop_details?.category ? ` (${data.stop_details.category})` : ""}.`, { billed });
    }
    // A reply cut off by max_tokens is almost always unparseable JSON; say so instead of a vague parse error later.
    // With a thinking model the limit also covers thinking, so this can happen on a short answer: raise max_tokens or lower effort.
    if (data.stop_reason === "max_tokens") {
      throw new AIProviderError("INVALID_STRUCTURED_RESPONSE", PROVIDER_NAME, "Response was cut off at max_tokens (thinking counts toward it).", { billed });
    }
    if (!text) {
      throw new AIProviderError("PROVIDER_UNAVAILABLE", PROVIDER_NAME, "Response did not contain any text.", { billed });
    }

    return { text, model: data.model ?? model, usage };
  }
}
