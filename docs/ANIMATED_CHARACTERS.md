# Character Shorts (animated characters)

Shorts are **always character videos**. The owner adds 1–8 character images (the 이지 마케팅 mascot with one click, or their own uploads), optionally writes what they want ("마스코트가 바쁜 사장님을 도와주는 이야기로 서비스를 소개해줘"), and picks a tone: 캐릭터 콩트 (funny skit) or 캐릭터 설명 (explainer). Without a character image the studio does not generate or schedule anything (`NEEDS_CHARACTER` in `src/app/(app)/shorts/actions.ts`, backed by an error in the handler).

The character is **really animated** by an image-to-video model (one 5 s clip per spoken line), voiced by TTS, and assembled with a speech bubble by JSON2Video.

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

No JSON2Video template is needed any more: the movie is built in code (`json2video-skit.ts`) and posted to `POST /v2/movies`. `NEXT_PUBLIC_SITE_URL` must be the public HTTPS site URL, because the mascot images are fetched from `/shorts-mascot/*.png`. Then redeploy and run `node --env-file=.env.local scripts/check-providers.mjs`.

Without `ANIMATION_PROVIDER=fal` (or without the key) character videos still work, with the image simply moved by JSON2Video (pop / bounce / shake …), and the preview says so ("움직이는 영상 서비스가 아직 연결되지 않아 …").

## Cost and limits

- Kling 2.5 Turbo Pro on fal.ai: US$0.35 per 5 s clip (verify at https://fal.ai/models). A video has 4–6 scenes → roughly **US$1.4–2.1**, plus the JSON2Video render (≈ 25 credits).
- Plans cap animated videos per month (`monthlyAnimatedShortsLimit` in `src/server/billing/plans.ts`: Free 0, Starter 2, Pro 6). Past the cap the video is still made, with the simple motion effect and a note. Change the numbers there only.
- Clips are a fixed 5 s (the shortest length these models bill); each spoken line is ≤ 28 characters so one clip covers it, and the clip is cut to / looped over the voice.
- Only the images the owner marked as characters are sent to the animation model. fal retries server failures itself; the app retries a failed clip once with a fresh request, then fails the run.
- The default endpoint can be deprecated (the Veo 3.1 Fast endpoint, for example, is scheduled to be). If clips fail with "not found", pick a current endpoint and set `ANIMATION_MODEL`.

## How a run works (deferred runs)

Clips take minutes, so the run is split into short steps (`runner.ts`, `handlers/shorts.ts`):

1. **Start (one request):** the AI plans the skit (`buildShortsPlanPrompt` → 4–6 scenes, each with speaker, image number, an English `action` for the animator and a fallback `motion`); each scene's character image is placed on a 9:16 gradient frame (`server/shorts/character-frame.ts`, sharp), uploaded to the private bucket, and a clip is queued. The handler returns `{ deferred: { state, progress } }`; the run stays `RUNNING` with its state in `automation_runs.output.job`.
2. **Advance (many short requests):** `advanceDeferredRun` — called every 6 s by the open Shorts page (`advanceShortsJob`) and by every cron tick — checks the clips; when all are done it posts the movie to JSON2Video; then checks the render. A lease + compare-and-swap on `output.job.rev` makes concurrent callers harmless.
3. **Finish:** the video URL is stored, optional platform publishing happens, temporary frames are deleted, usage is counted. Failures end the run through the normal failure path; retryable errors (network blips) are tolerated up to 4 times in a row.

A deferred run is reaped as stale after 45 minutes (plain runs after 10); the handler itself gives up after 30. The cron tick drives runs when nobody has the page open, so **scheduled videos only progress while the scheduler works**: pg_cron → Edge Function `run-due-automations` → `/api/cron/run-automations`. That Edge Function must be deployed with `--no-verify-jwt` (the cron job sends no JWT; the Next route is protected by `CRON_SECRET`), otherwise every tick is rejected with 401.

## Rendering notes (JSON2Video)

- One `voice` per scene (Azure `ko-KR-SunHiNeural` for the character, `ko-KR-InJoonNeural` for the unseen partner), so each scene is as long as its line and picture cannot drift from audio.
- Text boxes default to the full frame, vertically centred, and `y: "32%"` shifts that whole box; pin text with `y` in pixels + `height` + `vertical-position`. `word-break` is ignored, so the bubble wraps at spaces itself with `\n`.
- Layout checked in the JSON2Video editor preview (free): bubble placement, 9:16 framing, scene length following the voice. The `video` element (loop + cut to voice) is not drawn by the preview of an automated browser (autoplay is blocked), so check the first real render.
- Preview any generated movie for free in the editor (JSON view → paste) without spending render credits.
