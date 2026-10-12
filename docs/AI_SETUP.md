# AI, video and budget setup

Production uses paid services, all selected by environment variables. Secrets are entered by the account owner — never commit them or put them in `NEXT_PUBLIC_*`. **Nothing paid runs until `ALLOW_PAID_AI_CALLS=true` and a budget period is set** (section 4).

## 1. Writing and planning: Anthropic (Claude)

1. Create an account at https://console.anthropic.com, add prepaid credit and set a **monthly spend limit** (Settings → Limits). The API is billed separately from any Claude.ai subscription.
2. Create an API key and set in Vercel (Production):

   | Name | Value |
   | --- | --- |
   | `AI_PROVIDER` | `anthropic` |
   | `ANTHROPIC_API_KEY` | the key (Sensitive) |

   Set both **together** — `anthropic` without a key makes every generation fail with "AI 서비스 연결 정보가 올바르지 않습니다".
3. Redeploy (env changes apply to new deployments).

Models per pipeline step (`src/server/ai/models.ts`; change one without a deploy with `AI_MODEL_PLANNER` / `_WRITER` / `_REVIEWER` / `_VISION`):

| step | default model | $/MTok in / out |
| --- | --- | --- |
| planner (blog plan, ad plan) | `claude-opus-5-5` | 4 / 20 |
| writer (blog draft and fixes) | `claude-fable-5-1` | 10 / 50 |
| reviewer (fact check, publishing guide, posting text) | `claude-sonnet-5-5` | 2 / 10 |
| vision (photo analysis, frame QA) | `claude-sonnet-5-5` | 2 / 10 |
| small helper features (diagnosis text, calendar) | `AI_MODEL` or `claude-haiku-4-5-20251001` | 1 / 5 |

Request rules the code follows (migration guide): the 5.x models take **no** `temperature`/`top_p`/`top_k`; Opus 5.5 and Fable 5.1 always think (adaptive) so `max_tokens` covers thinking and `output_config.effort` is the only control; text is read from `text` blocks by type; a `refusal` or a `max_tokens` stop is an error that is still billed. Pipeline calls wait up to `AI_LONG_REQUEST_TIMEOUT_MS` (240 s) and are **not** re-sent after a timeout (a timed-out call may already be billed). Token usage (input / output / cache) and the dollar cost of every call are recorded in the ledger.

## 2. Ad video: fal.ai (Wan 3.0), FFmpeg worker, ElevenLabs

See `docs/AD_SHORTS.md`. Set `AD_VIDEO_PROVIDER=fal`, `FAL_KEY`; deploy `worker/ffmpeg` and set `POSTPROCESS_PROVIDER=worker`, `POSTPROCESS_WORKER_URL`, `POSTPROCESS_WORKER_TOKEN`; for the Korean voice set `TTS_PROVIDER=elevenlabs`, `ELEVENLABS_API_KEY`, `TTS_VOICE_ID` (a Korean-capable voice from your ElevenLabs library). Typical cost of one 25 s video: about **$3.75 reserved** ($2.50 once thinking is verified free) plus under $1 of Claude.

## 3. Verify before announcing

```bash
node --env-file=.env.local scripts/check-providers.mjs   # one tiny Claude call (< $0.001), worker health, budget settings
```

Then make one blog post and **one** video (this spends real money).

## 4. Budget (`BUDGET_*`, `ALLOW_PAID_AI_CALLS`)

| Name | Default | Meaning |
| --- | --- | --- |
| `ALLOW_PAID_AI_CALLS` | `false` | master switch for every paid call |
| `BUDGET_PERIOD_START` / `_END` | unset | Seoul dates, end excluded; no automatic reset — set a new period to continue |
| `BUDGET_VIDEO_USD` / `_ITEMS` | 50 / 10 | service-wide video cap and count |
| `BUDGET_BLOG_USD` / `_ITEMS` | 20 / 10 | service-wide blog cap and count |
| `BUDGET_*_ITEM_CAP_USD` | 10 / 3 | most one item may cost, retries included |
| `BUDGET_*_ITEM_FLOOR_USD` | 3.5 / 0.6 | held back for every unfinished item so retries cannot starve the rest |
| `BUDGET_FREEZE` | `false` | emergency stop |

Look at the ledger with SQL (service role): `select kind, state, sum(coalesce(actual_usd, reserved_usd)) from budget_spend where period_key = '2026-11-01..2026-12-01' group by 1, 2;`

## 5. Production checklist

- [ ] `BILLING_PROVIDER` is `toss` (mock checkout is blocked in production unless `ALLOW_MOCK_BILLING=true`).
- [ ] Supabase migrations up to **0073** are applied.
- [ ] Anthropic monthly spend limit set; fal.ai balance topped up in small amounts.
- [ ] `BUDGET_PERIOD_*` set and `ALLOW_PAID_AI_CALLS=true`; `check:providers` shows no ❌.
- [ ] The worker's `WORKER_ALLOWED_HOSTS` lists your Supabase host and the fal media hosts (`.fal.media`, `.fal.run`).
