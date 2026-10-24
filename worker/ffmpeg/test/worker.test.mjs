import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.mjs";
import { buildComposeArgs, probeFile } from "../src/ffmpeg.mjs";
import { validateJob } from "../src/jobs.mjs";
import { hostAllowed, isPrivateAddress, resolveSafeUrl, tokenMatches } from "../src/security.mjs";
import { createServer } from "../src/server.mjs";

const hasFfmpeg = (() => {
  try { execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); return true; } catch { return false; }
})();
const hasRsvg = (() => {
  try { execFileSync("rsvg-convert", ["--version"], { stdio: "ignore" }); return true; } catch { return false; }
})();
const FONT = ["/usr/share/fonts/truetype/nanum/NanumSquareRoundB.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"].find((file) => fs.existsSync(file));
const TOKEN = "test-token-0123456789";

function baseConfig(tmpRoot) {
  return loadConfig({ WORKER_TOKEN: TOKEN, WORKER_ALLOWED_HOSTS: "files.example.com,.supabase.co", WORKER_ALLOW_LOCAL: "1", WORKER_TMP_DIR: tmpRoot, WORKER_FONT_FILE: FONT ?? "", WORKER_CONCURRENCY: "2" });
}

describe("worker security", () => {
  const config = loadConfig({ WORKER_TOKEN: TOKEN, WORKER_ALLOWED_HOSTS: "files.example.com,.supabase.co" });

  it("refuses to start without a strong token or an allowlist", () => {
    expect(() => loadConfig({ WORKER_ALLOWED_HOSTS: "a.com" })).toThrow("WORKER_TOKEN");
    expect(() => loadConfig({ WORKER_TOKEN: "short", WORKER_ALLOWED_HOSTS: "a.com" })).toThrow("WORKER_TOKEN");
    expect(() => loadConfig({ WORKER_TOKEN: TOKEN })).toThrow("WORKER_ALLOWED_HOSTS");
  });

  it("recognises private, loopback, link-local and mapped addresses", () => {
    for (const address of ["127.0.0.1", "10.1.2.3", "172.16.0.5", "172.31.255.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1"]) {
      expect(isPrivateAddress(address), address).toBe(true);
    }
    for (const address of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "2606:4700:4700::1111"]) expect(isPrivateAddress(address), address).toBe(false);
  });

  it("matches hosts exactly or by subdomain suffix", () => {
    expect(hostAllowed("files.example.com", config)).toBe(true);
    expect(hostAllowed("evil.files.example.com", config)).toBe(false);
    expect(hostAllowed("abc.supabase.co", config)).toBe(true);
    expect(hostAllowed("supabase.co", config)).toBe(false);
    expect(hostAllowed("abc.supabase.co.evil.com", config)).toBe(false);
  });

  it("compares tokens in constant time and accepts only the exact one", () => {
    expect(tokenMatches(`Bearer ${TOKEN}`, TOKEN)).toBe(true);
    expect(tokenMatches(TOKEN, TOKEN)).toBe(true);
    expect(tokenMatches("Bearer wrong-token-0123456789", TOKEN)).toBe(false);
    expect(tokenMatches(undefined, TOKEN)).toBe(false);
  });

  it("rejects urls that could reach internal services", async () => {
    await expect(resolveSafeUrl("http://files.example.com/a.mp4", config)).rejects.toThrow("https");
    await expect(resolveSafeUrl("https://user:pw@files.example.com/a.mp4", config)).rejects.toThrow("credentials");
    await expect(resolveSafeUrl("https://169.254.169.254/latest/meta-data", config)).rejects.toThrow("not allowed");
    await expect(resolveSafeUrl("https://internal.local/x", config)).rejects.toThrow("not allowed");
    await expect(resolveSafeUrl("not a url", config)).rejects.toThrow("invalid");
    await expect(resolveSafeUrl("http://127.0.0.1:9/x", config)).rejects.toThrow("https");
  });
});

