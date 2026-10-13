import { afterEach, describe, expect, it, vi } from "vitest";
import type { Automation, Business } from "@/types/domain";
import type { AutomationHandlerResult, AutomationRunContext } from "@/types/automation";

const { generateStructuredMock, summarizeRunSpendMock } = vi.hoisted(() => ({ generateStructuredMock: vi.fn(), summarizeRunSpendMock: vi.fn() }));
vi.mock("@/server/ai/generate", () => ({ generateStructured: generateStructuredMock }));
vi.mock("@/server/budget", () => ({ summarizeRunSpend: summarizeRunSpendMock, isBudgetError: () => false }));
// The handler looks up the owner's other uploaded photos with the admin client; keep the unit tests off any real database.
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => { throw new Error("no database in unit tests"); } }));
const { describeImagesMock } = vi.hoisted(() => ({ describeImagesMock: vi.fn() }));
vi.mock("@/server/shorts/describe-images", () => ({ withImageAnalysis: describeImagesMock }));

const { blogAutomationHandler, applyPlannedPhotoRefs, normalizePhotoRefs } = await import("./blog");
import { mockBlogDraft, mockBlogFix, mockBlogGuide, mockBlogPlan, mockBlogReview } from "@/server/ai/providers/mock-blog";
import { serverEnv } from "@/lib/env/server";
import { aiGuideDraftSchema } from "@/server/ai/prompts/blog-guide";
import { blogPublishingGuideSchema } from "@/server/blog/publishing-guide";

afterEach(() => {
  vi.resetAllMocks();
  summarizeRunSpendMock.mockResolvedValue({ totalUsd: 0, steps: [] });
});

