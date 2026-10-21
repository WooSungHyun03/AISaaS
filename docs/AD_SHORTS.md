# Ad Shorts: one 20–30 s video, generated end to end

The owner uploads product / shop photos (and, if needed, short reference clips, music and a logo), says what they want, and gets a vertical 9:16 ad of **20–30 seconds** (default 25) with sound. The video is generated **in one pass** by **Wan 3.0 Standard reference-to-video** on fal.ai — there are no stitched 5-second clips — then checked, voiced if needed, and finished with FFmpeg. Nothing is ever posted without the owner pressing the button.

## The pipeline

```
upload (browser -> Storage)            photos ≤10, clips ≤5 (≤15 s total), audio ≤5 (≤15 s total), logo 1
        │
run     look at new photos (Sonnet vision, one call) -> ad plan (Opus 5.5, Zod-checked)
        -> Wan prompt (rules, no AI) -> posting text (Sonnet)               src/server/automations/handlers/shorts.ts
SUBMIT  reserve the generation in the ledger -> queue it at fal -> save the job id at once (checkpoint)
WAIT    poll fal -> settle the reservation when the video is ready
CHECK   FFmpeg measurements + vision QA of 8 frames. A clear error rejects; at most ONE regeneration
VOICE   Korean narration, only if the video's voice is missing or the owner chose it
FINISH  FFmpeg worker: logo, name, CTA, exact images, voice mix, loudness, final MP4 -> private Storage
```

Each call is one quick step; the run is *deferred* between steps (cron tick or the open page advances it), survives restarts, and never submits the same generation twice: the fal job id is saved with `ctx.checkpoint` before the step ends, so a crash resumes **polling** instead of paying again.

### The request to Wan (`connectors/wan/fal.ts`, schema checked 2026-10-12)

`alibaba/wan-3.0/reference-to-video`, queue API. Always sent explicitly — the endpoint's own defaults would be a 1080p, 5 s, "adaptive" video:

| field | value |
|---|---|
| `resolution` | `720p` |
| `aspect_ratio` | `9:16` |
| `duration` | 20–30, integer (default 25) |
| `audio` | `true` |
| `enable_prompt_expansion` | `true` (fal warns quality drops without it) |
| `enable_thinking` | `true` |
| `enable_safety_checker` | `true` |
| `reference_image_urls` / `reference_video_urls` / `reference_audio_urls` | signed URLs of the owner's files, in upload order |

Limits enforced before anything is sent: ≤10 images, ≤5 videos (≤15 s in total, ≥16 fps), ≤5 audio files (≤15 s in total), duration 20–30. The logo is **never** sent to the model; it is laid over the finished video.

### The plan (Opus 5.5) and the prompt (rules)

The planner returns a Zod-validated plan: concept, one message, audience, a 2-second hook, a 4–8 scene storyboard that covers 0 → N seconds with no gaps, what each reference is for, camera/lighting/colour, music and sound effects, the Korean narration, the CTA, the logo position, "exact" image inserts, and what must not change. `buildWanPrompt` turns that into the prompt **by rules** (same plan → same prompt, ≤ 2,000 characters; the standing rules are never cut). The rules (no text/subtitles/logos in the footage, keep products and labels exactly, no invented screens/prices/phone numbers, no distortion/flicker, and "no speech" when the voice is recorded separately) are checked again against fal's `actual_prompt` (after its own prompt expansion); if one is missing the owner gets a warning.

Labels, packaging text, screens and logos are **not** asked of the model: images marked "정확히 보여줄 이미지" are laid over the finished video by FFmpeg at the time the plan chose.

## Money: the budget ledger (`src/server/budget`, migration 0073)

Service-wide, **not per user**, enforced in the database under one advisory lock per (period, kind) so parallel runs can never overspend.

| | video | blog |
|---|---|---|
| default cap / items | **$50 / 10 videos** | **$20 / 10 posts** (avg ≤ $2) |
| per item cap (retries included) | $10 (`BUDGET_VIDEO_ITEM_CAP_USD`) | $3 |
| held back for every unfinished item | $3.50 | $0.60 |

Everything paid goes through reserve → call → settle: the worst case is reserved **before** the call (and the call is refused if it would pass the cap, the item cap, or eat the money other unfinished items still need); afterwards it is settled to the real cost. A call that failed in a way that may have been billed (timeout, dropped connection, a fal job that failed after queueing) stays booked at the reserved amount. Only a request provably rejected before any work (HTTP 4xx) is released. Free local FFmpeg is not counted. Nothing runs unless `ALLOW_PAID_AI_CALLS=true` **and** an explicit period (`BUDGET_PERIOD_START/END`, Seoul dates, end excluded) is set — there is no automatic monthly reset. `BUDGET_FREEZE=true` stops every paid call at once.

Generation price (`src/server/budget/pricing.ts`): `(output seconds + reference-video seconds) × $0.10/s (720p)`; fal bills the reference video's length **in addition** to the output. `enable_thinking` has no documented price effect, so until `WAN_THINKING_COST_VERIFIED=true` every generation is reserved (and booked) at **× 1.5**:

| output | no reference video | + 15 s reference video |
|---|---|---|
| 20 s | $3.00 (≈ $2.00 once verified) | $5.25 |
| 25 s | $3.75 (≈ $2.50) | $6.00 |
| 30 s | $4.50 (≈ $3.00) | $6.75 |

