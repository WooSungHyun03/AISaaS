import { describe, expect, it } from "vitest";
import { AppError, ConnectorError, describeAutomationRunError, isAppError, isConnectorError } from "./errors";

describe("AppError / ConnectorError", () => {
  it("marks connector errors retryable only for transient codes", () => {
    expect(new ConnectorError("youtube", "TIMEOUT", "x").retryable).toBe(true);
    expect(new ConnectorError("youtube", "UPSTREAM_SERVER_ERROR", "x").retryable).toBe(true);
    expect(new ConnectorError("youtube", "NETWORK_FAILURE", "x").retryable).toBe(true);
    expect(new ConnectorError("youtube", "NOT_CONFIGURED", "x").retryable).toBe(false);
    expect(new ConnectorError("youtube", "AUTH_FAILED", "x").retryable).toBe(false);
  });

  it("is identifiable via isAppError/isConnectorError but not confused with a plain Error", () => {
    const connectorError = new ConnectorError("youtube", "NOT_CONFIGURED", "not set up");
    expect(isAppError(connectorError)).toBe(true);
    expect(isConnectorError(connectorError)).toBe(true);
    expect(isConnectorError(new Error("plain"))).toBe(false);
    expect(isAppError(new Error("plain"))).toBe(false);
  });

  it("carries domain/code for structured logging", () => {
    const error = new ConnectorError("youtube", "AUTH_FAILED", "bad credentials");
    expect(error).toBeInstanceOf(AppError);
    expect(error.domain).toBe("youtube");
    expect(error.code).toBe("AUTH_FAILED");
  });
});

describe("describeAutomationRunError", () => {
  it("gives actionable messages for AI rate limits and unknown failures", () => {
    expect(describeAutomationRunError("[openai] Rate limited (429)")).toContain("잠시 후");
    expect(describeAutomationRunError("sensitive stack trace")).not.toContain("stack trace");
  });
});

describe("describeAutomationRunError — video, YouTube and plan limits", () => {
  it("never echoes raw provider text for video generation failures", () => {
    const raw = "영상 생성 상태를 확인하지 못했습니다. (HTTP 500: template var voice_script missing at secret-internal-path)";
    const result = describeAutomationRunError(raw);
    expect(result).toContain("영상");
    expect(result).not.toContain("secret-internal-path");
    expect(describeAutomationRunError("영상 생성 서비스 응답이 늦어요 (요청 시간 초과)")).toContain("오래 걸려");
    expect(describeAutomationRunError("영상 생성 서비스 설정이 없습니다. FAL_KEY를 확인해주세요.")).toContain("설정");
    expect(describeAutomationRunError("영상 생성 서비스 설정이 없습니다. FAL_KEY를 확인해주세요.")).not.toContain("FAL_KEY");
  });

  it("shows the budget and quality messages, which are already plain Korean", () => {
    expect(describeAutomationRunError("이번 달 제작 예산을 모두 사용해서 더 만들 수 없어요. 이용권은 차감되지 않았어요.")).toContain("제작 예산");
    expect(describeAutomationRunError("만든 영상이 품질 점검을 통과하지 못했어요. (영상 길이가 달라요)")).toContain("품질 점검");
  });

  it("explains YouTube upload failures in plain Korean", () => {
    expect(describeAutomationRunError("YouTube upload failed (HTTP 401)")).toContain("유튜브");
    expect(describeAutomationRunError("YouTube upload failed (HTTP 500)")).toContain("유튜브");
  });

  it("passes the server's own plan-limit sentences through unchanged", () => {
    const limit = "스타터 요금제의 이번 달 숏폼 한도(4건)를 모두 썼어요. 다음 달에 다시 쓰거나 요금제를 올려보세요.";
    expect(describeAutomationRunError(limit)).toBe(limit);
    const notAllowed = "무료 요금제에서는 이 콘텐츠를 만들 수 없어요. 요금제를 올리면 이용할 수 있어요.";
    expect(describeAutomationRunError(notAllowed)).toBe(notAllowed);
  });

  it("passes the credit purchase message through unchanged", () => {
    const message = "이용권이 없거나 모두 만료됐어요. 이용권을 구매하면 바로 만들 수 있어요.";
    expect(describeAutomationRunError(message)).toBe(message);
  });
});
