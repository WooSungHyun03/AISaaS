import "server-only";
import { serverEnv } from "@/lib/env/server";
import { logger } from "@/lib/logger";
import { classifyHttpStatus, ConnectorError, isConnectorError } from "@/server/shared/errors";
import type { EmailConnector, SendEmailParams, SendEmailResult } from "./provider";

const RESEND_API_URL = "https://api.resend.com/emails";
const REQUEST_TIMEOUT_MS = 10_000;
// Bounded — never more than one retry, matching the "no infinite retries"
// rule and the same one-retry shape as generateStructured()/blog topic
// regeneration. Only ever applied to a transient failure (see the
// `retryable` check below), never to auth/validation errors.
const MAX_RETRIES = 1;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Resend (https://resend.com) email connector. A fixed, trusted API
 * endpoint — unlike WordPressConnector (src/server/connectors/wordpress/
 * index.ts), which validates and pins a user-supplied host against SSRF,
 * there's nothing here to validate beyond the response itself, so this
 * uses plain `fetch` the same way the AI provider layer does
 * (src/server/ai/http.ts) rather than a raw node:https request.
 */
export class ResendConnector implements EmailConnector {
  readonly name = "email";

  isConfigured(): boolean {
    return Boolean(serverEnv.RESEND_API_KEY && serverEnv.RESEND_FROM_EMAIL);
  }

  private credentials(): { apiKey: string; from: string } {
    if (!this.isConfigured()) {
      throw new ConnectorError("email", "NOT_CONFIGURED", "이메일 발송 연동이 설정되지 않았습니다.");
    }
    return { apiKey: serverEnv.RESEND_API_KEY!, from: serverEnv.RESEND_FROM_EMAIL! };
  }

  async send({ to, subject, html, idempotencyKey }: SendEmailParams): Promise<SendEmailResult> {
    const { apiKey, from } = this.credentials();
    let lastError: ConnectorError | undefined;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      try {
        const response = await fetch(RESEND_API_URL, {
          method: "POST",
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            // Resend dedupes a repeated request carrying the same key
            // (https://resend.com/docs/api-reference/emails/send-email —
            // Idempotency-Key header) instead of sending a second email —
            // this is what makes a retried attempt for the same run +
            // recipient safe. See handlers/newsletter.ts for how the key
            // is derived.
            "Idempotency-Key": idempotencyKey,
          },
          body: JSON.stringify({ from, to: [to.email], subject, html }),
        });
        clearTimeout(timeout);

        if (!response.ok) {
          const body = await response.text();
          const error = new ConnectorError(
            "email",
            classifyHttpStatus(response.status),
            `이메일 발송에 실패했습니다 (HTTP ${response.status}): ${body.slice(0, 300)}`,
          );
          if (!error.retryable || attempt === MAX_RETRIES) throw error;
          lastError = error;
        } else {
          const data = (await response.json()) as { id?: string };
          if (!data.id) {
            throw new ConnectorError("email", "UPSTREAM_SERVER_ERROR", "이메일 발송 응답에 메시지 ID가 없습니다.");
          }
          return { messageId: data.id };
        }
      } catch (cause) {
        clearTimeout(timeout);

        if (isConnectorError(cause)) {
          if (!cause.retryable || attempt === MAX_RETRIES) throw cause;
          lastError = cause;
        } else if (cause instanceof Error && cause.name === "AbortError") {
          const error = new ConnectorError("email", "TIMEOUT", "이메일 발송 요청 시간이 초과되었습니다.", { cause });
          if (attempt === MAX_RETRIES) throw error;
          lastError = error;
        } else {
          const error = new ConnectorError("email", "NETWORK_FAILURE", "이메일 발송 서버에 연결하지 못했습니다.", { cause });
          if (attempt === MAX_RETRIES) throw error;
          lastError = error;
        }
      }

      const backoffMs = 300 * 2 ** attempt;
      logger.warn("email_connector_retry", { attempt: attempt + 1, maxRetries: MAX_RETRIES, code: lastError?.code, backoffMs });
      await sleep(backoffMs);
    }

    // Unreachable: the loop above always throws on its final attempt.
    throw lastError ?? new ConnectorError("email", "NETWORK_FAILURE", "이메일 발송에 실패했습니다.");
  }
}
