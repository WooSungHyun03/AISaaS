import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { FRAME_HEIGHT, FRAME_WIDTH, prepareCharacterFrame } from "./character-frame";

const mascot = () => readFile(path.join(process.cwd(), "public/shorts-mascot/wave.png"));

describe("prepareCharacterFrame", () => {
  it("puts a transparent mascot on an opaque 9:16 gradient with the character in the lower area", async () => {
    const frame = await prepareCharacterFrame(await mascot(), 0);
    const meta = await sharp(frame).metadata();
    expect(meta.width).toBe(FRAME_WIDTH);
    expect(meta.height).toBe(FRAME_HEIGHT);
    expect(meta.hasAlpha).toBe(false);

    // Top strip is background only (the bubble zone); the character region differs from it.
    const region = async (area: { left: number; top: number; width: number; height: number }) =>
      sharp(await sharp(frame).extract(area).toBuffer()).stats(); // stats() would otherwise ignore extract()
    const top = await region({ left: 0, top: 0, width: FRAME_WIDTH, height: 200 });
    const body = await region({ left: 100, top: 520, width: 520, height: 500 });
    expect(top.channels[0].stdev).toBeLessThan(15); // smooth gradient only
    expect(body.channels[0].stdev).toBeGreaterThan(40); // the mascot is there
  });

  it("uses a different gradient per scene index", async () => {
    const [a, b] = await Promise.all([prepareCharacterFrame(await mascot(), 0), prepareCharacterFrame(await mascot(), 2)]);
    const pixel = async (buffer: Buffer) => sharp(buffer).extract({ left: 5, top: 5, width: 1, height: 1 }).raw().toBuffer();
    expect([...(await pixel(a))]).not.toEqual([...(await pixel(b))]);
  });

  it("keeps the backdrop colour of an opaque illustration seamless", async () => {
    const opaque = await sharp({ create: { width: 400, height: 300, channels: 3, background: { r: 250, g: 240, b: 200 } } })
      .composite([{ input: await sharp({ create: { width: 100, height: 100, channels: 3, background: { r: 200, g: 30, b: 30 } } }).png().toBuffer(), left: 150, top: 100 }])
      .removeAlpha()
      .png()
      .toBuffer();
    const frame = await prepareCharacterFrame(opaque, 1);
    const corner = await sharp(frame).extract({ left: 2, top: 2, width: 1, height: 1 }).raw().toBuffer();
    expect([...corner]).toEqual([250, 240, 200]);
  });

  it("rejects bytes that are not an image", async () => {
    await expect(prepareCharacterFrame(new TextEncoder().encode("not an image"), 0)).rejects.toThrow();
  });
});
