import "server-only";
import { serverEnv } from "@/lib/env/server";
import { MockPostprocessProvider } from "./mock";
import type { PostprocessProvider } from "./types";
import { WorkerPostprocessProvider } from "./worker";

let cached: PostprocessProvider | undefined;

export function getPostprocessProvider(): PostprocessProvider {
  cached ??= serverEnv.POSTPROCESS_PROVIDER === "worker" ? new WorkerPostprocessProvider() : new MockPostprocessProvider();
  return cached;
}

export * from "./types";
export { MockPostprocessProvider } from "./mock";
