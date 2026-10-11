import { describe, expect, it } from "vitest";
import { ALL_PRODUCTS, getProductConfig, isProductId, PRODUCT_CONFIGS } from "./products";

describe("credit products", () => {
  it("defines blog and shorts packages in 5/10/30 and 3/10/30 quantities", () => {
    expect(ALL_PRODUCTS.filter((product) => product.kind === "BLOG").map((product) => product.credits)).toEqual([5, 10, 30]);
    expect(ALL_PRODUCTS.filter((product) => product.kind === "SHORTS").map((product) => product.credits)).toEqual([3, 10, 30]);
  });

  it("keeps every price positive and every package valid for 30 days", () => {
    for (const [id, product] of Object.entries(PRODUCT_CONFIGS)) {
      expect(product.id).toBe(id);
      expect(product.priceKrw).toBeGreaterThan(0);
      expect(product.validityDays).toBe(30);
    }
  });

  it("resolves only persisted product ids", () => {
    expect(isProductId("BLOG_5")).toBe(true);
    expect(isProductId("STARTER")).toBe(false);
    expect(isProductId("anything")).toBe(false);
    expect(getProductConfig("SHORTS_3")).toBe(PRODUCT_CONFIGS.SHORTS_3);
  });
});

