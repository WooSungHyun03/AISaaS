import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { MIN_REFERENCE_IMAGE_SIDE, ensureMinimumImageSize, resolveImageUrls } from "./assets";
import type { ShortsAsset } from "@/types/shorts-reference";

const png = (width: number, height: number) => sharp({ create: { width, height, channels: 3, background: "#e8c84a" } }).png().toBuffer().then((buffer) => new Uint8Array(buffer));
const sizeOf = async (bytes: Uint8Array) => {
  const meta = await sharp(bytes).metadata();
  return { width: meta.width, height: meta.height };
};

describe("ensureMinimumImageSize", () => {
  it("enlarges a photo a little under the model's minimum (225x225 was refused twice in production)", async () => {
    const result = await ensureMinimumImageSize(await png(225, 225));
    expect(result.enlarged).toBe(true);
    expect(await sizeOf(result.bytes)).toEqual({ width: 240, height: 240 });
  });

  it("keeps the shape of a non-square photo: the shorter side becomes the minimum", async () => {
    const result = await ensureMinimumImageSize(await png(300, 200));
    expect(result.enlarged).toBe(true);
    expect(await sizeOf(result.bytes)).toEqual({ width: 360, height: 240 });
  });

  it("returns a big enough photo untouched, byte for byte", async () => {
    const original = await png(400, 300);
    const result = await ensureMinimumImageSize(original);
    expect(result).toMatchObject({ enlarged: false, width: 400, height: 300 });
    expect(result.bytes).toBe(original);
    expect((await ensureMinimumImageSize(await png(MIN_REFERENCE_IMAGE_SIDE, MIN_REFERENCE_IMAGE_SIDE))).enlarged).toBe(false);
  });

  it("refuses a photo too small to enlarge, in plain Korean", async () => {
    await expect(ensureMinimumImageSize(await png(40, 40))).rejects.toThrow("사진이 너무 작아요");
  });
});

describe("resolveImageUrls", () => {
  const owner = { userId: "u1", automationId: "a1" };
  const asset = (id: string): ShortsAsset => ({ id, kind: "image", origin: "upload", source: `u1/a1/assets/${id}.png`, label: "" });

  function fakeAdmin(files: Record<string, Uint8Array>) {
    const upload = vi.fn().mockResolvedValue({ error: null });
    const signed: string[] = [];
    const admin = {
      storage: {
        from: () => ({
          download: async (path: string) => ({ data: new Blob([files[path] as BlobPart]), error: null }),
          createSignedUrl: async (path: string) => { signed.push(path); return { data: { signedUrl: `https://signed/${path}` }, error: null }; },
          upload,
        }),
      },
    };
    return { admin: admin as never, upload, signed };
  }

  it("sends a small photo's enlarged copy to the video model and leaves the original alone", async () => {
    const { admin, upload, signed } = fakeAdmin({ "u1/a1/assets/small.png": await png(225, 225), "u1/a1/assets/big.png": await png(800, 600) });
    const urls = await resolveImageUrls(admin, [asset("small"), asset("big")], owner);
    expect(urls).toEqual(["https://signed/u1/a1/assets/small-min240.png", "https://signed/u1/a1/assets/big.png"]);
    expect(upload).toHaveBeenCalledTimes(1);
    const [path, body, options] = upload.mock.calls[0];
    expect(path).toBe("u1/a1/assets/small-min240.png");
    expect(options).toMatchObject({ contentType: "image/png", upsert: true });
    expect(await sizeOf(body as Uint8Array)).toEqual({ width: 240, height: 240 });
    expect(signed).not.toContain("u1/a1/assets/small.png");
  });

  it("refuses a path outside the owner's folder before reading anything", async () => {
    const { admin } = fakeAdmin({});
    await expect(resolveImageUrls(admin, [{ ...asset("x"), source: "someone-else/a1/assets/x.png" }], owner)).rejects.toThrow();
  });
});