The first generation is reserved **before** the planner is called, so a run the month cannot afford stops at once and costs nothing. A regeneration is reserved before it is sent; if the ledger refuses it (cap, item cap) the run ends. With the defaults a 25 s video with one regeneration costs about $7.5 + ~$0.8 of Claude — inside the $10 item cap; with a long reference video the second attempt will usually be refused by the item cap (raise `BUDGET_VIDEO_ITEM_CAP_USD` if you want that).

Each run records its calls (`output.generation`: model, per-step cost, tokens, attempts, seed, `actual_prompt`), and the ledger keeps one row per call (`budget_spend`).

### Failure → refund

Run failed (generation failed twice, QA rejected the second video, budget refused the regeneration, worker down, over 80 minutes): the run is FAILED, the **credit is released**, the item slot goes back, and no further money is spent. Money already spent stays counted.

## Quality gate (`src/server/shorts/qa.ts`)

1. **FFmpeg measurements** (worker `analyze` job): duration within ±2 s of the request, 9:16 ratio, height ≥ 1,000 px, file integrity, black stretches (> 1.2 s rejects), frozen stretches (> 3 s rejects), silence, loudness, clipping.
2. **Vision QA** (Sonnet, 8 frames + the plan + what the photos show): hook, concept, product fidelity, brand text, invented UI/prices, burned-in subtitles, artifacts, continuity. Only **clearly visible** errors are `high` and reject.

A clear error rejects the video automatically and starts **one** regeneration (same model, correction in the prompt). **The AI never approves**: a video that passes is "직접 확인이 필요해요" and the owner decides. If the vision check is unavailable the video still goes to the owner, with a warning.

## Voice

Wan's native audio is used first (Korean narration quality is **not verified**). If the video has no sound or is nearly silent, **ElevenLabs** narration (the plan's Korean script, cost counted in the video budget) is mixed over the video's own sound with ducking (music/effects kept). The owner can also choose "한국어 음성 입히기": the prompt then asks for no speech and the recorded voice is mixed in. If narration fails the video is finished with a warning instead of being thrown away.

## FFmpeg worker (`worker/ffmpeg`)

A small Node service (no dependencies) around the system `ffmpeg`/`ffprobe`: `/v1/probe`, async `analyze` and `compose` jobs, output PUT to a signed Storage URL. See `worker/ffmpeg/README.md` for running and deploying it. Security: bearer token (timing-safe), https-only, host **allowlist**, DNS resolved once and the connection **pinned** to a public address (no private/loopback/link-local, no redirects, no credentials in URLs), size and time limits, request text never reaches a shell or a filter expression (overlay text goes through files), temp directories removed after every job and swept at start.

## Uploads (`server/shorts/assets.ts`, `app/(app)/shorts/actions.ts`)

The browser uploads straight to a private Storage bucket with a one-time signed upload URL (a video does not fit through a Server Action; Vercel's body limit is about 4.5 MB). The server then reads the first bytes (the browser's file type is never trusted), measures video/audio with the worker (`ffprobe`), checks count, size, length, fps and the 15 s totals, and only then adds the file to the settings; a rejected file is deleted. SVG logos must be plain shapes (no scripts, links or images). Files are reached only through short-lived signed URLs. The two private buckets (`shorts-references` for the owner's files, `shorts-videos` for finished videos and voice tracks) are created on first use; the older image-only `shorts-references` bucket is widened automatically. **Supabase's Free plan caps a single file at 50 MB** (a project-wide setting) whatever the bucket says, so a longer reference clip fails there; raise the project limit or keep clips short.

## Mock mode

With `AD_VIDEO_PROVIDER=mock` (default) nothing is called or paid: the planner/vision/QA are the mock AI, the "video" is a flagged placeholder (`sampleVideo`) that cannot be posted, and the ledger is untouched. In production the run is refused unless the real services are configured (`preflight`).

## Not verified with real services (needs your keys)

- Real fal / Wan generation, Korean native narration quality, label/packaging fidelity, how `enable_thinking` is billed (check one invoice, then set `WAN_THINKING_COST_VERIFIED=true`), the exact reference syntax ("image 1" is used positionally, as fal's docs describe), accepted reference file formats beyond JPEG/PNG/WEBP, MP4/MOV, MP3/WAV.
- Real Anthropic calls (Opus 5.5 / Fable 5.1 / Sonnet 5.5): request shapes follow the migration guide and are unit-tested, not run.
- Real ElevenLabs voice and its Korean pronunciation.
- The worker has been run for real only on a developer machine (real `ffmpeg`, real local Supabase Storage); deploy it and run `npm run check:providers`.

Deploying the worker and wiring `POSTPROCESS_WORKER_URL`: see `docs/FFMPEG_WORKER_DEPLOY.md`.

## First real video: checklist

1. Apply migration 0073; set the env (see `.env.example`: `AD_VIDEO_PROVIDER=fal`, `FAL_KEY`, worker, `AI_PROVIDER=anthropic`, `ALLOW_PAID_AI_CALLS=true`, period, budgets).
2. `node --env-file=.env.local scripts/check-providers.mjs`.
3. Make one 20 s video without reference clips. Compare fal's invoice with `output.generation.costUsd` (should be $3.00 reserved, $2.00 if thinking is free).
4. Watch the result: label text, product shape, narration language and loudness, the 2-second hook.
