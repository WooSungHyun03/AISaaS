import { blogPostSchema, type BlogBlock, type BlogPost, type BlogSection } from "./post";

/**
 * The editable form of a post. Plain text the owner can read and fix in a
 * textarea, round-tripped losslessly with the structured blocks:
 *
 *   # 제목
 *   문단 … **굵게** ==형광펜==            (a paragraph = consecutive lines)
 *   ## 🍞 소제목                           (starts a section)
 *   > 인용구
 *   - 항목                                 (bullet list)   ✔ 항목 (check list)   1. 항목 (numbered)
 *   [포인트] 💡 꿀팁 | 본문                (callout)
 *   [사진] 무엇을 찍을지 | 캡션            (photo slot; `[사진 2]` = the owner's uploaded photo no. 2)
 *   [정보] 라벨 | 값                       (business info row; consecutive rows form one box)
 *   ---                                    (divider)
 *   #해시태그 #해시태그                    (last line)
 *
 * Blank lines separate blocks.
 */
export function postToMarkup(post: BlogPost): string {
  const lines: string[] = [`# ${post.title}`, ""];
  for (const section of post.sections) {
    if (section.heading) lines.push(`## ${section.heading}`, "");
    for (const block of section.blocks) {
      lines.push(...blockToLines(block), "");
    }
  }
  if (post.hashtags.length > 0) lines.push(post.hashtags.map((tag) => `#${tag.replace(/^#/, "")}`).join(" "), "");
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function blockToLines(block: BlogBlock): string[] {
  switch (block.type) {
    case "paragraph":
      return [oneLine(block.text)];
    case "quote":
      return [`> ${oneLine(block.text)}`];
    case "list":
      return block.items.map((item, index) =>
        block.style === "number" ? `${index + 1}. ${oneLine(item)}` : block.style === "check" ? `✔ ${oneLine(item)}` : `- ${oneLine(item)}`);
    case "callout":
      return [`[포인트] ${oneLine(block.label)} | ${oneLine(block.text)}`];
    case "photo":
      return [`[사진${block.ref ? ` ${block.ref}` : ""}] ${oneLine(block.slot)}${block.caption ? ` | ${oneLine(block.caption)}` : ""}`];
    case "info":
      return block.rows.map((row) => `[정보] ${oneLine(row.label)} | ${oneLine(row.value)}`);
    case "divider":
      return ["---"];
  }
}

const oneLine = (text: string) => text.replace(/\s*\n\s*/g, " ").trim();

/** Parses the markup back into a post. Tolerant: unknown lines become paragraph text, never an error. */
export function markupToPost(markup: string): BlogPost {
  const rawLines = markup.replace(/\r\n?/g, "\n").split("\n");
  let title = "";
  const sections: BlogSection[] = [];
  let current: BlogSection = { blocks: [] };
  let hashtags: string[] = [];

  let paragraph: string[] = [];
  let infoRows: Array<{ label: string; value: string }> = [];
  let listStyle: "check" | "number" | "bullet" | null = null;
  let listItems: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length > 0) current.blocks.push({ type: "paragraph", text: paragraph.join(" ").trim() });
    paragraph = [];
  };
  const flushInfo = () => {
    if (infoRows.length > 0) current.blocks.push({ type: "info", rows: infoRows });
    infoRows = [];
  };
  const flushList = () => {
    if (listStyle && listItems.length >= 2) current.blocks.push({ type: "list", style: listStyle, items: listItems });
    else if (listStyle) for (const item of listItems) current.blocks.push({ type: "paragraph", text: item });
    listStyle = null;
    listItems = [];
  };
  const flushAll = () => {
    flushParagraph();
    flushInfo();
    flushList();
  };
  const pushSection = () => {
    flushAll();
    if (current.blocks.length > 0 || current.heading) sections.push({ ...current, blocks: current.blocks.length > 0 ? current.blocks : [{ type: "paragraph", text: current.heading ?? "" }] });
  };

  for (const rawLine of rawLines) {
    const line = rawLine.trim();
    if (!line) {
      flushAll();
      continue;
    }
    if (/^# /.test(line) && !title && sections.length === 0 && current.blocks.length === 0) {
      title = line.slice(2).trim();
      continue;
    }
    if (/^## /.test(line)) {
      pushSection();
      current = { heading: line.slice(3).trim(), blocks: [] };
      continue;
    }
    if (/^#[^\s#]/.test(line)) {
      flushAll();
      hashtags = line.split(/\s+/).filter((token) => token.startsWith("#") && token.length > 1).map((token) => token.slice(1));
      continue;
    }
    if (line === "---") {
      flushAll();
      current.blocks.push({ type: "divider" });
      continue;
    }
    const tagged = line.match(/^\[(포인트|사진(?:\s*\d{1,2})?|정보)\]\s*(.*)$/);
    if (tagged) {
      const [labelPart, ...rest] = tagged[2].split("|");
      const label = labelPart.trim();
      const value = rest.join("|").trim();
      if (tagged[1] === "정보") {
        flushParagraph();
        flushList();
        if (label && value) infoRows.push({ label, value });
        continue;
      }
      flushAll();
      if (tagged[1] === "포인트" && label && value) current.blocks.push({ type: "callout", label, text: value });
      else if (tagged[1].startsWith("사진") && label) {
        const ref = Number(tagged[1].replace(/\D/g, ""));
        current.blocks.push({ type: "photo", slot: label, caption: value, ...(ref >= 1 && ref <= 10 ? { ref } : {}) });
      }
      continue;
    }
    if (line.startsWith("> ")) {
      flushAll();
      current.blocks.push({ type: "quote", text: line.slice(2).trim() });
      continue;
    }
    const numbered = line.match(/^\d+\.\s+(.*)$/);
    const checked = line.match(/^✔\s*(.*)$/);
    const bullet = line.match(/^[-•]\s+(.*)$/);
    const listMatch = numbered ? (["number", numbered[1]] as const) : checked ? (["check", checked[1]] as const) : bullet ? (["bullet", bullet[1]] as const) : null;
    if (listMatch) {
      flushParagraph();
      flushInfo();
      if (listStyle && listStyle !== listMatch[0]) flushList();
      listStyle = listMatch[0];
      listItems.push(listMatch[1].trim());
      continue;
    }
    flushInfo();
    flushList();
    paragraph.push(line);
  }
  pushSection();

  const post = {
    title: title || "제목 없음",
    sections: sections.length > 0 ? sections : [{ blocks: [{ type: "paragraph" as const, text: "내용이 없어요." }] }],
    hashtags,
  };
  const parsed = blogPostSchema.safeParse(post);
  if (parsed.success) return parsed.data;
  // Over-long or empty pieces: keep what is valid instead of failing the owner's edit.
  return {
    title: post.title.slice(0, 120),
    sections: post.sections
      .map((section) => ({
        heading: section.heading?.slice(0, 80),
        blocks: section.blocks.flatMap((block) => {
          const checked = blogPostSchema.shape.sections.element.shape.blocks.element.safeParse(block);
          return checked.success ? [checked.data] : [];
        }),
      }))
      .filter((section) => section.blocks.length > 0),
    hashtags: hashtags.slice(0, 20).map((tag) => tag.slice(0, 40)),
  };
}

/** Whether stored content is this markup (new posts) rather than the plain text older posts were saved as. */
export function looksLikeBlogMarkup(content: string): boolean {
  return /^#\s+\S/.test(content.trimStart()) && /^##\s+\S/m.test(content);
}
