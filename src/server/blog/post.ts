import { z } from "zod";

/**
 * A blog post as structured blocks. The AI writes blocks (never raw HTML), the
 * app stores them as a small editable markup (markup.ts) and renders HTML per
 * platform from them (render.ts). Every text is escaped at render time, so
 * nothing the model — or text it was tricked by — returns can inject markup.
 *
 * Inline emphasis inside any `text`: **bold** and ==highlight==. Emoji are plain text.
 */
export const BLOG_CALLOUT_LABELS = ["💡 꿀팁", "📌 포인트", "⚠️ 참고", "✅ 체크"] as const;

const inlineText = (max: number) => z.string().trim().min(1).max(max);

export const blogBlockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("paragraph"), text: inlineText(2_000) }),
  z.object({ type: z.literal("quote"), text: inlineText(600) }),
  z.object({
    type: z.literal("list"),
    style: z.enum(["check", "number", "bullet"]),
    items: z.array(inlineText(220)).min(2).max(8),
  }),
  z.object({ type: z.literal("callout"), label: inlineText(24), text: inlineText(500) }),
  /** A spot for one of the owner's own photos: what it should show, an optional caption, and (when the owner uploaded references) which photo fits. */
  z.object({
    type: z.literal("photo"),
    slot: inlineText(160),
    caption: z.string().trim().max(120).default(""),
    /** Which of the owner's uploaded photos (1-based, in the order they were listed) belongs here. Absent = the owner picks. */
    ref: z.number().int().min(1).max(10).optional(),
  }),
  /** Business facts (address, hours …). Built from the business profile by the app, never by the AI. */
  z.object({
    type: z.literal("info"),
    rows: z.array(z.object({ label: inlineText(20), value: inlineText(200) })).min(1).max(10),
  }),
  z.object({ type: z.literal("divider") }),
]);
export type BlogBlock = z.infer<typeof blogBlockSchema>;

export const blogSectionSchema = z.object({
  /** Sub-heading (소제목), usually starting with an emoji. Absent for the intro. */
  heading: z.string().trim().min(1).max(80).optional(),
  blocks: z.array(blogBlockSchema).min(1).max(14),
});
export type BlogSection = z.infer<typeof blogSectionSchema>;

export const blogPostSchema = z.object({
  title: z.string().trim().min(1).max(120),
  sections: z.array(blogSectionSchema).min(1).max(14),
  hashtags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
});
export type BlogPost = z.infer<typeof blogPostSchema>;

export type BlogPlatform = "naver" | "tistory" | "generic";
export const BLOG_PLATFORM_LABEL: Record<Exclude<BlogPlatform, "generic">, string> = {
  naver: "네이버 블로그",
  tistory: "티스토리",
};

/** `**a**` / `==a==` markers without their syntax: what a reader (and a length count) actually sees. */
export function stripInlineMarkup(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, "$1").replace(/==(.+?)==/g, "$1");
}

/** Every visible string of a post in reading order (headings, text, items, captions). */
export function postTexts(post: BlogPost): string[] {
  const texts: string[] = [];
  for (const section of post.sections) {
    if (section.heading) texts.push(section.heading);
    for (const block of section.blocks) {
      switch (block.type) {
        case "paragraph":
        case "quote":
          texts.push(block.text);
          break;
        case "list":
          texts.push(...block.items);
          break;
        case "callout":
          texts.push(block.label, block.text);
          break;
        case "photo":
          texts.push(block.slot, ...(block.caption ? [block.caption] : []));
          break;
        case "info":
          texts.push(...block.rows.map((row) => `${row.label} ${row.value}`));
          break;
        case "divider":
          break;
      }
    }
  }
  return texts;
}

/** Plain reading text of the *writing* (paragraphs, quotes, lists, callouts, headings) — not photo slots or info rows. */
export function postBodyText(post: BlogPost): string {
  const parts: string[] = [];
  for (const section of post.sections) {
    if (section.heading) parts.push(stripInlineMarkup(section.heading));
    for (const block of section.blocks) {
      if (block.type === "paragraph" || block.type === "quote") parts.push(stripInlineMarkup(block.text));
      else if (block.type === "list") parts.push(...block.items.map(stripInlineMarkup));
      else if (block.type === "callout") parts.push(stripInlineMarkup(block.text));
    }
  }
  return parts.join("\n\n");
}

/** Length the way Korean bloggers count it: characters without spaces and line breaks. */
export function countCharsNoSpaces(text: string): number {
  return text.replace(/\s+/g, "").length;
}