const business: Business = {
  id: "biz-1",
  owner_id: "user-1",
  name: "우리동네 빵집",
  industry: "베이커리",
  description: null,
  location: "서울 마포구",
  target_customer: "20-30대 직장인",
  brand_tone: "친근하고 따뜻한",
  keywords: ["소금빵", "크루아상"],
  website: null,
  sns_links: {},
  main_offering: null,
  strengths: null,
  marketing_goal: null,
  promotion_type: null,
  promotion_details: {},
  public_widget_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

const automation = {
  id: "auto-1",
  user_id: "user-1",
  business_id: "biz-1",
  template_id: "tmpl-1",
  name: "블로그 자동화",
  status: "ACTIVE",
  schedule: {},
  config: {},
  last_run_at: null,
  next_run_at: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
} as unknown as Automation;

type Request = { system: string; prompt: string; role?: string; purpose?: string; schema: { parse(value: unknown): unknown } };
type Deferred = { deferred: { state: Record<string, unknown>; progress?: string } };
type Overrides = Partial<Record<"plan" | "draft" | "fix" | "review" | "guide", (request: Request, call: number) => unknown>>;

const config = { objective: "신메뉴 홍보", keywords: ["소금빵", "성수동 빵집"], tone: "친근하게", deliveryMode: "app_draft" as const };

/** Answers every AI call like the mock provider does, recording the requests. An override may return or throw instead. */
function useMockModels(overrides: Overrides = {}) {
  const calls: Record<string, number> = {};
  generateStructuredMock.mockImplementation(async (request: Request) => {
    const kind = request.prompt.includes("AUTOBIZ_BLOG_PLAN_V2") ? "plan"
      : request.prompt.includes("AUTOBIZ_BLOG_DRAFT_V2") ? "draft"
      : request.prompt.includes("AUTOBIZ_BLOG_FIX_V2") ? "fix"
      : request.prompt.includes("AUTOBIZ_BLOG_REVIEW_V2") ? "review"
      : "guide";
    const call = (calls[kind] = (calls[kind] ?? 0) + 1) - 1;
    const custom = overrides[kind]?.(request, call);
    if (custom !== undefined) return request.schema.parse(custom);
    const raw = kind === "plan" ? mockBlogPlan(request.prompt, request.system)
      : kind === "draft" ? mockBlogDraft(request.prompt, request.system)
      : kind === "fix" ? mockBlogFix(request.prompt, request.system)
      : kind === "review" ? mockBlogReview()
      : mockBlogGuide(request.prompt);
    return request.schema.parse(JSON.parse(raw));
  });
}

const requests = () => generateStructuredMock.mock.calls.map((call) => call[0] as Request);
const ofKind = (marker: string) => requests().filter((request) => request.prompt.includes(marker));

function baseContext(overrides: Partial<AutomationRunContext> = {}): AutomationRunContext {
  return { automation, business, config: config as never, recentTopics: [], runId: "run-1", ...overrides };
}

/** Drives a deferred run to the end like the runner does (start, then resume until it returns a result). */
async function runToEnd(ctx: AutomationRunContext, onStep?: (outcome: Deferred) => void): Promise<AutomationHandlerResult> {
  let outcome = await blogAutomationHandler.run(ctx);
  for (let step = 0; step < 20; step++) {
    if (!("deferred" in outcome)) return outcome;
    onStep?.(outcome as unknown as Deferred);
    outcome = await blogAutomationHandler.resume!(ctx, outcome.deferred.state as never);
  }
  throw new Error("blog run did not finish");
}

/** A draft whose third section breaks the gate: a stock phrase, an unprovable claim and an invented price. */
function draftWithBadSection(request: Request): unknown {
  const draft = JSON.parse(mockBlogDraft(request.prompt, request.system)) as { sections: Array<{ blocks: unknown[] }> };
  draft.sections[2].blocks = [{ type: "paragraph", text: "결론적으로 저희는 최고의 빵집이고 소금빵은 3,500원입니다 🙂" }, { type: "paragraph", text: "소금빵은 **겉바속촉**이에요 ✨" }];
  return draft;
}

describe("blogAutomationHandler", () => {
  it("runs the pipeline in order: Opus plan, Fable draft, Sonnet fact check, Sonnet guide — one model call per step", async () => {
    useMockModels();
    const progress: Array<string | undefined> = [];

    const result = await runToEnd(baseContext(), (step) => progress.push(step.deferred.progress));

    expect(requests().map((request) => `${request.role}:${request.purpose}`)).toEqual(["planner:blog.plan", "writer:blog.draft", "reviewer:blog.review", "reviewer:blog.guide"]);
    expect(progress).toEqual([expect.stringContaining("(2/5)"), expect.stringContaining("(4/5)"), expect.stringContaining("(5/5)")]);
    expect(result.contentType).toBe("blog-marketing");
    expect(result.content).toMatch(/^# /);
    expect(result.content).toContain("## 🥐");
    expect(result.content).toContain("[사진]");
    expect(result.content).toContain("[포인트] 💡 꿀팁");
    expect(result.output).toMatchObject({
      platform: "naver",
      stats: { chars: expect.any(Number), sections: 9, photos: expect.any(Number) },
      bodyHtml: expect.stringContaining("<h2"),
      callToAction: expect.any(String),
      factCheck: { ran: true, flagged: 0, fixed: false },
    });
    const stats = (result.output as { stats: { chars: number; photos: number } }).stats;
    expect(stats.chars).toBeGreaterThanOrEqual(1_500);
    expect(stats.photos).toBeGreaterThanOrEqual(4);
    expect(result.aiGenerationCount).toBe(4);
  });

  it("gives the models enough room to think: no sampling parameters, generous max tokens", async () => {
    useMockModels();
    await runToEnd(baseContext());
    for (const request of requests()) expect(request).not.toHaveProperty("temperature");
    const [plan, draft] = requests() as unknown as Array<{ maxTokens: number }>;
    expect(plan.maxTokens).toBeGreaterThanOrEqual(6_000);
    expect(draft.maxTokens).toBeGreaterThanOrEqual(12_000);
  });

  it("gives the writer the facts, the owner's notes, the platform style and the anti-AI rules", async () => {
    useMockModels();
    await runToEnd(baseContext({ config: { ...config, platform: "tistory", notes: "시그니처는 저온 숙성 소금빵이에요" } as never }));

    const plan = ofKind("AUTOBIZ_BLOG_PLAN_V2")[0];
    expect(plan.system).toContain("상호: 우리동네 빵집");
    expect(plan.system).toContain("위치: 서울 마포구");
    expect(plan.system).toContain("시그니처는 저온 숙성 소금빵이에요");
    expect(plan.system).toContain("Platform: Tistory");
    expect(plan.system).toContain("Never invent prices");
    expect(plan.system).toContain("결론적으로");
    expect(plan.system).toContain("==highlight==");
    const draft = ofKind("AUTOBIZ_BLOG_DRAFT_V2")[0];
    expect(draft.system).toBe(plan.system);
    expect(draft.prompt).toContain("Primary keyword:");
    expect(draft.prompt).toContain("Sections, in order:");
  });

  it("appends a business info box and hashtags that the app builds, not the AI", async () => {
    useMockModels();
    const result = await runToEnd(baseContext({ business: { ...business, main_offering: "소금빵, 크루아상", website: "https://bakery.example.com" } }));

    expect(result.content).toContain("## 📌 우리동네 빵집 정보");
    expect(result.content).toContain("[정보] 📍 위치 | 서울 마포구");
    expect(result.content).toContain("[정보] 🛍️ 대표 메뉴·서비스 | 소금빵, 크루아상");
    expect(result.content).toMatch(/#소금빵 #성수동빵집/);
    expect(result.content?.trim().split("\n").at(-1)).toMatch(/^#\S+/);
  });

  it("drops info boxes and dividers the AI tries to add itself", async () => {
    useMockModels({
      draft: (request) => {
        const draft = JSON.parse(mockBlogDraft(request.prompt, request.system)) as { sections: Array<{ blocks: unknown[] }> };
        draft.sections[1].blocks.push({ type: "info", rows: [{ label: "전화", value: "02-000-0000" }] }, { type: "divider" });
        return draft;
      },
    });
    const result = await runToEnd(baseContext());
    expect(result.content).not.toContain("02-000-0000");
    expect(result.content).not.toMatch(/^---$/m);
  });

  it("rewrites only the sections that fail the quality gate, in ONE targeted Fable call, with the problems and the old text", async () => {
    useMockModels({ draft: draftWithBadSection });

    const result = await runToEnd(baseContext());

    const fixes = ofKind("AUTOBIZ_BLOG_FIX_V2");
    expect(fixes).toHaveLength(1);
    expect(fixes[0].role).toBe("writer");
    expect(fixes[0].purpose).toBe("blog.fix");
    expect(fixes[0].prompt).toContain("SECTION 2");
    expect(fixes[0].prompt).toContain("결론적으로");
    expect(fixes[0].prompt).toContain("3,500원");
    expect(fixes[0].prompt).toContain("Current blocks:");
    expect(fixes[0].prompt.match(/^SECTION \d+/gm)!.length).toBeLessThanOrEqual(4);
    expect(ofKind("AUTOBIZ_BLOG_DRAFT_V2")).toHaveLength(1); // the post is never rewritten as a whole
    expect(result.content).not.toContain("3,500원");
    expect(result.content).not.toContain("결론적으로");
  });

  it("keeps the original section when the fix fails, tells the owner, and still finishes", async () => {
    useMockModels({ draft: draftWithBadSection, fix: () => { throw new Error("AI unavailable"); } });

    const result = await runToEnd(baseContext());

    expect(result.content).toContain("결론적으로");
    expect(result.output).toMatchObject({ qualityNotes: expect.arrayContaining([expect.stringContaining("자동으로 다듬지 못했어요")]) });
  });

  it("fixes a concrete unsupported claim found by the fact check, once, and keeps low-severity findings as notes", async () => {
    useMockModels({
      review: () => ({
        unsupported: [
          { section: 3, quote: "매일 새벽 4시에 굽습니다", reason: "제공된 사실에 영업·제조 시간이 없어요", severity: "high" },
          { section: 4, quote: "인기가 많아요", reason: "근거가 없는 평가에 가까워요", severity: "low" },
        ],
      }),
    });

    const result = await runToEnd(baseContext());

    expect(requests().map((request) => request.purpose)).toEqual(["blog.plan", "blog.draft", "blog.review", "blog.factfix", "blog.guide"]);
    const fix = ofKind("AUTOBIZ_BLOG_FIX_V2")[0];
    expect(fix.prompt).toContain("SECTION 3");
    expect(fix.prompt).toContain("매일 새벽 4시에 굽습니다");
    expect(fix.prompt).not.toContain("SECTION 4");
    expect(result.output).toMatchObject({
      factCheck: { ran: true, flagged: 2, fixed: true },
      qualityNotes: [expect.stringContaining("인기가 많아요")],
    });
  });

  it("finishes without a fact check when the reviewer is unavailable, and says so", async () => {
    useMockModels({ review: () => { throw new Error("budget exhausted"); } });
    const result = await runToEnd(baseContext());
    expect(result.output).toMatchObject({ factCheck: { ran: false }, qualityNotes: [expect.stringContaining("사실 검수를 하지 못했어요")] });
    expect(result.title).toBeTruthy();
  });

  it("records what each model call cost from the spend ledger", async () => {
    useMockModels();
    summarizeRunSpendMock.mockResolvedValue({ totalUsd: 0.91, steps: [{ step: "blog.plan", model: "claude-opus-5-5", usd: 0.1 }, { step: "blog.draft", model: "claude-fable-5-1", usd: 0.81 }] });
    const result = await runToEnd(baseContext());
    expect(result.output).toMatchObject({ generation: { pipeline: "blog-v2", costUsd: 0.91, steps: [expect.objectContaining({ step: "blog.plan" }), expect.objectContaining({ step: "blog.draft" })] } });
  });

  it("gives up on a run that has been going too long", async () => {
    useMockModels();
    const started = (await blogAutomationHandler.run(baseContext())) as unknown as Deferred;
    const stale = { ...started.deferred.state, startedAt: new Date(Date.now() - 41 * 60_000).toISOString() };
    await expect(blogAutomationHandler.resume!(baseContext(), stale as never)).rejects.toThrow("너무 오래");
  });

  it("refuses to continue from the old section-by-section job format with a clear message", async () => {
    await expect(blogAutomationHandler.resume!(baseContext(), { v: 1, stage: "WRITING" } as never)).rejects.toThrow("읽지 못했어요");
  });

  it("plans again exactly once when the first topic is a near-duplicate, then accepts the second", async () => {
    const topics = ["겨울철 난방비 절약 팁", "출근길 소금빵 예약 팁"];
    useMockModels({ plan: (request, call) => ({ ...JSON.parse(mockBlogPlan(request.prompt, request.system)), topic: topics[call] }) });

    const started = (await blogAutomationHandler.run(baseContext({ recentTopics: ["겨울철 난방비 절약하는 방법"] }))) as unknown as Deferred;

    expect(started.deferred.state.topic).toBe("출근길 소금빵 예약 팁");
    const plans = ofKind("AUTOBIZ_BLOG_PLAN_V2");
    expect(plans).toHaveLength(2);
    expect(plans[0].purpose).toBe("blog.plan");
    expect(plans[1].purpose).toBe("blog.plan.retry");
    expect(plans[1].prompt).toContain("겨울철 난방비 절약 팁");
  });

  it("does not plan again when the first topic is already distinct from recent history", async () => {
    useMockModels();
    await blogAutomationHandler.run(baseContext({ recentTopics: ["여름 휴가지 추천"] }));
    expect(ofKind("AUTOBIZ_BLOG_PLAN_V2")).toHaveLength(1);
  });

  it("keeps a calendar topic fixed and injects its goal, brief and CTA into every stage", async () => {
    useMockModels();
    const calendarItem = {
      id: "calendar-1",
      businessId: "biz-1",
      plannedDate: "2026-10-01",
      platform: "blog" as const,
      contentType: "정보성 블로그 글",
      topic: "직장인을 위한 아침 소금빵 활용법",
      goal: "평일 오전 방문 늘리기",
      summary: "출근 전 5분 안에 고르는 법과 예약 픽업 방법을 소개한다",
      cta: "출근길 예약하기",
    };

    const result = await runToEnd(baseContext({ calendarItem }));

    expect(result.topic).toBe(calendarItem.topic);
    expect(ofKind("AUTOBIZ_BLOG_PLAN_V2")[0].prompt).toContain(`"${calendarItem.topic}"`);
    for (const request of requests().filter((item) => !item.prompt.includes("AUTOBIZ_BLOG_GUIDE_V1") && !item.prompt.includes("AUTOBIZ_BLOG_REVIEW_V2"))) {
      expect(request.system).toContain(calendarItem.goal);
      expect(request.system).toContain(calendarItem.summary);
      expect(request.system).toContain(calendarItem.cta);
    }
  });

  it("only ever writes the post for the owner to review: no delivery, whatever an old setup said", async () => {
    useMockModels();
    const legacy = { ...config, deliveryMode: "wordpress_publish", wordpress: { siteUrl: "https://blog.example.com", username: "admin", encryptedAppPassword: "enc" } };
    const result = await runToEnd(baseContext({ config: legacy as never }));
    expect(result.externalUrl).toBeUndefined();
    expect(result.output).not.toHaveProperty("wordpressStatus");
    expect(result.output).not.toHaveProperty("externalUrl");
  });

  it("throws instead of returning a partial result when the plan or the draft fails", async () => {
    generateStructuredMock.mockRejectedValue(new Error("plan failed"));
    await expect(blogAutomationHandler.run(baseContext())).rejects.toThrow("plan failed");

    useMockModels({ draft: () => { throw new Error("draft failed"); } });
    await expect(runToEnd(baseContext())).rejects.toThrow("draft failed");
  });

  it("is metered against the blog budget only when a real provider is used, and needs Claude for that", () => {
    const env = serverEnv as { AI_PROVIDER: string };
    const original = env.AI_PROVIDER;
    try {
      env.AI_PROVIDER = "mock";
      expect(blogAutomationHandler.metered?.(baseContext())).toBeNull();
      expect(blogAutomationHandler.preflight?.(baseContext())).toBeNull();
      env.AI_PROVIDER = "anthropic";
      expect(blogAutomationHandler.metered?.(baseContext())).toBe("BLOG");
      expect(blogAutomationHandler.preflight?.(baseContext())).toBeNull();
      env.AI_PROVIDER = "openai";
      expect(blogAutomationHandler.metered?.(baseContext())).toBe("BLOG");
      expect(blogAutomationHandler.preflight?.(baseContext())).toContain("Claude");
    } finally {
      env.AI_PROVIDER = original;
    }
  });

  describe("publishing guide (style, photo spots, SEO)", () => {
    it("is made in the same run and matches the post: one detail per photo spot, grounded tags, readable colours", async () => {
      useMockModels();
      const result = await runToEnd(baseContext());
      const output = result.output as { publishingGuide: unknown; stats: { photos: number }; markup: string };
      const guide = blogPublishingGuideSchema.parse(output.publishingGuide);

      expect(guide.source).toBe("ai");
      expect(guide.images).toHaveLength(output.stats.photos);
      expect(guide.style.platform).toBe("naver");
      expect([11, 13, 15, 16, 19, 24, 28, 30, 34, 38]).toContain(guide.style.body.sizePx);
      // every tag is something the owner chose or something that is in the post
      const body = `${output.markup}`.replace(/\s+/g, "");
      for (const tag of guide.seo.tags) expect(["소금빵", "크루아상", "우리동네빵집", "베이커리"].includes(tag) || body.includes(tag) || /^(서울|마포구)(소금빵|크루아상|우리동네빵집|베이커리)$/.test(tag), tag).toBe(true);
      expect(guide.seo.regionKeywords.every((term) => term.includes("서울") || term.includes("마포"))).toBe(true);
    });

    it("never fails or re-bills the post when the guide's AI call fails: it falls back to rules", async () => {
      useMockModels();
      const original = generateStructuredMock.getMockImplementation()!;
      generateStructuredMock.mockImplementation(async (request: Request) => {
        if (request.prompt.includes("AUTOBIZ_BLOG_GUIDE_V1")) throw new Error("model unavailable");
        return original(request);
      });

      const result = await runToEnd(baseContext());
      const guide = blogPublishingGuideSchema.parse((result.output as { publishingGuide: unknown }).publishingGuide);

      expect(guide.source).toBe("rules");
      expect(guide.images.length).toBeGreaterThan(0);
      expect(guide.seo.tags.length).toBeGreaterThan(0);
      expect(result.title).toBeTruthy();
    });

    it("ignores a guide answer that is mostly garbage and still produces a complete guide", async () => {
      useMockModels();
      const original = generateStructuredMock.getMockImplementation()!;
      generateStructuredMock.mockImplementation(async (request: Request) => {
        if (request.prompt.includes("AUTOBIZ_BLOG_GUIDE_V1")) return aiGuideDraftSchema.parse({ style: { bodySize: "huge", headingColor: "red" }, seo: { tags: ["광고", 5, "최고의맛집"] } });
        return original(request);
      });

      const result = await runToEnd(baseContext());
      const guide = blogPublishingGuideSchema.parse((result.output as { publishingGuide: unknown }).publishingGuide);

      expect(guide.style.heading.color).toMatch(/^#[0-9A-F]{6}$/);
      expect(guide.seo.tags).not.toContain("최고의맛집");
      expect(guide.seo.tags).not.toContain("광고");
    });
  });
});


describe("blog reference photos", () => {
  const uploaded = (id: string, label: string) => ({ id, kind: "image", origin: "upload", source: `user-1/auto-1/assets/${id}.jpg`, label });
  const withPhotos = () => baseContext({ config: { ...config, assets: [uploaded("a1", "소금빵 진열"), uploaded("a2", "매장 입구")] } as never });
  const described = (assets: Array<{ id: string; label: string }>) =>
    assets.map((asset, index) => ({ ...asset, kind: "image", origin: "upload", source: `user-1/auto-1/assets/${asset.id}.jpg`, role: index === 0 ? "product" : "place", summary: index === 0 ? "갓 구운 소금빵이 쟁반에 담겨 있다" : "나무 문이 있는 매장 입구" }));

  /** The planner puts photo 1 in the first section and photo 2 in the second. */
  const plannedWithPhotos = (request: Request) => {
    const plan = JSON.parse(mockBlogPlan(request.prompt, request.system)) as { sections: Array<{ photo: string | null; photoRef?: number | null }> };
    plan.sections[0].photo = "진열대 위 소금빵";
    plan.sections[0].photoRef = 1;
    plan.sections[1].photo = "매장 입구";
    plan.sections[1].photoRef = 2;
    return plan;
  };

  it("looks at the photos once, tells the planner and writer what they show, and records the references used", async () => {
    describeImagesMock.mockImplementation(async (_owner: unknown, assets: Array<{ id: string; label: string }>) => described(assets));
    useMockModels({ plan: plannedWithPhotos });

    const result = await runToEnd(withPhotos());

    expect(describeImagesMock).toHaveBeenCalledTimes(1);
    expect(describeImagesMock.mock.calls[0][2]).toBe("blog.photos");
    const [plan, draft] = requests();
    expect(plan.system).toContain("사진 1번 [product]: 갓 구운 소금빵이 쟁반에 담겨 있다");
    expect(plan.system).toContain("사진 2번 [place]: 나무 문이 있는 매장 입구");
    expect(plan.prompt).toContain('"photoRef"');
    expect(draft.prompt).toContain("ref = 1");
    expect(draft.prompt).toContain("ref = 2");
    // The plan's choice is carried into the post when the writer leaves it out.
    expect(result.content).toContain("[사진 1]");
    expect(result.content).toContain("[사진 2]");
    expect(result.output).toMatchObject({
      references: [
        { number: 1, id: "a1", kind: "image", role: "product", summary: expect.stringContaining("소금빵"), path: "user-1/auto-1/assets/a1.jpg" },
        { number: 2, id: "a2", kind: "image", role: "place" },
      ],
    });
  });

  it("still writes the post when the photos cannot be analysed, using the owner's own labels", async () => {
    describeImagesMock.mockRejectedValue(new Error("vision down"));
    useMockModels();

    const result = await runToEnd(withPhotos());

    expect(requests()[0].system).toContain("사진 1번: 사장님 설명: 소금빵 진열");
    expect(result.output).toMatchObject({ references: [{ number: 1, summary: "" }, { number: 2, summary: "" }] });
  });

  it("makes no vision call and records no references when nothing was uploaded", async () => {
    useMockModels();
    const result = await runToEnd(baseContext());
    expect(describeImagesMock).not.toHaveBeenCalled();
    expect(requests()[0].system).not.toContain("사장님이 올린 사진");
    expect(result.output).toMatchObject({ references: [] });
  });

  it("never uses a photo whose file belongs to another automation", async () => {
    describeImagesMock.mockImplementation(async (_owner: unknown, assets: Array<{ id: string; label: string }>) => described(assets));
    useMockModels();
    const foreign = { ...uploaded("x1", "남의 사진"), source: "user-2/auto-9/assets/x1.jpg" };
    const result = await runToEnd(baseContext({ config: { ...config, assets: [foreign] } as never }));
    expect(describeImagesMock).not.toHaveBeenCalled();
    expect(result.output).toMatchObject({ references: [] });
  });

  it("drops refs to photos that do not exist or are used twice", () => {
    const photo = (ref?: number) => ({ type: "photo" as const, slot: "자리", caption: "", ...(ref ? { ref } : {}) });
    const sections = normalizePhotoRefs([{ blocks: [photo(1), photo(1), photo(5), photo()] }], 2);
    expect(sections[0].blocks.map((block) => ("ref" in block ? block.ref : undefined))).toEqual([1, undefined, undefined, undefined]);
  });

  it("fills the planned photo into the matching section only where the writer left it out and the photo is still free", () => {
    const plan = JSON.parse(mockBlogPlan("AUTOBIZ_BLOG_PLAN_V2", "")) as Parameters<typeof applyPlannedPhotoRefs>[1];
    plan.sections[0].photoRef = 1;
    plan.sections[1].photoRef = 2;
    const photo = (ref?: number) => ({ type: "photo" as const, slot: "자리", caption: "", ...(ref ? { ref } : {}) });
    const refsOf = (sections: Array<{ blocks: Array<{ type: string }> }>) => sections.map((section) => section.blocks.map((block) => ("ref" in block ? block.ref : undefined)));
    expect(refsOf(applyPlannedPhotoRefs([{ blocks: [photo()] }, { heading: "a", blocks: [photo()] }, { heading: "b", blocks: [photo()] }], plan))).toEqual([[undefined], [1], [2]]);
    // Photo 1 is already used by the writer elsewhere: the plan does not use it a second time.
    expect(refsOf(applyPlannedPhotoRefs([{ blocks: [photo(1)] }, { heading: "a", blocks: [photo()] }], plan))).toEqual([[1], [undefined]]);
  });
});
