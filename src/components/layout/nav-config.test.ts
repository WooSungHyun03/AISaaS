import { describe, expect, it } from "vitest";
import { APP_NAV, getActiveNavItem, isNavActive } from "./nav-config";
import { NAV_LINKS } from "./public-nav";

describe("navigation information architecture", () => {
  it("lists the agreed customer menu in the same shared order", () => {
    const items = APP_NAV.flatMap((section) => section.items);

    expect(items.map((item) => item.href)).toEqual([
      "/dashboard",
      "/diagnosis",
      "/calendar",
      "/blog",
      "/shorts",
      "/usage",
      "/growth-report",
      "/billing",
      "/support",
      "/settings",
    ]);
    expect(items.map((item) => item.label)).toEqual([
      "대시보드",
      "마케팅 진단",
      "마케팅 캘린더",
      "블로그",
      "숏폼",
      "이용내역",
      "성장 리포트",
      "요금제·결제",
      "문의",
      "설정",
    ]);
  });

  it("keeps compatibility routes under the correct current menu", () => {
    const diagnosis = APP_NAV[0]!.items[1]!;
    const usage = APP_NAV[0]!.items[5]!;

    expect(isNavActive("/diagnosis", diagnosis)).toBe(true);
    expect(isNavActive("/marketing/diagnosis", diagnosis)).toBe(true);
    expect(isNavActive("/usage", usage)).toBe(true);
    expect(isNavActive("/automations/history", usage)).toBe(true);
    expect(getActiveNavItem("/automations/history")?.href).toBe("/usage");
  });

  it("keeps public navigation focused on diagnosis, usage guidance, and pricing", () => {
    expect(NAV_LINKS[0]).toEqual({ href: "/#features", label: "마케팅 진단" });
    expect(NAV_LINKS.at(-1)).toEqual({ href: "/pricing", label: "요금제" });
  });

  it("does not surface deprecated routes while their code remains available", () => {
    const allApp = APP_NAV.flatMap((section) => section.items.map((item) => item.href));
    const allPublic = NAV_LINKS.map((link) => link.href);
    const deprecated = ["/setup-request", "/directory", "/guides", "/automations", "/automations/marketplace", "/automations/history"];

    for (const href of deprecated) {
      expect(allApp).not.toContain(href);
      expect(allPublic).not.toContain(href);
    }
  });

  it("does not activate a prefix lookalike route", () => {
    const settings = APP_NAV[0]!.items.at(-1)!;
    expect(isNavActive("/settings", settings)).toBe(true);
    expect(isNavActive("/settings/profile", settings)).toBe(true);
    expect(isNavActive("/settings-old", settings)).toBe(false);
  });
});
