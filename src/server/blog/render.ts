import { stripInlineMarkup, type BlogBlock, type BlogPlatform, type BlogPost } from "./post";

/**
 * Renders a post as HTML for pasting into a blog editor or sending to a CMS.
 * Everything is built from escaped text and fixed tags, so the output is safe
 * to show and to store.
 *
 * - naver: styled paragraphs with inline CSS only (the SmartEditor keeps bold,
 *   colour, size and background on paste but ignores most structural tags).
 * - tistory / generic: semantic h2 / blockquote / hr / table with a font stack,
 *   for the HTML editor (Tistory).
 */
const COLOR = { text: "#374151", heading: "#111827", accent: "#F59E0B", quoteBg: "#FFFBEB", quoteText: "#92400E", calloutBg: "#EFF6FF", calloutBorder: "#BFDBFE", muted: "#6B7280", tag: "#2563EB", highlight: "#FEF08A" } as const;
const FONT = "'Noto Sans KR','Nanum Gothic','Malgun Gothic',sans-serif";

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Escapes, then turns **bold** and ==highlight== into tags. Unmatched markers stay as plain text. */
export function inlineToHtml(text: string): string {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/==(.+?)==/g, `<span style="background-color:${COLOR.highlight};padding:0 2px;"><strong>$1</strong></span>`);
}

const p = (style: string, inner: string) => `<p style="${style}">${inner}</p>`;

function renderBlock(block: BlogBlock, platform: BlogPlatform): string {
  const semantic = platform !== "naver";
  switch (block.type) {
    case "paragraph":
      return p(`margin:0 0 18px;font-size:16px;line-height:1.95;color:${COLOR.text};`, inlineToHtml(block.text));
    case "quote":
      return `<blockquote style="margin:24px 0;padding:16px 20px;border-left:5px solid ${COLOR.accent};background-color:${COLOR.quoteBg};font-size:18px;font-weight:700;line-height:1.7;color:${COLOR.quoteText};">${inlineToHtml(block.text)}</blockquote>`;
    case "list": {
      const items = block.items.map((item) => inlineToHtml(item));
      if (!semantic || block.style === "check") {
        const mark = (index: number) => (block.style === "number" ? `${index + 1}.` : block.style === "check" ? "✔" : "•");
        return items.map((item, index) => p(`margin:0 0 8px;padding-left:4px;font-size:16px;line-height:1.8;color:${COLOR.text};`, `<strong>${mark(index)}</strong> ${item}`)).join("\n") + p("margin:0 0 10px;", "&nbsp;");
      }
      const tag = block.style === "number" ? "ol" : "ul";
      return `<${tag} style="margin:0 0 18px;padding-left:22px;font-size:16px;line-height:1.9;color:${COLOR.text};">${items.map((item) => `<li>${item}</li>`).join("")}</${tag}>`;
    }
    case "callout":
      return `<div style="margin:22px 0;padding:16px 20px;border:1px solid ${COLOR.calloutBorder};background-color:${COLOR.calloutBg};border-radius:12px;">${p(`margin:0 0 6px;font-size:16px;font-weight:700;color:${COLOR.heading};`, escapeHtml(block.label))}${p(`margin:0;font-size:16px;line-height:1.85;color:${COLOR.text};`, inlineToHtml(block.text))}</div>`;
    case "photo":
      return p(`margin:22px 0;padding:18px 12px;border:1px dashed #D1D5DB;text-align:center;font-size:14px;color:${COLOR.muted};`, `📷 <strong>사진 자리</strong> · ${inlineToHtml(block.slot)}${block.caption ? `<br>${inlineToHtml(block.caption)}` : ""}`);
    case "info": {
      if (semantic) {
        const rows = block.rows.map((row) => `<tr><th style="width:96px;padding:10px 12px;border:1px solid #E5E7EB;background-color:#F9FAFB;text-align:left;font-size:15px;color:${COLOR.heading};">${escapeHtml(row.label)}</th><td style="padding:10px 12px;border:1px solid #E5E7EB;font-size:15px;color:${COLOR.text};">${inlineToHtml(row.value)}</td></tr>`).join("");
        return `<table style="width:100%;margin:22px 0;border-collapse:collapse;">${rows}</table>`;
      }
      const lines = block.rows.map((row) => `<strong>${escapeHtml(row.label)}</strong> : ${inlineToHtml(row.value)}`).join("<br>");
      return p(`margin:22px 0;padding:16px 20px;border:1px solid #E5E7EB;background-color:#F9FAFB;font-size:15px;line-height:2;color:${COLOR.text};`, lines);
    }
    case "divider":
      return `<hr style="border:none;border-top:1px dashed #D1D5DB;margin:30px 0;">`;
  }
}

function renderHeading(heading: string, platform: BlogPlatform): string {
  const inner = inlineToHtml(heading);
  if (platform === "naver") {
    return p(`margin:42px 0 16px;padding-bottom:8px;border-bottom:3px solid ${COLOR.accent};font-size:23px;font-weight:700;line-height:1.5;color:${COLOR.heading};`, `<strong>${inner}</strong>`);
  }
  return `<h2 style="margin:42px 0 16px;padding-bottom:8px;border-bottom:3px solid ${COLOR.accent};font-size:23px;font-weight:700;line-height:1.5;color:${COLOR.heading};">${inner}</h2>`;
}

/** The post body (without the title, which every editor has its own field for). */
export function renderBlogHtml(post: BlogPost, platform: BlogPlatform = "generic"): string {
  const parts: string[] = [];
  for (const section of post.sections) {
    if (section.heading) parts.push(renderHeading(section.heading, platform));
    for (const block of section.blocks) parts.push(renderBlock(block, platform));
  }
  if (post.hashtags.length > 0) {
    parts.push(p(`margin:30px 0 0;font-size:15px;line-height:2;color:${COLOR.tag};`, post.hashtags.map((tag) => `#${escapeHtml(tag.replace(/^#/, ""))}`).join(" ")));
  }
  const body = parts.join("\n");
  return platform === "naver" ? body : `<div style="font-family:${FONT};max-width:760px;">\n${body}\n</div>`;
}

/** Plain text for the history list and for pasting where no formatting is possible. */
export function renderBlogText(post: BlogPost): string {
  const out: string[] = [];
  for (const section of post.sections) {
    if (section.heading) out.push(stripInlineMarkup(section.heading));
    for (const block of section.blocks) {
      switch (block.type) {
        case "paragraph":
          out.push(stripInlineMarkup(block.text));
          break;
        case "quote":
          out.push(`“${stripInlineMarkup(block.text)}”`);
          break;
        case "list":
          out.push(block.items.map((item, index) => `${block.style === "number" ? `${index + 1}.` : block.style === "check" ? "✔" : "-"} ${stripInlineMarkup(item)}`).join("\n"));
          break;
        case "callout":
          out.push(`${block.label}\n${stripInlineMarkup(block.text)}`);
          break;
        case "photo":
          out.push(`[사진 자리] ${stripInlineMarkup(block.slot)}`);
          break;
        case "info":
          out.push(block.rows.map((row) => `${row.label}: ${stripInlineMarkup(row.value)}`).join("\n"));
          break;
        case "divider":
          out.push("────────");
          break;
      }
    }
  }
  if (post.hashtags.length > 0) out.push(post.hashtags.map((tag) => `#${tag.replace(/^#/, "")}`).join(" "));
  return out.join("\n\n");
}
