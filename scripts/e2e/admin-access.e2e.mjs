// /admin must open for a registered administrator and answer "not found" for everyone else (checked on the LOCAL stack).
import assert from "node:assert/strict";
import { BASE_URL, launch, login, newContext } from "./lib.mjs";

const browser = await launch();
let failed = 0;
const check = async (name, run) => {
  try { await run(); console.log(`  ✓ ${name}`); } catch (error) { failed += 1; console.log(`  ✗ ${name}\n    ${error instanceof Error ? error.message : error}`); }
};

await check("로그인하지 않으면 로그인 화면으로 가요", async () => {
  const page = await (await newContext(browser)).newPage();
  await page.goto(`${BASE_URL}/admin`, { waitUntil: "networkidle" });
  assert.match(page.url(), /\/login/);
});
await check("일반 사용자는 /admin 에서 ‘페이지를 찾을 수 없어요’를 봐요", async () => {
  const page = await (await newContext(browser)).newPage();
  await login(page);
  await page.goto(`${BASE_URL}/admin`, { waitUntil: "networkidle" });
  assert.match(await page.locator("main").innerText(), /페이지를 찾을 수 없어요/);
  await page.goto(`${BASE_URL}/admin/users`, { waitUntil: "networkidle" });
  assert.match(await page.locator("main").innerText(), /페이지를 찾을 수 없어요/);
});
await check("등록된 관리자는 /admin 대시보드와 하위 화면을 열 수 있어요", async () => {
  const page = await (await newContext(browser)).newPage();
  await login(page, { email: "admin@autobiz.local", password: "Admin1234!" });
  for (const path of ["/admin", "/admin/users", "/admin/payments", "/admin/inquiries"]) {
    await page.goto(`${BASE_URL}${path}`, { waitUntil: "networkidle" });
    const text = await page.locator("main").innerText();
    assert.ok(!/페이지를 찾을 수 없어요/.test(text), `${path} 가 열리지 않아요`);
  }
});
await browser.close();
process.exit(failed ? 1 : 0);
