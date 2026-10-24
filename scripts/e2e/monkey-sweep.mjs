// Clicks every visible button and link on the main screens (skipping destructive or paid ones) and reports what a person
// would hit: a console error, an uncaught exception, a 5xx answer, a dead end. LOCAL stack only (seeded user).
//   node scripts/e2e/monkey-sweep.mjs [--mobile]
import { BASE_URL, launch, login, newContext } from "./lib.mjs";

const mobile = process.argv.includes("--mobile");
const ROUTES = ["/dashboard", "/diagnosis", "/calendar", "/blog", "/shorts", "/shorts/library", "/growth-report", "/automations", "/usage", "/billing", "/settings", "/business", "/guide", "/support"];
const SKIP = /삭제|로그아웃|구매|결제|환불|탈퇴|해지|취소|제출|보내기|전송|초기화|지금 만들기|영상 만들기|미리보기 만들기|바로 만들기|지금 수집|등록|저장|확인|계정/;
const browser = await launch();
const context = await newContext(browser, { mobile });
const page = await context.newPage();
await login(page);
let issues = 0;
let clicks = 0;
let lastControl = "(page load)";

for (const route of ROUTES) {
  const found = [];
  const onConsole = (m) => { if (m.type() === "error" && !/favicon|Failed to load resource/.test(m.text())) found.push(`console after "${lastControl}": ${m.text().slice(0, 140)}`); };
  const onError = (e) => found.push(`exception after "${lastControl}": ${e.message.slice(0, 140)}`);
  const onResponse = (r) => { if (r.status() >= 500) found.push(`HTTP ${r.status()} ${r.request().method()} ${r.url().replace(BASE_URL, "").slice(0, 80)}`); };
  page.on("console", onConsole); page.on("pageerror", onError); page.on("response", onResponse);
  await page.goto(`${BASE_URL}${route}`, { waitUntil: "networkidle" });
  const labels = await page.locator("main button:visible, main a:visible, main [role=tab]:visible, main summary:visible").evaluateAll((els) => els.map((e, i) => ({ i, text: (e.getAttribute("aria-label") || e.textContent || "").trim().replace(/\s+/g, " ").slice(0, 40), href: e.getAttribute("href") || "" })));
  const seen = new Set();
  for (const { text, href } of labels) {
    const key = `${text}|${href}`;
    if (!text || seen.has(key) || SKIP.test(text) || /^(https?:|mailto:|tel:)/.test(href)) continue;
    seen.add(key);
    lastControl = text;
    await page.goto(`${BASE_URL}${route}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(150);
    const target = href ? page.locator(`main a[href="${href}"]:visible`).first() : page.locator("main button:visible, main [role=tab]:visible, main summary:visible").filter({ hasText: text }).first();
    if (!(await target.count())) continue;
    await target.click({ timeout: 4000 }).catch(() => {});
    clicks += 1;
    await page.waitForTimeout(350);
    const body = await page.locator("body").innerText().catch(() => "");
    if (/문제가 생겼어요|Application error|Internal Server Error/.test(body)) found.push(`error screen after "${text}"`);
    await page.keyboard.press("Escape").catch(() => {});
  }
  page.off("console", onConsole); page.off("pageerror", onError); page.off("response", onResponse);
  const unique = [...new Set(found)];
  if (unique.length) { issues += 1; console.log(`  ✗ ${route}\n      ${unique.join("\n      ")}`); } else console.log(`  ✓ ${route} (${seen.size} controls)`);
}
await browser.close();
console.log(issues ? `\n${issues}개 화면에서 문제 발견 (${clicks}회 클릭)` : `\n문제 없음 (${clicks}회 클릭)`);
process.exit(issues ? 1 : 0);
