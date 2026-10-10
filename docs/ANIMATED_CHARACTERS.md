# Reference-image Shorts: animated characters and photo showcases

The Shorts studio lets an owner attach 1–8 reference images and describe the video they want. What gets made depends on **what each image shows** (chosen at upload: 캐릭터 / 제품·메뉴 / 매장·사무실·공간 / 사람 / 기타) and on **the owner's request**:

| Format | Needs | What is produced | Extra cost |
| --- | --- | --- | --- |
| `character` | a **캐릭터** image | The character is *really animated* by an image-to-video model (one 5 s clip per line), voiced by TTS, with a speech bubble. Falls back to the simple motion effect (image tweened by JSON2Video) when animation is unavailable or the plan allowance is used up. | ~US$0.35 per scene |
| `showcase` | a non-character image (product, place, person, other) | The owner's photos full-screen with slow pan/zoom, a caption and one narrator. Photos are never altered by AI. | none beyond JSON2Video |
| classic | no image | The colour-card video with subtitles (template flow in `docs/VIDEO_RENDERING.md`). | none |

In the studio the style is **자동** (the AI picks `character` or `showcase` from the request and image kinds), 캐릭터 콩트, 캐릭터 설명 or 사진 홍보. A pinned style the images cannot satisfy falls back to what they allow (`allowedShortsFormats`). Only `character` images are ever sent to the animation model — people, product and shop photos never are.

## Setup (once, by the account owner)

1. Create an account at https://fal.ai and add prepaid credit (Billing). Set a spend limit if the dashboard offers one.
2. Create an API key (Keys → Add key). Do not paste it into chat or commit it.
3. In Vercel → Settings → Environment Variables (Production):

   | Name | Value |
   | --- | --- |
   | `ANIMATION_PROVIDER` | `fal` |
   | `FAL_KEY` | the key (Sensitive) |
   | `ANIMATION_MODEL` | *(optional)* another fal image-to-video endpoint id; default `fal-ai/kling-video/v2.5-turbo/pro/image-to-video` |

4. Redeploy. `NEXT_PUBLIC_SITE_URL` must be the public HTTPS site URL (the mascot images are fetched from `/shorts-mascot/*.png`).
5. Run `node --env-file=.env.local scripts/check-providers.mjs`, then make one character video in the studio.

Without `ANIMATION_PROVIDER=fal` (or without the key) character videos still work with the simple motion effect and say so in the preview ("움직이는 영상 서비스가 아직 연결되지 않아 …").

## Cost and limits

- Kling 2.5 Turbo Pro on fal.ai: US$0.35 for a 5 s clip (verify current prices at https://fal.ai/models). A character video has 4–6 scenes → roughly **US$1.4–2.1** plus the JSON2Video render (≈ 25 credits).
- Plans cap animated videos per month (`monthlyAnimatedShortsLimit` in `src/server/billing/plans.ts`: Free 0, Starter 2, Pro 6). Past the cap, character Shorts are rendered with the simple motion effect, never refused. Change the numbers there only.
- Frames are fixed 5 s clips because that is the shortest length these models bill; the voice line (≤ 28 characters) decides how much of the clip is used.
- fal retries server-side failures itself; the app retries a failed clip once with a fresh request, then fails the run (the clips already paid for are not reused).
- The default fal endpoint can be deprecated (the Veo 3.1 Fast endpoint, for example, is scheduled to be). If clips start failing with "not found", pick a current endpoint in the fal model list and set `ANIMATION_MODEL`.

## How a run works (deferred runs)

Clips take minutes, so the run is split into short steps (`src/server/automations/runner.ts`, `handlers/shorts.ts`):

1. **Start (one request):** AI plans the video (`buildShortsPlanPrompt`), each character image is placed on a 9:16 frame (`character-frame.ts`, sharp), uploaded to the private bucket, and a clip is queued per scene. The handler returns `{ deferred: { state, progress } }`; the run stays `RUNNING` with the state in `automation_runs.output.job`.
2. **Advance (many short requests):** `advanceDeferredRun` — called every 6 s by the open Shorts page (`advanceShortsJob`) and by every cron tick — checks the clips; when all are done it posts the full movie to JSON2Video; then checks the render. A lease + compare-and-swap on `output.job.rev` makes concurrent callers harmless.
3. **Finish:** the video URL is stored, optional platform publishing happens, temporary frames are deleted, and usage is counted. Failures end the run through the normal failure path; retryable errors (network blips) are tolerated up to 4 times in a row.

A deferred run is reaped as stale after 45 minutes (plain runs after 10); the handler itself gives up after 30. Because the cron tick drives runs when nobody has the page open, **scheduled character videos only progress while the scheduler works**: pg_cron → Edge Function `run-due-automations` → `/api/cron/run-automations`. That Edge Function must be deployed with `--no-verify-jwt` (the cron job sends no JWT; the Next route is protected by `CRON_SECRET`), otherwise every tick is rejected with 401 and nothing scheduled ever runs.

## Rendering notes

Layouts are built in code (`json2video-skit.ts`, `json2video-showcase.ts`) and posted to `POST /v2/movies` — no template needed. Verified in the JSON2Video editor preview: bubble and caption placement, 9:16 framing, per-scene voice and scene length following the voice. The `video` element (loop + cut to voice) is not drawn by the in-browser preview of an automated browser (autoplay is blocked), so check the first real render.
