import { htmlToText } from "@/server/shared/html";

/** Phrases that make Korean marketing copy read as machine-written or as a stock ad. */
const STOCK_PHRASES = [
  "안녕하세요, 오늘은",
  "알아보겠습니다",
  "알아보도록 하겠습니다",
  "살펴보겠습니다",
  "결론적으로",
  "마무리하며",
  "어떨까요?",
  "놓치지 마세요",
  "지금 바로",
  "최고의",
  "압도적인",
  "혁신적인",
];

const MIN_PLAIN_LENGTH = 400;
const MIN_PARAGRAPHS = 3;
const MAX_KEYWORD_REPEATS = 6;
const MAX_EXCLAMATIONS = 3;

export interface BlogQualityInput {
  bodyHtml: string;
  keywords: string[];
}

/**
 * Cheap, deterministic checks on a generated post. Returns Korean fix
 * instructions (empty when the post passes) that the handler feeds back
 * into exactly one regeneration — never a loop.
 */
export function assessBlogBody({ bodyHtml, keywords }: BlogQualityInput): string[] {
  const text = htmlToText(bodyHtml);
  const paragraphs = text.split(/\n{2,}/).filter(Boolean);
  const issues: string[] = [];

  if (text.length < MIN_PLAIN_LENGTH) issues.push(`본문이 너무 짧아요(${text.length}자). 최소 ${MIN_PLAIN_LENGTH}자 이상, 구체적인 내용으로 채워 주세요.`);
  if (paragraphs.length < MIN_PARAGRAPHS) issues.push(`문단을 ${MIN_PARAGRAPHS}개 이상으로 나눠 주세요.`);

  const lowered = text.toLowerCase();
  for (const keyword of keywords) {
    const needle = keyword.trim().toLowerCase();
    if (needle.length < 2) continue;
    const count = lowered.split(needle).length - 1;
    if (count > MAX_KEYWORD_REPEATS) issues.push(`키워드 “${keyword}”가 ${count}번 반복돼요. 자연스럽게 ${MAX_KEYWORD_REPEATS}번 이하로 줄여 주세요.`);
  }

  const stock = STOCK_PHRASES.filter((phrase) => text.includes(phrase));
  if (stock.length > 0) issues.push(`상투적인 표현을 빼 주세요: ${stock.slice(0, 4).map((phrase) => `“${phrase}”`).join(", ")}.`);

  if ((text.match(/!/g) ?? []).length > MAX_EXCLAMATIONS) issues.push("느낌표를 줄이고 차분한 문장으로 써 주세요.");
  if ((text.match(/\p{Extended_Pictographic}/gu) ?? []).length > 2) issues.push("이모지를 빼 주세요.");

  // Same sentence opening repeated three or more times in a row reads as templated.
  const sentences = text.split(/(?<=[.!?。])\s+|\n+/).map((sentence) => sentence.trim()).filter((sentence) => sentence.length > 6);
  let run = 1;
  for (let index = 1; index < sentences.length; index++) {
    run = sentences[index].slice(0, 4) === sentences[index - 1].slice(0, 4) ? run + 1 : 1;
    if (run >= 3) {
      issues.push("비슷한 문장 시작이 반복돼요. 문장 길이와 시작을 다양하게 써 주세요.");
      break;
    }
  }

  return issues;
}
