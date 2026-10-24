import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { downloadToFile, uploadFile } from "./security.mjs";
import { analyzeVideo, buildComposeArgs, extractFrames, POSITION_NAMES, probeFile, run } from "./ffmpeg.mjs";

const TYPES = new Set(["analyze", "compose"]);

class ValidationError extends Error {}
export { ValidationError };

function requireUrl(value, name) {
  if (typeof value !== "string" || value.length === 0 || value.length > 2_000) throw new ValidationError(`${name} is required`);
  return value;
}

/** Checks a job request and returns only the fields the worker understands. Nothing from the request reaches a shell. */
export function validateJob(body) {
  if (!body || typeof body !== "object" || !TYPES.has(body.type)) throw new ValidationError("unknown job type");
  if (body.type === "analyze") {
    return { type: "analyze", videoUrl: requireUrl(body.videoUrl, "videoUrl"), frames: Math.max(0, Math.min(12, Number(body.frames ?? 8) || 0)) };
  }
  const overlays = [];
  for (const raw of Array.isArray(body.overlays) ? body.overlays.slice(0, 8) : []) {
    if (!raw || typeof raw !== "object") continue;
    const position = POSITION_NAMES.includes(raw.position) ? raw.position : "bottom";
    const timing = { startSec: Number.isFinite(raw.startSec) ? raw.startSec : undefined, endSec: Number.isFinite(raw.endSec) ? raw.endSec : undefined };
    if (raw.kind === "image") overlays.push({ kind: "image", url: requireUrl(raw.url, "overlay url"), position, widthPct: raw.widthPct, ...timing });
    else if (raw.kind === "text") {
      const text = String(raw.text ?? "").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim().slice(0, 200);
      if (text) overlays.push({ kind: "text", text, position, fontSizePx: raw.fontSizePx, color: raw.color, ...timing });
    }
  }
  const mode = ["native", "mix", "voice_only"].includes(body.audio?.mode) ? body.audio.mode : "native";
  if (mode !== "native" && typeof body.voiceUrl !== "string") throw new ValidationError("voiceUrl is required for this audio mode");
  const output = body.output ?? {};
  return {
    type: "compose",
    videoUrl: requireUrl(body.videoUrl, "videoUrl"),
    voiceUrl: typeof body.voiceUrl === "string" ? requireUrl(body.voiceUrl, "voiceUrl") : undefined,
    overlays,
    audio: { mode, loudnorm: body.audio?.loudnorm !== false, duckRatio: body.audio?.duckRatio, voiceGainDb: body.audio?.voiceGainDb, nativeGainDb: body.audio?.nativeGainDb },
    target: { width: body.target?.width, height: body.target?.height, fps: body.target?.fps },
    output: { uploadUrl: requireUrl(output.uploadUrl, "output.uploadUrl"), contentType: "video/mp4" },
  };
}

async function convertSvgIfNeeded(file, dir, name) {
  const head = fs.readFileSync(file).subarray(0, 512).toString("utf8").toLowerCase();
  if (!head.includes("<svg")) return file;
  const out = path.join(dir, `${name}.png`);
  await run("rsvg-convert", ["-w", "1024", "-o", out, file], { timeoutMs: 30_000 });
  return out;
}

async function runAnalyze(job, dir, config) {
  const file = path.join(dir, "input.mp4");
  await downloadToFile(job.videoUrl, file, config);
  const analysis = await analyzeVideo(file, { timeoutMs: config.ffmpegTimeoutMs });
  const frames = job.frames > 0 ? await extractFrames(file, analysis.probe.durationSec, job.frames, dir) : [];
  return { ...analysis, frames };
}

async function runCompose(job, dir, config) {
  const video = path.join(dir, "video.mp4");
  await downloadToFile(job.videoUrl, video, config);
  const probe = await probeFile(video);
  if (!probe.hasVideo) throw new Error("input has no video stream");
  const files = { video, texts: [], images: [], output: path.join(dir, "final.mp4") };
  if (job.voiceUrl) {
    files.voice = path.join(dir, "voice.bin");
    await downloadToFile(job.voiceUrl, files.voice, config);
    const voiceProbe = await probeFile(files.voice);
    if (!voiceProbe.hasAudio) throw new Error("voice file has no audio");
  }
  let imageCount = 0;
  let textCount = 0;
  for (const overlay of job.overlays) {
    if (overlay.kind === "image") {
      const raw = path.join(dir, `image-${imageCount}.bin`);
      await downloadToFile(overlay.url, raw, config);
      files.images.push(await convertSvgIfNeeded(raw, dir, `image-${imageCount}`));
      imageCount += 1;
    } else {
      const textFile = path.join(dir, `text-${textCount}.txt`);
      fs.writeFileSync(textFile, overlay.text, { mode: 0o600 });
      files.texts.push(textFile);
      textCount += 1;
    }
  }
  const args = buildComposeArgs(job, files, probe, config.fontFile);
  await run("ffmpeg", args, { timeoutMs: config.ffmpegTimeoutMs });
  const result = await probeFile(files.output);
  if (!result.hasVideo || result.durationSec < 1) throw new Error("output video is invalid");
  const sizeBytes = await uploadFile(job.output.uploadUrl, files.output, job.output.contentType, config);
  return { probe: { ...result, sizeBytes } };
}

/** A small in-memory job table with a bounded number of parallel jobs. Jobs live in memory only; a restart loses them and the app resubmits. */
export class JobTable {
  constructor(config) {
    this.config = config;
    this.jobs = new Map();
    this.queue = [];
    this.running = 0;
    fs.mkdirSync(config.tmpRoot, { recursive: true, mode: 0o700 });
    this.sweepOrphans();
  }

  /** Temp directories left behind by a crash. */
  sweepOrphans() {
    for (const entry of fs.readdirSync(this.config.tmpRoot)) fs.rmSync(path.join(this.config.tmpRoot, entry), { recursive: true, force: true });
  }

  submit(spec) {
    const id = randomUUID();
    this.jobs.set(id, { id, spec, state: "queued", createdAt: Date.now() });
    this.queue.push(id);
    this.pump();
    return id;
  }

  get(id) {
    const job = this.jobs.get(id);
    return job ? { jobId: id, state: job.state, ...(job.result ? { result: job.result } : {}), ...(job.error ? { error: job.error } : {}) } : null;
  }

  pump() {
    while (this.running < this.config.concurrency && this.queue.length > 0) {
      const job = this.jobs.get(this.queue.shift());
      if (!job) continue;
      this.running += 1;
      job.state = "running";
      const dir = path.join(this.config.tmpRoot, job.id);
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      const work = job.spec.type === "analyze" ? runAnalyze(job.spec, dir, this.config) : runCompose(job.spec, dir, this.config);
      work
        .then((result) => { job.result = result; job.state = "done"; })
        .catch((error) => {
          job.error = String(error?.message ?? error).slice(0, 300);
          job.state = "failed";
          // The app only sees this once and turns it into a plain sentence: the reason has to be in the worker's own log too.
          console.error(JSON.stringify({ level: "error", message: "job_failed", jobId: job.id, type: job.spec.type, error: job.error }));
        })
        .finally(() => {
          fs.rmSync(dir, { recursive: true, force: true });
          job.finishedAt = Date.now();
          this.running -= 1;
          this.pump();
        });
    }
  }

  /** Forgets finished jobs after their TTL. */
  expire(now = Date.now()) {
    for (const [id, job] of this.jobs) if (job.finishedAt && now - job.finishedAt > this.config.jobTtlMs) this.jobs.delete(id);
  }
}
