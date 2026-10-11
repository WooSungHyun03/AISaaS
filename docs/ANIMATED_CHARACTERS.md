# Shorts pipeline: animated characters, product and shop promos

Shorts are built from the owner's **reference images** (up to 8; the 이지 마케팅 mascot with one click, or uploads). The AI looks at what each image shows and makes the matching video — see `docs/AD_SHORTS.md` for the format rules and research. This file covers the shared pipeline: setup, cost and how a run works.

- **character** images are really animated (one 5 s clip per spoken line), voiced by TTS, (no captions or bubbles) and a generated background track.
- **product / place** photos become a promo; at most four scenes are animated, the rest are panned/zoomed photos.
- Without a reference image the studio does not generate or schedule anything (`NEEDS_CHARACTER` in `src/app/(app)/shorts/actions.ts`, backed by an error in the handler).

## Setup (once, by the account owner)

Two paid services, both selected by environment variables (Vercel → Settings → Environment Variables, Production; mark keys Sensitive and never commit them):

| Name | Value |
| --- | --- |
| `AI_PROVIDER`, `ANTHROPIC_API_KEY` | writing (see `docs/AI_SETUP.md`) |
| `VIDEO_RENDER_PROVIDER` | `json2video` |
| `VIDEO_RENDER_API_KEY` | JSON2Video API key |
| `ANIMATION_PROVIDER` | `fal` |
| `FAL_KEY` | fal.ai API key (https://fal.ai → add prepaid credit → Keys) |
| `ANIMATION_MODEL` | *(optional)* another fal image-to-video endpoint id; default `fal-ai/kling-video/v2.5-turbo/pro/image-to-video` |
| `ANIMATION_MODEL_PREMIUM` | *(optional)* endpoint for plans with premium animation (Pro); default `fal-ai/kling-video/v3/pro/image-to-video` |
| `MUSIC_MODEL` | *(optional)* background-music endpoint; default `fal-ai/lyria2` |

No JSON2Video template is needed any more: the movie is built in code (`json2video-skit.ts`) and posted to `POST /v2/movies`. `NEXT_PUBLIC_SITE_URL` must be the public HTTPS site URL, because the mascot images are fetched from `/shorts-mascot/*.png`. Then redeploy and run `node --env-file=.env.local scripts/check-providers.mjs`.

Without `ANIMATION_PROVIDER=fal` (or without the key) character videos still work, with the image simply moved by JSON2Video (pop / bounce / shake …), and the preview says so ("움직이는 영상 서비스가 아직 연결되지 않아 …").

## Cost and limits

- Kling 2.5 Turbo Pro on fal.ai: US$0.35 per 5 s clip; Kling 3.0 Pro about US$0.56 (verify at https://fal.ai/models); a music track about US$0.10. A video has 4–6 scenes → roughly **US$1.4–2.1**, plus the JSON2Video render (≈ 25 credits).
- A promo animates at most 4 scenes (≈ US$1.4); a character video has 4–6 clips. Generating the Shorts preview consumes one `SHORTS` credit for the whole run. Publishing that existing preview consumes no additional credit. If the animation provider is unavailable, the video uses the simple motion effect and reports that fallback in the preview.
- Clips are a fixed 5 s (the shortest length these models bill); each spoken line is ≤ 28 characters so one clip covers it, and the clip is cut to / looped over the voice.
- Only the images the owner marked as characters are sent to the animation model. fal retries server failures itself; the app retries a failed clip once with a fresh request, then fails the run.
- The default endpoint can be deprecated (the Veo 3.1 Fast endpoint, for example, is scheduled to be). If clips fail with "not found", pick a current endpoint and set `ANIMATION_MODEL`.

## How a run works (deferred runs)

Clips take minutes, so the run is split into short steps (`runner.ts`, `handlers/shorts.ts`):

1. **Start (one request):** images that were never analysed are looked at; the AI plans the video (`buildShortsPlanPrompt`: a character skit with speaker/`action`/fallback `motion`, or a promo with caption/`camera`/`animate`/`motionPrompt`); each scene's image is framed to 9:16 (`server/shorts/character-frame.ts`, sharp: a gradient frame for characters, `preparePhotoFrame` for photos), uploaded to the private bucket, and a clip is queued where the plan animates. The handler returns `{ deferred: { state, progress } }`; the run stays `RUNNING` with its state in `automation_runs.output.job`.
2. **Advance (many short requests):** `advanceDeferredRun` — called every 6 s by the open Shorts page (`advanceShortsJob`) and by every cron tick — checks the clips; when all are done it posts the movie to JSON2Video; then checks the render. A lease + compare-and-swap on `output.job.rev` makes concurrent callers harmless.
3. **Finish:** the video URL is stored, optional platform publishing happens, temporary frames are deleted, usage is counted. Failures end the run through the normal failure path; retryable errors (network blips) are tolerated up to 4 times in a row.

A deferred run is reaped as stale after 45 minutes (plain runs after 10); the handler itself gives up after 30. The cron tick drives runs when nobody has the page open, so **scheduled videos only progress while the scheduler works**: pg_cron → Edge Function `run-due-automations` → `/api/cron/run-automations`. That Edge Function must be deployed with `--no-verify-jwt` (the cron job sends no JWT; the Next route is protected by `CRON_SECRET`), otherwise every tick is rejected with 401.

## Rendering notes (JSON2Video)

- One `voice` per scene (Azure `ko-KR-SunHiNeural` for the character, `ko-KR-InJoonNeural` for the unseen partner), so each scene is as long as its line and picture cannot drift from audio.
- Text boxes default to the full frame, vertically centred, and `y: "32%"` shifts that whole box; pin text with `y` in pixels + `height` + `vertical-position`. `word-break` is ignored, so the bubble wraps at spaces itself with `\n`.
- Layout checked in the JSON2Video editor preview (free): bubble placement, 9:16 framing, scene length following the voice. The `video` element (loop + cut to voice) is not drawn by the preview of an automated browser (autoplay is blocked), so check the first real render.
- Preview any generated movie for free in the editor (JSON view → paste) without spending render credits.
