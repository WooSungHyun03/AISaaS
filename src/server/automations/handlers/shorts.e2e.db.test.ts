import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * The ad Shorts pipeline end to end, with everything real except the paid video model: the real FFmpeg worker (a real
 * ffmpeg process), real local Supabase Storage (buckets, signed upload and download URLs), and the real spend ledger.
 * Wan is replaced by a fake that "generates" a test clip served from a local file server.
 * Needs `bash scripts/dev-db.sh` and ffmpeg; skipped otherwise (RUN_DB_TESTS=1 to run).
 */
const env = vi.hoisted(() => {
  if (!process.env.RUN_DB_TESTS) return null;
  try {
    // vi.hoisted runs before the imports below exist, so the built-in modules are fetched directly.
    const fsx = process.getBuiltinModule("node:fs");
    const pathx = process.getBuiltinModule("node:path");
    const text = fsx.readFileSync(pathx.join(process.cwd(), ".env.local.supabase"), "utf8");
    const values = Object.fromEntries(text.split(/\r?\n/).map((line) => /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())).filter((m): m is RegExpExecArray => Boolean(m)).map((m) => [m[1], m[2].replace(/^['"]|['"]$/g, "")]));
    Object.assign(process.env, {
      NEXT_PUBLIC_SUPABASE_URL: values.NEXT_PUBLIC_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: values.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      SUPABASE_SERVICE_ROLE_KEY: values.SUPABASE_SERVICE_ROLE_KEY,
      AD_VIDEO_PROVIDER: "fal",
      FAL_KEY: "test-key",
      ALLOW_PAID_AI_CALLS: "true",
      BUDGET_PERIOD_START: "2026-01-01",
      BUDGET_PERIOD_END: "2030-01-01",
    });
    return values;
  } catch {
    return null;
  }
});

const hasFfmpeg = (() => {
  try { execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); return true; } catch { return false; }
})();
const FONT = ["/usr/share/fonts/truetype/nanum/NanumSquareRoundB.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"].find((file) => fs.existsSync(file));

const fake = vi.hoisted(() => ({ videoUrl: "", submitted: [] as unknown[], voice: new Uint8Array() }));
vi.mock("@/server/connectors/wan", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/connectors/wan")>()),
  getWanProvider: () => ({
    name: "fal",
    submit: async (request: unknown) => {
      fake.submitted.push(request);
      return { requestId: "e2e", statusUrl: "https://queue.fal.run/e2e/status", responseUrl: "https://queue.fal.run/e2e" };
    },
    status: async () => ({ state: "done", videoUrl: fake.videoUrl, durationSec: 25, width: 720, height: 1280, seed: 1, actualPrompt: "No text or subtitles. Keep the product exactly the same. Do not invent screens. No flicker." }),
  }),
}));
vi.mock("@/server/ai/generate", () => ({
  generateStructured: async (request: { schema: { parse(value: unknown): unknown }; prompt: string; system?: string }) => {
    const { MockAIProvider } = await import("@/server/ai/providers/mock");
    const { text } = await new MockAIProvider().generateText({ prompt: request.prompt, system: request.system });
    return request.schema.parse(JSON.parse(text));
  },
}));
vi.mock("@/server/connectors/tts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/connectors/tts")>()),
  getTtsProvider: () => ({ name: "elevenlabs", synthesize: async (text: string) => ({ audio: fake.voice, characters: text.length }) }),
}));
const postprocess = vi.hoisted(() => ({ provider: null as unknown }));
vi.mock("@/server/connectors/postprocess", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/connectors/postprocess")>()),
  getPostprocessProvider: () => postprocess.provider,
}));

const suite = env && hasFfmpeg && FONT ? describe : describe.skip;

