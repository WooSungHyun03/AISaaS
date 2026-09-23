/**
 * Global error-handling layer shared by every server domain (AI, platform
 * connectors, the automation runner, directory sync, ...). A domain gets a
 * typed error for free by extending `AppError` — the runner and logging
 * code can then branch on `.code`/`.domain` instead of parsing free-text
 * messages, and every domain's retry/observability behavior stays
 * consistent instead of each one reinventing it.
 */
export class AppError extends Error {
  readonly domain: string;
  readonly code: string;
  readonly retryable: boolean;

  constructor(domain: string, code: string, message: string, options?: { cause?: unknown; retryable?: boolean }) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "AppError";
    this.domain = domain;
    this.code = code;
    this.retryable = options?.retryable ?? false;
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/** Error codes shared by every platform connector (WordPress, Instagram, Email, YouTube, ...). */
export type ConnectorErrorCode =
  | "NOT_CONFIGURED"
  | "INVALID_TARGET"
  | "AUTH_FAILED"
  | "PERMISSION_DENIED"
  | "TIMEOUT"
  | "UPSTREAM_CLIENT_ERROR"
  | "UPSTREAM_SERVER_ERROR"
  | "NETWORK_FAILURE";

const RETRYABLE_CONNECTOR_CODES: ReadonlySet<ConnectorErrorCode> = new Set([
  "TIMEOUT",
  "UPSTREAM_SERVER_ERROR",
  "NETWORK_FAILURE",
]);

/**
 * Thrown by any `PlatformConnector` implementation. `connector` is the
 * connector's `name` (e.g. "wordpress") so a single log line/error report
 * identifies both which platform failed and why.
 */
export class ConnectorError extends AppError {
  constructor(connector: string, code: ConnectorErrorCode, message: string, options?: { cause?: unknown }) {
    super(connector, code, message, { cause: options?.cause, retryable: RETRYABLE_CONNECTOR_CODES.has(code) });
    this.name = "ConnectorError";
  }
}

export function isConnectorError(error: unknown): error is ConnectorError {
  return error instanceof ConnectorError;
}

/**
 * Client-safe explanation for an automation run failure. `automation_runs`
 * only ever persists `error.message` (a string — see runner.ts), so this
 * necessarily classifies by matching text rather than a `.code`, but it is
 * the one place that mapping happens for every domain (AI, WordPress, ...)
 * instead of each page re-implementing its own guesswork.
 */
export function describeAutomationRunError(message: string | null | undefined): string {
  if (!message) return "실행에 실패했습니다. 자동화 설정을 확인한 뒤 다시 시도해주세요.";

  const error = message.toLowerCase();
  if (error.includes("already has a run") || error.includes("one_active_run")) {
    return "이미 실행 중입니다. 완료된 뒤 다시 시도해주세요.";
  }
  if (error.includes("wordpress")) {
    if (/http 40[13]|authentication|application password|credential|권한|연결 정보/.test(error)) {
      return "WordPress 인증 또는 글 작성 권한을 확인해주세요. 설정에서 연결 정보를 다시 입력할 수 있습니다.";
    }
    if (/http 404|rest api/.test(error)) {
      return "WordPress 주소 또는 REST API 경로를 확인해주세요.";
    }
    if (/시간이 초과|timeout|timed out/.test(error)) {
      return "WordPress 응답이 늦어 실행이 중단되었습니다. 사이트 상태를 확인한 뒤 다시 시도해주세요.";
    }
    return "WordPress에 글을 저장하지 못했습니다. 사이트 연결과 발행 설정을 확인해주세요.";
  }
  if (/api_key|api key|missing_api_key|authentication rejected/.test(error)) {
    return "AI 서비스 연결 정보가 올바르지 않습니다. 관리자에게 API 설정 확인을 요청해주세요.";
  }
  if (/rate.limit|429|too many requests/.test(error)) {
    return "AI 서비스 요청이 일시적으로 많습니다. 잠시 후 다시 실행해주세요.";
  }
  if (/timed out|timeout|시간이 초과/.test(error)) {
    return "AI 서비스 응답이 늦어 실행이 중단되었습니다. 잠시 후 다시 시도해주세요.";
  }
  if (/invalid_structured_response|invalid json|parse|schema validation/.test(error)) {
    return "AI가 생성한 글을 처리하지 못했습니다. 다시 실행해주세요.";
  }
  if (/network|fetch failed|provider unavailable|upstream error/.test(error)) {
    return "외부 서비스에 연결하지 못했습니다. 잠시 후 다시 시도해주세요.";
  }
  return "실행 중 문제가 발생했습니다. 설정을 확인한 뒤 다시 시도해주세요.";
}
