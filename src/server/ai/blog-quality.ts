import {
  countCharsNoSpaces,
  postBodyText,
  stripInlineMarkup,
  type BlogBlock,
  type BlogPost,
  type BlogSection,
} from "@/server/blog/post";

/**
 * Phrases that make Korean marketing copy read as machine-written, or that
 * the Korean advertising rules treat as unprovable superlatives. The same
 * list is given to the writer, so the gate and the prompt cannot drift.
 */
export const AI_TELL_PHRASES = [
  "안녕하세요, 오늘은",
  "알아보겠습니다",
  "알아보도록 하겠습니다",
  "살펴보겠습니다",
  "살펴보도록 하겠습니다",
  "결론적으로",
  "마무리하며",
  "요약하자면",
  "다양한 매력",
  "이처럼",
  "~해보는 건 어떨까요",
  "놓치지 마세요",
  "여러분",
  "해보시길 바랍니다",
  "중요한 역할을",
] as const;

export const UNPROVABLE_CLAIMS = ["최고의", "최고급", "최저가", "1등", "일등", "유일한", "압도적", "혁신적", "100%", "완벽한", "세계 최초", "국내 최초"] as const;

export const BLOG_LENGTH = {
  /** Naver-style count: characters without spaces. */
  minTotal: 1_500,
  targetTotal: 2_100,
  maxTotal: 3_600,
  minBodySections: 5,
  maxBodySections: 8,
  minSectionChars: 200,
  maxParagraphChars: 320,
  minEmoji: 8,
  maxEmoji: 45,
  minPhotos: 4,
} as const;

export type BlogIssueKind = "length" | "structure" | "emoji" | "emphasis" | "photos" | "quote" | "callout" | "keyword" | "wording" | "monotony";

export interface BlogIssue {
  /** Index into `post.sections`, or null for a problem of the whole post. */
  section: number | null;
  kind: BlogIssueKind;
  message: string;
}

export interface BlogQualityInput {
  post: BlogPost;
  /** Keywords the post should contain (config + business). */
  keywords: string[];
  /** Everything the writer was allowed to rely on; numbers with units must come from here. */
  facts: string;
}

const EMOJI = /\p{Extended_Pictographic}/gu;
const NUMBER_WITH_UNIT = /\d[\d,.]*\s*(?:원|만원|천원|%|퍼센트|시간|시|분|초|명|년|월|일|호|km|m|kg|g|ml|인분)/g;

function sectionText(section: BlogSection): string {
  return postBodyText({ title: "", sections: [section], hashtags: [] });
}

function blocksOf<T extends BlogBlock["type"]>(post: BlogPost, type: T): Array<Extract<BlogBlock, { type: T }>> {
  return post.sections.flatMap((section) => section.blocks).filter((block): block is Extract<BlogBlock, { type: T }> => block.type === type);
}

/** Last two syllables of each sentence: a rough way to spot "…해요. …해요. …해요." monotony. */
function endings(text: string): string[] {
  return text
    .split(/(?<=[.!?。])\s+|\n+/)
    .map((sentence) => sentence.replace(/[.!?。\s…~✨\p{Extended_Pictographic}]+$/gu, "").trim())
    .filter((sentence) => sentence.length > 8)
    .map((sentence) => sentence.slice(-2));
}

/**
 * Cheap, deterministic checks on a generated post. Each issue names the
 * section it belongs to so the handler can rewrite just those sections
 * (never the whole post, never a loop). Messages are Korean fix instructions
 * that are fed straight back to the writer.
 */
