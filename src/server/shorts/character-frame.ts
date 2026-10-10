import "server-only";
import sharp from "sharp";

/**
 * Builds the 9:16 still an image-to-video model animates. Video models cannot
 * take transparency, and a cropped or off-centre character makes the clip
 * drift, so each reference is placed on a clean background with room above
 * it for the speech bubble that is drawn over the clip later.
 *
 * - Transparent images (mascots, stickers) go on a brand gradient.
 * - Opaque images (illustrations, photos of a character) sit on a flat
 *   colour taken from their own corner, so a plain backdrop stays seamless.
 */
export const FRAME_WIDTH = 720;
export const FRAME_HEIGHT = 1280;

/** Gradient pairs (top, bottom); they follow the scene backgrounds of the video layout. */
const GRADIENTS: Array<[string, string]> = [
  ["#2563EB", "#1E3A8A"],
  ["#4F46E5", "#312E81"],
  ["#0D9488", "#0F766E"],
  ["#C2410C", "#7C2D12"],
  ["#7C3AED", "#4C1D95"],
  ["#0891B2", "#164E63"],
];

function gradientSvg(index: number): Buffer {
  const [top, bottom] = GRADIENTS[index % GRADIENTS.length];
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${FRAME_WIDTH}" height="${FRAME_HEIGHT}"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`,
  );
}

/** The character area: below the bubble zone (top third), centred horizontally. */
const BOX = { width: Math.round(FRAME_WIDTH * 0.86), height: Math.round(FRAME_HEIGHT * 0.56), top: Math.round(FRAME_HEIGHT * 0.36) };

export async function prepareCharacterFrame(source: Uint8Array, sceneIndex: number): Promise<Buffer> {
  const image = sharp(source, { failOn: "error" }).rotate();
  const meta = await image.metadata();
  const fitted = await image
    .resize({ width: BOX.width, height: BOX.height, fit: "inside", withoutEnlargement: false })
    .png()
    .toBuffer({ resolveWithObject: true });
  const left = Math.round((FRAME_WIDTH - fitted.info.width) / 2);
  const top = BOX.top + Math.round((BOX.height - fitted.info.height) / 2);

  if (meta.hasAlpha) {
    return sharp(gradientSvg(sceneIndex)).composite([{ input: fitted.data, left, top }]).removeAlpha().png().toBuffer();
  }

  // Opaque: sample the top-left pixel as the backdrop colour.
  const corner = await sharp(source).rotate().extract({ left: 0, top: 0, width: 1, height: 1 }).raw().toBuffer();
  const [r, g, b] = [corner[0] ?? 255, corner[1] ?? 255, corner[2] ?? 255];
  return sharp({ create: { width: FRAME_WIDTH, height: FRAME_HEIGHT, channels: 3, background: { r, g, b } } })
    .composite([{ input: fitted.data, left, top }])
    .removeAlpha()
    .png()
    .toBuffer();
}
