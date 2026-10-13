// Browser check of the reference-photo flow (blog + Shorts) against the LOCAL stack:
//   bash scripts/dev-db.sh && npx next dev -p 3100 && node scripts/e2e/reference-photos.e2e.mjs
// Uses the seeded local accounts and the mock AI; nothing leaves the machine.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { BASE_URL, launch, login, makeSamplePhotos, newContext, topUpLocalCredits } from "./lib.mjs";

const DB_CONTAINER = process.env.E2E_DB_CONTAINER ?? "supabase_db_autobiz-dev-db";
const sql = (query) => execFileSync("docker", ["exec", DB_CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-tA", "-c", query], { encoding: "utf8" }).trim();
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

const dir = await mkdtemp(path.join(tmpdir(), "photos-"));
const photos = await makeSamplePhotos(dir);
const notAnImage = path.join(dir, "notes.txt");
await writeFile(notAnImage, "not an image");
const heic = path.join(dir, "photo.heic");
await writeFile(heic, "heic");

// Start each pass from a known state: no uploaded references on the seeded user's automations.
// A run left RUNNING by an aborted earlier check keeps the generate button disabled (by design); close it so a pass starts clean.
const closeStaleRuns = () => sql("update automation_runs set status = 'FAILED', error_message = 'e2e: stale run closed' where status in ('QUEUED', 'RUNNING') and automation_id in (select id from automations where user_id = (select id from auth.users where email = 'user@autobiz.local'))");
const resetPhotos = () => (closeStaleRuns(), sql("update automations set config = config - 'assets' - 'references' where user_id = (select id from auth.users where email = 'user@autobiz.local')"));

topUpLocalCredits(sql);
const browser = await launch();
const run = async (mobile) => {
  const label = mobile ? "휴대폰" : "PC";
  console.log(`\n[${label}]`);
  resetPhotos();
  const context = await newContext(browser, { mobile });
  const page = await context.newPage();
  await login(page);
  const fileInput = () => page.locator("input[type=file][aria-label='참고 사진 파일 선택']").first();
  const dropzone = () => page.getByTestId("photo-dropzone").first();

  await page.goto(`${BASE_URL}/blog`, { waitUntil: "networkidle" });

  await step(`${label}: 블로그에 사진 영역이 보여요 (끌어다 놓기 + 고르기)`, async () => {
    await dropzone().waitFor();
    assert.match(await dropzone().innerText(), /끌어다 놓거나/);
    await page.getByRole("button", { name: "사진 고르기" }).first().waitFor();
  });

  await step(`${label}: 잘못된 파일(txt·HEIC)은 올리기 전에 이유와 함께 막혀요`, async () => {
    await fileInput().setInputFiles([notAnImage, heic]);
    await page.getByText(/HEIC 사진은 올릴 수 없어요/).first().waitFor({ timeout: 5_000 });
    assert.equal(await page.getByText(/올릴 사진 \d+장/).count(), 0);
  });

  await step(`${label}: 올리기 전에 미리보기가 보이고, 사진을 하나씩 뺄 수 있어요`, async () => {
    await fileInput().setInputFiles(photos);
    await page.getByText("올릴 사진 3장").waitFor();
    assert.equal(await page.locator("img[alt$='미리보기']").count(), 3);
    await page.getByRole("button", { name: "sample-3.jpg 빼기" }).click();
    await page.getByText("올릴 사진 2장").waitFor();
    // add one more after removing: the list keeps growing, nothing is lost
    await fileInput().setInputFiles([photos[2]]);
    await page.getByText("올릴 사진 3장").waitFor();
  });

  await step(`${label}: 설명을 적고 올리면 저장된 사진으로 보여요`, async () => {
    await page.getByLabel("sample-1.jpg 설명").fill("갓 구운 소금빵");
    await page.getByRole("button", { name: /사진 3장 올리기/ }).click();
    await page.getByRole("list", { name: "올린 참고 사진" }).waitFor({ timeout: 30_000 });
    await page.waitForFunction(() => document.querySelectorAll("ul[aria-label='올린 참고 사진'] li").length === 3, null, { timeout: 30_000 });
    assert.equal(await page.getByText("올릴 사진").count(), 0);
  });

  await step(`${label}: 올린 사진 주소는 서명된 임시 주소이고, 서명 없이는 열 수 없어요`, async () => {
    const src = await page.locator("ul[aria-label='올린 참고 사진'] img").first().getAttribute("src");
    assert.ok(src?.includes("token="), "signed url expected");
    const withToken = await fetch(src);
    assert.equal(withToken.status, 200);
    const bare = await fetch(src.split("?")[0]);
    assert.ok(bare.status >= 400, `unsigned access must fail, got ${bare.status}`);
    const publicPath = await fetch(`${new URL(src).origin}/storage/v1/object/public/shorts-references/x`);
    assert.ok(publicPath.status >= 400);
  });

  await step(`${label}: 한 장을 지울 수 있어요`, async () => {
    await page.getByRole("button", { name: "참고 사진 3 삭제" }).click({ force: true });
    await page.waitForFunction(() => document.querySelectorAll("ul[aria-label='올린 참고 사진'] li").length === 2, null, { timeout: 15_000 });
  });

  await step(`${label}: 숏폼에서 이전에 올린 블로그 사진을 다시 쓸 수 있어요`, async () => {
    await page.goto(`${BASE_URL}/shorts`, { waitUntil: "networkidle" });
    const start = page.getByRole("button", { name: /숏폼 만들기 시작/ });
    if (await start.count()) { await start.first().click(); await page.waitForLoadState("networkidle"); }
    await page.getByRole("button", { name: "이전에 올린 사진 쓰기" }).first().click();
    const region = page.getByRole("region", { name: "이전에 올린 사진" });
    await region.waitFor();
    const tiles = region.locator("button[aria-pressed]");
    assert.equal(await tiles.count(), 2);
    await tiles.nth(0).click();
    await region.getByRole("button", { name: /고른 사진 1장 쓰기/ }).click();
    await page.waitForFunction(() => document.querySelectorAll("ul[aria-label='올린 참고 사진'] li").length === 1, null, { timeout: 20_000 });
  });

  if (!mobile) {
    await step("PC: 블로그 글을 만들면 사진을 읽고 글에 맞춰요 (사용한 참고 자료 · 이미지 가이드)", async () => {
      await page.goto(`${BASE_URL}/blog`, { waitUntil: "networkidle" });
      const before = Number(sql("select count(*) from content_history"));
      await page.getByRole("button", { name: "지금 만들기" }).click();
      // The open page advances the run step by step; wait until the new post exists.
      const started = Date.now();
      while (Number(sql("select count(*) from content_history")) <= before) {
        assert.ok(Date.now() - started < 240_000, "the post was not finished in time");
        await page.waitForTimeout(3_000);
      }
      await page.reload({ waitUntil: "networkidle" });
      const link = page.locator("ul.divide-y a[href*='/runs/']").first();
      await link.click();
      await page.getByText(/사용한 참고 자료 2개/).waitFor({ timeout: 30_000 });
      await page.getByRole("tab", { name: /이미지 가이드/ }).click();
      await page.getByText(/올려주신 1번 사진 활용/).first().waitFor();
      assert.ok(await page.getByText(/AI가 본 모습/).count() > 0);
    });

    await step("PC: 광고 숏폼 미리보기를 만들면 올린 사진이 이력에 남아요", async () => {
      await page.goto(`${BASE_URL}/shorts`, { waitUntil: "networkidle" });
      const shortsDone = () => Number(sql("select count(*) from automation_runs r join automations a on a.id = r.automation_id join automation_templates t on t.id = a.template_id where t.slug = 'shorts' and r.status = 'SUCCESS'"));
      const doneBefore = shortsDone();
      const generate = page.getByRole("button", { name: /영상 만들기|미리보기 만들기|영상 만들기 시작/ }).first();
      if (await generate.isDisabled()) {
        const state = sql("select a.id, a.status, (select count(*) from automation_runs r where r.automation_id = a.id and r.status in ('QUEUED','RUNNING')) inflight, a.config->'assets' is not null has_assets from automations a join automation_templates t on t.id = a.template_id where t.slug = 'shorts'");
        throw new Error(`영상 만들기가 비활성화돼 있어요: ${state} | 화면: ${(await page.locator("main").innerText()).slice(0, 400).replace(/\n+/g, " / ")}`);
      }
      await page.getByRole("button", { name: /영상 만들기|미리보기 만들기|영상 만들기 시작/ }).first().click();
      // The open page advances the job; wait until a new preview run has finished.
      const startedAt = Date.now();
      while (shortsDone() <= doneBefore) {
        assert.ok(Date.now() - startedAt < 240_000, "the preview was not finished in time");
        await page.waitForTimeout(3_000);
      }
      const runId = sql("select r.id from automation_runs r join automations a on a.id = r.automation_id join automation_templates t on t.id = a.template_id where t.slug = 'shorts' and r.status = 'SUCCESS' order by r.created_at desc limit 1");
      const automationId = sql(`select automation_id from automation_runs where id = '${runId}'`);
      await page.goto(`${BASE_URL}/automations/${automationId}/runs/${runId}`, { waitUntil: "networkidle" });
      await page.getByText(/사용한 참고 자료/).waitFor({ timeout: 30_000 });
    });
  }

  await step(`${label}: 다른 사용자는 내 사진 목록을 볼 수 없어요 (소유자 확인)`, async () => {
    const other = await newContext(browser, { mobile });
    const otherPage = await other.newPage();
    await login(otherPage, { email: "admin@autobiz.local", password: "Admin1234!" });
    await otherPage.goto(`${BASE_URL}/automations/${sql("select id from automations where config ? 'assets' limit 1")}/runs/${sql("select id from automation_runs order by created_at desc limit 1")}`, { waitUntil: "networkidle" });
    const text = await otherPage.locator("body").innerText();
    assert.ok(!text.includes("사용한 참고 자료") && !text.includes("성수 소금빵집 블로그"), "another owner's run must not render");
    await other.close();
  });

  await context.close();
};

await run(false);
await run(true);
await browser.close();
const failed = results.filter(([, status]) => status !== "ok");
console.log(`\n${results.length - failed.length}/${results.length} 통과`);
process.exit(failed.length ? 1 : 0);
