# Shorts video rendering

AutoBiz uses **JSON2Video** for server-side Shorts rendering. The application does not run FFmpeg or Remotion on Vercel.

## Why JSON2Video

- JSON2Video charges one render credit per output second, offers 600 evaluation credits, and has a lower entry subscription than Creatomate.
- A saved template can repeat one authored scene for every object in the `scene_items` variable.
- Azure text-to-speech and automatic subtitles are built in, so this P0 does not need a separate TTS service.
- `POST /v2/movies` returns immediately and `GET /v2/movies?project=...` exposes bounded polling states (`pending`, `running`, `done`, `error`, `timeout`).

Official references:

- https://json2video.com/pricing/
- https://json2video.com/docs/v2/reference/api-endpoints/movies-create
- https://json2video.com/docs/v2/reference/api-endpoints/movies-status
- https://json2video.com/docs/v2/reference/json-syntax/element/voice
- https://json2video.com/docs/v2/reference/json-syntax/element/subtitles

Creatomate has a polished visual template editor and a well-documented render API, but its entry plan is more expensive and its voice-over setup requires a separate OpenAI or paid ElevenLabs connection. See https://creatomate.com/pricing and https://creatomate.com/docs/fundamentals/template-editor/ai-voice-overs.

## One-time account and template setup

1. Create a JSON2Video account and copy the API key from the dashboard.
2. Create a template from `docs/json2video-shorts-template.json`:
   - Dashboard → Templates → Add new template → Edit layout.
   - Copy the contents of the file's `movie` object into the editor JSON view, or call `POST https://api.json2video.com/v2/templates` with the whole file.
3. Keep the canvas at `1080 × 1920` and retain these variable names:
   - `voice_script`: full Korean narration used by the built-in Azure voice.
   - `scene_items`: array used by the repeating scene.
   - Per item: `scene_text`, `visual_prompt`, `duration_sec`, `background_color`.
4. Keep one movie-level `voice` element and one movie-level `subtitles` element. The supplied template uses the included `ko-KR-SunHiNeural` Azure voice.
5. Copy the generated template ID.
6. Configure the deployment:

   ```env
   VIDEO_RENDER_PROVIDER=json2video
   VIDEO_RENDER_API_KEY=<server-only API key>
   VIDEO_RENDER_TEMPLATE_ID=<template ID>
   ```

Local development and CI use `VIDEO_RENDER_PROVIDER=mock`; they never call JSON2Video and require no key.

The connector passes `visual_prompt` to the template contract for future background-media generation. This P0 uses the template's branded background colours because JSON2Video does not natively generate images or video clips from that prompt. Adding a separate visual-generation provider remains independent of the rendering API.

## Character Shorts from reference images

When a Shorts setup has reference images (`automations.config.references`, 1–8 images), the render does **not** use the template above. `src/server/connectors/video/json2video-skit.ts` builds the whole movie in code and posts it to `POST /v2/movies`, so only `VIDEO_RENDER_API_KEY` is needed for this mode.

- **Sources.** Uploads go to the private Storage bucket `shorts-references` (created on first upload with the service role; the browser first downsizes each image to PNG/JPEG ≤ 1024 px, the server re-checks magic bytes and the 3 MB cap). At render time each upload becomes a 1-hour signed URL. The 이지 마케팅 mascot poses are static files in `public/shorts-mascot/*.png`, fetched by JSON2Video from `NEXT_PUBLIC_SITE_URL` — that variable must be the public HTTPS site URL in production or the render fails with a clear `NOT_CONFIGURED` error.
- **Script.** `buildShortsSkitPrompt` (AI) writes 4–7 one-line scenes. Each line has a `speaker` (`main` = the pictured character, `partner` = an unseen second voice), an `imageIndex` into the reference list (the AI is told what each image shows), and a `motion` (`pop`, `bounce`, `wobble`, `shake`, `slide`, `zoom`). An out-of-range `imageIndex` falls back to the first image.
- **Scene layout.** Per scene: one `voice` (Azure `ko-KR-SunHiNeural` for `main`, `ko-KR-InJoonNeural` for `partner`), the reference image with keyframe motion, and a speech bubble. The scene has no fixed `duration`, so its length is the voice's length and picture and audio cannot drift. Lines are capped (45 chars each, 190 in total) to keep a video around 20–35 s so it renders inside the 60 s request budget.
- **Text boxes.** JSON2Video text boxes default to the full frame, vertically centred, and `y: "32%"` just shifts that whole box down. Pin text with `y` in pixels + `height` + `vertical-position` (this is what the bubble and the template's scene text now do); `word-break` is ignored, so the bubble wraps at spaces itself with `\n`.
- **Limits.** The character moves by tweening the reference image (position/size), not by generated animation or lip-sync. Image-to-video generation would be a separate, per-clip priced provider.

Preview a generated movie for free in the JSON2Video editor (JSON view → paste → the preview plays without spending render credits).