export function assessBlogPost({ post, keywords, facts }: BlogQualityInput): BlogIssue[] {
  const issues: BlogIssue[] = [];
  const body = postBodyText(post);
  const total = countCharsNoSpaces(body);
  const bodySections = post.sections.map((section, index) => ({ section, index })).filter(({ section }) => Boolean(section.heading));
  // Intro = first section without heading; closing = last section when it is the final one.
  const lengths = post.sections.map((section) => countCharsNoSpaces(sectionText(section)));

  if (total < BLOG_LENGTH.minTotal) {
    // Ask the thinnest body sections to grow rather than blaming the post as a whole.
    const thin = bodySections.map(({ index }) => ({ index, length: lengths[index] })).sort((a, b) => a.length - b.length).slice(0, 3);
    for (const { index, length } of thin) {
      issues.push({ kind: "length", section: index, message: `이 부분이 짧아요(${length}자). 제공된 사실 안에서 장면·감각·이유를 더해 ${Math.ceil(BLOG_LENGTH.targetTotal / Math.max(1, post.sections.length))}자 이상으로 늘려 주세요.` });
    }
    issues.push({ kind: "length", section: null, message: `글 전체가 ${total}자예요. 공백 제외 ${BLOG_LENGTH.minTotal}자 이상이 되도록 글을 풍성하게 해 주세요.` });
  }
  if (total > BLOG_LENGTH.maxTotal) issues.push({ kind: "length", section: null, message: `글이 너무 길어요(${total}자). ${BLOG_LENGTH.maxTotal}자 이하로 줄여 주세요.` });
  if (bodySections.length < BLOG_LENGTH.minBodySections) issues.push({ kind: "structure", section: null, message: `소제목이 있는 부분이 ${bodySections.length}개예요. ${BLOG_LENGTH.minBodySections}개 이상이어야 해요.` });
  if (bodySections.length > BLOG_LENGTH.maxBodySections) issues.push({ kind: "structure", section: null, message: `소제목이 너무 많아요(${bodySections.length}개). ${BLOG_LENGTH.maxBodySections}개 이하로 합쳐 주세요.` });

  for (const { section, index } of bodySections) {
    if (!/^\p{Extended_Pictographic}/u.test(section.heading ?? "")) issues.push({ kind: "emoji", section: index, message: "소제목은 이모지 하나로 시작해 주세요." });
    for (const block of section.blocks) {
      if (block.type === "paragraph" && countCharsNoSpaces(stripInlineMarkup(block.text)) > BLOG_LENGTH.maxParagraphChars) {
        issues.push({ kind: "structure", section: index, message: "문단이 너무 길어요. 2~4문장(220자 안팎)씩 끊어 여러 문단으로 나눠 주세요." });
        break;
      }
    }
  }

  const emojiCount = (post.sections.flatMap((section) => [section.heading ?? "", ...section.blocks.map((block) => ("text" in block ? block.text : ""))]).join(" ").match(EMOJI) ?? []).length;
  if (emojiCount < BLOG_LENGTH.minEmoji) issues.push({ kind: "emoji", section: null, message: `이모지가 ${emojiCount}개뿐이에요. 소제목과 문단 끝에 자연스럽게 ${BLOG_LENGTH.minEmoji}개 이상 넣어 주세요.` });
  if (emojiCount > BLOG_LENGTH.maxEmoji) issues.push({ kind: "emoji", section: null, message: `이모지가 너무 많아요(${emojiCount}개). ${BLOG_LENGTH.maxEmoji}개 이하로 줄여 주세요.` });

  const allText = post.sections.flatMap((section) => section.blocks.flatMap((block) => ("text" in block ? [block.text] : block.type === "list" ? block.items : []))).join("\n");
  if ((allText.match(/\*\*[^*]+\*\*/g) ?? []).length < 5) issues.push({ kind: "emphasis", section: null, message: "핵심 혜택·키워드를 **굵게** 강조한 곳이 5곳 이상 있어야 해요." });
  if ((allText.match(/==[^=]+==/g) ?? []).length < 2) issues.push({ kind: "emphasis", section: null, message: "가장 중요한 문장을 ==형광펜==으로 2곳 이상 강조해 주세요." });
  if (blocksOf(post, "photo").length < BLOG_LENGTH.minPhotos) issues.push({ kind: "photos", section: null, message: `사진 자리가 부족해요. 소제목마다 어떤 사진을 넣을지 [사진] 블록을 ${BLOG_LENGTH.minPhotos}개 이상 넣어 주세요.` });
  if (blocksOf(post, "quote").length < 1) issues.push({ kind: "quote", section: null, message: "눈에 띄는 한 줄 인용구(quote)가 하나 이상 있어야 해요." });
  if (blocksOf(post, "callout").length < 1) issues.push({ kind: "callout", section: null, message: "꿀팁·포인트 박스(callout)가 하나 이상 있어야 해요." });

  // Keywords: in the title, early in the text, never stuffed.
  const lowered = body.toLowerCase();
  for (const keyword of keywords) {
    const needle = keyword.trim().toLowerCase();
    if (needle.length < 2) continue;
    const count = lowered.split(needle).length - 1;
    if (count > 8) issues.push({ kind: "keyword", section: null, message: `키워드 “${keyword}”가 ${count}번 반복돼요. 자연스럽게 8번 이하로 줄여 주세요.` });
  }
  const primary = keywords.find((keyword) => keyword.trim().length >= 2);
  if (primary && !post.title.toLowerCase().includes(primary.trim().toLowerCase())) {
    // Informational: the title is fixed before writing, so this only flags a post whose body also ignores the keyword.
    if (!lowered.slice(0, 400).includes(primary.trim().toLowerCase())) issues.push({ kind: "keyword", section: 0, message: `첫 부분(400자 안)에 핵심 키워드 “${primary}”를 자연스럽게 넣어 주세요.` });
  }

  // Wording: machine tells and unprovable superlatives, per section so the right part is rewritten.
  post.sections.forEach((section, index) => {
    const text = sectionText(section);
    const tells = AI_TELL_PHRASES.filter((phrase) => text.includes(phrase.replace(/^~/, "")));
    if (tells.length > 0) issues.push({ kind: "wording", section: index, message: `상투적인 표현을 빼 주세요: ${tells.slice(0, 4).map((phrase) => `“${phrase}”`).join(", ")}.` });
    const claims = UNPROVABLE_CLAIMS.filter((phrase) => text.includes(phrase));
    if (claims.length > 0) issues.push({ kind: "wording", section: index, message: `증명할 수 없는 과장 표현을 빼 주세요: ${claims.slice(0, 4).map((phrase) => `“${phrase}”`).join(", ")}.` });
    if ((text.match(/!/g) ?? []).length > 4) issues.push({ kind: "wording", section: index, message: "느낌표를 줄여 주세요(부분당 4개 이하)." });

    // Numbers with units that the facts never mentioned are the most likely inventions.
    const invented = [...new Set((text.match(NUMBER_WITH_UNIT) ?? []).map((value) => value.replace(/\s+/g, "")))].filter((value) => !facts.replace(/\s+/g, "").includes(value));
    if (invented.length > 0) issues.push({ kind: "wording", section: index, message: `제공되지 않은 숫자는 쓰지 마세요: ${invented.slice(0, 4).join(", ")}. 숫자 없이 표현해 주세요.` });
  });

  // Monotony: the same sentence ending or opening over and over.
  const allEndings = endings(body);
  if (allEndings.length >= 12) {
    const counts = new Map<string, number>();
    for (const ending of allEndings) counts.set(ending, (counts.get(ending) ?? 0) + 1);
    const [topEnding, topCount] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (topCount / allEndings.length > 0.45) issues.push({ kind: "monotony", section: null, message: `문장 끝이 “…${topEnding}”로 너무 자주 끝나요. 어미와 문장 길이를 다양하게(질문·명사형·짧은 문장 섞기) 써 주세요.` });
  }
  const sentences = body.split(/(?<=[.!?。])\s+|\n+/).map((sentence) => sentence.trim()).filter((sentence) => sentence.length > 6);
  let run = 1;
  for (let index = 1; index < sentences.length; index++) {
    run = sentences[index].slice(0, 4) === sentences[index - 1].slice(0, 4) ? run + 1 : 1;
    if (run >= 3) {
      issues.push({ kind: "monotony", section: null, message: "비슷한 문장 시작이 연달아 반복돼요. 문장 시작을 다양하게 써 주세요." });
      break;
    }
  }

  return issues;
}

