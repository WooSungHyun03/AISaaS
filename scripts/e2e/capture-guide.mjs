// Captures the real screens used by the 이용방법 guide (public/guide/<기능>/<id>.png + <id>-m.png) from the LOCAL stack,
// draws numbered markers over the controls the guide talks about, and checks that every marked control was found.
//   bash scripts/dev-db.sh
//   psql … < scripts/seed-growth-demo.sql ; psql … < scripts/sql/seed-guide-screens.sql
//   YOUTUBE_CLIENT_ID=x YOUTUBE_CLIENT_SECRET=x INSTAGRAM_APP_ID=x INSTAGRAM_APP_SECRET=x npx next dev -p 3100   # placeholders only so the connect buttons are enabled; nothing is sent
//   node scripts/e2e/capture-guide.mjs [--only blog/photos]
// Only seeded sample data and generated sample "photos" appear: no personal, token or payment data.
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { annotate, clearAnnotations } from "./annotate.mjs";
import { BASE_URL, launch, login, makeSamplePhotos, newContext, topUpLocalCredits } from "./lib.mjs";

const DB_CONTAINER = process.env.E2E_DB_CONTAINER ?? "supabase_db_autobiz-dev-db";
const sql = (query) => execFileSync("docker", ["exec", DB_CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-tA", "-c", query], { encoding: "utf8" }).trim();
const OUT = path.resolve("public/guide");
const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1].split(",") : null;

const HIDE_DEV_UI = "nextjs-portal, [data-nextjs-toast], [data-nextjs-dev-tools-button], [data-sonner-toaster] { display: none !important; }";

const scrollTo = (selectorOrLocator) => async (page) => {
  const target = typeof selectorOrLocator === "function" ? selectorOrLocator(page) : page.locator(selectorOrLocator);
  await target.first().evaluate((element) => element.scrollIntoView({ block: "start" }));
  await page.evaluate(() => window.scrollBy(0, -24));
};

const text = (value, options) => (page) => page.getByText(value, options);
const role = (name, options) => (page) => page.getByRole(name.role, { name: name.name, ...options });
const label = (value) => (page) => page.getByLabel(value);

/**
 * One entry per screen. `marks` are the numbered controls in the same order as the caption in guide-content.ts.
 * `prepare` runs before the capture (open a dialog, scroll …); `device` limits a shot to one device.
 */
function specs(ctx) {
  return [
    { slug: "diagnosis", id: "overview", path: "/diagnosis", marks: [text("마케팅 준비 점수"), text("점수는 이렇게 계산했어요")] },
    { slug: "diagnosis", id: "website", path: "/diagnosis", prepare: scrollTo((p) => p.getByRole("heading", { name: "홈페이지 진단" })), marks: [label("홈페이지 주소"), role({ role: "button", name: /다시 진단하기|홈페이지 진단하기/ }), text("홈페이지 기본", { exact: true })] },
    { slug: "diagnosis", id: "channel", path: "/diagnosis", prepare: scrollTo((p) => p.getByRole("heading", { name: "채널 진단" })), marks: [label("채널 주소"), label("플랫폼"), role({ role: "button", name: "채널 추가" })] },

    { slug: "calendar", id: "month", path: "/calendar", marks: [role({ role: "button", name: "월", exact: true }), role({ role: "button", name: "일정 추가" }), (p) => p.locator(".fc-event").first()] },
    { slug: "calendar", id: "add", path: "/calendar", prepare: async (page) => { await page.getByRole("button", { name: "일정 추가" }).click(); await page.getByRole("dialog").waitFor(); }, marks: [(p) => p.getByRole("dialog").getByLabel("제목"), (p) => p.getByRole("dialog").getByText("시작", { exact: false }).first(), (p) => p.getByRole("dialog").getByText("반복", { exact: false }).first()] },

    { slug: "blog", id: "start", path: "/blog", marks: [text(/블로그 이용권 \d+회 남음/), role({ role: "button", name: "지금 만들기" }), role({ role: "button", name: "설정 수정" })] },
    { slug: "blog", id: "preview", path: "/blog", prepare: async (page) => { await page.locator("input[type=file][aria-label='참고 사진 파일 선택']").first().setInputFiles(ctx.photos); await page.getByText("올릴 사진 3장").waitFor(); await scrollTo((p) => p.getByTestId("photo-dropzone"))(page); }, marks: [(p) => p.getByTestId("photo-dropzone"), (p) => p.locator("img[alt$='미리보기']").first(), (p) => p.getByLabel("sample-1.jpg 설명"), role({ role: "button", name: /사진 3장 올리기/ })] },
    { slug: "blog", id: "photos", path: "/blog", prepare: scrollTo((p) => p.getByTestId("photo-dropzone")), marks: [(p) => p.getByTestId("photo-dropzone"), role({ role: "button", name: "사진 고르기" }), role({ role: "button", name: "이전에 올린 사진 쓰기" }), (p) => p.getByRole("list", { name: "올린 참고 사진" }).locator("li").first()] },
    { slug: "blog", id: "result", path: () => ctx.blogRunPath, marks: [role({ role: "tab", name: /완성된 글/ }), role({ role: "button", name: /전체 게시 가이드 복사/ }), role({ role: "button", name: "고치기" })] },
    { slug: "blog", id: "images", path: () => ctx.blogRunPath, prepare: async (page) => { await page.getByRole("tab", { name: /이미지 가이드/ }).click(); await scrollTo((p) => p.getByRole("tab", { name: /이미지 가이드/ }))(page); }, marks: [role({ role: "tab", name: /이미지 가이드/ }), text(/올려주신 \d번 사진 활용/), (p) => p.locator("ol img").first()] },

    { slug: "shorts", id: "overview", path: "/shorts", marks: [(p) => p.getByRole("heading", { name: "광고 영상 재료" }), (p) => p.getByTestId("photo-dropzone")] },
    { slug: "shorts", id: "photos", path: "/shorts", prepare: scrollTo((p) => p.getByTestId("photo-dropzone")), marks: [(p) => p.getByTestId("photo-dropzone"), role({ role: "button", name: "사진 고르기" }), (p) => p.getByLabel("사진 1 쓰임새"), role({ role: "button", name: "참고 사진 1 삭제" })] },
    { slug: "shorts", id: "settings", path: "/shorts", prepare: scrollTo((p) => p.getByText("영상 길이").first()), marks: [label("영상 길이"), (p) => p.getByText("목소리", { exact: true }), label("어떤 광고를 원하세요?")] },
    { slug: "shorts", id: "result", path: () => ctx.shortsRunPath, prepare: scrollTo(text("사용한 참고 자료")), marks: [text("사용한 참고 자료")] },

    { slug: "growth-report", id: "overview", path: "/growth-report", marks: [(p) => p.getByRole("navigation", { name: "기간 선택" }), (p) => p.getByRole("heading", { name: /채널 성장/ })] },
    { slug: "growth-report", id: "chart", path: "/growth-report", prepare: scrollTo((p) => p.getByRole("heading", { name: /채널 성장/ })), marks: [text("구독자 수", { exact: true }), (p) => p.getByText(/이전 30일 대비/).first(), (p) => p.locator("svg[role='img']").first()] },
    { slug: "growth-report", id: "internal", path: "/growth-report", prepare: scrollTo((p) => p.getByRole("heading", { name: /서비스 내부 기록/ })), marks: [text("만든 콘텐츠", { exact: true }), text("제작 성공률", { exact: true }), text("캘린더 수행률", { exact: true })] },

    { slug: "home", id: "overview", path: "/dashboard", marks: [(p) => p.locator("section[aria-labelledby='next-action-title']"), (p) => p.locator("section[aria-labelledby='next-action-title'] a").first()] },
    { slug: "home", id: "credits", path: "/dashboard", prepare: scrollTo((p) => p.getByRole("heading", { name: "남은 콘텐츠 이용권" })), marks: [(p) => p.getByRole("heading", { name: "남은 콘텐츠 이용권" }), (p) => p.getByRole("link", { name: /구매·관리/ })] },

    { slug: "channels", id: "overview", path: "/settings", marks: [(p) => p.getByRole("heading", { name: "외부 서비스 연결" }), (p) => p.getByRole("heading", { name: "YouTube" }), (p) => p.getByRole("heading", { name: "인스타그램" })] },
    { slug: "channels", id: "connect", path: "/settings", marks: [(p) => p.locator("span", { hasText: /^연결 안 됨$/ }).first(), role({ role: "link", name: "YouTube 연결" }), role({ role: "link", name: "인스타그램 연결" })] },

    { slug: "billing", id: "overview", path: "/billing", marks: [(p) => p.getByRole("heading", { name: "남은 이용권" })] },
    { slug: "billing", id: "products", path: "/billing", prepare: scrollTo((p) => p.getByRole("heading", { name: /블로그 포스팅 상품/ })), marks: [(p) => p.getByRole("heading", { name: /블로그 포스팅 상품/ }), (p) => p.getByRole("button", { name: /구매/ }).first()] },
    { slug: "billing", id: "usage", path: "/usage", marks: [(p) => p.getByRole("heading", { name: "이용내역" }), (p) => p.locator("main ul:visible, main table:visible").first()] },
  ];
}

function resolve(factory, page) {
  return typeof factory === "function" ? factory(page) : factory;
}

async function ensureRuns(browser, ctx) {
  const context = await newContext(browser);
  const page = await context.newPage();
  await login(page);
  // blog: a finished post that used the uploaded photos
  await page.goto(`${BASE_URL}/blog`, { waitUntil: "networkidle" });
  await page.locator("input[type=file][aria-label='참고 사진 파일 선택']").first().setInputFiles(ctx.photos);
  await page.getByLabel("sample-1.jpg 설명").fill("갓 구운 소금빵");
  await page.getByLabel("sample-2.jpg 설명").fill("매장 입구");
  await page.getByLabel("sample-3.jpg 설명").fill("포장 라벨");
  await page.getByRole("button", { name: /사진 3장 올리기/ }).click();
  await page.waitForFunction(() => document.querySelectorAll("ul[aria-label='올린 참고 사진'] li").length === 3, null, { timeout: 60_000 });
  const posts = Number(sql("select count(*) from content_history"));
  await page.getByRole("button", { name: "지금 만들기" }).click();
  const started = Date.now();
  while (Number(sql("select count(*) from content_history")) <= posts) {
    if (Date.now() - started > 300_000) throw new Error("블로그 글이 제때 끝나지 않았어요");
    await page.waitForTimeout(3_000);
  }
  ctx.blogRunPath = `/automations/${sql("select automation_id from automation_runs where status = 'SUCCESS' order by created_at desc limit 1")}/runs/${sql("select id from automation_runs where status = 'SUCCESS' order by created_at desc limit 1")}`;

  // shorts: the same three photos as materials, then one preview
  await page.goto(`${BASE_URL}/shorts`, { waitUntil: "networkidle" });
  const start = page.getByRole("button", { name: /숏폼 만들기 시작/ });
  if (await start.count()) { await start.first().click(); await page.waitForLoadState("networkidle"); }
  await page.locator("input[type=file][aria-label='참고 사진 파일 선택']").first().setInputFiles(ctx.photos);
  await page.getByLabel("sample-1.jpg 설명").fill("갓 구운 소금빵");
  await page.getByLabel("sample-2.jpg 설명").fill("매장 입구");
  await page.getByLabel("sample-3.jpg 설명").fill("포장 라벨");
  await page.getByRole("button", { name: /사진 3장 올리기/ }).click();
  await page.waitForFunction(() => document.querySelectorAll("ul[aria-label='올린 참고 사진'] li").length === 3, null, { timeout: 60_000 });
  const before = Number(sql("select count(*) from automation_runs r join automations a on a.id = r.automation_id join automation_templates t on t.id = a.template_id where t.slug = 'shorts' and r.status = 'SUCCESS'"));
  await page.getByRole("button", { name: /영상 만들기|미리보기 만들기/ }).first().click();
  const shortsStarted = Date.now();
  while (Number(sql("select count(*) from automation_runs r join automations a on a.id = r.automation_id join automation_templates t on t.id = a.template_id where t.slug = 'shorts' and r.status = 'SUCCESS'")) <= before) {
    if (Date.now() - shortsStarted > 300_000) throw new Error("숏폼 미리보기가 제때 끝나지 않았어요");
    await page.waitForTimeout(3_000);
  }
  const shortsRun = sql("select r.id || '|' || r.automation_id from automation_runs r join automations a on a.id = r.automation_id join automation_templates t on t.id = a.template_id where t.slug = 'shorts' and r.status = 'SUCCESS' order by r.created_at desc limit 1").split("|");
  ctx.shortsRunPath = `/automations/${shortsRun[1]}/runs/${shortsRun[0]}`;
  await context.close();
}

async function capture(browser, ctx, mobile, list) {
  const context = await newContext(browser, { mobile });
  const page = await context.newPage();
  await login(page);
  await page.addStyleTag({ content: HIDE_DEV_UI }).catch(() => undefined);
  for (const spec of list) {
    const target = `${spec.slug}/${spec.id}`;
    try {
      await page.goto(`${BASE_URL}${resolve(spec.path)}`, { waitUntil: "networkidle" });
      await page.addStyleTag({ content: HIDE_DEV_UI });
      if (spec.prepare) await spec.prepare(page);
      await page.waitForTimeout(400);
      // On a phone the controls are often below the first screen: bring the first marked control into view.
      if (mobile && !spec.prepare) await resolve(spec.marks[0], page).first().evaluate((element) => element.scrollIntoView({ block: "center" }));
      await annotate(page, spec.marks.map((factory, index) => ({ n: index + 1, target: resolve(factory, page), arrow: index === 0 && spec.arrow })));
      await mkdir(path.join(OUT, spec.slug), { recursive: true });
      await page.screenshot({ path: path.join(OUT, spec.slug, `${spec.id}${mobile ? "-m" : ""}.png`) });
      await clearAnnotations(page);
      console.log(`  ✓ ${mobile ? "휴대폰" : "PC"} ${target}`);
    } catch (error) {
      console.log(`  ✗ ${mobile ? "휴대폰" : "PC"} ${target}: ${String(error instanceof Error ? error.message : error).split("\n")[0]}`);
      process.exitCode = 1;
    }
  }
  await context.close();
}

const dir = await mkdtemp(path.join(tmpdir(), "guide-photos-"));
const ctx = { photos: await makeSamplePhotos(dir), blogRunPath: "", shortsRunPath: "" };
topUpLocalCredits(sql);
if (!process.argv.includes("--reuse")) sql("update automations set config = config - 'assets' - 'references' where user_id = (select id from auth.users where email = 'user@autobiz.local')");
const browser = await launch();
if (process.argv.includes("--reuse")) {
  // Reuse the finished blog / Shorts runs of an earlier pass (the sample photos stay uploaded for Shorts).
  const last = (slug) => sql(`select r.automation_id || '/runs/' || r.id from automation_runs r join automations a on a.id = r.automation_id join automation_templates t on t.id = a.template_id where t.slug = '${slug}' and r.status = 'SUCCESS' order by r.created_at desc limit 1`);
  ctx.blogRunPath = `/automations/${last("blog-marketing")}`;
  ctx.shortsRunPath = `/automations/${last("shorts")}`;
} else {
  await ensureRuns(browser, ctx);
}
// "preview" needs photos that are not uploaded yet: capture the staged state from a clean photo list.
sql("update automations set config = config - 'assets' where user_id = (select id from auth.users where email = 'user@autobiz.local') and config ? 'assets' and id in (select a.id from automations a join automation_templates t on t.id = a.template_id where t.slug = 'blog-marketing')");
const all = specs(ctx);
const wanted = only ? all.filter((spec) => only.includes(`${spec.slug}/${spec.id}`)) : all;
const stagedFirst = wanted.filter((spec) => spec.id === "preview");
const rest = wanted.filter((spec) => spec.id !== "preview");
await capture(browser, ctx, false, stagedFirst);
await capture(browser, ctx, true, stagedFirst);
// restore the blog photos for the remaining shots (the run page keeps its own record)
{
  const context = await newContext(browser);
  const page = await context.newPage();
  await login(page);
  await page.goto(`${BASE_URL}/blog`, { waitUntil: "networkidle" });
  await page.locator("input[type=file][aria-label='참고 사진 파일 선택']").first().setInputFiles(ctx.photos);
  await page.getByLabel("sample-1.jpg 설명").fill("갓 구운 소금빵");
  await page.getByLabel("sample-2.jpg 설명").fill("매장 입구");
  await page.getByLabel("sample-3.jpg 설명").fill("포장 라벨");
  await page.getByRole("button", { name: /사진 3장 올리기/ }).click();
  await page.waitForFunction(() => document.querySelectorAll("ul[aria-label='올린 참고 사진'] li").length === 3, null, { timeout: 60_000 });
  await context.close();
}
await capture(browser, ctx, false, rest);
await capture(browser, ctx, true, rest);
await browser.close();
