/**
 * Shrinks an image in the browser before it is uploaded, so phone photos and
 * large mascot files stay far below the upload limit. The result is always
 * PNG (when the source has transparency) or JPEG, which are the only formats
 * the video renderer accepts.
 */
// Character images are re-framed to 720x1280 for the animator, so 1024px is plenty.
const EDGES = [1024, 768, 512];
const TARGET_BYTES = 2.6 * 1024 * 1024;

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

export async function downsizeImage(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file);
  const keepsAlpha = /^image\/(png|webp|gif|avif)$/.test(file.type);
  try {
    for (const edge of EDGES) {
      const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d");
      if (!context) break;
      if (!keepsAlpha) {
        context.fillStyle = "#FFFFFF";
        context.fillRect(0, 0, canvas.width, canvas.height);
      }
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = keepsAlpha ? await toBlob(canvas, "image/png") : await toBlob(canvas, "image/jpeg", 0.88);
      if (blob && blob.size <= TARGET_BYTES) {
        const extension = keepsAlpha ? "png" : "jpg";
        return new File([blob], `reference.${extension}`, { type: blob.type });
      }
    }
  } finally {
    bitmap.close();
  }
  throw new Error("이미지를 줄이지 못했어요. 더 작은 이미지를 사용해주세요.");
}
