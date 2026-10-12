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

/** Optional look chosen by the publishing guide; every field falls back to the built-in style. */
export interface BlogRenderTheme {
  headingColor: string;
  headingSize: number;
  bodyColor: string;
  bodySize: number;
  lineHeight: number;
  emphasisColor: string;
  emphasisSize: number;
}

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

function renderBlock(block: BlogBlock, platform: BlogPlatform, theme?: BlogRenderTheme, photoNumber = 0): string {
  const semantic = platform !== "naver";
  const bodyColor = theme?.bodyColor ?? COLOR.text;
  const bodySize = theme?.bodySize ?? 16;
  const lineHeight = theme?.lineHeight ?? 1.95;
  switch (block.type) {
    case "paragraph":
      return p(`margin:0 0 18px;font-size:${bodySize}px;line-height:${lineHeight};color:${bodyColor};`, inlineToHtml(block.text));
    case "quote":
      return `<blockquote style="margin:24px 0;padding:16px 20px;border-left:5px solid ${theme?.emphasisColor ?? COLOR.accent};background-color:${COLOR.quoteBg};font-size:${theme?.emphasisSize ?? 18}px;font-weight:700;line-height:1.7;color:${theme?.emphasisColor ?? COLOR.quoteText};">${inlineToHtml(block.text)}</blockquote>`;
    case "list": {
      const items = block.items.map((item) => inlineToHtml(item));
      if (!semantic || block.style === "check") {
        const mark = (index: number) => (block.style === "number" ? `${index + 1}.` : block.style === "check" ? "✔" : "•");
        return items.map((item, index) => p(`margin:0 0 8px;padding-left:4px;font-size:${bodySize}px;line-height:1.8;color:${bodyColor};`, `<strong>${mark(index)}</strong> ${item}`)).join("\n") + p("margin:0 0 10px;", "&nbsp;");
      }
      const tag = block.style === "number" ? "ol" : "ul";
      return `<${tag} style="margin:0 0 18px;padding-left:22px;font-size:${bodySize}px;line-height:1.9;color:${bodyColor};">${items.map((item) => `<li>${item}</li>`).join("")}</${tag}>`;
    }
    case "callout":
      return `<div style="margin:22px 0;padding:16px 20px;border:1px solid ${COLOR.calloutBorder};background-color:${COLOR.calloutBg};border-radius:12px;">${p(`margin:0 0 6px;font-size:${bodySize}px;font-weight:700;color:${theme?.headingColor ?? COLOR.heading};`, escapeHtml(block.label))}${p(`margin:0;font-size:${bodySize}px;line-height:1.85;color:${bodyColor};`, inlineToHtml(block.text))}</div>`;
    case "photo":
      return p(`margin:22px 0;padding:18px 12px;border:1px dashed #D1D5DB;text-align:center;font-size:14px;color:${COLOR.muted};`, `📷 <strong>이미지 ${photoNumber} 삽입 자리</strong> · ${inlineToHtml(block.slot)}${block.caption ? `<br>${inlineToHtml(block.caption)}` : ""}`);
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

function renderHeading(heading: string, platform: BlogPlatform, theme?: BlogRenderTheme): string {
  const inner = inlineToHtml(heading);
  const color = theme?.headingColor ?? COLOR.heading;
  const rule = `${theme?.headingColor ?? COLOR.accent}`;
  const size = theme?.headingSize ?? 23;
  if (platform === "naver") {
    return p(`margin:42px 0 16px;padding-bottom:8px;border-bottom:3px solid ${rule};font-size:${size}px;font-weight:700;line-height:1.5;color:${color};`, `<strong>${inner}</strong>`);
  }
  return `<h2 style="margin:42px 0 16px;padding-bottom:8px;border-bottom:3px solid ${rule};font-size:${size}px;font-weight:700;line-height:1.5;color:${color};">${inner}</h2>`;
}

/** The post body (without the title, which every editor has its own field for). */
export function renderBlogHtml(post: BlogPost, platform: BlogPlatform = "generic", theme?: BlogRenderTheme): string {
  const parts: string[] = [];
  let photoNumber = 0;
  for (const section of post.sections) {
    if (section.heading) parts.push(renderHeading(section.heading, platform, theme));
    for (const block of section.blocks) {
      if (block.type === "photo") photoNumber += 1;
      parts.push(renderBlock(block, platform, theme, photoNumber));
    }
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
  let photoNumber = 0;
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
          photoNumber += 1;
          out.push(`[이미지 ${photoNumber} 삽입] ${stripInlineMarkup(block.slot)}`);
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
