/**
 * Renders AI-generated HTML (simple `<p>`-only bodies, see
 * src/server/ai/prompts/) down to plain text for `content_history.content`,
 * which has historically held plain text. Shared by every handler that
 * generates an HTML body (blog, newsletter — Rule 10: two real call sites).
 */
export function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function decodeBasicEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/gi, "'")
    .replace(/&amp;/gi, "&");
}

/**
 * Like stripHtml but keeps paragraph structure: block boundaries become
 * blank lines, so a saved post is still readable (and copy-pasteable) as
 * paragraphs instead of one long line. Scripts/styles are dropped with
 * their content.
 */
export function htmlToText(html: string): string {
  const text = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|h[1-6]|li|blockquote|tr)>/gi, "\n\n")
    .replace(/<[^>]+>/g, " ");
  return decodeBasicEntities(text)
    .split("\n")
    .map((line) => line.replace(/[ \t ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Re-builds a post body as `<p>` paragraphs only, with every other tag and
 * attribute (script, iframe, on* handlers, links) removed and the text
 * escaped. The prompt asks for exactly this shape; this makes it true even
 * if the model — or text it was tricked by — returns something else, before
 * the HTML is stored or sent to a CMS.
 */
export function toSafeParagraphHtml(html: string): string {
  const paragraphs = htmlToText(html)
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/\n/g, " ").trim())
    .filter(Boolean);
  return paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("\n");
}
