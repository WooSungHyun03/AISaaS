import { type NextRequest } from "next/server";
import { serveShortsVideo } from "@/server/shorts/library-route";

/** Plays a library video: checks the owner, signs a fresh address and sends the player there (so an old page never holds an expired link). */
export async function GET(_request: NextRequest, context: RouteContext<"/shorts/[contentId]/video">) {
  return serveShortsVideo((await context.params).contentId, "play");
}
