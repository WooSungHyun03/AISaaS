import { beforeEach, describe, expect, it, vi } from "vitest";

const { createClientMock, adminMock, uploadMock, deleteMock, revalidatePathMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  adminMock: { kind: "admin" },
  uploadMock: vi.fn(),
  deleteMock: vi.fn(),
  revalidatePathMock: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));
vi.mock("@/lib/supabase/server", () => ({ createClient: createClientMock }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => adminMock }));
vi.mock("@/server/automations/runner", () => ({ runAutomationNow: vi.fn() }));
vi.mock("@/server/billing/entitlements", () => ({ canCreateAutomation: vi.fn() }));
vi.mock("@/server/shorts/reference-images", () => ({
  detectImageType: (bytes: Uint8Array) => (bytes[0] === 0x89 ? "png" : bytes[0] === 0xff ? "jpeg" : null),
  referenceStoragePath: (userId: string, automationId: string, id: string, type: string) => `${userId}/${automationId}/${id}.${type === "png" ? "png" : "jpg"}`,
  isOwnedReferencePath: (path: string, userId: string, automationId: string) => path.startsWith(`${userId}/${automationId}/`),
  uploadReferenceImage: uploadMock,
  deleteReferenceImage: deleteMock,
}));

const { uploadShortsReference, addMascotReferences, removeShortsReference, saveShortsCreativeSettings } = await import("./actions");

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

function setup(config: Record<string, unknown> = {}) {
  const updates: unknown[] = [];
  const from = vi.fn((table: string) => {
    const builder: Record<string, unknown> = {};
    builder.select = vi.fn(() => builder);
    builder.eq = vi.fn(() => builder);
    builder.update = vi.fn((payload: unknown) => {
      updates.push(payload);
      return builder;
    });
    builder.maybeSingle = vi.fn().mockResolvedValue(
      table === "automations"
        ? { data: { id: "auto-1", user_id: "user-1", business_id: "biz-1", template_id: "tmpl-1", status: "DRAFT", config }, error: null }
        : { data: { slug: "shorts" }, error: null },
    );
    builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve);
    return builder;
  });
  createClientMock.mockResolvedValue({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }) }, from });
  return { updates };
}

function formWith(bytes: Uint8Array, label = "") {
  const form = new FormData();
  form.set("file", new File([bytes as BlobPart], "a.png", { type: "image/png" }));
  form.set("label", label);
  return form;
}

const savedConfig = (updates: unknown[]) => (updates[0] as { config: Record<string, unknown> }).config;

beforeEach(() => {
  vi.resetAllMocks();
  uploadMock.mockResolvedValue(undefined);
});

