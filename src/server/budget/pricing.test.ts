import { describe, expect, it } from "vitest";
import { ttsUsd, wanBilledSeconds, wanReserveUsd, wanSettledUsd, type WanPricingInput } from "./pricing";

const base: WanPricingInput = { resolution: "720p", outputSeconds: 25, referenceVideoSeconds: 0, thinking: false, thinkingCostVerified: false, thinkingReserveMultiplier: 1.5 };

describe("Wan 3.0 Standard pricing", () => {
  it("prices 20, 25 and 30 s at 720p without reference video", () => {
    expect(wanReserveUsd({ ...base, outputSeconds: 20 })).toBe(2);
    expect(wanReserveUsd({ ...base, outputSeconds: 25 })).toBe(2.5);
    expect(wanReserveUsd({ ...base, outputSeconds: 30 })).toBe(3);
  });

  it("bills reference video seconds on top of the output", () => {
    expect(wanBilledSeconds(25, 30)).toBe(55);
    expect(wanReserveUsd({ ...base, referenceVideoSeconds: 30 })).toBe(5.5);
    expect(wanReserveUsd({ ...base, outputSeconds: 30, referenceVideoSeconds: 75 })).toBe(10.5);
  });

  it("holds back a safety multiplier while the thinking surcharge is unverified, and drops it once verified", () => {
    expect(wanReserveUsd({ ...base, thinking: true })).toBe(3.75);
    expect(wanReserveUsd({ ...base, thinking: true, thinkingCostVerified: true })).toBe(2.5);
    expect(wanReserveUsd({ ...base, thinking: false })).toBe(2.5);
  });

  it("prices the resolutions differently, so the explicit 720p matters", () => {
    expect(wanReserveUsd({ ...base, resolution: "480p" })).toBe(1.25);
    expect(wanReserveUsd({ ...base, resolution: "1080p" })).toBe(5);
  });

  it("settles on the seconds the provider reports when it reports any", () => {
    expect(wanSettledUsd({ ...base, actualOutputSeconds: 24 })).toBe(2.4);
    expect(wanSettledUsd({ ...base })).toBe(2.5);
  });

  it("prices narration by character count", () => {
    expect(ttsUsd(500, 0.1)).toBe(0.05);
    expect(ttsUsd(-5, 0.1)).toBe(0);
  });
});
