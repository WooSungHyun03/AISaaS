# Ad Shorts from reference images (character, product, shop)

The owner adds up to 8 images and, optionally, writes what they want. The AI **looks at the images** and builds the matching kind of vertical ad (TikTok / Instagram Reels / YouTube Shorts). Setup, costs and the deferred-run flow are in `docs/ANIMATED_CHARACTERS.md`.

## How ad shorts are made in practice (research, 2026)

- The common pipeline is **asset → brief → storyboard → generation → platform export**: a product photo or URL goes in, a script, voice, captions and music come out, vertical 9:16, 15–30 s ([UGC workflow](https://mrkarthikkn.medium.com/make-viral-ai-ugc-ads-in-2026-the-full-workflow-for-high-converting-campaigns-80335379a20b), [shhots](https://shhots.ai/blog/best-ai-avatar-solutions-for-ugc-product-ads/)).
- Products on the market: Creatify (product URL → UGC-style ads with avatars, from US$39/month), Topview, Arcads and HeyGen (talking avatars/spokespeople), Higgsfield (cinematic image-to-video) ([Creatify vs Topview](https://www.stork.ai/compare/creatify-vs-topview-ai)). They are subscription tools for ad teams; none writes Korean small-business ads from the owner's own photos with a Korean voice on a per-video price.
- The generation layer is image-to-video: Kling 2.5 Turbo Pro about US$0.35 per 5 s clip, Runway Gen-4 Turbo about US$0.05/s, Veo 3.1 Fast US$0.10–0.15/s ([fal.ai Kling](https://fal.ai/models/fal-ai/kling-video/v2.5-turbo/pro/image-to-video), [Veo 3.1 Fast](https://fal.ai/models/fal-ai/veo3.1/fast/image-to-video)). Prompts that keep a product stable separate **camera motion**, **subject motion** and **preservation rules**, and ask for simple, slow moves ([Kling prompt guide](https://picsart.com/blog/kling-ai-prompts/)).
- What makes an ad short work: the first 1–2 s stop the scroll (a question, a desire, a problem, a joke) and the hook is also on-screen text; one message; concrete shots (product close-up, in use, the place); captions burned in; a clear last-scene call to action.

## What the app does

1. **Look at each image** (`server/shorts/reference-analysis.ts`, Claude vision, once when it is added): `character` (illustration/mascot/animal), `product` (item, dish, drink), `place` (shop, interior, office), `person` (owner/staff/customer) or `other`, plus a one-sentence summary and any readable text. The owner sees the result under each thumbnail and can correct it. Without vision (another AI provider) an image is `other` with the owner's label.
2. **Pick the format** (`allowedShortsFormats` + the AI, from the owner's request): style *자동* lets the AI choose; *캐릭터 콩트 / 캐릭터 설명* need a character; *상품·매장 홍보* uses the photos.
   - **character:** a funny skit or explainer where the character really moves (one 5 s clip per line, two voices) — see `ANIMATED_CHARACTERS.md`.
   - **promo:** 4–7 scenes: spoken hook (≤ 12 characters) → the product/place at its best → 2–3 highlights taken only from what is visible, the profile and the request → proof only if given → closing card with the business name, location and offering **from the profile**. One narrator voice and the business name in a corner.
   - **No captions.** Neither format draws subtitles, speech bubbles or caption boxes (owner's decision: shorts usually have none). Only the small business-name tag and the closing card are drawn, so the voice and the picture must carry each scene.
3. **Photos are never altered by AI.** Each photo is framed to 9:16 (`preparePhotoFrame`: portrait-ish photos are cropped to the interesting part; landscape ones are shown whole over a blurred copy). The plan marks **at most 4** scenes as *animate* where real motion helps (steam, pouring, light, a slow push-in); those frames go to the image-to-video model with a product-preserving prompt (shape, colour, packaging text and logo unchanged, no new objects, no people). The other scenes get a slow pan/zoom (`camera`). **Person photos are never animated.**
4. **Cost control:** generating a Shorts preview reserves one `SHORTS` credit for the whole run, including its animated scenes. Publishing an existing preview uses no additional credit. Without a fal key, promos still render with panned photos and say so.
5. **No fabricated claims:** the planner may not state prices, hours, addresses, awards or statistics that were not given, nor unprovable superlatives (최고, 1등 …).

## Sound and models

- **Background music:** the plan picks a mood (`music`: e.g. "playful ukulele" for a skit, "warm acoustic" for a cafe); an instrumental track is generated next to the clips (fal Lyria 2, about US$0.10 per ~30 s track, `MUSIC_MODEL`) and mixed at volume 0.2 under the voice, looped to the movie length with a fade-out. A missing or failed track just means no music.
- **Model tiers:** plans carry `animationQuality` (`src/server/billing/plans.ts`): Starter uses `ANIMATION_MODEL` (default Kling 2.5 Turbo Pro, about US$0.35 per 5 s clip), Pro uses `ANIMATION_MODEL_PREMIUM` (default Kling 3.0 Pro, about US$0.56 without audio). Each model family's input names are mapped in `connectors/animation/fal.ts`.
- **Compare before choosing:** `npm run bakeoff:animation -- --image <https url> --prompt "…" [--models a,b] [--music "…"]` runs the same image through several models in parallel and prints time, estimated price and the video URLs (spends real fal credit; needs `FAL_KEY` in `.env.local`).
- **Not built yet (needs the comparison first):** lip-synced talking characters (Kling 3.0 native audio — Korean support is reported inconsistently), multi-reference generation (Seedance 2.0 reference-to-video), a natural Korean voice (ElevenLabs via JSON2Video — voice IDs must be verified), restyled product backgrounds.

## Limits

- Product accuracy: image-to-video can still bend small text or logos; keep clips short and review the preview before publishing.
- Real people are shown, never animated or voiced as the person.
- The Korean voice is TTS (Azure); lip-sync is not attempted.
- Sound effects are not added; the Korean voice is plain TTS.
