/**
 * Single source of truth for one-time credit products.
 *
 * Product ids are persisted in billing_orders and checkout sessions, so never
 * rename an id after it has been sold. Historical orders keep their own price,
 * credit and validity snapshots; these values define new purchases only.
 */
interface ProductDefinition {
  id: string;
  kind: "BLOG" | "SHORTS";
  name: string;
  priceKrw: number;
  credits: number;
  validityDays: number;
}

export const PRODUCT_CONFIGS = {
  BLOG_5: {
    id: "BLOG_5",
    kind: "BLOG",
    name: "블로그 포스팅 5회",
    priceKrw: 9_900,
    credits: 5,
    validityDays: 30,
  },
  BLOG_10: {
    id: "BLOG_10",
    kind: "BLOG",
    name: "블로그 포스팅 10회",
    priceKrw: 17_900,
    credits: 10,
    validityDays: 30,
  },
  BLOG_30: {
    id: "BLOG_30",
    kind: "BLOG",
    name: "블로그 포스팅 30회",
    priceKrw: 44_900,
    credits: 30,
    validityDays: 30,
  },
  SHORTS_3: {
    id: "SHORTS_3",
    kind: "SHORTS",
    name: "숏폼 제작 3회",
    priceKrw: 19_900,
    credits: 3,
    validityDays: 30,
  },
  SHORTS_10: {
    id: "SHORTS_10",
    kind: "SHORTS",
    name: "숏폼 제작 10회",
    priceKrw: 59_000,
    credits: 10,
    validityDays: 30,
  },
  SHORTS_30: {
    id: "SHORTS_30",
    kind: "SHORTS",
    name: "숏폼 제작 30회",
    priceKrw: 159_000,
    credits: 30,
    validityDays: 30,
  },
} as const satisfies Record<string, ProductDefinition>;

export type ProductId = keyof typeof PRODUCT_CONFIGS;
export type CreditKind = (typeof PRODUCT_CONFIGS)[ProductId]["kind"];
export type ProductConfig = (typeof PRODUCT_CONFIGS)[ProductId];

/**
 * One-time signup trial. `referenceId` is persisted in the immutable ledger;
 * keep it stable so support can identify historical trial grants.
 */
export const FREE_TRIAL_CREDITS = {
  referenceId: "signup-trial-v1",
  validityDays: 30,
  amounts: { BLOG: 1, SHORTS: 1 },
} as const satisfies {
  referenceId: string;
  validityDays: number;
  amounts: Record<CreditKind, number>;
};

export const ALL_PRODUCTS: readonly ProductConfig[] = Object.values(PRODUCT_CONFIGS);

export function isProductId(value: string): value is ProductId {
  return Object.hasOwn(PRODUCT_CONFIGS, value);
}

export function getProductConfig(productId: ProductId): ProductConfig {
  return PRODUCT_CONFIGS[productId];
}

