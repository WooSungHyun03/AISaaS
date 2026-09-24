import { describe, expect, it } from "vitest";
import { isNearDuplicateTopic, topicSimilarity } from "./similarity";

describe("topicSimilarity", () => {
  it("treats an exact match as fully similar", () => {
    expect(topicSimilarity("겨울철 난방비 절약 팁", "겨울철 난방비 절약 팁")).toBe(1);
  });

  it("treats punctuation/whitespace/case differences as an exact duplicate", () => {
    expect(topicSimilarity("Winter Heating Tips!", "winter   heating tips")).toBe(1);
    expect(topicSimilarity("겨울철, 난방비 절약!", "겨울철 난방비 절약")).toBe(1);
  });

  it("scores a near-duplicate (same idea, different phrasing) highly but below 1", () => {
    const score = topicSimilarity("겨울철 난방비 절약 팁", "겨울철 난방비 절약하는 방법");
    expect(score).toBeGreaterThan(0.5);
    expect(score).toBeLessThan(1);
  });

  it("scores genuinely distinct topics low", () => {
    const score = topicSimilarity("겨울철 난방비 절약 팁", "여름 휴가철 인기 여행지 추천");
    expect(score).toBeLessThan(0.3);
  });

  it("returns 0 for an empty string", () => {
    expect(topicSimilarity("", "아무 주제")).toBe(0);
  });
});

describe("isNearDuplicateTopic", () => {
  it("flags a topic that matches an existing one after normalization", () => {
    expect(isNearDuplicateTopic("Winter Heating Tips!", ["winter heating tips"])).toBe(true);
  });

  it("flags a near-duplicate above the default threshold", () => {
    expect(isNearDuplicateTopic("겨울철 난방비 절약 팁", ["겨울철 난방비 절약하는 방법"])).toBe(true);
  });

  it("does not flag a genuinely distinct topic", () => {
    expect(isNearDuplicateTopic("여름 휴가철 인기 여행지 추천", ["겨울철 난방비 절약 팁", "봄맞이 대청소 노하우"])).toBe(false);
  });

  it("returns false when there are no recent topics to compare against", () => {
    expect(isNearDuplicateTopic("아무 주제", [])).toBe(false);
  });
});
