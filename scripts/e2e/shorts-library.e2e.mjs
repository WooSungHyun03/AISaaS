// Browser check of the Shorts library (내 영상 / 영상 상세) against the LOCAL stack:
//   bash scripts/dev-db.sh && npx next dev -p 3100 && node scripts/e2e/shorts-library.e2e.mjs
// Seeds finished videos (real MP4 files made with ffmpeg, stored in the local private bucket) as the seeded local
// user, then drives the browser: list, thumbnails, play, download, re-signing, rename, delete, access control,
// legacy rows, PC and phone. No paid service is called; nothing leaves the machine.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { BASE_URL, launch, login, newContext } from "./lib.mjs";

const DB_CONTAINER = process.env.E2E_DB_CONTAINER ?? "supabase_db_autobiz-dev-db";
const sql = (query) => execFileSync("docker", ["exec", DB_CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-tA", "-c", query], { encoding: "utf8" }).trim();
const env = Object.fromEntries((await readFile(".env.local.supabase", "utf8")).split(/\r?\n/).map((line) => /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())).filter(Boolean).map((m) => [m[1], m[2].replace(/^['"]|['"]$/g, "")]));
assert.ok(/127\.0\.0\.1|localhost/.test(env.NEXT_PUBLIC_SUPABASE_URL), "local Supabase only");
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const BUCKET = "shorts-videos";
const PREFIX = "E2E ";

const results = [];
const step = async (name, run) => {
  try {
    await run();
    results.push([name, "ok"]);
    console.log(`  ✓ ${name}`);
  } catch (error) {
    results.push([name, "FAIL"]);
    console.log(`  ✗ ${name}\n    ${error instanceof Error ? error.message : error}`);
  }
};

// ---- seed -----------------------------------------------------------------------------------------------------
const dir = await mkdtemp(path.join(tmpdir(), "shorts-library-"));
const clip = (name, tone) => {
  const file = path.join(dir, name);
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=360x640:rate=30:duration=4", "-f", "lavfi", "-i", `sine=frequency=${tone}:duration=4`, "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", "-movflags", "+faststart", file]);
  return file;
};
const clips = { a: clip("a.mp4", 330), b: clip("b.mp4", 440) };

const userId = sql("select id from auth.users where email = 'user@autobiz.local'");
let businessId = sql(`select id from businesses where owner_id = '${userId}' order by created_at limit 1`);
if (!businessId) businessId = sql(`insert into businesses (owner_id, name) values ('${userId}', '이지 베이커리') returning id`).split("\n")[0];
const templateId = sql("select id from automation_templates where slug = 'shorts'");
let automationId = sql(`select id from automations where user_id = '${userId}' and template_id = '${templateId}' limit 1`);
if (!automationId) automationId = sql(`insert into automations (user_id, business_id, template_id, name, status, schedule) values ('${userId}', '${businessId}', '${templateId}', '숏폼', 'DRAFT', '{"frequency":"DAILY","timeOfDay":"18:00","timezone":"Asia/Seoul"}') returning id`).split("\n")[0];
const businessName = sql(`select name from businesses where id = '${businessId}'`);

const cleanup = async () => {
  const rows = sql(`select r.id from automation_runs r where r.automation_id = '${automationId}' and r.output->>'e2e' = 'true'`).split("\n").filter(Boolean);
  for (const runId of rows) {
    const folder = `${userId}/${automationId}/${runId}`;
    const listed = await admin.storage.from(BUCKET).list(folder);
    const files = (listed.data ?? []).map((file) => `${folder}/${file.name}`);
    if (files.length) await admin.storage.from(BUCKET).remove(files);
  }
  sql(`delete from content_history where automation_id = '${automationId}' and title like '${PREFIX}%'`);
  sql(`delete from automation_runs where automation_id = '${automationId}' and output->>'e2e' = 'true'`);
};
await cleanup();
await admin.storage.createBucket(BUCKET, { public: false }).catch(() => undefined);

const PUBLISHING = { v: 1, source: "rules", title: "봄 신메뉴 딸기 소금빵", alternativeTitles: [], description: "봄에만 만나는 딸기 소금빵을 소개해요.", keywords: ["딸기소금빵", "신메뉴"], hashtags: ["딸기소금빵", "신메뉴", "동네빵집"], callToAction: "오늘 들러보세요", summary: "딸기 소금빵 소개", youtubeTitle: "딸기 소금빵 신메뉴", instagramHook: "봄 한정 딸기 소금빵" };
const seeded = {};
let minute = 0;
async function seed(key, { title, source = "MANUAL", status = "SUCCESS", output = {}, file, videoPath = "stored", bytes, durationSec = 4 }) {
  minute += 1;
  const createdAt = new Date(Date.now() - (30 - minute) * 60_000).toISOString();
  const runId = sql(`insert into automation_runs (automation_id, status, source, output, created_at) values ('${automationId}', '${status}', '${source}', '{"e2e": true}', '${createdAt}') returning id`).split("\n")[0];
  let storedPath = null;
  if (file) {
    storedPath = `${userId}/${automationId}/${runId}/final.mp4`;
    const body = await readFile(file);
    const { error } = await admin.storage.from(BUCKET).upload(storedPath, body, { contentType: "video/mp4", upsert: true });
    if (error) throw error;
    bytes = body.length;
  }
  const outputJson = JSON.stringify({ e2e: true, hook: title, script: "딸기 소금빵을 소개하는 대본", durationSec, ...(videoPath === "output" && storedPath ? { videoPath: storedPath } : {}), ...output }).replaceAll("'", "''");
  sql(`update automation_runs set output = '${outputJson}'::jsonb where id = '${runId}'`);
  if (status === "SUCCESS") {
    const stored = videoPath === "stored" && storedPath;
    sql(`insert into content_history (business_id, automation_id, run_id, content_type, title, topic, content, created_at, video_path, video_duration_sec, video_bytes) values ('${businessId}', '${automationId}', '${runId}', 'shorts', '${title.replaceAll("'", "''")}', '봄 신메뉴', '딸기 소금빵을 소개하는 대본', '${createdAt}', ${stored ? `'${storedPath}'` : "null"}, ${stored ? durationSec : "null"}, ${stored ? bytes : "null"})`);
  }
  const contentId = sql(`select id from content_history where run_id = '${runId}'`);
  seeded[key] = { runId, contentId, title, storedPath, bytes };
  return seeded[key];
}

for (let index = 0; index < 8; index++) await seed(`filler${index}`, { title: `${PREFIX}채우기 ${index + 1}`, output: {} });
await seed("manual", { title: `${PREFIX}봄 신메뉴 영상`, file: clips.a, output: { publishing: PUBLISHING, format: "ad", generation: { model: "alibaba/wan-3.0/reference-to-video", resolution: "720p" } } });
await seed("scheduled", { title: `${PREFIX}예약 제작 영상`, source: "SCHEDULED", file: clips.b });
await seed("legacyPath", { title: `${PREFIX}이전 기록 영상`, file: clips.a, videoPath: "output" });
await seed("external", { title: `${PREFIX}외부 링크 영상`, output: { videoUrl: "https://videos.invalid/old/clip.mp4" } });
await seed("missing", { title: `${PREFIX}파일 없는 영상`, output: {} });
await seed("sample", { title: `${PREFIX}샘플 영상`, output: { videoUrl: "https://samples.invalid/test.mp4", sampleVideo: true } });
const running = await seed("running", { title: `${PREFIX}진행 중`, status: "RUNNING", output: {} });
const creditSum = () => Number(sql(`select coalesce(sum(remaining), 0) from credit_grants where user_id = '${userId}'`));

const browser = await launch();
// Every Short of the seeded user's businesses is in the library, the seeded ones and any made before.
const total = () => Number(sql(`select count(*) from content_history where content_type = 'shorts' and business_id in (select id from businesses where owner_id = '${userId}')`));
const cardOf = (page, title) => page.locator("li", { has: page.getByRole("heading", { name: title }) });
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);

const run = async (mobile) => {
  const label = mobile ? "휴대폰" : "PC";
  console.log(`\n[${label}]`);
  const context = await newContext(browser, { mobile });
  const page = await context.newPage();
  await login(page);
  const creditsBefore = creditSum();
  const { manual, scheduled, legacyPath, external, missing, sample } = seeded;

  if (!mobile) await step(`${label}: 제작 중인 작업은 '만드는 중'에, 완성된 영상과 따로 보여요`, async () => {
    await page.goto(`${BASE_URL}/shorts/library`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "만드는 중" }).waitFor();
    assert.ok(await page.getByText(/영상을 만들고 있어요/).count() >= 1);
    assert.equal(await page.getByRole("heading", { name: `${PREFIX}진행 중` }).count(), 0, "a running job is not a finished video");
  });
  if (!mobile) sql(`update automation_runs set status = 'FAILED', error_message = '영상 마무리 작업에 실패했어요. 잠시 후 다시 시도해주세요.' where id = '${running.runId}'`);

  await step(`${label}: 내 영상 목록에 영상이 한 개씩 보여요 (제목·날짜·길이·상태)`, async () => {
    await page.goto(`${BASE_URL}/shorts/library`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "내 영상", level: 1 }).waitFor();
    if (!mobile) {
      await page.getByRole("heading", { name: /만들지 못한 영상/ }).waitFor();
      assert.ok(await page.getByText(/영상 마무리 작업에 실패했어요/).count() >= 1);
      assert.equal(await page.getByRole("heading", { name: "만드는 중" }).count(), 0);
    }
    const first = cardOf(page, manual.title);
    await first.waitFor();
    const text = await first.innerText();
    assert.match(text, /저장됨/);
    assert.match(text, /4초/);
    assert.match(text, new RegExp(businessName));
    assert.ok(await first.getByRole("link", { name: "상세 보기", exact: true }).count() === 1);
    assert.ok(await first.getByRole("link", { name: "다운로드", exact: true }).count() === 1);
    assert.match(await cardOf(page, legacyPath.title).innerText(), /저장됨/, "a row from before the library still shows as stored");
    assert.match(await cardOf(page, external.title).innerText(), /임시 링크/);
    assert.match(await cardOf(page, missing.title).innerText(), /복구 불가/);
    assert.match(await cardOf(page, sample.title).innerText(), /샘플/);
    assert.equal(await cardOf(page, missing.title).getByRole("link", { name: "다운로드", exact: true }).count(), 0, "nothing to download for a lost file");
    assert.ok(!(await overflow(page)), "no horizontal scroll");
    if (process.env.E2E_SHOTS) {
      await page.waitForTimeout(1_500);
      await page.screenshot({ path: path.join(process.env.E2E_SHOTS, `library-${mobile ? "mobile" : "pc"}.png`), fullPage: false });
    }
  });

  await step(`${label}: 목록은 12개씩 나뉘고 다음 쪽에서 나머지가 보여요`, async () => {
    await page.goto(`${BASE_URL}/shorts/library`, { waitUntil: "networkidle" });
    assert.equal(await page.locator("ul.grid > li").count(), 12);
    await page.getByRole("link", { name: "다음" }).click();
    await page.waitForURL(/page=2/);
    assert.equal(await page.locator("ul.grid > li").count(), Math.min(12, total() - 12));
    await page.getByRole("link", { name: "이전" }).click();
    await page.waitForURL(/\/shorts\/library$/);
  });

  await step(`${label}: 카드의 첫 장면(썸네일)이 영상 파일에서 읽혀요`, async () => {
    await page.goto(`${BASE_URL}/shorts/library`, { waitUntil: "networkidle" });
    const video = cardOf(page, manual.title).locator("video");
    await cardOf(page, manual.title).scrollIntoViewIfNeeded();
    await video.waitFor({ timeout: 15_000 });
    await page.waitForFunction((el) => el.readyState >= 1 && el.videoWidth === 360, await video.elementHandle(), { timeout: 15_000 });
  });

  await step(`${label}: 상세 화면에서 영상이 재생돼요`, async () => {
    await cardOf(page, manual.title).getByRole("link", { name: "상세 보기", exact: true }).click();
    await page.waitForURL(new RegExp(`/shorts/${manual.contentId}$`));
    const video = page.locator("video[aria-label$='영상']");
    await video.waitFor();
    await page.waitForFunction((el) => el.readyState >= 2, await video.elementHandle(), { timeout: 15_000 });
    const progressed = await video.evaluate(async (el) => {
      el.muted = true;
      await el.play();
      await new Promise((resolve) => setTimeout(resolve, 1200));
      return { time: el.currentTime, duration: el.duration };
    });
    assert.ok(progressed.time > 0.5, `playback must advance (${progressed.time})`);
    assert.ok(Math.abs(progressed.duration - 4) < 0.5);
    assert.ok(!(await overflow(page)), "no horizontal scroll on the detail page");
    if (process.env.E2E_SHOTS) await page.screenshot({ path: path.join(process.env.E2E_SHOTS, `detail-${mobile ? "mobile" : "pc"}.png`), fullPage: true });
  });

  await step(`${label}: 상세에 제목·날짜·길이·크기·홍보 대상·게시용 문구(해시태그·키워드)가 보여요`, async () => {
    const body = await page.locator("main").innerText();
    for (const expected of [manual.title, "만든 날짜", "영상 길이", "4초", "파일 크기", "홍보 대상", businessName, "720p", "딸기 소금빵을 소개하는 대본"]) assert.ok(body.includes(expected), `missing: ${expected}`);
    await page.getByRole("heading", { name: "게시용 제목·설명" }).waitFor({ timeout: 5_000 });
    const fields = (await page.locator("main input, main textarea").evaluateAll((nodes) => nodes.map((node) => node.value))).join(" ");
    assert.ok((body + fields).includes("딸기소금빵"), "keywords / hashtags");
    assert.ok(await page.getByRole("button", { name: /복사/ }).count() >= 1, "copy buttons");
    assert.ok(await page.getByRole("link", { name: /새 영상 만들기/ }).count() >= 1);
  });

  await step(`${label}: MP4로 내려받을 수 있어요 (파일 이름은 제목, 용량은 저장된 파일과 같아요)`, async () => {
    const response = await context.request.get(`${BASE_URL}/shorts/${manual.contentId}/download`);
    assert.equal(response.status(), 200);
    assert.match(response.headers()["content-type"] ?? "", /video\/mp4/);
    assert.match(response.headers()["content-disposition"] ?? "", /attachment/);
    assert.equal((await response.body()).length, manual.bytes);
  });

  await step(`${label}: 주소가 만료된 뒤에도 같은 화면에서 새 주소로 다시 재생돼요`, async () => {
    const shortLived = await admin.storage.from(BUCKET).createSignedUrl(manual.storedPath, 1);
    await page.waitForTimeout(2_200);
    assert.notEqual((await fetch(shortLived.data.signedUrl)).status, 200, "an expired address must stop working");
    const again = await context.request.get(`${BASE_URL}/shorts/${manual.contentId}/video`, { headers: { Range: "bytes=0-99" } });
    assert.ok([200, 206].includes(again.status()), `route re-signs: ${again.status()}`);
  });

  await step(`${label}: 보거나 내려받아도 AI 제작 이용권은 줄지 않아요`, async () => {
    assert.equal(creditSum(), creditsBefore);
  });

  await step(`${label}: 새로고침하고, 로그아웃했다가 다시 로그인해도 같은 주소로 영상이 열려요`, async () => {
    await page.reload({ waitUntil: "networkidle" });
    await page.locator("video[aria-label$='영상']").waitFor();
    await context.clearCookies();
    await page.goto(`${BASE_URL}/shorts/${manual.contentId}`, { waitUntil: "domcontentloaded" });
    await page.waitForURL(/\/login/);
    await login(page);
    await page.goto(`${BASE_URL}/shorts/${manual.contentId}`, { waitUntil: "networkidle" });
    await page.getByText(manual.title).first().waitFor();
    await page.locator("video[aria-label$='영상']").waitFor();
  });

  await step(`${label}: 로그인하지 않으면 영상·내려받기 주소가 열리지 않아요`, async () => {
    const anonymous = await fetch(`${BASE_URL}/shorts/${manual.contentId}/video`, { redirect: "manual" });
    assert.ok(anonymous.status >= 300 && anonymous.status < 400 || anonymous.status === 401, `anonymous status ${anonymous.status}`);
    assert.ok(!(anonymous.headers.get("location") ?? "").includes("/storage/v1/"), "must not hand out a storage address");
    const download = await fetch(`${BASE_URL}/shorts/${manual.contentId}/download`, { redirect: "manual" });
    assert.ok(!(download.headers.get("location") ?? "").includes("/storage/v1/"));
  });

  await step(`${label}: 다른 사용자는 내 영상 상세·재생·다운로드에 접근할 수 없어요`, async () => {
    const other = await newContext(browser, { mobile });
    const otherPage = await other.newPage();
    await login(otherPage, { email: "admin@autobiz.local", password: "Admin1234!" });
    await otherPage.goto(`${BASE_URL}/shorts/${manual.contentId}`, { waitUntil: "networkidle" });
    const text = await otherPage.locator("body").innerText();
    assert.match(text, /영상을 찾을 수 없어요/);
    assert.ok(!text.includes(manual.title));
    for (const suffix of ["video", "download"]) {
      const response = await other.request.get(`${BASE_URL}/shorts/${manual.contentId}/${suffix}`, { maxRedirects: 0 });
      assert.equal(response.status(), 404, suffix);
    }
    await otherPage.goto(`${BASE_URL}/shorts/library`, { waitUntil: "networkidle" });
    assert.ok(!(await otherPage.locator("body").innerText()).includes(PREFIX), "another owner's list does not show these videos");
    await other.close();
  });

  await step(`${label}: 예약으로 만든 영상도 같은 보관함에 같은 모습으로 있어요`, async () => {
    await page.goto(`${BASE_URL}/shorts/${scheduled.contentId}`, { waitUntil: "networkidle" });
    await page.getByText(scheduled.title).first().waitFor();
    await page.locator("video[aria-label$='영상']").waitFor();
    assert.equal(sql(`select source from automation_runs where id = '${scheduled.runId}'`), "SCHEDULED");
  });

  await step(`${label}: 제목을 고치면 상세와 목록에 남아요`, async () => {
    await page.goto(`${BASE_URL}/shorts/${legacyPath.contentId}`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "제목 수정" }).click();
    await page.getByLabel("영상 제목").fill(`${PREFIX}고친 제목 ${label}`);
    await page.getByRole("button", { name: "제목 저장" }).click();
    await page.getByRole("heading", { name: `${PREFIX}고친 제목 ${label}` }).waitFor();
    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("heading", { name: `${PREFIX}고친 제목 ${label}` }).waitFor();
    await page.goto(`${BASE_URL}/shorts/library`, { waitUntil: "networkidle" });
    assert.ok(await page.getByRole("heading", { name: `${PREFIX}고친 제목 ${label}` }).count() >= 1);
    legacyPath.title = `${PREFIX}고친 제목 ${label}`;
  });

  await step(`${label}: 복구할 수 없는 예전 영상은 '복구 불가'로 알려주고, 가짜 영상을 보여주지 않아요`, async () => {
    for (const item of [external, missing]) {
      await page.goto(`${BASE_URL}/shorts/${item.contentId}`, { waitUntil: "networkidle" });
      assert.equal(await page.locator("video").count(), 0);
      assert.match(await page.locator("main").innerText(), /영상 파일을 불러올 수 없어요/);
      assert.match(await page.locator("main").innerText(), /복구 불가/);
    }
    await page.goto(`${BASE_URL}/shorts/${sample.contentId}`, { waitUntil: "networkidle" });
    assert.match(await page.locator("main").innerText(), /테스트용 샘플/);
  });

  await step(`${label}: /shorts 에서 '제작한 영상 보기'와 최근 영상으로 보관함에 갈 수 있어요`, async () => {
    await page.goto(`${BASE_URL}/shorts`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: /최근 만든 영상/ }).waitFor();
    await page.getByRole("link", { name: "제작한 영상 보기" }).first().click();
    await page.waitForURL(/\/shorts\/library/);
  });

  await step(`${label}: 삭제는 확인을 거치고, 취소하면 그대로예요`, async () => {
    await page.goto(`${BASE_URL}/shorts/library`, { waitUntil: "networkidle" });
    await cardOf(page, scheduled.title).getByRole("button", { name: "삭제" }).click();
    await page.getByRole("heading", { name: "이 영상을 삭제할까요?" }).waitFor();
    await page.getByRole("button", { name: "취소" }).click();
    assert.equal(Number(sql(`select count(*) from content_history where id = '${scheduled.contentId}'`)), 1);
  });

  if (!mobile) {
    await step("PC: 삭제하면 파일·보관함 기록이 함께 지워지고 다른 영상은 그대로예요 (작업 기록은 남아요)", async () => {
      await cardOf(page, scheduled.title).getByRole("button", { name: "삭제" }).click();
      await page.getByRole("button", { name: "삭제하기" }).click();
      await page.waitForFunction((title) => !document.body.innerText.includes(title), scheduled.title, { timeout: 15_000 });
      assert.equal(Number(sql(`select count(*) from content_history where id = '${scheduled.contentId}'`)), 0);
      const listed = await admin.storage.from(BUCKET).list(`${userId}/${automationId}/${scheduled.runId}`);
      assert.equal((listed.data ?? []).length, 0, "the file is gone from Storage");
      assert.equal(sql(`select status from automation_runs where id = '${scheduled.runId}'`), "SUCCESS", "the run row stays for credits and usage");
      assert.equal(sql(`select coalesce(output ? 'videoPath', false) from automation_runs where id = '${scheduled.runId}'`), "f");
      assert.equal((await context.request.get(`${BASE_URL}/shorts/${scheduled.contentId}/video`, { maxRedirects: 0 })).status(), 404);
      // The other videos are untouched and still play.
      const still = await context.request.get(`${BASE_URL}/shorts/${manual.contentId}/video`, { headers: { Range: "bytes=0-9" } });
      assert.ok([200, 206].includes(still.status()));
      assert.equal(creditSum(), creditsBefore, "deleting does not touch credits");
    });
  } else {
    await step("휴대폰: 상세에서 삭제하면 목록으로 돌아가요", async () => {
      await page.goto(`${BASE_URL}/shorts/${scheduled.contentId}`, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: "삭제" }).click();
      await page.getByRole("button", { name: "삭제하기" }).click();
      await page.waitForURL(/\/shorts\/library$/, { timeout: 15_000 });
      assert.equal(Number(sql(`select count(*) from content_history where id = '${scheduled.contentId}'`)), 0);
    });
  }

  await context.close();
};

try {
  await run(false);
  // A second pass on a phone-sized screen needs the rows the first pass removed.
  await seed("scheduled", { title: `${PREFIX}예약 제작 영상`, source: "SCHEDULED", file: clips.b });
  sql(`update automation_runs set status = 'FAILED' where id = '${running.runId}'`);
  await run(true);
} finally {
  await browser.close();
  await cleanup();
  await rm(dir, { recursive: true, force: true });
}
const failed = results.filter(([, status]) => status !== "ok");
console.log(`\n${results.length - failed.length}/${results.length} 통과`);
process.exit(failed.length ? 1 : 0);
