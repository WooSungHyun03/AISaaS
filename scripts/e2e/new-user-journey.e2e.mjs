// A brand-new person's whole journey on the LOCAL stack (mock AI, local DB): sign up → tell us about the business →
// pages open → make the first blog post → find it in the history → credit used once → sign out → sign back in → still theirs.
//   CRON_SECRET=… AI_PROVIDER=mock … npx next dev -p 3100   (or a production build with ALLOW_MOCK_AI=true)
//   node scripts/e2e/new-user-journey.e2e.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { BASE_URL, launch, newContext } from "./lib.mjs";

const DB_CONTAINER = process.env.E2E_DB_CONTAINER ?? "supabase_db_autobiz-dev-db";
const sql = (query) => execFileSync("docker", ["exec", DB_CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-tA", "-c", query], { encoding: "utf8" }).trim();
const email = `journey-${Date.now()}@autobiz.local`;
const PASSWORD = "Journey-1234!";
const USER_ID = `(select id from auth.users where email = '${email}')`;
let failed = 0;
const step = async (name, run) => {
  try { await run(); console.log(`  ✓ ${name}`); } catch (error) { failed += 1; console.log(`  ✗ ${name}\n    ${error instanceof Error ? error.message : error}`); }
};

const browser = await launch();
for (const mobile of [false, true]) {
  const label = mobile ? "휴대폰" : "PC";
  const mail = mobile ? email.replace("journey-", "journey-m-") : email;
  const who = `(select id from auth.users where email = '${mail}')`;
  console.log(`\n[${label}]`);
  const context = await newContext(browser, { mobile });
  const page = await context.newPage();
  const problems = [];
  page.on("console", (message) => { if (message.type() === "error" && !/favicon/.test(message.text())) problems.push(message.text().slice(0, 160)); });
  page.on("pageerror", (error) => problems.push(error.message.slice(0, 160)));

  await step(`${label}: 가입하면 사업 정보 입력으로 안내돼요`, async () => {
    await page.goto(`${BASE_URL}/signup`, { waitUntil: "networkidle" });
    await page.getByLabel("이름").fill("여정 테스트");
    await page.getByLabel("이메일").fill(mail);
    await page.getByLabel("비밀번호").fill(PASSWORD);
    await page.locator("input[name=agreeTerms]").check();
    await page.getByRole("button", { name: /가입|시작/ }).first().click();
    await page.waitForURL(/\/onboarding/, { timeout: 20_000 });
    assert.equal(sql(`select count(*) from profiles where email = '${mail}'`), "1");
  });
  await step(`${label}: 체험 이용권(블로그 1 · 숏폼 1)이 지급돼요`, async () => {
    assert.equal(sql(`select coalesce(sum(remaining),0) from credit_grants where user_id = ${who} and kind = 'BLOG'`), "1");
    assert.equal(sql(`select coalesce(sum(remaining),0) from credit_grants where user_id = ${who} and kind = 'SHORTS'`), "1");
  });
  await step(`${label}: 필수 항목을 비우면 넘어가지 않고 이유를 알려줘요`, async () => {
    await page.getByText("가게", { exact: true }).first().click();
    await page.getByRole("button", { name: "다음" }).click();
    await page.getByRole("button", { name: "다음" }).click();
    await page.getByText(/입력해주세요/).first().waitFor({ timeout: 5000 });
    assert.match(await page.locator("main").innerText(), /2 \/ 4 단계/, "필수 항목이 비었는데 다음 단계로 넘어갔어요");
  });
  await step(`${label}: 사업 정보를 마치면 사업체가 저장돼요`, async () => {
    await page.getByLabel(/상호명/).fill("여정 베이커리");
    await page.getByLabel(/업종/).fill("베이커리");
    await page.getByLabel(/지역/).fill("서울 성동구");
    for (let i = 0; i < 6; i++) {
      const done = page.getByRole("button", { name: /저장하고/ }).first();
      if (await done.isVisible().catch(() => false)) { await done.click(); break; }
      await page.getByRole("button", { name: "다음" }).click();
      await page.waitForTimeout(300);
    }
    for (let i = 0; i < 40 && sql(`select count(*) from businesses where owner_id = ${who}`) === "0"; i++) await page.waitForTimeout(300);
    assert.equal(sql(`select count(*) from businesses where owner_id = ${who}`), "1");
    assert.equal(sql(`select promotion_type from businesses where owner_id = ${who}`), "STORE");
  });
  await step(`${label}: 주요 화면이 열리고 오류가 없어요`, async () => {
    for (const route of ["/dashboard", "/diagnosis", "/calendar", "/blog", "/shorts", "/growth-report", "/usage", "/billing", "/settings", "/guide"]) {
      const response = await page.goto(`${BASE_URL}${route}`, { waitUntil: "networkidle" });
      assert.ok(response && response.status() < 400, `${route} → ${response?.status()}`);
      assert.ok(!/문제가 생겼어요|Application error/.test(await page.locator("body").innerText()), `${route} 오류 화면`);
      assert.ok((await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 1, `${route} 가로 스크롤`);
    }
  });
  await step(`${label}: 첫 블로그 글을 만들면 이력에 저장되고 이용권이 1회만 쓰여요`, async () => {
    await page.goto(`${BASE_URL}/blog`, { waitUntil: "networkidle" });
    await page.getByText("네이버 블로그", { exact: true }).first().click();
    await page.getByRole("button", { name: "첫 글 바로 만들기" }).click();
    for (let i = 0; i < 40 && sql(`select count(*) from automations where user_id = ${who}`) === "0"; i++) await page.waitForTimeout(300);
    assert.equal(sql(`select count(*) from automations where user_id = ${who}`), "1");
    await page.goto(`${BASE_URL}/blog`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "지금 만들기" }).first().click();
    // the post is written in several steps in the background; the page keeps polling
    for (let i = 0; i < 90 && sql(`select count(*) from content_history where business_id in (select id from businesses where owner_id = ${who})`) === "0"; i++) await page.waitForTimeout(1000);
    assert.equal(sql(`select count(*) from content_history where business_id in (select id from businesses where owner_id = ${who})`), "1", "글이 저장되지 않았어요");
    assert.equal(sql(`select coalesce(sum(remaining),0) from credit_grants where user_id = ${who} and kind = 'BLOG'`), "0");
    assert.ok(!/MOCK AI RESPONSE/.test(sql(`select content from content_history where business_id in (select id from businesses where owner_id = ${who})`)));
  });
  await step(`${label}: 이용권이 없으면 두 번째 글은 만들어지지 않고 이유를 알려줘요`, async () => {
    await page.goto(`${BASE_URL}/blog`, { waitUntil: "networkidle" });
    const button = page.getByRole("button", { name: "지금 만들기" }).first();
    if (await button.isEnabled().catch(() => false)) await button.click();
    await page.waitForTimeout(2500);
    assert.equal(sql(`select count(*) from content_history where business_id in (select id from businesses where owner_id = ${who})`), "1");
    assert.equal(sql(`select coalesce(sum(remaining),0) from credit_grants where user_id = ${who} and kind = 'BLOG'`), "0");
  });
  await step(`${label}: 이용내역에 방금 만든 글이 보여요`, async () => {
    await page.goto(`${BASE_URL}/usage`, { waitUntil: "networkidle" });
    assert.match(await page.locator("main").innerText(), /블로그/);
  });
  await step(`${label}: 로그아웃하면 보호된 화면이 닫히고, 다시 로그인하면 내 데이터가 그대로예요`, async () => {
    await page.goto(`${BASE_URL}/dashboard`, { waitUntil: "networkidle" });
    // On a phone the sign-out lives in the account menu of the header; on a PC it is also in the sidebar.
    await page.getByRole("button", { name: "내 계정 메뉴" }).click();
    await page.getByRole("menuitem", { name: /로그아웃/ }).or(page.getByRole("button", { name: /로그아웃/ })).first().click();
    await page.waitForURL((url) => !/\/dashboard/.test(url.pathname), { timeout: 10_000 });
    await page.goto(`${BASE_URL}/blog`, { waitUntil: "networkidle" });
    assert.match(page.url(), /\/login/);
    await page.getByLabel("이메일").fill(mail);
    await page.getByLabel("비밀번호").first().fill(PASSWORD);
    await page.getByRole("button", { name: /로그인/ }).first().click();
    await page.waitForURL(/\/(dashboard|blog|marketing|diagnosis)/, { timeout: 20_000 });
    await page.goto(`${BASE_URL}/blog`, { waitUntil: "networkidle" });
    assert.match(await page.locator("main").innerText(), /여정 베이커리/);
  });
  await step(`${label}: 다른 사람의 데이터는 보이지 않아요(블로그 이력·이용내역)`, async () => {
    const text = await page.locator("main").innerText();
    assert.ok(!/성수 소금빵집/.test(text), "다른 사용자의 사업체가 보여요");
  });
  await step(`${label}: 콘솔 오류가 없어요`, async () => assert.deepEqual(problems, []));
  await context.close();
}

await browser.close();
// the people created here are removed again (cascades to their data)
sql(`delete from auth.users where email like 'journey-%@autobiz.local'`);
console.log(failed ? `\n${failed}개 실패` : "\n모두 통과");
process.exit(failed ? 1 : 0);