describe("job validation", () => {
  it("keeps only known fields and clamps the rest", () => {
    const job = validateJob({
      type: "compose",
      videoUrl: "https://files.example.com/v.mp4",
      voiceUrl: "https://files.example.com/v.mp3",
      audio: { mode: "mix", $evil: "x" },
      overlays: [
        { kind: "text", text: "  지금 예약하세요\u0000  ", position: "nowhere", fontSizePx: 40 },
        { kind: "image", url: "https://files.example.com/logo.png", position: "top-right", widthPct: 0.2 },
        { kind: "script", code: "rm -rf /" },
      ],
      output: { uploadUrl: "https://files.example.com/up", contentType: "text/html" },
    });
    expect(job.overlays).toHaveLength(2);
    expect(job.overlays[0]).toMatchObject({ kind: "text", text: "지금 예약하세요", position: "bottom" });
    expect(job.output.contentType).toBe("video/mp4");
    expect(JSON.stringify(job)).not.toContain("rm -rf");
  });

  it("rejects unknown types and missing inputs", () => {
    expect(() => validateJob({ type: "shell" })).toThrow("unknown job type");
    expect(() => validateJob({ type: "analyze" })).toThrow("videoUrl");
    expect(() => validateJob({ type: "compose", videoUrl: "https://a.b/v.mp4", audio: { mode: "mix" }, output: { uploadUrl: "https://a.b/u" } })).toThrow("voiceUrl");
  });
});

describe("compose command", () => {
  const probe = { durationSec: 25, hasAudio: true };
  const files = { video: "/w/video.mp4", voice: "/w/voice.bin", images: ["/w/logo.png"], texts: ["/w/text-0.txt"], output: "/w/final.mp4" };
  const spec = {
    target: { width: 720, height: 1280, fps: 30 },
    audio: { mode: "mix" },
    overlays: [
      { kind: "image", position: "top-right", widthPct: 0.2 },
      { kind: "text", position: "bottom", startSec: 21, endSec: 25, fontSizePx: 44 },
    ],
  };

  it("builds a 720x1280 H.264/AAC output with overlays, ducking and loudness normalisation", () => {
    const args = buildComposeArgs(spec, files, probe, "/font.ttf");
    const graph = args[args.indexOf("-filter_complex") + 1];
    expect(graph).toContain("scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280");
    expect(graph).toContain("overlay=main_w-overlay_w-main_w*0.04:main_h*0.04");
    expect(graph).toContain("textfile='/w/text-0.txt'");
    expect(graph).toContain("enable='between(t,21.00,25.00)'");
    expect(graph).toContain("sidechaincompress");
    expect(graph).toContain("amix=inputs=2:duration=first:normalize=0");
    expect(graph).toContain("loudnorm=I=-14");
    expect(graph).toContain("aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo");
    expect(args).toEqual(expect.arrayContaining(["-c:v", "libx264", "-c:a", "aac", "+faststart"]));
    expect(args.at(-1)).toBe("/w/final.mp4");
  });

  it("never puts the overlay text into the filter graph", () => {
    const args = buildComposeArgs(spec, files, probe, "/font.ttf");
    expect(args.join(" ")).not.toContain("지금");
  });

  it("makes silence for a video without sound and supports voice-only mode", () => {
    const silent = buildComposeArgs({ ...spec, audio: { mode: "native" } }, { video: files.video, texts: [], images: [], output: files.output }, { durationSec: 20, hasAudio: false }, "/f.ttf");
    expect(silent[silent.indexOf("-filter_complex") + 1]).toContain("anullsrc");
    const voiceOnly = buildComposeArgs({ ...spec, overlays: [], audio: { mode: "voice_only" } }, { video: files.video, voice: files.voice, texts: [], images: [], output: files.output }, probe, "/f.ttf");
    expect(voiceOnly[voiceOnly.indexOf("-filter_complex") + 1]).toContain("[1:a]volume=0dB,apad");
  });
});

const suite = hasFfmpeg && FONT ? describe : describe.skip;

