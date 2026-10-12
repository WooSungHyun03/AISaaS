import { claudeCostUsd, claudeWorstCaseUsd } from "@/server/ai/models";

export { claudeCostUsd, claudeWorstCaseUsd };

/** fal.ai list prices of Wan 3.0 Standard, USD per second of output (https://fal.ai/wan-3, checked 2026-10-12). */
export const WAN_USD_PER_SECOND = { "480p": 0.05, "720p": 0.1, "1080p": 0.2 } as const;
export type WanResolution = keyof typeof WAN_USD_PER_SECOND;

export interface WanPricingInput {
  resolution: WanResolution;
  /** Seconds of video asked for. */
  outputSeconds: number;
  /** Seconds of reference video sent along: fal bills "input video duration in addition to output duration". */
  referenceVideoSeconds: number;
  thinking: boolean;
  /** True once the thinking surcharge (if any) has been checked on a real invoice. */
  thinkingCostVerified: boolean;
  thinkingReserveMultiplier: number;
}

/** Seconds that are billed: (output + reference video). */
export function wanBilledSeconds(outputSeconds: number, referenceVideoSeconds: number): number {
  return Math.max(0, outputSeconds) + Math.max(0, referenceVideoSeconds);
}

/**
 * What one Wan generation is reserved at. `enable_thinking` has no documented price effect, so until it is verified
 * the reservation (and the settlement, see wanSettledUsd) carries a safety multiplier instead of assuming it is free.
 */
export function wanReserveUsd(input: WanPricingInput): number {
  const base = wanBilledSeconds(input.outputSeconds, input.referenceVideoSeconds) * WAN_USD_PER_SECOND[input.resolution];
  const multiplier = input.thinking && !input.thinkingCostVerified ? input.thinkingReserveMultiplier : 1;
  return round6(base * multiplier);
}

/** What a finished generation is booked at: the billed seconds the response reports, at the same conservative rule. */
export function wanSettledUsd(input: WanPricingInput & { actualOutputSeconds?: number }): number {
  const output = input.actualOutputSeconds && input.actualOutputSeconds > 0 ? input.actualOutputSeconds : input.outputSeconds;
  return wanReserveUsd({ ...input, outputSeconds: output });
}

/** Text-to-speech price (ElevenLabs lists $0.08 / 1K characters for v3 and Multilingual v2; the default is rounded up). */
export function ttsUsd(characters: number, usdPer1kChars: number): number {
  return round6((Math.max(0, characters) / 1000) * usdPer1kChars);
}

export function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}
