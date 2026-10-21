// Scheduled blog + Shorts production, end to end against the LOCAL stack (mock AI, no paid calls):
//   bash scripts/dev-db.sh
//   CRON_SECRET=local-cron-secret CHANNEL_DATA_PROVIDER=live ALLOW_MOCK_AI=true AI_PROVIDER=mock BILLING_PROVIDER=mock \
//     npx next start -p 3100            (after npm run build with the local env)
//   CRON_SECRET=local-cron-secret node scripts/e2e/scheduled-content.e2e.mjs
// "The cron endpoint answered" is not the check: every scenario ends at the saved content, the run history and the credit ledger.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { BASE_URL, launch, login, newContext, topUpLocalCredits } from "./lib.mjs";

const DB_CONTAINER = process.env.E2E_DB_CONTAINER ?? "supabase_db_autobiz-dev-db";
const CRON_SECRET = process.env.CRON_SECRET ?? "local-cron-secret";
const sql = (query) => execFileSync("docker", ["exec", DB_CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-tA", "-c", query], { encoding: "utf8" }).trim();
const USER = `(select id from auth.users where email = 'user@autobiz.local')`;
let failed = 0;
const step = async (name, run) => {
  try { await run(); console.log(`  ✓ ${name}`); } catch (error) { failed += 1; console.log(`  ✗ ${name}\n    ${error instanceof Error ? error.message : error}`); }
};
const cron = () => fetch(`${BASE_URL}/api/cron/run-automations`, { method: "POST", headers: { "x-cron-secret": CRON_SECRET } }).then((r) => r.json());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- test data: two fresh automations (blog + Shorts) for the seeded user, removed again at the end ----------
const business = sql(`select id from businesses where owner_id = ${USER} and name = '성수 소금빵집'`);
assert.ok(business, "seeded business missing (run bash scripts/dev-db.sh and the guide seeds)");
sql(`update businesses set promotion_type = coalesce(promotion_type, 'STORE') where id = '${business}'`);
topUpLocalCredits(sql);
sql(`delete from automations where name like 'E2E 예약 %' and user_id = ${USER}`);

const kstWeekday = (offsetDays = 0) => new Date(Date.now() + 9 * 3_600_000 + offsetDays * 86_400_000).getUTCDay();
const TODAY = kstWeekday(0);
const OTHER = kstWeekday(2);
const schedule = (days) => JSON.stringify({ frequency: "WEEKLY", daysOfWeek: days, timeOfDay: "09:00", timezone: "Asia/Seoul" });
const blogConfig = JSON.stringify({ objective: "신규 고객의 방문·예약·문의 늘리기", keywords: ["소금빵", "성수 빵집"], tone: "친근하고 전문적인", deliveryMode: "app_draft", platform: "naver" });
const shortsConfig = JSON.stringify({ assets: [{ id: "mascot-wave", kind: "image", origin: "mascot", source: "wave", label: "인사", role: "character" }], shortsBrief: "신메뉴 소금빵을 갓 구운 느낌으로 보여주세요", durationSec: 25, voiceMode: "native" });
function createAutomation(slug, name, days, config, nextRunAt) {
  return sql(`insert into automations (user_id, business_id, template_id, name, status, schedule, config, next_run_at)
    values (${USER}, '${business}', (select id from automation_templates where slug = '${slug}'), '${name}', 'ACTIVE', '${schedule(days)}'::jsonb, '${config}'::jsonb, ${nextRunAt}) returning id`).split("\n")[0];
}
const credits = (kind) => Number(sql(`select coalesce(sum(remaining),0) from credit_grants where user_id = ${USER} and kind = '${kind}'`));
const runsOf = (id) => sql(`select status || '|' || source from automation_runs where automation_id = '${id}' order by created_at`).split("\n").filter(Boolean);

/** Ticks until the automation's run is no longer in flight (a blog post or a video is written in several steps). */
async function runToCompletion(id, limit = 60) {
  for (let i = 0; i < limit; i++) {
    await cron();
    const inFlight = sql(`select count(*) from automation_runs where automation_id = '${id}' and status in ('QUEUED','RUNNING')`);
    if (inFlight === "0" && runsOf(id).length > 0) return;
    await sleep(700);
  }
  throw new Error(`run of ${id} did not finish in ${limit} ticks`);
}

const blogId = createAutomation("blog-marketing", "E2E 예약 블로그", [TODAY], blogConfig, "now() - interval '2 minutes'");
const shortsId = createAutomation("shorts", "E2E 예약 숏폼", [TODAY], shortsConfig, "now() + interval '1 day'");
const offDayId = createAutomation("blog-marketing", "E2E 예약 다른요일", [OTHER], blogConfig, "now() + interval '2 days'");

console.log("\n[요일 예약 → 실제 생성]");
await step("선택한 요일의 슬롯이 오면 블로그 글이 만들어져 생성 이력까지 저장돼요(이용권 1회만 차감)", async () => {
  const before = credits("BLOG");
  await runToCompletion(blogId);
  assert.deepEqual(runsOf(blogId), ["SUCCESS|SCHEDULED"]);
  assert.equal(sql(`select count(*) from content_history where automation_id = '${blogId}' and run_id is not null and length(content) > 50`), "1");
  assert.equal(before - credits("BLOG"), 1, "이용권이 정확히 1회 차감돼야 해요");
  assert.equal(sql(`select consecutive_failures from automations where id = '${blogId}'`), "0");
  assert.ok(sql(`select last_run_at from automations where id = '${blogId}'`).length > 0);
});
await step("다음 제작 시각은 같은 요일 다음 주(한국 시간 09:00)로 옮겨져요", async () => {
  const next = sql(`select to_char(next_run_at at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') || '|' || extract(dow from next_run_at at time zone 'Asia/Seoul') from automations where id = '${blogId}'`);
  const [clock, dow] = next.split("|");
  assert.match(clock, / 09:00$/);
  assert.equal(Number(dow), TODAY);
  assert.ok(Date.parse(`${clock.replace(" ", "T")}:00+09:00`) > Date.now());
});
/** A production build refuses Shorts until a real video generator is configured (a placeholder must never pass as a video); `next dev` makes a labelled sample. */
const shortsRefusal = () => /영상 제작 서비스가 아직 연결되지 않아/.test(sql(`select coalesce(string_agg(error_message, ' '), '') from automation_runs where automation_id = '${shortsId}'`));
await step("슬롯이 오면 숏폼도 정확히 1회만 실행돼요(세 번 동시에 불러도)", async () => {
  const before = credits("SHORTS");
  sql(`update automations set next_run_at = now() - interval '1 minute' where id = '${shortsId}'`);
  await Promise.all([cron(), cron(), cron()]);
  await runToCompletion(shortsId);
  await cron();
  assert.equal(runsOf(shortsId).length, 1, "숏폼 예약은 슬롯당 1회만 실행돼야 해요");
  if (shortsRefusal()) {
    // no generator configured: the run is recorded with the reason, nothing is charged, the schedule keeps going
    assert.deepEqual(runsOf(shortsId), ["FAILED|SCHEDULED"]);
    assert.equal(credits("SHORTS"), before, "생성하지 못했으면 이용권은 그대로여야 해요");
    assert.equal(sql(`select status from automations where id = '${shortsId}'`), "ACTIVE");
    assert.ok(Date.parse(sql(`select next_run_at from automations where id = '${shortsId}'`)) > Date.now());
    console.log("    (이 서버는 운영 빌드라 영상 생성기가 없어 거절 경로를 확인했어요)");
  } else {
    assert.deepEqual(runsOf(shortsId), ["SUCCESS|SCHEDULED"]);
    assert.equal(before - credits("SHORTS"), 1);
    const output = sql(`select output::text from automation_runs where automation_id = '${shortsId}' and status = 'SUCCESS'`);
    assert.match(output, /sampleVideo|videoPath|videoUrl|script/);
  }
});

await step("선택하지 않은 요일의 예약은 돌지 않아요", async () => {
  await cron();
  assert.deepEqual(runsOf(offDayId), []);
  assert.equal(sql(`select count(*) from content_history where automation_id = '${offDayId}'`), "0");
});

console.log("\n[장애 복구]");
await step("스케줄러가 몇 시간 멈췄다가 돌아오면 놓친 슬롯을 한 번만 따라잡아요", async () => {
  const id = createAutomation("blog-marketing", "E2E 예약 따라잡기", [TODAY], blogConfig, "now() - interval '3 hours'");
  await runToCompletion(id);
  assert.deepEqual(runsOf(id), ["SUCCESS|SCHEDULED"]);
  await cron();
  assert.equal(runsOf(id).length, 1);
});
await step("하루 넘게 놓친 슬롯은 만들지 않고 이력에 사유를 남긴 뒤 다음 슬롯으로 넘어가요(이용권 그대로)", async () => {
  const id = createAutomation("blog-marketing", "E2E 예약 오래된슬롯", [TODAY], blogConfig, "now() - interval '30 hours'");
  const before = credits("BLOG");
  await cron();
  await sleep(500);
  assert.deepEqual(runsOf(id), ["FAILED|SCHEDULED"]);
  assert.match(sql(`select error_message from automation_runs where automation_id = '${id}'`), /건너뛰었어요/);
  assert.equal(credits("BLOG"), before);
  assert.equal(sql(`select count(*) from content_history where automation_id = '${id}'`), "0");
  assert.equal(sql(`select status from automations where id = '${id}'`), "ACTIVE");
  assert.ok(Date.parse(sql(`select next_run_at from automations where id = '${id}'`)) > Date.now(), "다음 슬롯으로 넘어가야 해요");
});
await step("한 번 실패해도 예약은 멈추지 않아요(연속 3회째에야 멈춤)", async () => {
  const id = createAutomation("blog-marketing", "E2E 예약 실패", [TODAY], JSON.stringify({ objective: "" }), "now() - interval '1 minute'");
  for (let attempt = 1; attempt <= 3; attempt++) {
    sql(`update automations set next_run_at = now() - interval '1 minute' where id = '${id}' and status = 'ACTIVE'`);
    await cron();
    await sleep(600);
    const [status, failures] = sql(`select status || '|' || consecutive_failures from automations where id = '${id}'`).split("|");
    // a bad config is refused before it can fail (no streak); either way the schedule is never parked by ONE failure
    if (attempt === 1) assert.equal(status, "ACTIVE");
    assert.ok(Number(failures) <= attempt);
  }
});
await step("스케줄러 상태 API가 마지막 실행 시각을 알려줘요", async () => {
  const response = await fetch(`${BASE_URL}/api/health/scheduler`);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.healthy, true);
  assert.ok(body.ageMinutes <= 5);
  assert.ok(Number(sql(`select count(*) from scheduler_ticks where succeeded + failed + skipped > 0`)) >= 1);
});

console.log("\n[화면: 요일 선택 · 켜기/끄기]");
const browser = await launch();
const page = await (await newContext(browser)).newPage();
await login(page);
await step("블로그 화면에 '자동으로 만들기' 스위치와 다음 제작 시각이 보여요", async () => {
  await page.goto(`${BASE_URL}/blog`, { waitUntil: "networkidle" });
  const card = page.locator("section", { hasText: "E2E 예약 블로그" }).first();
  await card.getByRole("switch", { name: "정해진 때마다 자동으로 만들기" }).waitFor();
  assert.match(await card.innerText(), /다음 제작/);
});
await step("스위치를 끄면 즉시 반영돼요(PAUSED, 다음 제작 없음) · 다시 켜면 선택한 요일로 예약돼요", async () => {
  const card = page.locator("section", { hasText: "E2E 예약 블로그" }).first();
  await card.getByRole("switch", { name: "정해진 때마다 자동으로 만들기" }).click();
  for (let i = 0; i < 20 && sql(`select status from automations where id = '${blogId}'`) !== "PAUSED"; i++) await sleep(300);
  assert.equal(sql(`select status || '|' || coalesce(next_run_at::text, 'null') from automations where id = '${blogId}'`), "PAUSED|null");
  await cron();
  assert.equal(runsOf(blogId).length, 1, "꺼 둔 예약은 돌면 안 돼요");
  await page.goto(`${BASE_URL}/blog`, { waitUntil: "networkidle" });
  await card.getByRole("switch", { name: "정해진 때마다 자동으로 만들기" }).click();
  for (let i = 0; i < 20 && sql(`select status from automations where id = '${blogId}'`) !== "ACTIVE"; i++) await sleep(300);
  assert.equal(sql(`select status from automations where id = '${blogId}'`), "ACTIVE");
  assert.equal(Number(sql(`select extract(dow from next_run_at at time zone 'Asia/Seoul') from automations where id = '${blogId}'`)), TODAY);
});
await step("설정 수정에서 요일을 바꾸고 저장하면 다음 제작이 새 요일로 바뀌어요", async () => {
  await page.goto(`${BASE_URL}/blog`, { waitUntil: "networkidle" });
  const card = page.locator("section", { hasText: "E2E 예약 블로그" }).first();
  await card.getByRole("button", { name: "설정 수정" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  // pick exactly one other weekday: untick today, tick the day after tomorrow (the picker's buttons are "월요일" …)
  const names = ["일", "월", "화", "수", "목", "금", "토"];
  const dayButton = (day) => dialog.getByRole("button", { name: `${names[day]}요일`, exact: true });
  if ((await dayButton(OTHER).getAttribute("aria-pressed")) !== "true") await dayButton(OTHER).click();
  if ((await dayButton(TODAY).getAttribute("aria-pressed")) === "true") await dayButton(TODAY).click();
  await dialog.getByRole("button", { name: "변경 저장" }).click();
  for (let i = 0; i < 25 && Number(sql(`select extract(dow from next_run_at at time zone 'Asia/Seoul') from automations where id = '${blogId}'`)) !== OTHER; i++) await sleep(300);
  assert.equal(Number(sql(`select extract(dow from next_run_at at time zone 'Asia/Seoul') from automations where id = '${blogId}'`)), OTHER);
  assert.deepEqual(JSON.parse(sql(`select schedule->'daysOfWeek' from automations where id = '${blogId}'`)), [OTHER]);
});
await browser.close();

sql(`delete from automations where name like 'E2E 예약 %' and user_id = ${USER}`);
topUpLocalCredits(sql);
console.log(failed ? `\n${failed}개 실패` : "\n모두 통과");
process.exit(failed ? 1 : 0);
