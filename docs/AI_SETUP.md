# AI + video setup (Claude Haiku 4.5 + JSON2Video)

Production uses two paid services. Both are selected by environment variables;
no code change is needed to switch. Secrets are entered by the account owner —
never commit them or put them in `NEXT_PUBLIC_*`.

## 1. Writing: Anthropic (Claude Haiku 4.5)

1. Create an account at https://console.anthropic.com and add prepaid credit
   (Billing). The API is billed separately from any Claude.ai/ChatGPT subscription.
2. Set a **monthly spend limit** (Settings → Limits) so a bug or abuse can't run up a bill.
3. Create an API key (API keys → Create key). Copy it once.
4. In Vercel → Project → Settings → Environment Variables (Production), set:

   | Name | Value |
   | --- | --- |
   | `AI_PROVIDER` | `anthropic` |
   | `ANTHROPIC_API_KEY` | the key (mark as Sensitive) |
   | `AI_MODEL` | *(optional)* leave empty for `claude-haiku-4-5-20251001`; set e.g. a Sonnet id to upgrade quality later |

   Set `AI_PROVIDER` and the key **together** — `anthropic` without a key makes every
   generation fail with "AI 서비스 연결 정보가 올바르지 않습니다".
5. Redeploy (env changes apply to new deployments).

What it is used for: topic + body of blog posts, Shorts topic/script/scenes, the
2–4 week calendar plan, and the diagnosis narrative. Calls are bounded: ≤ 2
attempts per structured answer, at most one quality rewrite per blog post,
`AI_REQUEST_TIMEOUT_MS` (45 s) and `AI_MAX_RETRIES` (2) for transient errors.

### Rough cost (Haiku 4.5: $1 in / $5 out per million tokens — verify current prices)

| Action | Tokens (est.) | Cost (est.) |
| --- | --- | --- |
| Blog post (topic + body, +1 rewrite worst case) | ~4–8K in, ~2.5–5K out | ~$0.01–0.03 |
| Shorts script + scenes | ~3K in, ~1.5K out | ~$0.01 |
| 4-week calendar plan | ~2K in, ~3K out | ~$0.02 |
| Website diagnosis narrative | ~3K in, ~0.5K out | ~$0.006 |

Even the Pro plan's full monthly quota (30 blogs + 12 Shorts) is roughly **$1 or less**
of text generation per user.

## 2. Video: JSON2Video

1. Sign up at https://json2video.com. The free plan gives 600 one-time credits but
   **adds a watermark** — fine for testing, not for customers. Plans are
   subscription-based (Hobby from about $17/month; Professional about $50/month for
   200 Full-HD minutes — verify current pricing and the Hobby minute allowance).
2. Copy the API key from the dashboard.
3. Set in Vercel (Production):

   | Name | Value |
   | --- | --- |
   | `VIDEO_RENDER_PROVIDER` | `json2video` |
   | `VIDEO_RENDER_API_KEY` | the API key (Sensitive) |

   No template is needed: the movie is built in code (`docs/VIDEO_RENDERING.md`).

Cost per Shorts video is about 1 credit per second (a 30 s video ≈ 30 credits ≈
$0.1–0.2 on a paid plan); the voice-over is included. The fixed monthly
subscription is the real cost until volume grows.

## 2b. Animated characters (optional): fal.ai

Character Shorts can be *really animated* (not just moved) by an image-to-video model through fal.ai: set `ANIMATION_PROVIDER=fal` and `FAL_KEY`. Cost is about US$0.35 per scene (a video is 4–6 scenes) and plans cap animated videos per month. Setup, limits and the step-by-step run flow: `docs/ANIMATED_CHARACTERS.md`.

## 3. Verify before announcing

```bash
node --env-file=.env.local scripts/check-providers.mjs   # one tiny Claude call (< $0.001)
```

Then in the app: run a diagnosis, create a calendar plan, generate one blog post
from the calendar, and render **one** Shorts preview (this one spends real
JSON2Video credits).

## 4. Production checklist

- [ ] `BILLING_PROVIDER` is `toss` (mock checkout is blocked in production unless `ALLOW_MOCK_BILLING=true`).
- [ ] Supabase migrations 0032 and 0033 are applied.
- [ ] Anthropic monthly spend limit set; JSON2Video plan matches expected volume.
- [ ] Plan quotas (`src/server/billing/plans.ts`) × expected users stay inside the JSON2Video minutes you pay for.