describe("uploadShortsReference", () => {
  it("stores a valid image privately and records it in the automation config without dropping other keys", async () => {
    const { updates } = setup({ platforms: ["youtube"] });

    const result = await uploadShortsReference("auto-1", formWith(PNG_BYTES, "  놀란 고양이  "));

    expect(result).toEqual({ success: true });
    expect(uploadMock).toHaveBeenCalledWith(adminMock, expect.stringMatching(/^user-1\/auto-1\/.+\.png$/), expect.any(Uint8Array), "png");
    const config = savedConfig(updates);
    expect(config.platforms).toEqual(["youtube"]);
    expect(config.references).toEqual([expect.objectContaining({ kind: "upload", label: "놀란 고양이" })]);
  });

  it("rejects non-image content even when it is named like an image", async () => {
    setup();
    const result = await uploadShortsReference("auto-1", formWith(new TextEncoder().encode("<svg></svg>")));
    expect(result.error).toContain("PNG 또는 JPG");
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it("rejects an oversized file and a request without a file", async () => {
    setup();
    const big = new Uint8Array(3 * 1024 * 1024 + 1);
    big.set(PNG_BYTES);
    expect((await uploadShortsReference("auto-1", formWith(big))).error).toContain("3MB");
    expect((await uploadShortsReference("auto-1", new FormData())).error).toContain("이미지 파일");
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it("stops at the maximum number of references", async () => {
    const references = Array.from({ length: 8 }, (_, index) => ({ id: `r${index}`, kind: "upload", source: `user-1/auto-1/r${index}.png`, label: "" }));
    setup({ references });
    const result = await uploadShortsReference("auto-1", formWith(PNG_BYTES));
    expect(result.error).toContain("최대 8장");
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it("removes the stored file when saving the config fails", async () => {
    const { updates } = setup();
    createClientMock.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }) },
      from: vi.fn((table: string) => {
        const builder: Record<string, unknown> = {};
        builder.select = vi.fn(() => builder);
        builder.eq = vi.fn(() => builder);
        builder.update = vi.fn(() => builder);
        builder.maybeSingle = vi.fn().mockResolvedValue(
          table === "automations"
            ? { data: { id: "auto-1", user_id: "user-1", business_id: "biz-1", template_id: "t", status: "DRAFT", config: {} }, error: null }
            : { data: { slug: "shorts" }, error: null },
        );
        builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ error: { message: "db down" } }).then(resolve);
        return builder;
      }),
    });

    const result = await uploadShortsReference("auto-1", formWith(PNG_BYTES));

    expect(result.error).toBeTruthy();
    expect(deleteMock).toHaveBeenCalledWith(adminMock, expect.stringMatching(/^user-1\/auto-1\//));
    expect(updates).toHaveLength(0);
  });

  it("does nothing for an automation the user does not own", async () => {
    createClientMock.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }) },
      from: vi.fn(() => {
        const builder: Record<string, unknown> = {};
        builder.select = vi.fn(() => builder);
        builder.eq = vi.fn(() => builder);
        builder.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
        return builder;
      }),
    });
    const result = await uploadShortsReference("someone-elses", formWith(PNG_BYTES));
    expect(result.error).toBeTruthy();
    expect(uploadMock).not.toHaveBeenCalled();
  });
});

describe("mascot, removal and creative settings", () => {
  it("adds every mascot pose (up to the limit) and seeds a promo brief only when none exists", async () => {
    const { updates } = setup();
    expect(await addMascotReferences("auto-1")).toEqual({ success: true });
    const config = savedConfig(updates);
    expect((config.references as unknown[]).length).toBe(8);
    expect(String(config.shortsBrief)).toContain("이지 마케팅");

    const second = setup({ shortsBrief: "내 요청", references: [{ id: "mascot-wave", kind: "mascot", source: "wave", label: "인사" }] });
    await addMascotReferences("auto-1");
    const next = savedConfig(second.updates);
    expect((next.references as Array<{ source: string }>).filter((item) => item.source === "wave")).toHaveLength(1);
    expect(next.shortsBrief).toBe("내 요청"); // an existing brief is never overwritten by the default
  });

  it("deletes the stored file only for uploaded references", async () => {
    const { updates } = setup({ references: [
      { id: "u1", kind: "upload", source: "user-1/auto-1/u1.png", label: "" },
      { id: "mascot-wave", kind: "mascot", source: "wave", label: "인사" },
    ] });
    await removeShortsReference("auto-1", "u1");
    expect(deleteMock).toHaveBeenCalledWith(adminMock, "user-1/auto-1/u1.png");
    expect((savedConfig(updates).references as unknown[])).toHaveLength(1);

    deleteMock.mockClear();
    setup({ references: [{ id: "mascot-wave", kind: "mascot", source: "wave", label: "" }] });
    await removeShortsReference("auto-1", "mascot-wave");
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("validates style and brief length", async () => {
    const { updates } = setup();
    expect((await saveShortsCreativeSettings("auto-1", { style: "horror", brief: "" })).error).toBeTruthy();
    expect((await saveShortsCreativeSettings("auto-1", { style: "skit", brief: "가".repeat(301) })).error).toContain("300자");
    expect(await saveShortsCreativeSettings("auto-1", { style: "explainer", brief: "  신메뉴  " })).toEqual({ success: true });
    expect(savedConfig(updates)).toMatchObject({ shortsStyle: "explainer", shortsBrief: "신메뉴" });
  });
});