suite("ad Shorts pipeline (real worker, real Storage, real ledger)", () => {
  const userId = randomUUID();
  const automationId = randomUUID();
  const runId = randomUUID();
  const silentRunId = randomUUID();
  let tmp = "";
  let silentUrl = "";
  let fileServer: http.Server;
  let workerServer: http.Server;
  let admin: ReturnType<typeof import("@/lib/supabase/admin").createAdminClient>;

  beforeAll(async () => {
    const [{ createAdminClient }, { createServer }, { loadConfig }, { WorkerPostprocessProvider }, { ensureShortsBuckets }] = await Promise.all([
      import("@/lib/supabase/admin"),
      import("../../../../worker/ffmpeg/src/server.mjs"),
      import("../../../../worker/ffmpeg/src/config.mjs"),
      import("@/server/connectors/postprocess/worker"),
      import("@/server/shorts/assets"),
    ]);
    admin = createAdminClient();
    await ensureShortsBuckets(admin);

    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "shorts-e2e-"));
    const ff = (...args: string[]) => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args]);
    // The "generated" 25 s clip, with a tone, and two small product photos.
    ff("-f", "lavfi", "-i", "testsrc2=size=720x1280:rate=30:duration=25", "-f", "lavfi", "-i", "sine=frequency=330:duration=25", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", path.join(tmp, "generated.mp4"));
    ff("-f", "lavfi", "-i", "color=c=orange:size=400x400", "-frames:v", "1", path.join(tmp, "photo.png"));
    // A clip with no sound at all, and a "Korean voice" track.
    ff("-f", "lavfi", "-i", "testsrc2=size=720x1280:rate=30:duration=25", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", path.join(tmp, "silent.mp4"));
    ff("-f", "lavfi", "-i", "sine=frequency=200:duration=20", "-c:a", "libmp3lame", path.join(tmp, "voice.mp3"));
    fake.voice = new Uint8Array(fs.readFileSync(path.join(tmp, "voice.mp3")));
    fileServer = http.createServer((request, response) => {
      const file = path.join(tmp, path.basename(request.url ?? ""));
      if (!fs.existsSync(file)) return response.writeHead(404).end();
      response.writeHead(200, { "content-length": fs.statSync(file).size });
      fs.createReadStream(file).pipe(response);
    });
    await new Promise<void>((resolve) => fileServer.listen(0, "127.0.0.1", resolve));
    fake.videoUrl = `http://127.0.0.1:${(fileServer.address() as { port: number }).port}/generated.mp4`;
    silentUrl = `http://127.0.0.1:${(fileServer.address() as { port: number }).port}/silent.mp4`;

    const token = "e2e-token-0123456789";
    const config = loadConfig({ WORKER_TOKEN: token, WORKER_ALLOWED_HOSTS: "127.0.0.1", WORKER_ALLOW_LOCAL: "1", WORKER_TMP_DIR: path.join(tmp, "work"), WORKER_FONT_FILE: FONT } as unknown as NodeJS.ProcessEnv);
    workerServer = createServer(config).server as http.Server;
    await new Promise<void>((resolve) => workerServer.listen(0, "127.0.0.1", resolve));
    postprocess.provider = new WorkerPostprocessProvider({ baseUrl: `http://127.0.0.1:${(workerServer.address() as { port: number }).port}`, token });

    for (const name of ["a", "b"]) {
      const { error } = await admin.storage.from("shorts-references").upload(`${userId}/${automationId}/assets/${name}.png`, fs.readFileSync(path.join(tmp, "photo.png")), { contentType: "image/png", upsert: true });
      if (error) throw error;
    }
  });

  afterAll(async () => {
    await new Promise((resolve) => workerServer?.close(resolve));
    await new Promise((resolve) => fileServer?.close(resolve));
    for (const id of [runId, silentRunId]) {
      await admin.from("budget_spend").delete().eq("run_id", id);
      await admin.from("budget_items").delete().eq("run_id", id);
      const paths = (await admin.storage.from("shorts-videos").list(`${userId}/${automationId}/${id}`)).data?.map((entry) => `${userId}/${automationId}/${id}/${entry.name}`) ?? [];
      if (paths.length) await admin.storage.from("shorts-videos").remove(paths);
    }
    await admin.storage.from("shorts-references").remove(["a", "b"].map((name) => `${userId}/${automationId}/assets/${name}.png`));
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const business = { id: "biz", name: "우리동네 빵집", industry: "베이커리", description: null, location: "서울", brand_tone: null, keywords: ["소금빵"], promotion_type: "STORE", promotion_details: {}, main_offering: "소금빵", website: null } as never;
  const contextFor = (id: string, extra: Record<string, unknown> = {}) => ({
    automation: { id: automationId, user_id: userId, business_id: "biz" } as never,
    business,
    config: { assets: ["a", "b"].map((name) => ({ id: name, kind: "image", origin: "upload", source: `${userId}/${automationId}/assets/${name}.png`, label: "소금빵", role: "product", summary: "주황색 소금빵" })), durationSec: 25, voiceMode: "native", ...extra },
    recentTopics: [],
    runId: id,
    shorts: { previewOnly: true },
    checkpoint: async () => undefined,
  });
  const probeOf = async (videoPath: string) => {
    const signed = await admin.storage.from("shorts-videos").createSignedUrl(videoPath, 60);
    const file = path.join(tmp, `${randomUUID()}.mp4`);
    fs.writeFileSync(file, new Uint8Array(await (await fetch(signed.data!.signedUrl)).arrayBuffer()));
    return JSON.parse(execFileSync("ffprobe", ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", file]).toString());
  };
  const driveRun = async (id: string, extra: Record<string, unknown> = {}) => {
    const [{ shortsAutomationHandler: handler }, { claimBudgetItem, withBudgetScope }] = await Promise.all([import("./shorts"), import("@/server/budget")]);
    const ctx = contextFor(id, extra);
    await claimBudgetItem("VIDEO", id);
    const result = await withBudgetScope({ kind: "VIDEO", runId: id, attempt: 1 }, async () => {
      let outcome = await handler.run(ctx);
      // Like the page polling every few seconds: the worker's jobs take a moment.
      for (let step = 0; step < 200; step++) {
        if (!("deferred" in outcome)) return outcome;
        outcome = await handler.resume!(ctx, outcome.deferred.state as never);
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      throw new Error(`did not finish: ${JSON.stringify(outcome)}`.slice(0, 400));
    });
    if (!("output" in result)) throw new Error("no result");
    return result.output as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  };

  it("adds a Korean voice, paid from the video budget, when the generated clip has no sound", async () => {
    const { summarizeRunSpend, settleOpenReservations } = await import("@/server/budget");
    const original = fake.videoUrl;
    fake.videoUrl = silentUrl;
    try {
      const output = await driveRun(silentRunId);
      expect(output).toMatchObject({ voiceFallback: true, qa: { status: "NEEDS_HUMAN_CHECK" } });
      const probe = await probeOf(output.videoPath);
      expect(probe.streams.map((stream: { codec_type: string }) => stream.codec_type).sort()).toEqual(["audio", "video"]);
      const spend = await summarizeRunSpend(silentRunId);
      expect(spend.steps.map((step) => step.step)).toEqual(expect.arrayContaining(["video.generate", "video.tts"]));
      expect(spend.steps.find((step) => step.step === "video.tts")?.state).toBe("SETTLED");
      expect(await settleOpenReservations(silentRunId)).toBe(0);
    } finally {
      fake.videoUrl = original;
    }
  }, 120_000);

  it("makes a finished 9:16 MP4 with the worker, stores it privately, books the generation in the real ledger and leaves nothing open", async () => {
    const { closeRunItem, settleOpenReservations, summarizeRunSpend } = await import("@/server/budget");
    const output = await driveRun(runId);

    // The video was requested the way the plan says: 720p, 25 s, both photos.
    expect(fake.submitted[0]).toMatchObject({ durationSec: 25, resolution: "720p" });
    expect(output).toMatchObject({ format: "ad", videoPath: `${userId}/${automationId}/${runId}/final.mp4`, qa: { status: "NEEDS_HUMAN_CHECK", aiChecked: true } });

    // The finished file is in private Storage and is what the worker made: 720x1280 H.264 + AAC, about 25 s.
    const probe = await probeOf(output.videoPath);
    const video = probe.streams.find((stream: { codec_type: string }) => stream.codec_type === "video");
    const audio = probe.streams.find((stream: { codec_type: string }) => stream.codec_type === "audio");
    expect(video).toMatchObject({ codec_name: "h264", width: 720, height: 1280 });
    expect(audio).toMatchObject({ codec_name: "aac" });
    expect(Number(probe.format.duration)).toBeGreaterThan(24);
    expect(Number(probe.format.duration)).toBeLessThan(26);
    // A private bucket: the bare object address is not readable without the signature.
    const anonymous = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/shorts-videos/${output.videoPath}`);
    expect(anonymous.status).not.toBe(200);

    // The ledger: one generation, reserved at 720p x 25 s x 1.5 and settled to the same, nothing left open.
    const spend = await summarizeRunSpend(runId);
    const generation = spend.steps.find((step) => step.step === "video.generate");
    expect(generation).toMatchObject({ state: "SETTLED", usd: 3.75 });
    expect(await settleOpenReservations(runId)).toBe(0);
    await closeRunItem(runId, "COMPLETED");
    const { data: item } = await admin.from("budget_items").select("state").eq("run_id", runId).single();
    expect(item?.state).toBe("COMPLETED");
  }, 120_000);
});
