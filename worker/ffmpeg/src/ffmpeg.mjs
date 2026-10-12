import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/** Runs a command, captures stdout and stderr (bounded) and fails on a non-zero exit or a timeout. */
export function run(command, args, { timeoutMs = 120_000, maxOutput = 8 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${command} timed out`));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { if (stdout.length < maxOutput) stdout += chunk; });
    child.stderr.on("data", (chunk) => { if (stderr.length < maxOutput) stderr += chunk; });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} exited with ${code}: ${stderr.slice(-400)}`));
    });
  });
}

function fraction(value) {
  const [a, b] = String(value ?? "0/1").split("/").map(Number);
  return b ? a / b : 0;
}

/** What the app needs to know about a media file. */
export async function probeFile(file, timeoutMs = 60_000) {
  const { stdout } = await run("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file], { timeoutMs });
  const info = JSON.parse(stdout);
  const video = info.streams?.find((stream) => stream.codec_type === "video" && stream.disposition?.attached_pic !== 1);
  const audio = info.streams?.find((stream) => stream.codec_type === "audio");
  const duration = Number(info.format?.duration ?? video?.duration ?? audio?.duration ?? 0);
  return {
    durationSec: Number.isFinite(duration) ? Math.round(duration * 1000) / 1000 : 0,
    sizeBytes: Number(info.format?.size ?? fs.statSync(file).size),
    formatName: String(info.format?.format_name ?? ""),
    hasVideo: Boolean(video),
    hasAudio: Boolean(audio),
    width: video?.width ?? null,
    height: video?.height ?? null,
    fps: video ? Math.round(fraction(video.avg_frame_rate) * 100) / 100 : null,
    videoCodec: video?.codec_name ?? null,
    audioCodec: audio?.codec_name ?? null,
    pixelFormat: video?.pix_fmt ?? null,
  };
}

function parseDetections(stderr, startKey, endKey) {
  const spans = [];
  let open = null;
  for (const line of stderr.split("\n")) {
    const start = line.match(new RegExp(`${startKey}[:=]\\s*(-?[\\d.]+)`));
    const end = line.match(new RegExp(`${endKey}[:=]\\s*(-?[\\d.]+)`));
    if (start) open = Number(start[1]);
    if (end && open !== null) {
      spans.push({ start: open, end: Number(end[1]) });
      open = null;
    }
  }
  return spans;
}

const total = (spans) => Math.round(spans.reduce((sum, span) => sum + Math.max(0, span.end - span.start), 0) * 100) / 100;

/**
 * Deterministic quality measurements of a generated video: black and frozen stretches, silence, loudness and clipping.
 * Judging them is the app's job; the worker only measures.
 */
export async function analyzeVideo(file, { timeoutMs = 300_000 } = {}) {
  const probe = await probeFile(file);
  const video = await run(
    "ffmpeg",
    ["-hide_banner", "-nostats", "-i", file, "-an", "-vf", "blackdetect=d=0.4:pix_th=0.10,freezedetect=n=0.003:d=1.5", "-f", "null", "-"],
    { timeoutMs },
  );
  const black = parseDetections(video.stderr, "black_start", "black_end");
  const frozen = parseDetections(video.stderr, "lavfi.freezedetect.freeze_start", "lavfi.freezedetect.freeze_end");
  let audio = null;
  if (probe.hasAudio) {
    const result = await run(
      "ffmpeg",
      ["-hide_banner", "-nostats", "-i", file, "-vn", "-af", "silencedetect=n=-45dB:d=0.8,volumedetect,astats=metadata=0:reset=0", "-f", "null", "-"],
      { timeoutMs },
    );
    const silent = parseDetections(result.stderr, "silence_start", "silence_end");
    const mean = result.stderr.match(/mean_volume:\s*(-?[\d.]+) dB/);
    const max = result.stderr.match(/max_volume:\s*(-?[\d.]+) dB/);
    const peak = result.stderr.match(/Peak level dB:\s*(-?[\d.]+)/);
    const clipped = result.stderr.match(/Number of clipped samples:\s*(\d+)/) ?? result.stderr.match(/clip.*?(\d+)/i);
    audio = {
      meanVolumeDb: mean ? Number(mean[1]) : null,
      maxVolumeDb: max ? Number(max[1]) : peak ? Number(peak[1]) : null,
      silentSeconds: total(silent),
      silentRatio: probe.durationSec > 0 ? Math.round((total(silent) / probe.durationSec) * 100) / 100 : 0,
      clippedSamples: clipped ? Number(clipped[1]) : 0,
    };
  }
  return {
    probe,
    black: { seconds: total(black), spans: black.slice(0, 20) },
    frozen: { seconds: total(frozen), spans: frozen.slice(0, 20) },
    audio,
  };
}

/** Evenly spaced JPEG frames (base64), small enough to hand to a vision model. */
export async function extractFrames(file, durationSec, count, dir, width = 540) {
  const frames = [];
  const safeCount = Math.max(1, Math.min(count, 12));
  for (let index = 0; index < safeCount; index++) {
    const at = durationSec > 0 ? Math.min(durationSec - 0.05, ((index + 0.5) / safeCount) * durationSec) : 0;
    const out = path.join(dir, `frame-${index}.jpg`);
    await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-ss", String(Math.max(0, at)), "-i", file, "-frames:v", "1", "-vf", `scale=${width}:-2`, "-q:v", "4", "-y", out], { timeoutMs: 60_000 });
    frames.push({ atSec: Math.round(at * 100) / 100, base64: fs.readFileSync(out).toString("base64") });
  }
  return frames;
}

const MARGIN = 0.04;
/** Where an overlay sits. W/H are the video's size, w/h the overlay's own (names differ between overlay and drawtext). */
const POSITIONS = {
  "top-left": (v) => ({ x: `${v.W}*${MARGIN}`, y: `${v.H}*${MARGIN}` }),
  "top-right": (v) => ({ x: `${v.W}-${v.w}-${v.W}*${MARGIN}`, y: `${v.H}*${MARGIN}` }),
  "bottom-left": (v) => ({ x: `${v.W}*${MARGIN}`, y: `${v.H}-${v.h}-${v.H}*${MARGIN}` }),
  "bottom-right": (v) => ({ x: `${v.W}-${v.w}-${v.W}*${MARGIN}`, y: `${v.H}-${v.h}-${v.H}*${MARGIN}` }),
  top: (v) => ({ x: `(${v.W}-${v.w})/2`, y: `${v.H}*${MARGIN}` }),
  center: (v) => ({ x: `(${v.W}-${v.w})/2`, y: `(${v.H}-${v.h})/2` }),
  // Above the platforms' own caption / button area at the bottom of a Short.
  bottom: (v) => ({ x: `(${v.W}-${v.w})/2`, y: `${v.H}-${v.h}-${v.H}*0.14` }),
};
export const POSITION_NAMES = Object.keys(POSITIONS);
const IMAGE_VARS = { W: "main_w", H: "main_h", w: "overlay_w", h: "overlay_h" };
const TEXT_VARS = { W: "w", H: "h", w: "text_w", h: "text_h" };
const place = (name, vars) => (POSITIONS[name] ?? POSITIONS.bottom)(vars);

function between(startSec, endSec) {
  if (startSec === undefined && endSec === undefined) return "";
  return `:enable='between(t,${Number(startSec ?? 0).toFixed(2)},${Number(endSec ?? 100000).toFixed(2)})'`;
}

const number = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/**
 * The ffmpeg command for the final video, as pure data (so it can be tested without running anything).
 *
 * `files` holds local paths: video, optional voice, image inputs in order (`images`, matching `spec.logo`/image overlays),
 * `texts` (one file per text overlay, so no user text ever reaches a filter expression) and the output path.
 */
export function buildComposeArgs(spec, files, probe, fontFile) {
  const width = clamp(Math.round(number(spec.target?.width, 720)), 240, 1080);
  const height = clamp(Math.round(number(spec.target?.height, 1280)), 426, 1920);
  const fps = clamp(Math.round(number(spec.target?.fps, 30)), 15, 60);
  const duration = Math.max(1, probe.durationSec);
  const inputs = ["-i", files.video];
  let index = 1;
  const voiceIndex = files.voice ? index++ : null;
  const imageIndexes = (files.images ?? []).map(() => index++);
  for (const input of [files.voice, ...(files.images ?? [])].filter(Boolean)) inputs.push("-i", input);

  const chain = [];
  chain.push(`[0:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=${fps},format=yuv420p[v0]`);
  let last = "v0";
  let step = 0;
  let imageCursor = 0;
  let textCursor = 0;
  for (const overlay of spec.overlays ?? []) {
    step += 1;
    const next = `v${step}`;
    if (overlay.kind === "image") {
      const input = imageIndexes[imageCursor++];
      const widthPct = clamp(number(overlay.widthPct, 0.3), 0.05, 1);
      const { x, y } = place(overlay.position, IMAGE_VARS);
      chain.push(`[${input}:v]scale=${Math.round(width * widthPct)}:-1,format=rgba[ov${step}]`);
      chain.push(`[${last}][ov${step}]overlay=${x}:${y}${between(overlay.startSec, overlay.endSec)}[${next}]`);
    } else {
      const textFile = files.texts[textCursor++];
      const size = clamp(Math.round(number(overlay.fontSizePx, 44)), 16, 120);
      const color = /^#[0-9a-fA-F]{6}$/.test(overlay.color ?? "") ? overlay.color.replace("#", "0x") : "white";
      const { x, y } = place(overlay.position, TEXT_VARS);
      chain.push(`[${last}]drawtext=fontfile='${fontFile}':textfile='${textFile}':fontsize=${size}:fontcolor=${color}:borderw=3:bordercolor=black@0.85:box=1:boxcolor=black@0.35:boxborderw=14:x=${x}:y=${y}${between(overlay.startSec, overlay.endSec)}[${next}]`);
    }
    last = next;
  }
  chain.push(`[${last}]null[vout]`);

  // Audio. A video without a sound track gets silence, so every output has one.
  const mode = spec.audio?.mode ?? "native";
  const loud = spec.audio?.loudnorm !== false;
  const duck = clamp(number(spec.audio?.duckRatio, 8), 2, 20);
  const voiceGain = clamp(number(spec.audio?.voiceGainDb, 0), -12, 12);
  const nativeGain = clamp(number(spec.audio?.nativeGainDb, 0), -30, 12);
  // An explicit stereo / 44.1 kHz format (not aresample alone): older ffmpeg builds (Debian 12's 5.1) cannot negotiate the layout after loudnorm.
  const tail = `${loud ? "loudnorm=I=-14:TP=-1.5:LRA=11," : ""}aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,atrim=0:${duration.toFixed(3)}`;
  if (voiceIndex !== null && mode === "voice_only") {
    chain.push(`[${voiceIndex}:a]volume=${voiceGain}dB,apad,${tail}[aout]`);
  } else if (voiceIndex !== null && mode === "mix") {
    const native = probe.hasAudio ? `[0:a]volume=${nativeGain}dB[nat]` : `anullsrc=r=44100:cl=stereo,atrim=0:${duration.toFixed(3)}[nat]`;
    chain.push(native);
    chain.push(`[${voiceIndex}:a]volume=${voiceGain}dB,apad,asplit=2[vsc][vmix]`);
    chain.push(`[nat][vsc]sidechaincompress=threshold=0.04:ratio=${duck}:attack=20:release=350[ducked]`);
    chain.push(`[ducked][vmix]amix=inputs=2:duration=first:normalize=0,${tail}[aout]`);
  } else if (probe.hasAudio) {
    chain.push(`[0:a]volume=${nativeGain}dB,${tail}[aout]`);
  } else {
    chain.push(`anullsrc=r=44100:cl=stereo,${tail}[aout]`);
  }

  return [
    "-hide_banner", "-loglevel", "error", "-y",
    ...inputs,
    "-filter_complex", chain.join(";"),
    "-map", "[vout]", "-map", "[aout]",
    "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-profile:v", "high", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "160k", "-ar", "44100",
    "-movflags", "+faststart",
    "-t", duration.toFixed(3),
    files.output,
  ];
}
