#!/usr/bin/env node
/**
 * Compares image-to-video models on YOUR image, side by side, before you pick one for production.
 * It spends real fal.ai credit (one 5 s clip per model, about US$0.35-0.85 each), so run it deliberately.
 *
 *   node --env-file=.env.local scripts/bakeoff-animation.mjs \
 *     --image https://be-celeb.org/shorts-mascot/wave.png \
 *     --prompt "The robot waves cheerfully and tilts its head. Smooth, natural motion; steady camera." \
 *     [--models fal-ai/kling-video/v2.5-turbo/pro/image-to-video,fal-ai/kling-video/v3/pro/image-to-video] \
 *     [--music "Warm acoustic pop, light beat, no vocals"]
 *
 * The image must be a public HTTPS URL (for a private upload, create a signed URL first). Needs FAL_KEY.
 * Prints the time each model took, an estimated price and the video URL; open them next to each other.
 */
const key = process.env.FAL_KEY;
if (!key) {
  console.error("FAL_KEY is not set. Put it in .env.local and run with --env-file=.env.local.");
  process.exit(1);
}

const args = Object.fromEntries(
  process.argv.slice(2).flatMap((arg, index, all) => (arg.startsWith("--") ? [[arg.slice(2), all[index + 1]]] : [])),
);
const image = args.image;
if (!image || !/^https:\/\//.test(image)) {
  console.error("--image must be a public https:// URL.");
  process.exit(1);
}
const prompt = args.prompt ?? "Smooth, natural motion with a steady camera. Keep the subject exactly as in the image.";
const models = (args.models ?? "fal-ai/kling-video/v2.5-turbo/pro/image-to-video,fal-ai/kling-video/v3/pro/image-to-video").split(",").map((m) => m.trim()).filter(Boolean);

/** Rough list prices (fal.ai model pages, 2026-10) for a 5 s clip without audio; verify before relying on them. */
const PRICE_5S = [
  [/kling-video\/v2\.5-turbo/, 0.35],
  [/kling-video\/v3/, 0.56],
  [/seedance/, 1.5],
  [/veo3\.1\/fast/, 0.5],
];
const estimate = (model) => PRICE_5S.find(([pattern]) => pattern.test(model))?.[1] ?? null;

const headers = { Authorization: `Key ${key}`, "Content-Type": "application/json" };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function clipBody(model) {
  const common = { prompt, duration: "5" };
  return /\/v3\//.test(model) ? { ...common, start_image_url: image, generate_audio: false } : { ...common, image_url: image };
}

async function run(model, body, pick) {
  const startedAt = Date.now();
  const submit = await fetch(`https://queue.fal.run/${model}`, { method: "POST", headers, body: JSON.stringify(body) });
  if (!submit.ok) return { model, error: `submit failed: HTTP ${submit.status} ${(await submit.text()).slice(0, 200)}` };
  const { status_url: statusUrl, response_url: responseUrl } = await submit.json();
  for (let attempt = 0; attempt < 120; attempt++) {
    await sleep(5_000);
    const status = await (await fetch(statusUrl, { headers })).json();
    if (status.status === "COMPLETED") {
      const resultResponse = await fetch(responseUrl, { headers });
      const result = await resultResponse.json();
      if (!resultResponse.ok) return { model, error: `failed: ${JSON.stringify(result).slice(0, 200)}` };
      return { model, seconds: Math.round((Date.now() - startedAt) / 1000), url: pick(result) };
    }
  }
  return { model, error: "timed out after 10 minutes" };
}

console.log(`Image: ${image}\nPrompt: ${prompt}\nRunning ${models.length} model(s) in parallel…\n`);
const jobs = models.map((model) => run(model, clipBody(model), (result) => result.video?.url));
if (args.music) jobs.push(run("fal-ai/lyria2", { prompt: args.music, negative_prompt: "vocals, singing, lyrics, speech" }, (result) => result.audio?.url));

for (const outcome of await Promise.all(jobs)) {
  const price = estimate(outcome.model);
  console.log(`● ${outcome.model}${price ? `  (≈ US$${price.toFixed(2)} per 5 s clip)` : ""}`);
  console.log(outcome.error ? `  ✗ ${outcome.error}` : `  ✓ ${outcome.seconds}s → ${outcome.url}`);
}
