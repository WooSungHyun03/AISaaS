import { describe, expect, it } from "vitest";
import { APP_NAV, isNavActive } from "./nav-config";
import { NAV_LINKS } from "./public-nav";

describe("navigation information architecture", () => {
  it("puts the new-user marketing journey before advanced settings", () => {
    expect(APP_NAV[0]?.items.map((item) => item.href)).toEqual([
      "/dashboard",
      "/diagnosis",
      "/business",
      "/calendar",
      "/blog",
      "/shorts",
      "/growth-report",
    ]);
    expect(APP_NAV[1]).toMatchObject({
      label: "고급 설정",
      items: [
        { href: "/automations/marketplace" },
        { href: "/automations" },
        { href: "/automations/history" },
      ],
    });
  });

  it("keeps the diagnosis item active after its compatibility redirect", () => {
    const diagnosis = APP_NAV[0]!.items[1]!;
    expect(isNavActive("/diagnosis", diagnosis)).toBe(true);
    expect(isNavActive("/marketing/diagnosis", diagnosis)).toBe(true);
  });

  it("places resources last and prioritizes diagnosis in the public navigation", () => {
    expect(APP_NAV.at(-1)?.label).toBe("리소스");
    expect(APP_NAV.at(-1)?.items.map((item) => item.href)).toEqual(["/directory", "/guides"]);
    expect(NAV_LINKS[0]).toEqual({ href: "/#features", label: "마케팅 진단" });
    expect(NAV_LINKS.at(-1)).toEqual({ href: "/directory", label: "AI 서비스" });
  });
});
