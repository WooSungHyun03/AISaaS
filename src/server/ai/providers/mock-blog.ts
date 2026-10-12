/**
 * Deterministic blog outline / section responses for the mock AI provider (local development and CI).
 * They are written to pass the same quality gate as a real post: enough characters, emphasis, emoji, photo
 * spots, a quote and a callout, and no numbers with units.
 */
const HEADINGS = ["🥐 처음 오시는 분께 꼭 알려드리고 싶은 점", "✨ 저희가 가장 신경 쓰는 부분", "📌 이렇게 고르시면 실패가 없어요", "🍞 하루가 어떻게 흘러가는지 보여드릴게요", "💬 자주 받는 질문에 먼저 답해 드려요", "🌿 오래 찾아주시는 분들이 좋아하는 이유"];

function field(text: string | undefined, label: string): string | undefined {
  return text?.match(new RegExp(`${label}\\s*:\\s*(.+)`))?.[1]?.trim();
}

/** Planner answer: topic, keywords and an outline with photo spots, a quote, a callout and a list. */
export function mockBlogPlan(prompt: string, system = ""): string {
  const fixed = prompt.match(/exactly this planned topic, without replacing it: "([^"]+)"/)?.[1];
  const topic = fixed ?? "단골 손님이 가장 자주 묻는 질문 정리";
  const business = field(system, "상호") ?? "우리 가게";
  const keywords = (field(system, "이번 글의 핵심 키워드") ?? field(system, "업체 키워드") ?? "").split(",").map((item) => item.trim()).filter(Boolean);
  return JSON.stringify({
    topic,
    title: `${keywords[0] ?? topic}, ${business} 이야기`.slice(0, 60),
    reader: "처음 방문을 고민하는 동네 손님",
    angle: "고르는 기준과 매장의 방식을 솔직하게 풀어 주기",
    searchIntent: "처음 알아보는 사람이 기본 정보와 선택 기준을 찾는 검색",
    hookIdea: "손님이 가장 먼저 묻는 질문으로 시작해 궁금증을 풀어 준다",
    keywords: { primary: keywords[0] ?? topic.slice(0, 12), secondary: keywords.slice(1, 4) },
    sections: HEADINGS.map((heading, index) => ({
      heading,
      purpose: `독자가 ${index + 1}번째로 궁금해하는 점에 답하기`,
      points: ["제공된 사실에 근거한 설명", "독자의 상황에 맞춘 팁"],
      photo: index % 3 === 2 ? null : `${business}의 ${heading.replace(/^\S+\s/, "")}을 보여주는 사진`,
      extra: index === 0 ? "quote" : index === 1 ? "callout" : index === 3 ? "list" : "none",
    })),
    closing: { takeaway: "편하게 들러서 직접 확인해 보세요", cta: "궁금한 점은 가게로 편하게 문의해 주세요" },
  });
}

interface MockSectionSpec {
  heading: string;
  photo: string | null;
  quote: boolean;
  callout: boolean;
  list: boolean;
}

