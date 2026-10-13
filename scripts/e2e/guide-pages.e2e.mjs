// 이용방법 pages on the LOCAL stack: table of contents, every screenshot loads, zoom works, no sideways scrolling on a phone,
// and the old "이용 방법" block is gone from the public home page.
import assert from "node:assert/strict";
import { BASE_URL, launch, login, newContext } from "./lib.mjs";

const SLUGS = ["diagnosis", "calendar", "blog", "shorts", "growth-report", "home", "channels", "billing"];
const browser = await launch();
let failed = 0;
const check = async (name, run) => {
  try { await run(); console.log(`  ✓ ${name}`); } catch (error) { failed += 1; console.log(`  ✗ ${name}\n    ${error instanceof Error ? error.message : error}`); }
};

for (const mobile of [false, true]) {
  const label = mobile ? "휴대폰" : "PC";
  const page = await (await newContext(browser, { mobile })).newPage();
  await login(page);

  await check(`${label}: /guide 목차에 8개 기능이 있어요`, async () => {
    await page.goto(`${BASE_URL}/guide`, { waitUntil: "networkidle" });
    assert.equal(await page.locator("main ol > li a[href^='/guide/']").count(), 8);
  });

  for (const slug of SLUGS) {
    await check(`${label}: /guide/${slug} — 화면 이미지 · 목차 · 가로 스크롤 없음`, async () => {
      await page.goto(`${BASE_URL}/guide/${slug}`, { waitUntil: "networkidle" });
      assert.equal(await page.locator("h1").count(), 1);
      assert.equal(await page.getByRole("navigation", { name: "이용방법 목차" }).locator("a[href^='/guide/']").count(), 8);
      const images = page.locator("figure img");
      const count = await images.count();
      assert.ok(count > 0, "screens expected");
      for (let index = 0; index < count; index += 1) {
        await images.nth(index).scrollIntoViewIfNeeded();
        await page.waitForFunction((i) => { const img = document.querySelectorAll("figure img")[i]; return img && img.complete && img.naturalWidth > 0; }, index, { timeout: 10_000 });
        assert.ok((await images.nth(index).getAttribute("alt"))?.length > 10, "alt text expected");
      }
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(overflow <= 1, `horizontal overflow ${overflow}px`);
    });
  }

  await check(`${label}: 화면을 누르면 크게 볼 수 있고 Esc로 닫혀요`, async () => {
    await page.goto(`${BASE_URL}/guide/blog`, { waitUntil: "networkidle" });
    await page.locator("figure button").first().click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor();
    assert.ok(await dialog.locator("img").first().isVisible());
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
  });

  await check(`${label}: 사이드바(또는 메뉴)에 이용방법이 있어요`, async () => {
    await page.goto(`${BASE_URL}/dashboard`, { waitUntil: "networkidle" });
    assert.ok((await page.locator("a[href='/guide']").count()) > 0);
  });
}

await check("공개 홈에는 예전 ‘이용 방법’ 영역과 링크가 없어요", async () => {
  const page = await (await newContext(browser)).newPage();
  await page.goto(`${BASE_URL}/`, { waitUntil: "networkidle" });
  assert.equal(await page.locator("#how").count(), 0);
  assert.equal(await page.locator("a[href='/#how']").count(), 0);
  assert.equal(await page.getByText("이렇게 시작해요").count(), 0);
});

await browser.close();
process.exit(failed ? 1 : 0);
