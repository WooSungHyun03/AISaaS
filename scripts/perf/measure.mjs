// Local performance measurements (production build on http://localhost:3100, seeded local DB, mock providers).
//   npm run build && npx next start -p 3100 && node scripts/perf/measure.mjs [label]
// Prints page-load timings (TTFB / DCL / load / LCP / CLS / requests) and the growth-report button latencies.
import { BASE_URL, launch, login, newContext } from "../e2e/lib.mjs";

const label = process.argv[2] ?? "run";
const PAGES = ["/", "/dashboard", "/diagnosis", "/calendar", "/blog", "/shorts", "/growth-report", "/settings", "/billing", "/guide"];
const browser = await launch();
const context = await newContext(browser);
const page = await context.newPage();
await login(page);

async function loadMetrics(path) {
  let requests = 0;
  const count = () => { requests += 1; };
  page.on("request", count);
  await page.addInitScript(() => {
    window.__lcp = 0; window.__cls = 0;
    new PerformanceObserver((list) => { for (const e of list.getEntries()) window.__lcp = e.startTime; }).observe({ type: "largest-contentful-paint", buffered: true });
    new PerformanceObserver((list) => { for (const e of list.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: "layout-shift", buffered: true });
  });
  const start = Date.now();
  await page.goto(`${BASE_URL}${path}`, { waitUntil: "networkidle" });
  const wall = Date.now() - start;
  await page.waitForTimeout(400);
  const nav = await page.evaluate(() => {
    const n = performance.getEntriesByType("navigation")[0];
    return { ttfb: Math.round(n.responseStart), dcl: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd), lcp: Math.round(window.__lcp), cls: Number(window.__cls.toFixed(3)), transferKB: Math.round(performance.getEntriesByType("resource").reduce((s, r) => s + (r.transferSize || 0), 0) / 1024) };
  });
  page.off("request", count);
  return { path, wall, requests, ...nav };
}

console.log(`\n== ${label}: page loads (warm session, production build)`);
for (const path of PAGES) {
  // two loads: the first warms server caches, the second is reported
  await loadMetrics(path);
  const m = await loadMetrics(path);
  console.log(`${m.path.padEnd(16)} ttfb ${String(m.ttfb).padStart(4)}ms  dcl ${String(m.dcl).padStart(4)}ms  load ${String(m.load).padStart(4)}ms  lcp ${String(m.lcp).padStart(4)}ms  cls ${m.cls}  req ${m.requests}  ${m.transferKB}KB`);
}

console.log(`\n== ${label}: growth-report buttons (click → heading/aria state updated and chart painted)`);
await page.goto(`${BASE_URL}/growth-report`, { waitUntil: "networkidle" });
const buttons = [["최근 7일", "기간 선택"], ["최근 90일", "기간 선택"], ["최근 30일", "기간 선택"], ["주별", "보기 단위"], ["월별", "보기 단위"], ["일별", "보기 단위"]];
for (const [name, group] of buttons) {
  let requests = 0;
  // The browser re-asks for the favicon when the URL is updated (history.replaceState); that is not app traffic.
  const onReq = (r) => { if (!/\.(png|jpg|svg|ico|woff2?|css)(\?.*)?$/.test(r.url())) requests += 1; };
  page.on("request", onReq);
  const control = page.getByRole("navigation", { name: group }).getByText(name, { exact: true });
  const t0 = Date.now();
  await control.click();
  // selected state is reflected when aria-current/aria-pressed is set on the control
  await page.waitForFunction(({ name, group }) => {
    const nav = document.querySelector(`nav[aria-label="${group}"]`);
    if (!nav) return false;
    return [...nav.querySelectorAll("a,button")].some((el) => el.textContent?.trim() === name && (el.getAttribute("aria-current") === "page" || el.getAttribute("aria-pressed") === "true"));
  }, { name, group }, { timeout: 30_000 });
  const selected = Date.now() - t0;
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(150);
  const settled = Date.now() - t0;
  page.off("request", onReq);
  console.log(`${name.padEnd(8)} selected ${String(selected).padStart(5)}ms  settled ${String(settled).padStart(5)}ms  network requests ${requests}`);
}
await browser.close();
