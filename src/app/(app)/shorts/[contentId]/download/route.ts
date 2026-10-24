import { type NextRequest } from "next/server";
import { serveShortsVideo } from "@/server/shorts/library-route";

/** Downloads a library video as an MP4 file. Viewing or downloading never touches the owner's credits. */
export async function GET(_request: NextRequest, context: RouteContext<"/shorts/[contentId]/download">) {
  return serveShortsVideo((await context.params).contentId, "download");
}