export function emojiCountOf(text: string): number {
  return (text.match(EMOJI) ?? []).length;
}

/**
 * Gives every issue a home. Section-specific issues stay where they are; issues about the post as a
 * whole (too few photos, no quote …) are handed to the sections best placed to fix them, so a rewrite
 * touches as few sections as possible.
 */
export function assignIssues(post: BlogPost, issues: BlogIssue[]): Map<number, string[]> {
  const result = new Map<number, string[]>();
  const add = (index: number, message: string) => result.set(index, [...(result.get(index) ?? []), message]);
  const bodyIndexes = post.sections.map((section, index) => (section.heading ? index : -1)).filter((index) => index >= 0);
  const count = (index: number, predicate: (block: BlogBlock) => boolean) => post.sections[index].blocks.filter(predicate).length;
  const textOf = (index: number) => sectionText(post.sections[index]);
  const pick = (candidates: number[], score: (index: number) => number, take: number) =>
    [...candidates].sort((a, b) => score(a) - score(b)).slice(0, take);

  for (const issue of issues) {
    if (issue.section !== null) {
      add(issue.section, issue.message);
      continue;
    }
    switch (issue.kind) {
      case "photos":
        pick(bodyIndexes.filter((index) => count(index, (block) => block.type === "photo") === 0), () => 0, 3).forEach((index) => add(index, "이 부분에 [사진] 자리(photo 블록)를 하나 넣어 주세요."));
        break;
      case "quote":
        add(bodyIndexes[0] ?? 0, "이 부분에 눈에 띄는 한 줄 인용구(quote 블록)를 넣어 주세요.");
        break;
      case "callout":
        add(bodyIndexes[Math.min(1, bodyIndexes.length - 1)] ?? 0, "이 부분에 꿀팁·포인트 박스(callout 블록)를 넣어 주세요.");
        break;
      case "emphasis":
        pick(bodyIndexes, (index) => (textOf(index).match(/\*\*|==/g) ?? []).length, 3).forEach((index) => add(index, "핵심 혜택은 **굵게**, 가장 중요한 한 문장은 ==형광펜==으로 강조해 주세요."));
        break;
      case "emoji":
        pick(bodyIndexes, (index) => emojiCountOf(textOf(index)), 3).forEach((index) => add(index, "문단 끝 등에 어울리는 이모지를 두세 개 더 넣어 주세요."));
        break;
      case "length":
        pick(bodyIndexes, (index) => countCharsNoSpaces(textOf(index)), 3).forEach((index) => add(index, issue.message));
        break;
      default:
        pick(bodyIndexes, (index) => -countCharsNoSpaces(textOf(index)), 2).forEach((index) => add(index, issue.message));
    }
  }
  return result;
}
