const dateFormatter = new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Seoul" });

export const formatShortsDate = (value: string | null) => (value ? dateFormatter.format(new Date(value)) : "-");

export function formatShortsDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) return "-";
  const rounded = Math.round(seconds);
  return rounded < 60 ? `${rounded}초` : `${Math.floor(rounded / 60)}분 ${rounded % 60}초`;
}

export function formatShortsSize(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes) || bytes <= 0) return "-";
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))}KB` : `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

/** Where a library video is streamed from / downloaded. The routes check the owner and sign a fresh address on every request. */
export const shortsVideoSrc = (contentId: string) => `/shorts/${contentId}/video`;
export const shortsDownloadHref = (contentId: string) => `/shorts/${contentId}/download`;