suite("worker end to end (real ffmpeg)", () => {
  let tmp;
  let work;
  let files;
  let origin;
  let workerUrl;
  let fileServer;
  let workerServer;
  const uploads = [];
  const headers = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };

  const ff = (...args) => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args]);

  beforeAll(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "worker-test-"));
    files = path.join(tmp, "files");
    work = path.join(tmp, "work");
    fs.mkdirSync(files);
    // 6 s test clip with a tone, a 6 s silent clip whose last 3 s are black, a "voice" track and a logo.
    ff("-f", "lavfi", "-i", "testsrc=size=1280x720:rate=30:duration=6", "-f", "lavfi", "-i", "sine=frequency=440:duration=6", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", path.join(files, "tone.mp4"));
    ff("-f", "lavfi", "-i", "testsrc=size=720x1280:rate=30:duration=3", "-f", "lavfi", "-i", "color=c=black:size=720x1280:rate=30:duration=3", "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0[v]", "-map", "[v]", "-c:v", "libx264", "-pix_fmt", "yuv420p", path.join(files, "silent-black.mp4"));
    ff("-f", "lavfi", "-i", "sine=frequency=220:duration=4", "-c:a", "libmp3lame", path.join(files, "voice.mp3"));
    ff("-f", "lavfi", "-i", "color=c=red:size=200x100:duration=1", "-frames:v", "1", path.join(files, "logo.png"));
    fs.writeFileSync(path.join(files, "logo.svg"), '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"><rect width="100" height="50" fill="blue"/></svg>');

    fileServer = http.createServer((request, response) => {
      if (request.method === "PUT") {
        const chunks = [];
        request.on("data", (chunk) => chunks.push(chunk));
        request.on("end", () => { uploads.push({ url: request.url, body: Buffer.concat(chunks), type: request.headers["content-type"] }); response.writeHead(200).end(); });
        return;
      }
      const file = path.join(files, path.basename(request.url ?? ""));
      if (!fs.existsSync(file)) return response.writeHead(404).end();
      response.writeHead(200, { "content-length": fs.statSync(file).size });
      fs.createReadStream(file).pipe(response);
    });
    await new Promise((resolve) => fileServer.listen(0, "127.0.0.1", resolve));
    origin = `http://127.0.0.1:${fileServer.address().port}`;

    const created = createServer(baseConfig(work));
    workerServer = created.server;
    await new Promise((resolve) => workerServer.listen(0, "127.0.0.1", resolve));
    workerUrl = `http://127.0.0.1:${workerServer.address().port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => workerServer.close(resolve));
    await new Promise((resolve) => fileServer.close(resolve));
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const call = async (method, route, body, extra = {}) => {
    const response = await fetch(`${workerUrl}${route}`, { method, headers: extra.noAuth ? { "content-type": "application/json" } : headers, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, body: await response.json() };
  };
  const finish = async (jobId) => {
    for (let attempt = 0; attempt < 200; attempt++) {
      const { body } = await call("GET", `/v1/jobs/${jobId}`);
      if (body.state === "done" || body.state === "failed") return body;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("job did not finish");
  };

  it("answers health checks without a token but nothing else", async () => {
    expect((await call("GET", "/healthz", undefined, { noAuth: true })).status).toBe(200);
    expect((await call("POST", "/v1/probe", { url: `${origin}/tone.mp4` }, { noAuth: true })).status).toBe(401);
    expect((await call("POST", "/v1/jobs", { type: "analyze", videoUrl: `${origin}/tone.mp4` }, { noAuth: true })).status).toBe(401);
  });

  it("probes media facts for pricing and validation", async () => {
    const video = await call("POST", "/v1/probe", { url: `${origin}/tone.mp4` });
    expect(video.body).toMatchObject({ hasVideo: true, hasAudio: true, width: 1280, height: 720, fps: 30 });
    expect(video.body.durationSec).toBeGreaterThan(5.5);
    const audio = await call("POST", "/v1/probe", { url: `${origin}/voice.mp3` });
    expect(audio.body).toMatchObject({ hasVideo: false, hasAudio: true });
    expect(audio.body.durationSec).toBeGreaterThan(3.5);
  });

  it("measures black stretches, silence and missing audio, and returns frames", async () => {
    const { status, body } = await call("POST", "/v1/jobs", { type: "analyze", videoUrl: `${origin}/silent-black.mp4`, frames: 4 });
    expect(status).toBe(202);
    const done = await finish(body.jobId);
    expect(done.state).toBe("done");
    expect(done.result.probe).toMatchObject({ hasAudio: false, width: 720, height: 1280 });
    expect(done.result.black.seconds).toBeGreaterThan(2);
    expect(done.result.audio).toBeNull();
    expect(done.result.frames).toHaveLength(4);
    expect(Buffer.from(done.result.frames[0].base64, "base64").subarray(0, 2).toString("hex")).toBe("ffd8");

    const tone = await finish((await call("POST", "/v1/jobs", { type: "analyze", videoUrl: `${origin}/tone.mp4`, frames: 0 })).body.jobId);
    expect(tone.result.audio.silentRatio).toBe(0);
    expect(tone.result.black.seconds).toBe(0);
  });

  it("composes overlays, a mixed voice and loudness-normalised audio into a valid 9:16 MP4 and uploads it", async () => {
    const { body } = await call("POST", "/v1/jobs", {
      type: "compose",
      videoUrl: `${origin}/tone.mp4`,
      voiceUrl: `${origin}/voice.mp3`,
      audio: { mode: "mix" },
      target: { width: 720, height: 1280, fps: 30 },
      overlays: [
        { kind: "image", url: `${origin}/logo.png`, position: "top-right", widthPct: 0.2 },
        // An SVG logo is converted with rsvg-convert, which the Docker image has (it may be missing on a dev machine).
        ...(hasRsvg ? [{ kind: "image", url: `${origin}/logo.svg`, position: "bottom-left", widthPct: 0.2, startSec: 1, endSec: 3 }] : []),
        { kind: "text", text: "지금 예약하세요", position: "bottom", startSec: 3, endSec: 6, fontSizePx: 48 },
      ],
      output: { uploadUrl: `${origin}/upload/final.mp4` },
    });
    const done = await finish(body.jobId);
    expect(done.error).toBeUndefined();
    expect(done.state).toBe("done");
    expect(uploads).toHaveLength(1);
    expect(uploads[0].type).toBe("video/mp4");
    const out = path.join(tmp, "out.mp4");
    fs.writeFileSync(out, uploads[0].body);
    const probe = await probeFile(out);
    expect(probe).toMatchObject({ width: 720, height: 1280, fps: 30, videoCodec: "h264", audioCodec: "aac", hasAudio: true });
    expect(probe.durationSec).toBeGreaterThan(5.5);
    expect(probe.durationSec).toBeLessThan(6.5);
    expect(done.result.probe.sizeBytes).toBe(uploads[0].body.length);
  });

  it("adds a sound track to a silent video and keeps the work folder clean", async () => {
    const { body } = await call("POST", "/v1/jobs", { type: "compose", videoUrl: `${origin}/silent-black.mp4`, audio: { mode: "native" }, overlays: [], output: { uploadUrl: `${origin}/upload/silent.mp4` } });
    const done = await finish(body.jobId);
    expect(done.state).toBe("done");
    const out = path.join(tmp, "silent-out.mp4");
    fs.writeFileSync(out, uploads.at(-1).body);
    expect((await probeFile(out)).hasAudio).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(fs.readdirSync(work)).toEqual([]);
  });

  it("fails a job that points at a host that is not allowed, without fetching it", async () => {
    const { body } = await call("POST", "/v1/jobs", { type: "analyze", videoUrl: "https://evil.example.org/v.mp4" });
    const done = await finish(body.jobId);
    expect(done.state).toBe("failed");
    expect(done.error).toContain("not allowed");
    const internal = await finish((await call("POST", "/v1/jobs", { type: "analyze", videoUrl: "https://169.254.169.254/x.mp4" })).body.jobId);
    expect(internal.state).toBe("failed");
  });

  it("writes the reason of a failed job to its own log (the app turns it into a plain sentence and the reason was otherwise lost)", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const { body } = await call("POST", "/v1/jobs", { type: "analyze", videoUrl: "https://evil.example.org/v.mp4" });
      await finish(body.jobId);
      const line = errors.mock.calls.map((args) => String(args[0])).find((text) => text.includes("job_failed"));
      expect(line).toBeDefined();
      expect(JSON.parse(line)).toMatchObject({ level: "error", message: "job_failed", jobId: body.jobId, type: "analyze", error: expect.stringContaining("not allowed") });
    } finally {
      errors.mockRestore();
    }
  });

  it("rejects bad requests and unknown jobs", async () => {
    expect((await call("POST", "/v1/jobs", { type: "shell" })).status).toBe(400);
    expect((await call("GET", "/v1/jobs/00000000-0000-4000-8000-000000000000")).status).toBe(404);
    expect((await call("GET", "/nope")).status).toBe(404);
  });
});
