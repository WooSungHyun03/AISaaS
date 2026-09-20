export interface PublishContentParams {
  title?: string;
  content: string;
}

export interface PublishResult {
  externalUrl?: string;
  externalId?: string;
}

/**
 * A connector only knows how to push already-generated content to one
 * external platform. It never calls the AI layer itself (Rule: AI and
 * platform APIs must not depend on each other directly) — handlers in
 * src/server/automations/handlers/ generate content, then hand it to a
 * connector's publish().
 */
export interface PlatformConnector {
  readonly name: string;
  /** Whether the required env vars for this connector are present. */
  isConfigured(): boolean;
  publish(params: PublishContentParams): Promise<PublishResult>;
}
