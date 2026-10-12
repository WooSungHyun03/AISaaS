# AutoBiz FFmpeg worker

Post-processing for ad Shorts. The app calls it to **measure** a generated video (length, size, black or frozen stretches, silence, loudness, sample frames for the vision QA), to **probe** uploaded clips and audio (the length decides what the video model bills), and to **finish** the video: logo, business name, CTA text, exact label/screen images, narration mixed under ducking, loudness normalisation, 720×1280 H.264/AAC MP4, uploaded to a signed Supabase Storage URL. Free local work: it is not counted in the budget.

No npm dependencies — Node 20+ built-ins and the system `ffmpeg`, `ffprobe`, `rsvg-convert` (SVG logos) and a CJK font.

## Run

```bash
docker build -t autobiz-ffmpeg-worker worker/ffmpeg
docker run --rm -p 8080:8080 \
  -e WORKER_TOKEN="$(openssl rand -hex 24)" \
  -e WORKER_ALLOWED_HOSTS="your-project.supabase.co,.fal.media,.fal.run" \
  autobiz-ffmpeg-worker
curl localhost:8080/healthz
```

Without Docker: `WORKER_TOKEN=… WORKER_ALLOWED_HOSTS=… node worker/ffmpeg/src/index.mjs` (needs ffmpeg and a CJK font; set `WORKER_FONT_FILE` if the Noto path differs).

In the app: `POSTPROCESS_PROVIDER=worker`, `POSTPROCESS_WORKER_URL=https://…`, `POSTPROCESS_WORKER_TOKEN=<the same token>`.

## Environment

| Name | Default | |
|---|---|---|
| `WORKER_TOKEN` | — (required, ≥16 chars) | bearer token every call except `/healthz` must send |
| `WORKER_ALLOWED_HOSTS` | — (required) | hosts the worker may download from and upload to: `host.example.com` exact, `.example.com` any subdomain |
| `PORT` | 8080 | |
| `WORKER_CONCURRENCY` | 2 | parallel jobs (each is a CPU-heavy ffmpeg run; give the container 2+ vCPU) |
| `WORKER_MAX_DOWNLOAD_MB` / `WORKER_MAX_UPLOAD_MB` | 300 / 120 | |
| `WORKER_FFMPEG_TIMEOUT_MS` | 600000 | |
| `WORKER_TMP_DIR` | `/tmp/autobiz-worker` | every job's files live in its own folder and are removed when it ends; leftovers are swept at start |
| `WORKER_FONT_FILE` | Noto Sans CJK Bold | for Korean overlay text |
| `WORKER_ALLOW_LOCAL` | — | tests only: allows `127.0.0.1` over plain http |

## API

`Authorization: Bearer <WORKER_TOKEN>` on everything except `GET /healthz`.

- `POST /v1/probe {url}` → `{durationSec, sizeBytes, hasVideo, hasAudio, width, height, fps, videoCodec, audioCodec, …}`
- `POST /v1/jobs {type:"analyze", videoUrl, frames}` → `202 {jobId}`; result: `{probe, black, frozen, audio, frames:[{atSec, base64}]}`
- `POST /v1/jobs {type:"compose", videoUrl, voiceUrl?, audio:{mode:"native"|"mix"|"voice_only"}, overlays:[…], target, output:{uploadUrl}}` → `202 {jobId}`; result: `{probe}` of the uploaded file
- `GET /v1/jobs/:id` → `{state: queued|running|done|failed, result?, error?}`

Jobs live in memory. After a restart the app gets a 404 for the old job and simply sends it again (the work is free).

## Security

HTTPS only; host allowlist; the host is resolved once and the connection is pinned to that public address (private, loopback, link-local and mapped addresses are refused — DNS rebinding cannot redirect it); no redirects; no credentials in URLs; request body ≤ 64 KB; size/time limits; overlay text is written to a file and never placed in a filter expression; unknown fields are dropped. Run it in a private network or behind the token only; do not expose it publicly without the token.

## Deploying

Any container host works (Fly.io, Cloud Run, Railway, a small VPS). It needs outbound HTTPS to Supabase Storage and fal's media hosts, and the app must reach it over HTTPS. Cloud Run: set concurrency 2, CPU always allocated (jobs outlive the request that started them), min instances 1.

## Tests

`npx vitest run worker` runs the unit tests and an end-to-end test against the real `ffmpeg` (skipped when ffmpeg or a font is missing).
