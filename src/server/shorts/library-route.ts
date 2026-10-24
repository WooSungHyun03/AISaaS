import "server-only";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { downloadFileName, getShortsContent, ownsVideoPath, signStoredVideo } from "@/server/shorts/library";

const NO_STORE = { "Cache-Control": "private, no-store" };

function plain(status: number, message: string): Response {
  return new Response(message, { status, headers: { ...NO_STORE, "Content-Type": "text/plain; charset=utf-8" } });
}

/**
 * The shared body of the library's video routes. The owner is checked under RLS first (a stranger's id and a wrong id
 * both answer 404), a stored file is signed again on every request, and the answer is a redirect, so the browser streams
 * the MP4 straight from Storage with range requests: nothing is proxied through the server.
 */
export async function serveShortsVideo(contentId: string, mode: "play" | "download"): Promise<Response> {
  const user = await getAuthUser();
  if (!user) return plain(401, "로그인이 필요합니다.");
  const content = await getShortsContent(await createClient(), contentId);
  if (!content) return plain(404, "영상을 찾을 수 없어요.");

  const { source } = content;
  if (source.state === "STORED" && source.path) {
    if (!ownsVideoPath(source.path, user.id, content.automationId)) return plain(404, "영상을 찾을 수 없어요.");
    const url = await signStoredVideo(source.path, mode === "download" ? { downloadName: downloadFileName(content.title) } : {});
    if (!url) return plain(502, "영상 주소를 만들지 못했어요. 잠시 후 다시 시도해주세요.");
    return new Response(null, { status: 302, headers: { ...NO_STORE, Location: url } });
  }
  // An older video that only ever had a hosted address: send the player there; it may no longer answer.
  if (source.state === "EXTERNAL" && source.externalUrl) return new Response(null, { status: 302, headers: { ...NO_STORE, Location: source.externalUrl } });
  return plain(404, "이 영상 파일은 더 이상 사용할 수 없어요.");
}
