// Shared helpers for the local browser checks (guide screenshots, upload E2E). Local development only:
// they sign in with the seeded local accounts of scripts/dev-db.sh and talk to http://localhost:3100.
import { chromium } from "playwright-core";

export const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3100";
export const USER = { email: process.env.DEV_USER_EMAIL ?? "user@autobiz.local", password: process.env.DEV_USER_PASSWORD ?? "User1234!" };

export function assertLocal() {
  const host = new URL(BASE_URL).hostname;
  if (!["localhost", "127.0.0.1", "[::1]"].includes(host)) throw new Error(`로컬 개발 서버에서만 실행할 수 있어요: ${BASE_URL}`);
}

export async function launch() {
  assertLocal();
  return chromium.launch({ channel: "chrome", headless: true });
}

export async function newContext(browser, { mobile = false } = {}) {
  return browser.newContext(
    mobile
      ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "ko-KR", timezoneId: "Asia/Seoul" }
      : { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, locale: "ko-KR", timezoneId: "Asia/Seoul" },
  );
}

export async function login(page, account = USER) {
  await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
  await page.getByLabel("이메일").fill(account.email);
  await page.getByLabel("비밀번호").first().fill(account.password);
  await page.getByRole("button", { name: /로그인/ }).first().click();
  await page.waitForURL(/\/(dashboard|onboarding|diagnosis|blog|shorts)/, { timeout: 30_000 });
}

/** Plain illustrated sample "photos" (no real people or places) for upload checks and guide screenshots. */
export async function makeSamplePhotos(dir, items = [["소금빵", "#F4B942", "#E8833A"], ["매장 입구", "#7FB7BE", "#3D5A80"], ["포장 라벨", "#C8A2C8", "#6D597A"]]) {
  const { mkdir } = await import("node:fs/promises");
  const sharp = (await import("sharp")).default;
  await mkdir(dir, { recursive: true });
  const paths = [];
  for (const [index, [name, from, to]] of items.entries()) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="1200" height="900" fill="url(#g)"/><circle cx="600" cy="400" r="190" fill="rgba(255,255,255,0.35)"/><text x="600" y="430" font-size="96" font-weight="700" text-anchor="middle" fill="white" font-family="sans-serif">${name}</text><text x="600" y="780" font-size="40" text-anchor="middle" fill="rgba(255,255,255,0.85)" font-family="sans-serif">샘플 사진 ${index + 1}</text></svg>`;
    const file = `${dir}/sample-${index + 1}.jpg`;
    await sharp(Buffer.from(svg)).jpeg({ quality: 88 }).toFile(file);
    paths.push(file);
  }
  return paths;
}

/** Local DB only: tops the seeded user's credits up so repeated runs never stall on "no credits". */
export function topUpLocalCredits(sql) {
  sql(`update credit_grants set remaining = amount, expires_at = now() + interval '30 days' where user_id = (select id from auth.users where email = 'user@autobiz.local')`);
  sql(`update credit_grants set amount = greatest(amount, 8), remaining = 8 where user_id = (select id from auth.users where email = 'user@autobiz.local')`);
}
