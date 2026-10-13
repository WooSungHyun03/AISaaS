// Channel registration -> daily public-data collection -> growth report, against the LOCAL stack (mock providers, no network):
//   bash scripts/dev-db.sh
//   CRON_SECRET=local-cron-secret CHANNEL_DATA_PROVIDER=mock AI_PROVIDER=mock BILLING_PROVIDER=mock npx next dev -p 3100
//   CRON_SECRET=local-cron-secret node scripts/e2e/channel-collection.e2e.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { BASE_URL, launch, login, newContext } from "./lib.mjs";

const DB_CONTAINER = process.env.E2E_DB_CONTAINER ?? "supabase_db_autobiz-dev-db";
const CRON_SECRET = process.env.CRON_SECRET ?? "local-cron-secret";
const sql = (query) => execFileSync("docker", ["exec", DB_CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-tA", "-c", query], { encoding: "utf8" }).trim();
const USER_ID = `(select id from auth.users where email = 'user@autobiz.local')`;
const HANDLE = "e2e-bakery";
let failed = 0;
const step = async (name, run) => {
  try { await run(); console.log(`  ✓ ${name}`); } catch (error) { failed += 1; console.log(`  ✗ ${name}\n    ${error instanceof Error ? error.message : error}`); }
};
const cron = (secret) => fetch(`${BASE_URL}/api/cron/run-automations`, { method: "POST", headers: secret ? { "x-cron-secret": secret } : {} });

// A clean slate for the channel this check owns; the seeded demo channels stay but are parked a day ahead so only ours is due.
sql(`delete from tracked_channels where external_id like 'UC%' and business_id in (select id from businesses where owner_id = ${USER_ID})`);
sql(`delete from channel_diagnosis_attempts`); // local only: repeated runs must not hit the hourly diagnosis limit
sql(`update tracked_channels set next_snapshot_at = now() + interval '1 day' where business_id in (select id from businesses where owner_id = ${USER_ID})`);

const browser = await launch();
const context = await newContext(browser);
const page = await context.newPage();
await login(page);

console.log("\n[등록]");
await step("주소를 입력하면 '채널 확인'이 먼저고, 확인 전에는 아무것도 저장되지 않아요", async () => {
  await page.goto(`${BASE_URL}/diagnosis`, { waitUntil: "networkidle" });
  await page.getByLabel("채널 주소").first().fill(`https://www.youtube.com/@${HANDLE}`);
  await page.getByRole("button", { name: "채널 확인" }).click();
  await page.getByRole("status", { name: "확인된 채널" }).waitFor({ timeout: 15_000 });
  assert.equal(sql(`select count(*) from tracked_channels where external_id like 'UC%' and business_id in (select id from businesses where owner_id = ${USER_ID})`), "0");
});
await step("확인 카드에 채널 이름·플랫폼·공개 수치가 보여요", async () => {
  const text = await page.getByRole("status", { name: "확인된 채널" }).innerText();
  assert.match(text, /유튜브/);
  assert.match(text, /구독자/);
});
await step("'이 채널로 등록'을 누르면 정식 Channel ID로 저장되고, 첫 수집이 06:00 KST로 예약돼요", async () => {
  await page.getByRole("button", { name: "이 채널로 등록" }).click();
  for (let i = 0; i < 60 && sql(`select count(*) from tracked_channels where external_id like 'UC%' and business_id in (select id from businesses where owner_id = ${USER_ID})`) === "0"; i++) await page.waitForTimeout(500);
  const row = sql(`select external_id, coalesce(display_name,''), to_char(next_snapshot_at at time zone 'UTC','HH24:MI') from tracked_channels where external_id like 'UC%' and business_id in (select id from businesses where owner_id = ${USER_ID})`).split("|");
  assert.match(row[0], /^UC/);
  assert.ok(row[1].length > 0, "display_name 이 비어 있어요");
  assert.equal(row[2], "21:00"); // 06:00 KST
});
await step("같은 채널을 다시 등록해도 중복되지 않아요", async () => {
  await page.getByLabel("채널 주소").first().fill(`youtube.com/@${HANDLE}`);
  await page.getByRole("button", { name: "채널 확인" }).click();
  await page.getByRole("status", { name: "확인된 채널" }).waitFor({ timeout: 15_000 });
  await page.getByRole("button", { name: "이 채널로 등록" }).click();
  await page.waitForTimeout(2500);
  assert.equal(sql(`select count(*) from tracked_channels where external_id like 'UC%' and business_id in (select id from businesses where owner_id = ${USER_ID})`), "1");
});

// Failure handling (retry in 30 minutes, pause at 12, YouTube quota) is covered by collect-pipeline.test.ts.
const channelId = sql(`select id from tracked_channels where external_id like 'UC%' and business_id in (select id from businesses where owner_id = ${USER_ID})`);
const snapshotCount = () => Number(sql(`select count(*) from marketing_metric_snapshots where channel_id = '${channelId}' and source = 'mock'`));
const contentCount = () => Number(sql(`select count(*) from channel_content_snapshots where channel_id = '${channelId}'`));

console.log("\n[자동 수집]");
await step("크론 비밀값이 없거나 틀리면 401", async () => {
  assert.equal((await cron(null)).status, 401);
  assert.equal((await cron("wrong")).status, 401);
});
await step("과거 며칠치 기록을 넣고(로컬 mock), 06:00이 지난 채널은 크론 한 번에 수집돼요", async () => {
  for (const [daysAgo, views, subs] of [[3, 1000, 100], [2, 1100, 104], [1, 1250, 109]]) {
    sql(`insert into marketing_metric_snapshots (channel_id, metric, value, recorded_at, source) values ('${channelId}','viewCount',${views}, now() - interval '${daysAgo} days','mock'), ('${channelId}','subscriberCount',${subs}, now() - interval '${daysAgo} days','mock')`);
  }
  // registering already took today's first snapshot; clear it so the cron run below has to write it
  sql(`delete from marketing_metric_snapshots where channel_id = '${channelId}' and recorded_date = (now() at time zone 'Asia/Seoul')::date`);
  sql(`delete from channel_content_snapshots where channel_id = '${channelId}'`);
  sql(`update tracked_channels set next_snapshot_at = now() - interval '1 minute', last_collected_at = null where id = '${channelId}'`);
  const before = snapshotCount();
  const response = await cron(CRON_SECRET);
  assert.equal(response.status, 200);
  assert.ok(snapshotCount() > before, "스냅샷이 늘지 않았어요");
  assert.ok(contentCount() > 0, "영상별 스냅샷이 없어요");
  assert.equal(sql(`select last_collection_status from tracked_channels where id = '${channelId}'`), "SUCCESS");
  assert.equal(sql(`select to_char(next_snapshot_at at time zone 'UTC','HH24:MI') from tracked_channels where id = '${channelId}'`), "21:00");
});
await step("같은 날 크론이 다시 돌아도 중복 수집·중복 행이 생기지 않아요", async () => {
  const [snaps, contents] = [snapshotCount(), contentCount()];
  await cron(CRON_SECRET);
  await cron(CRON_SECRET);
  assert.equal(snapshotCount(), snaps);
  assert.equal(contentCount(), contents);
});
await step("동시에 두 번 호출해도 한 번만 수집돼요(claim)", async () => {
  sql(`update tracked_channels set next_snapshot_at = now() - interval '1 minute' where id = '${channelId}'`);
  const runsBefore = Number(sql(`select count(*) from channel_collection_runs where trigger = 'CRON'`));
  await Promise.all([cron(CRON_SECRET), cron(CRON_SECRET)]);
  const runs = Number(sql(`select count(*) from channel_collection_runs where trigger = 'CRON'`)) - runsBefore;
  const succeeded = Number(sql(`select coalesce(sum(channels_succeeded),0) from (select * from channel_collection_runs where trigger='CRON' order by started_at desc limit ${Math.max(runs, 1)}) r`));
  assert.equal(succeeded, 1, `수집이 ${succeeded}번 일어났어요`);
});
await step("실행 기록이 남아요(CRON, SUCCESS)", async () => {
  assert.ok(Number(sql(`select count(*) from channel_collection_runs where trigger = 'CRON' and status = 'SUCCESS'`)) >= 1);
});
console.log("\n[성장 리포트]");
for (const mobile of [false, true]) {
  const label = mobile ? "휴대폰" : "PC";
  const mctx = await newContext(browser, { mobile });
  const mpage = await mctx.newPage();
  await login(mpage);
  await step(`${label}: 일/주/월 보기가 있고 마지막 수집 시각과 샘플 표시가 보여요`, async () => {
    await mpage.goto(`${BASE_URL}/growth-report`, { waitUntil: "networkidle" });
    const text = await mpage.locator("main").innerText();
    assert.match(text, /샘플/);
    assert.match(text, /마지막 수집|마지막 업데이트|마지막/);
    for (const view of ["day", "week", "month"]) {
      await mpage.goto(`${BASE_URL}/growth-report?view=${view}`, { waitUntil: "networkidle" });
      assert.ok((await mpage.locator("main").innerText()).length > 50);
    }
  });
  await step(`${label}: 가로 스크롤이 생기지 않아요`, async () => {
    await mpage.goto(`${BASE_URL}/growth-report`, { waitUntil: "networkidle" });
    const overflow = await mpage.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 1, `가로로 ${overflow}px 넘쳐요`);
  });
  await mctx.close();
}

console.log("\n[주소 변경]");
await step("'주소 변경'으로 새 채널을 확인·등록하면 이전 채널이 지워져요", async () => {
  await page.goto(`${BASE_URL}/diagnosis`, { waitUntil: "networkidle" });
  const oldId = channelId;
  // find the card by the address this check registered: the order of cards (and the seeded demo channels) must not matter
  const card = page.locator("div.rounded-2xl", { hasText: `youtube.com/@${HANDLE}` }).last();
  await card.getByRole("button", { name: "유튜브 주소 변경" }).click();
  await card.getByLabel("새 채널 주소").fill("https://www.youtube.com/@e2e-bakery-two");
  await card.getByRole("button", { name: "채널 확인" }).click();
  await card.getByRole("status", { name: "확인된 채널" }).waitFor({ timeout: 15_000 });
  await card.getByRole("button", { name: "이 채널로 바꾸기" }).click();
  await page.waitForTimeout(3000);
  assert.equal(sql(`select count(*) from tracked_channels where id = '${oldId}'`), "0");
  assert.equal(sql(`select count(*) from tracked_channels where external_id like 'UC%' and business_id in (select id from businesses where owner_id = ${USER_ID})`), "1");
});
await step("존재하지 않는 채널은 확인 단계에서 이유와 함께 막혀요", async () => {
  await page.goto(`${BASE_URL}/diagnosis`, { waitUntil: "networkidle" });
  await page.getByLabel("채널 주소").first().fill("https://www.youtube.com/watch?v=abc");
  await page.getByRole("button", { name: "채널 확인" }).click();
  await page.waitForTimeout(1500);
  assert.equal(await page.getByRole("status", { name: "확인된 채널" }).count(), 0);
  assert.ok((await page.locator("#add-channel-error").count()) > 0, "오류 안내가 없어요");
});

console.log("\n[관리자]");
const adminContext = await newContext(browser);
const adminPage = await adminContext.newPage();
await login(adminPage, { email: "admin@autobiz.local", password: "Admin1234!" });
await step("관리자는 수집 기록(자동·성공/실패 건수)을 볼 수 있어요", async () => {
  await adminPage.goto(`${BASE_URL}/admin/collection`, { waitUntil: "networkidle" });
  const text = await adminPage.locator("main").innerText();
  assert.match(text, /채널 수집 기록/);
  assert.match(text, /자동\(매일 06:00 KST\)/);
});
await step("'지금 수집'은 관리자만 쓰고, 연속 실행은 막혀요", async () => {
  adminPage.on("dialog", (dialog) => dialog.accept());
  sql(`delete from channel_collection_runs where trigger = 'MANUAL_ADMIN'`);
  await adminPage.getByRole("button", { name: "지금 수집" }).click();
  await adminPage.getByText(/수집 완료/).waitFor({ timeout: 40_000 });
  await adminPage.getByRole("button", { name: "지금 수집" }).click();
  await adminPage.getByText(/분 더 기다려 주세요/).waitFor({ timeout: 10_000 });
  assert.equal(sql(`select count(*) from channel_collection_runs where trigger = 'MANUAL_ADMIN'`), "1");
});
await step("일반 사용자는 /admin/collection 을 열 수 없어요", async () => {
  await page.goto(`${BASE_URL}/admin/collection`, { waitUntil: "networkidle" });
  assert.match(await page.locator("main").innerText(), /페이지를 찾을 수 없어요/);
});

await browser.close();
// Leave the local seed as it was: this check's channel, its mock snapshots, and what the admin "지금 수집" wrote onto the demo channels.
sql(`delete from tracked_channels where external_id like 'UC%' and business_id in (select id from businesses where owner_id = ${USER_ID})`);
sql(`delete from marketing_metric_snapshots where source = 'mock'`);
sql(`delete from channel_content_snapshots`);
sql(`update tracked_channels set display_name = null, thumbnail_url = null, last_collected_at = now(), last_collection_status = 'SUCCESS', consecutive_failure_count = 0 where external_id in ('@demo-growth-channel', 'demo-growth-blog')`);
console.log(failed ? `\n${failed}개 실패` : "\n모두 통과");
process.exit(failed ? 1 : 0);
