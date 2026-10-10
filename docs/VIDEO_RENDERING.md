# Shorts video rendering

Shorts are character videos assembled by **JSON2Video** (voice-over, speech bubbles, scene timing, 9:16 MP4). The characters themselves are animated by an image-to-video service; see `docs/ANIMATED_CHARACTERS.md` for the full flow, setup and costs.

## Why JSON2Video

It takes a complete movie as JSON through one REST call, has built-in Azure Korean voices (`ko-KR-SunHiNeural`, `ko-KR-InJoonNeural`) at no extra credit cost, bills by output second (≈ 1 credit per second), and its editor can preview any movie JSON for free. Sources: https://json2video.com/pricing, https://json2video.com/docs/v2/reference/api-endpoints/movies-create, https://json2video.com/docs/v2/reference/json-syntax/element/voice.

## Account setup

1. Create a JSON2Video account and copy the API key from the dashboard (the free plan adds a watermark; fine for testing).
2. Set, server-side only:

   ```env
   VIDEO_RENDER_PROVIDER=json2video
   VIDEO_RENDER_API_KEY=<server-only API key>
   ```

No template is needed: `src/server/connectors/video/json2video-skit.ts` builds the movie and `Json2VideoRenderProvider` posts it (`startMovie`) and polls it (`getMovieStatus`). Local development and CI use `VIDEO_RENDER_PROVIDER=mock`; they never call JSON2Video and need no key.

## Notes

- The result must be an HTTPS 9:16 MP4 (`assertMp4PortraitUrl`).
- Renders are started and polled in separate short requests (deferred runs), never awaited inside one request.
- Per-scene `voice` elements make each scene as long as its spoken line. Pin text boxes with pixel `y` + `height` + `vertical-position`, and wrap bubbles at spaces with `\n` (details in `docs/ANIMATED_CHARACTERS.md`).
