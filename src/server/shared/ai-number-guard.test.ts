import { describe, expect, it } from "vitest";
import { buildAllowedNumbers, stripUnverifiedNumbers } from "./ai-number-guard";

describe("buildAllowedNumbers", () => {
  it("extracts plain numbers, comma-grouped numbers, percentages, and decimals", () => {
    const allowed = buildAllowedNumbers('{"subscriberCount": 1200, "uploadsLast30Days": 3, "ratio": "20%", "averageGapDays": 3.5}');
    expect(allowed.has("1200")).toBe(true);
    expect(allowed.has("3")).toBe(true);
    expect(allowed.has("20")).toBe(true);
    expect(allowed.has("3.5")).toBe(true);
  });

  it("splits an embedded ISO date string into its numeric components automatically", () => {
    const allowed = buildAllowedNumbers('{"collectedAt": "2026-10-09T17:01:12.000Z"}');
    for (const n of ["2026", "10", "9", "17", "1", "12"]) expect(allowed.has(n)).toBe(true);
  });
});

describe("stripUnverifiedNumbers", () => {
  it("keeps a sentence whose number appears (in any equivalent formatting) in the source", () => {
    const source = '{"subscriberCount": 1200}';
    expect(stripUnverifiedNumbers("구독자가 1200명이에요.", source)).toBe("구독자가 1200명이에요.");
    expect(stripUnverifiedNumbers("구독자가 1,200명이에요.", source)).toBe("구독자가 1,200명이에요.");
  });

  it("removes a whole sentence that contains a number absent from the source (hallucination)", () => {
    const source = '{"subscriberCount": 1200}';
    const result = stripUnverifiedNumbers("구독자가 1200명이에요. 어제보다 500명 늘었어요.", source);
    expect(result).toBe("구독자가 1200명이에요.");
  });

  it("drops an entire multi-sentence line if its only sentence is bad, keeping other lines", () => {
    const source = '{"subscriberCount": 1200}';
    const result = stripUnverifiedNumbers("구독자가 999명이에요.\n업로드가 꾸준해요.", source);
    expect(result).toBe("업로드가 꾸준해요.");
  });

  it("returns an empty string when every sentence is unverified", () => {
    expect(stripUnverifiedNumbers("구독자가 999명이에요.", "{}")).toBe("");
  });

  it("[case 1] does not break on a decimal number, and checks it as a whole token", () => {
    const source = '{"averageGapDays": 3.5}';
    expect(stripUnverifiedNumbers("최근 게시 간격이 평균 3.5일이에요.", source)).toBe("최근 게시 간격이 평균 3.5일이에요.");
    // A different decimal (not in source) must still cause removal, not a crash or a half-sentence.
    expect(stripUnverifiedNumbers("최근 게시 간격이 평균 7.2일이에요.", source)).toBe("");
  });

  it("[case 2] handles a Korean sentence with no terminal punctuation", () => {
    const source = '{"uploadsLast30Days": 3}';
    expect(stripUnverifiedNumbers("최근 30일간 3개를 업로드했어요", source)).toBe("최근 30일간 3개를 업로드했어요");
    expect(stripUnverifiedNumbers("최근 30일간 9개를 업로드했어요", source)).toBe("");
  });

  it("[case 3] handles a bulleted/numbered list, keeping the marker and removing only the bad item", () => {
    const source = '{"uploadsLast30Days": 3}';
    const aiText = "1. 최근 30일간 3개를 업로드했어요.\n2. 구독자가 999명 늘었어요.\n- 업로드를 꾸준히 유지하세요.";
    expect(stripUnverifiedNumbers(aiText, source)).toBe("1. 최근 30일간 3개를 업로드했어요.\n- 업로드를 꾸준히 유지하세요.");
  });

  it("treats a trailing '%' as part of the number when comparing", () => {
    const source = '{"ratio": "20%"}';
    expect(stripUnverifiedNumbers("조회 대비 구독자 비율이 20%예요.", source)).toBe("조회 대비 구독자 비율이 20%예요.");
    expect(stripUnverifiedNumbers("조회 대비 구독자 비율이 45%예요.", source)).toBe("");
  });

  it("matches numbers regardless of a leading zero (date components)", () => {
    const source = '{"lastPostDate": "2026-10-09"}';
    expect(stripUnverifiedNumbers("10월 9일에 마지막으로 게시했어요.", source)).toBe("10월 9일에 마지막으로 게시했어요.");
  });
});
