/**
 * Renders AI-generated HTML (simple `<p>`-only bodies, see
 * src/server/ai/prompts/) down to plain text for `content_history.content`,
 * which has historically held plain text. Shared by every handler that
 * generates an HTML body (blog, newsletter — Rule 10: two real call sites).
 */
export function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
