import { afterEach, describe, expect, it, vi } from "vitest";
import type { ShortsReference } from "@/types/shorts-reference";

const { clientEnvMock, serverEnvMock } = vi.hoisted(() => ({
  clientEnvMock: { NEXT_PUBLIC_SITE_URL: "https://be-celeb.org" },
  serverEnvMock: { VIDEO_RENDER_PROVIDER: "json2video" as "json2video" | "mock" },
}));
vi.mock("@/lib/env/client", () => ({ clientEnv: clientEnvMock }));
vi.mock("@/lib/env/server", () => ({ serverEnv: serverEnvMock }));

const { detectImageType, isOwnedReferencePath, referenceStoragePath, resolveReferenceImageUrls } = await import("./reference-images");

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]);

describe("detectImageType", () => {
  it("accepts PNG and JPEG by magic bytes only", () => {
    expect(detectImageType(PNG)).toBe("png");
    expect(detectImageType(JPEG)).toBe("jpeg");
  });

  it("rejects other content even if it claims to be an image", () => {
    expect(detectImageType(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'></svg>"))).toBeNull();
    expect(detectImageType(new TextEncoder().encode("GIF89a......"))).toBeNull();
    expect(detectImageType(new Uint8Array([]))).toBeNull();
  });
});

describe("reference storage paths", () => {
  it("nests files under user and automation", () => {
    const path = referenceStoragePath("user-1", "auto-1", "ref-1", "png");
    expect(path).toBe("user-1/auto-1/ref-1.png");
    expect(isOwnedReferencePath(path, "user-1", "auto-1")).toBe(true);
  });

  it("refuses paths of someone else or with traversal", () => {
    expect(isOwnedReferencePath("user-2/auto-1/x.png", "user-1", "auto-1")).toBe(false);
    expect(isOwnedReferencePath("user-1/auto-2/x.png", "user-1", "auto-1")).toBe(false);
    expect(isOwnedReferencePath("user-1/auto-1/../user-2/x.png", "user-1", "auto-1")).toBe(false);
  });
});

describe("resolveReferenceImageUrls", () => {
  afterEach(() => vi.restoreAllMocks());

  const owner = { userId: "user-1", automationId: "auto-1" };
  function adminWith(createSignedUrl: ReturnType<typeof vi.fn>) {
    return { storage: { from: vi.fn().mockReturnValue({ createSignedUrl }) } } as never;
  }

  it("signs uploads and points mascot poses at the site's static files", async () => {
    const sign = vi.fn().mockResolvedValue({ data: { signedUrl: "https://abc.supabase.co/storage/v1/object/sign/shorts-references/user-1/auto-1/u.png?token=t" }, error: null });
    const references: ShortsReference[] = [
      { id: "u", kind: "upload", source: "user-1/auto-1/u.png", label: "" },
      { id: "m", kind: "mascot", source: "wave", label: "인사" },
    ];

    const urls = await resolveReferenceImageUrls(adminWith(sign), references, owner);

    expect(sign).toHaveBeenCalledWith("user-1/auto-1/u.png", 3600);
    expect(urls[0]).toMatch(/^https:\/\/abc\.supabase\.co\/storage\//);
    expect(urls[1]).toMatch(/\/shorts-mascot\/wave\.png$/);
    expect(urls.every((url) => url.startsWith("https://"))).toBe(true);
  });

  it("fails clearly when the site URL is not public HTTPS and the real renderer is on", async () => {
    clientEnvMock.NEXT_PUBLIC_SITE_URL = "http://localhost:3000";
    try {
      await expect(
        resolveReferenceImageUrls(adminWith(vi.fn()), [{ id: "m", kind: "mascot", source: "wave", label: "" }], owner),
      ).rejects.toMatchObject({ code: "NOT_CONFIGURED" });

      serverEnvMock.VIDEO_RENDER_PROVIDER = "mock";
      const urls = await resolveReferenceImageUrls(adminWith(vi.fn()), [{ id: "m", kind: "mascot", source: "wave", label: "" }], owner);
      expect(urls[0]).toMatch(/^https:\/\/reference-image\.mock\.invalid\//);
    } finally {
      clientEnvMock.NEXT_PUBLIC_SITE_URL = "https://be-celeb.org";
      serverEnvMock.VIDEO_RENDER_PROVIDER = "json2video";
    }
  });

  it("never signs a path that belongs to another user", async () => {
    const sign = vi.fn();
    await expect(
      resolveReferenceImageUrls(adminWith(sign), [{ id: "x", kind: "upload", source: "user-2/auto-1/x.png", label: "" }], owner),
    ).rejects.toMatchObject({ code: "INVALID_TARGET" });
    expect(sign).not.toHaveBeenCalled();
  });

  it("reports an unreadable upload instead of rendering without it", async () => {
    const sign = vi.fn().mockResolvedValue({ data: null, error: { message: "not found" } });
    await expect(
      resolveReferenceImageUrls(adminWith(sign), [{ id: "u", kind: "upload", source: "user-1/auto-1/u.png", label: "" }], owner),
    ).rejects.toMatchObject({ code: "INVALID_TARGET" });
  });
});