function mockSectionBlocks(spec: MockSectionSpec | null, kind: "intro" | "body" | "closing", index: number, business: string, keywordText: string): unknown[] {
  const blocks: unknown[] = [];
  if (kind === "intro") {
    blocks.push(
      { type: "paragraph", text: `${keywordText ? `${keywordText}, ` : ""}어디서부터 알아봐야 할지 막막하셨죠? ${business}에 가장 많이 들어오는 질문부터 하나씩 풀어 볼게요 🙂` },
      { type: "paragraph", text: `이 글은 처음 오시는 분이 **미리 알고 오면 편한 이야기**만 골라 담았어요. 매장에서 직접 손님과 나눈 대화가 바탕이라, 읽고 나면 방문 전에 궁금한 점이 대부분 풀릴 거예요 ✨` },
      { type: "paragraph", text: `끝까지 읽어 주시면 ==무엇을 기준으로 고르면 되는지== 분명해질 거라고 생각해요. 편한 마음으로 따라와 주세요.` },
      { type: "quote", text: "처음이라 어색한 마음, 저희가 먼저 풀어 드릴게요" },
    );
  } else if (kind === "closing") {
    blocks.push(
      { type: "paragraph", text: `여기까지 읽어 주셔서 고맙습니다. 정리하면 **${business}는 천천히 설명드리는 곳**이에요. 처음이라 망설여지신다면 그 마음 그대로 오셔도 괜찮습니다 😊` },
      { type: "paragraph", text: `궁금한 점이 남았다면 가게로 편하게 문의해 주세요. 방문 전에 필요한 내용은 미리 안내해 드릴게요. 가까운 시간에 들러서 직접 확인해 보세요 🍀` },
    );
  } else if (spec) {
    const openers = ["가장 먼저 말씀드리고 싶은 건", "솔직히 이 부분은", "손님들이 자주 놓치시는 게", "저희가 오래 고민한 건", "의외로 중요한 게", "마지막으로 꼭 짚고 싶은 건"];
    blocks.push(
      { type: "paragraph", text: `${openers[index % openers.length]} **${spec.heading.replace(/^\S+\s/, "") || "기본기"}**예요. 눈에 잘 띄지 않아도 쌓이면 결과가 달라지기 때문에 매일 같은 순서로 챙기고 있어요 😊` },
      { type: "paragraph", text: `예를 들어 오시는 분의 상황을 먼저 여쭙고, 그에 맞는 방법을 천천히 보여 드려요. ==급하게 권하지 않는 것==이 저희의 원칙이라서 고민할 시간은 충분히 드립니다.` },
      { type: "paragraph", text: `궁금한 건 언제든 물어보세요. 사소한 질문일수록 나중에 큰 도움이 되더라고요 🌿 이렇게 하나씩 맞춰 가면 처음 오신 날과 두 번째 오신 날의 표정이 달라져요.` },
    );
    if (spec.photo) blocks.push({ type: "photo", slot: spec.photo, caption: "직접 찍은 사진으로 바꿔 주세요" });
    if (spec.quote) blocks.push({ type: "quote", text: "작은 차이가 결과를 만듭니다" });
    if (spec.callout) blocks.push({ type: "callout", label: "💡 꿀팁", text: "방문 전에 **궁금한 점을 메모**해 오시면 훨씬 알차게 상담받으실 수 있어요." });
    if (spec.list) blocks.push({ type: "list", style: "check", items: ["오시기 전에 궁금한 점 적어 두기", "편한 복장으로 오기", "모르는 건 바로 물어보기"] });
  }
  return blocks;
}

/** The plan's section lines in a draft / fix prompt: "3. 🥐 heading — purpose: … Photo block: slot = "…" … Include one quote block." */
function specsFromBrief(prompt: string): MockSectionSpec[] {
  return [...prompt.matchAll(/^\d+\. (.+?) — purpose:(.*)$/gm)].map((match) => ({
    heading: match[1].trim(),
    photo: match[2].match(/slot = "([^"]+)"/)?.[1] ?? null,
    quote: /Include one quote block/.test(match[2]),
    callout: /Include one callout block/.test(match[2]),
    list: /Include one list block/.test(match[2]),
  }));
}

function mockTitle(prompt: string): string {
  return prompt.match(/^Post title: (.+)$/m)?.[1]?.trim() ?? "블로그 글";
}

function mockKeywordText(system: string, prompt: string): string {
  const fromSystem = (field(system, "이번 글의 핵심 키워드") ?? field(system, "업체 키워드") ?? "").split(",").map((item) => item.trim()).filter(Boolean);
  return (fromSystem.length > 0 ? fromSystem : [prompt.match(/^Primary keyword: ([^;\n]+)/m)?.[1]?.trim() ?? ""]).filter(Boolean).slice(0, 2).join(", ");
}

