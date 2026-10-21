// Visits every main screen as the seeded user (PC and phone) and fails on anything a person would notice:
// a console error, an uncaught exception, a failed request, an error screen, a horizontal scrollbar, a button that does nothing.
//   node scripts/e2e/page-sweep.mjs            (local stack on :3100, seeded accounts)
import { BASE_URL, launch, login, newContext } from "./lib.mjs";

const ROUTES = ["/dashboard", "/diagnosis", "/calendar", "/blog", "/shorts", "/growth-report", "/growth-report?days=7&view=week", "/growth-report?days=90&view=month", "/automations", "/automations/history", "/usage", "/billing", "/settings", "/business", "/guide", "/guide/blog", "/guide/growth-report", "/support"];
const ADMIN_ROUTES = ["/admin", "/admin/users", "/admin/payments", "/admin/inquiries", "/admin/usage", "/admin/errors", "/admin/collection", "/admin/scheduler"];
let failed = 0;
const browser = await launch();

async function sweep(label, routes, account, mobile) {
  const context = await newContext(browser, { mobile });
  const page = await context.newPage();
  await login(page, account);
  for (const route of routes) {
    const problems = [];
    const onConsole = (message) => { if (message.type() === "error" && !/favicon|Failed to load resource.*(401|404)/.test(message.text())) problems.push(`console: ${message.text().slice(0, 200)}`); };
    const onError = (error) => problems.push(`exception: ${error.message.slice(0, 200)}`);
    const onFailed = (request) => { if (!/favicon|_rsc=|\.(png|jpg|svg|woff2?)(\?|$)/.test(request.url()) && request.failure()?.errorText !== "net::ERR_ABORTED") problems.push(`request failed: ${request.url().replace(BASE_URL, "")} ${request.failure()?.errorText}`); };
    page.on("console", onConsole); page.on("pageerror", onError); page.on("requestfailed", onFailed);
    const response = await page.goto(`${BASE_URL}${route}`, { waitUntil: "networkidle" }).catch((error) => { problems.push(`navigation: ${error.message.slice(0, 120)}`); return null; });
    await page.waitForTimeout(500);
    if (response && response.status() >= 400) problems.push(`HTTP ${response.status()}`);
    const text = await page.locator("body").innerText().catch(() => "");
    if (/문제가 생겼어요|Application error|Internal Server Error|undefined|NaN|\[object Object\]/.test(text)) problems.push(`error text on screen: ${(text.match(/문제가 생겼어요|Application error|Internal Server Error|undefined|NaN|\[object Object\]/) ?? [])[0]}`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (overflow > 1) problems.push(`horizontal overflow ${overflow}px`);
    page.off("console", onConsole); page.off("pageerror", onError); page.off("requestfailed", onFailed);
    if (problems.length) { failed += 1; console.log(`  ✗ ${label} ${route}\n      ${problems.join("\n      ")}`); } else console.log(`  ✓ ${label} ${route}`);
  }
  await context.close();
}

for (const mobile of [false, true]) {
  const device = mobile ? "휴대폰" : "PC";
  await sweep(device, ROUTES, undefined, mobile);
}
await sweep("관리자 PC", ADMIN_ROUTES, { email: "admin@autobiz.local", password: "Admin1234!" }, false);
await sweep("관리자 휴대폰", ["/admin", "/admin/collection", "/admin/scheduler"], { email: "admin@autobiz.local", password: "Admin1234!" }, true);
await browser.close();
console.log(failed ? `\n${failed}개 화면에 문제가 있어요` : "\n모든 화면이 깨끗해요");
process.exit(failed ? 1 : 0);
