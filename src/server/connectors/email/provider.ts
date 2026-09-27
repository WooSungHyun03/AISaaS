export interface EmailRecipient {
  email: string;
  name?: string | null;
}

export interface SendEmailParams {
  to: EmailRecipient;
  subject: string;
  html: string;
  /**
   * Passed through to the provider so an HTTP-layer retry of the exact
   * same request (same run, same recipient) is deduped at the provider
   * instead of delivering twice — see ResendConnector.send() and
   * handlers/newsletter.ts, which derives this from `automation_runs.id`.
   */
  idempotencyKey: string;
}

export interface SendEmailResult {
  /** The provider's own message id, persisted on `automation_runs.output`. */
  messageId: string;
}

/**
 * Vendor-neutral interface for sending a single transactional/marketing
 * email — mirrors the AIProvider (src/server/ai/provider.ts) and
 * BillingProvider (src/server/billing/provider.ts) pattern so newsletter
 * automation logic never depends on a vendor SDK directly. Deliberately
 * not `PlatformConnector` (src/server/connectors/types.ts): that interface
 * publishes one piece of content to one external account (WordPress,
 * Instagram, ...), while a newsletter send is one email per subscriber —
 * a different shape that doesn't fit `publish()`.
 */
export interface EmailConnector {
  readonly name: string;
  /** Whether the required env vars for this connector are present. */
  isConfigured(): boolean;
  send(params: SendEmailParams): Promise<SendEmailResult>;
}