/** Writer answer: the whole post — intro, one section per planned heading, closing. */
export function mockBlogDraft(prompt: string, system = ""): string {
  const business = field(system, "상호") ?? "우리 가게";
  const keywordText = mockKeywordText(system, prompt);
  const specs = specsFromBrief(prompt);
  return JSON.stringify({
    title: mockTitle(prompt),
    sections: [
      { blocks: mockSectionBlocks(null, "intro", 0, business, keywordText) },
      ...specs.map((spec, index) => ({ heading: spec.heading, blocks: mockSectionBlocks(spec, "body", index, business, keywordText) })),
      { blocks: mockSectionBlocks(null, "closing", 0, business, keywordText) },
    ],
  });
}

/** Writer answer to a targeted fix: a clean rewrite of each listed section (the problems named in the prompt are gone). */
export function mockBlogFix(prompt: string, system = ""): string {
  const business = field(system, "상호") ?? "우리 가게";
  const keywordText = mockKeywordText(system, prompt);
  const specs = specsFromBrief(prompt);
  const sections = [...prompt.matchAll(/^SECTION (\d+)(?: \(heading: ([^)]*)\))?/gm)].map((match) => {
    const index = Number(match[1]);
    const heading = match[2]?.trim();
    const spec = specs.find((item) => item.heading === heading) ?? (heading ? { heading, photo: null, quote: false, callout: false, list: false } : null);
    const kind = heading ? "body" : index === 0 ? "intro" : "closing";
    return { index, ...(heading ? { heading } : {}), blocks: mockSectionBlocks(spec, kind, Math.max(index - 1, 0), business, keywordText) };
  });
  return JSON.stringify({ sections });
}

/** Reviewer answer: everything is supported. */
export function mockBlogReview(): string {
  return JSON.stringify({ unsupported: [], seo: {} });
}

/** Local-development answer for the publishing guide: plausible, deterministic and checked like a real one. */
export function mockBlogGuide(prompt: string): string {
  const title = prompt.match(/^Post title: (.+)$/m)?.[1]?.trim() ?? "블로그 글";
  const keywords = (prompt.match(/^Owner keywords: (.+)$/m)?.[1] ?? "").split(",").map((item) => item.trim()).filter((item) => item && item !== "(none)");
  const photoCount = [...prompt.matchAll(/^(\d+)\. \(/gm)].length;
  const primary = keywords[0] ?? title.slice(0, 10);
  return JSON.stringify({
    style: {
      fontFamily: "나눔바른고딕",
      titleColor: "#1F2937",
      headingColor: "#1D4ED8",
      bodyColor: "#374151",
      emphasisColor: "#DC2626",
      titleSize: 28,
      headingSize: 24,
      bodySize: 16,
      emphasisSize: 19,
      lineHeight: 1.8,
      titleAlign: "center",
      emphasisMethod: "핵심 단어는 굵게, 가장 중요한 문장 하나는 형광펜으로 표시해요.",
      rationale: "(예시) 개발용 모의 AI가 만든 스타일이에요.",
    },
    images: Array.from({ length: photoCount }, (_, index) => ({
      index: index + 1,
      type: index === 0 ? "대표 사진" : "설명 사진",
      ratio: "4:3",
      caption: `사진 ${index + 1} 설명`,
      altText: `${primary} 관련 사진 ${index + 1}`,
      reason: "글의 내용을 눈으로 확인시켜 줘요.",
    })),
    seo: {
      titleCandidates: [`${primary}, 처음이라면 이것부터 확인하세요`, `${primary} 고르기 전에 알아둘 점`],
      primaryKeyword: primary,
      secondaryKeywords: keywords.slice(1, 4),
      regionKeywords: [],
      searchIntent: "정보 탐색",
      searchIntentNote: "(예시) 처음 알아보는 사람이 기본 정보를 찾는 검색이에요.",
      tags: keywords.slice(0, 6),
      metaDescription: `${primary}에 대해 처음 알아보는 분께 꼭 필요한 내용만 정리했어요. 직접 확인할 수 있는 사실 위주로 담았습니다.`,
    },
  });
}
