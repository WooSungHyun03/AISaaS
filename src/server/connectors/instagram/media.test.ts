import { describe, expect, it, vi } from "vitest";
import { isConnectorError } from "@/server/shared/errors";

const { ensureMarketingCardImageUrl } = await import("./media");

function makeBucket(overrides: Partial<{ list: ReturnType<typeof vi.fn>; upload: ReturnType<typeof vi.fn>; getPublicUrl: ReturnType<typeof vi.fn> }> = {}) {
  const list = overrides.list ?? vi.fn().mockResolvedValue({ data: [], error: null });
  const upload = overrides.upload ?? vi.fn().mockResolvedValue({ error: null });
  const getPublicUrl = overrides.getPublicUrl ?? vi.fn().mockReturnValue({ data: { publicUrl: "https://storage.example.com/marketing-assets/instagram/marketing-card.png" } });
  return { list, upload, getPublicUrl };
}

function fakeAdmin(bucket: ReturnType<typeof makeBucket>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { storage: { from: vi.fn().mockReturnValue(bucket) } } as any;
}

describe("ensureMarketingCardImageUrl", () => {
  it("uploads the marketing card and returns its public URL when it doesn't already exist", async () => {
    const bucket = makeBucket({ list: vi.fn().mockResolvedValue({ data: [], error: null }) });
    const admin = fakeAdmin(bucket);

    const url = await ensureMarketingCardImageUrl(admin);

    expect(url).toBe("https://storage.example.com/marketing-assets/instagram/marketing-card.png");
    expect(admin.storage.from).toHaveBeenCalledWith("marketing-assets");
    expect(bucket.upload).toHaveBeenCalledTimes(1);
    const [path, buffer, options] = bucket.upload.mock.calls[0];
    expect(path).toBe("instagram/marketing-card.png");
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(0);
    expect(options).toEqual({ contentType: "image/png", upsert: true });
  });

  it("skips the upload when the file already exists in the bucket", async () => {
    const bucket = makeBucket({ list: vi.fn().mockResolvedValue({ data: [{ name: "marketing-card.png" }], error: null }) });
    const admin = fakeAdmin(bucket);

    const url = await ensureMarketingCardImageUrl(admin);

    expect(url).toBe("https://storage.example.com/marketing-assets/instagram/marketing-card.png");
    expect(bucket.upload).not.toHaveBeenCalled();
  });

  it("throws a classified ConnectorError when listing the bucket fails", async () => {
    const bucket = makeBucket({ list: vi.fn().mockResolvedValue({ data: null, error: { message: "bucket not found" } }) });
    const admin = fakeAdmin(bucket);

    const error = await ensureMarketingCardImageUrl(admin).catch((e: unknown) => e);

    expect(isConnectorError(error)).toBe(true);
    expect((error as Error).message).toContain("bucket not found");
    expect(bucket.upload).not.toHaveBeenCalled();
  });

  it("throws a classified ConnectorError when the upload fails", async () => {
    const bucket = makeBucket({ upload: vi.fn().mockResolvedValue({ error: { message: "quota exceeded" } }) });
    const admin = fakeAdmin(bucket);

    const error = await ensureMarketingCardImageUrl(admin).catch((e: unknown) => e);

    expect(isConnectorError(error)).toBe(true);
    expect((error as Error).message).toContain("quota exceeded");
  });

  it("throws a classified ConnectorError when no public URL comes back", async () => {
    const bucket = makeBucket({ getPublicUrl: vi.fn().mockReturnValue({ data: { publicUrl: "" } }) });
    const admin = fakeAdmin(bucket);

    const error = await ensureMarketingCardImageUrl(admin).catch((e: unknown) => e);

    expect(isConnectorError(error)).toBe(true);
  });
});
