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
