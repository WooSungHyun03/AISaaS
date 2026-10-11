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
   - **promo:** 4–7 scenes: hook (≤ 12 characters, also on screen) → the product/place at its best → 2–3 highlights taken only from what is visible, the profile and the request → proof only if given → closing card with the business name, location and offering **from the profile**. One narrator voice, a punchy caption per scene, the business name in a corner.
3. **Photos are never altered by AI.** Each photo is framed to 9:16 (`preparePhotoFrame`: portrait-ish photos are cropped to the interesting part; landscape ones are shown whole over a blurred copy). The plan marks **at most 4** scenes as *animate* where real motion helps (steam, pouring, light, a slow push-in); those frames go to the image-to-video model with a product-preserving prompt (shape, colour, packaging text and logo unchanged, no new objects, no people). The other scenes get a slow pan/zoom (`camera`). **Person photos are never animated.**
4. **Cost control:** animated promo scenes count against the same monthly allowance as animated characters (`monthlyAnimatedShortsLimit`); past it, or without a fal key, promos still render with panned photos and say so.
5. **No fabricated claims:** the planner may not state prices, hours, addresses, awards or statistics that were not given, nor unprovable superlatives (최고, 1등 …).

## Limits

- Product accuracy: image-to-video can still bend small text or logos; keep clips short and review the preview before publishing.
- Real people are shown, never animated or voiced as the person.
- The Korean voice is TTS (Azure); lip-sync is not attempted.
- Music and sound effects are not added yet.
