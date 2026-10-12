# Blog posts: how the app writes ad-blog quality articles

Goal: posts that look and read like the best Naver / Tistory business blogs — long enough, sub-headed, emoji and emphasis, photo spots, a quote and a tip box, a business-info box, hashtags — without inventing facts.

## What the research says (2026)

- Naver ranks with C-Rank (blog expertise), D.I.A. (document experience) and AI briefing. Posts that keep readers: **1,500–2,000+ characters**, **5+ original photos**, question-style sub-headings, clear structure (lists, tables, short paragraphs), a representative image ([nblogmaster](https://nblogmaster.com/blog/naver-blog-seo-tips), [TILNOTE](https://tilnote.io/en/pages/6abd32871bc5b55a946de798)).
- Naver gives no official character/image/keyword counts; what lowers quality is copied or templated text, keyword stuffing (5+ repeats), irrelevant keywords, unmarked ads and AI text that reads the same everywhere ([locaposting checklist](https://locaposting.com/blog/naver-seo-checklist)).
- Naver's "AI 활용" label is **recommended, not required** for blogs (required for shopping ads) ([MTN](https://news.mtn.co.kr/news-detail/2026072417015682342)).
- Tistory is read through Google too: semantic h2/h3, an early answer, tidy structure, original content ([JAB-GYVER](https://jab-guyver.co.kr/5300)).

## How the app does it (`src/server/blog`, `src/server/ai/prompts/blog.ts`, `handlers/blog.ts`)

1. **Facts first.** `buildBlogFacts` collects only what the owner gave (profile, goal, keywords, the new *"꼭 넣고 싶은 내용"* note, calendar brief). The writer may state nothing else as true: no invented prices, hours, awards, reviews, "I visited" stories. Numbers with units (원, %, 시, 분 …) that the facts never mention are flagged by the quality check.
2. **Three models, one call per step** (`handlers/blog.ts`, deferred run; every call is metered against the blog budget — see `docs/AI_SETUP.md`):

   | step | model | what it does |
   | --- | --- | --- |
   | PLAN | Opus 5.5 | topic (or the calendar's fixed topic), search intent, primary/secondary keywords, 5–7 sections with points, photo spots, quote/callout/list slots, closing CTA |
   | DRAFT | Fable 5.1 | the **whole** Korean post in one call (consistent voice and rhythm), then the quality gate below |
   | FIX | Fable 5.1 | only the sections that failed the gate (max 4), once, with the old text and the problems |
   | REVIEW | Sonnet 5.5 | fact check against the owner's facts; a concrete unsupported claim triggers **one** more targeted fix, vaguer findings become notes for the owner |
   | GUIDE | Sonnet 5.5 | style, photo notes, SEO and tags (below); falls back to rules if the call fails or the budget has no room |

   Every step after DRAFT may fail without failing the post. Per post the worst case reserved is about $2 (DRAFT is reserved at its `max_tokens`, the real cost is usually a fraction); the item cap is $3.
3. **Structured blocks, not raw HTML** (`post.ts`): paragraph, quote, list (check/bullet/number), callout, photo slot, info box, divider; inline `**bold**` and `==highlight==`. Headings start with an emoji, paragraphs end with an occasional emoji.
4. **Quality gate** (`blog-quality.ts`, unchanged): length ≥ 1,500 chars (no spaces), 5–8 sub-headings, short paragraphs, 8–45 emoji, ≥ 5 bold + ≥ 2 highlight, ≥ 4 photo spots, a quote and a callout, keyword in the first 400 chars and not stuffed (≤ 8), no AI-tell phrases (`결론적으로`, `알아보겠습니다`, `여러분` …) or unprovable claims (`최고의`, `1등`, `100%` …), no invented numbers, varied sentence endings and openings. Problems are assigned to sections; **only the failing sections (max 4) are rewritten once**, with the old text and the problems in the prompt. A rewrite that fails keeps the original.
5. **App-built extras:** the business-info box (location, main offering, website — from the profile, never from the AI) and 8–12 hashtags.
6. **Rendering** (`render.ts`): the same post becomes HTML for Naver (styled paragraphs with inline CSS; the SmartEditor keeps bold/colour/size/background on paste) or Tistory/WordPress (h2, blockquote, table, font stack). All text is escaped; nothing from the model can inject markup.
7. **Owner workspace** (`blog-workspace.tsx`): live preview, "서식 그대로 복사" (HTML + text on the clipboard), Tistory "HTML 코드 복사", title/text copy, the list of photos to take, and an editor over a readable markup (`# 제목`, `## 소제목`, `> 인용`, `[사진] …`, `[포인트] …`) that round-trips with the blocks (`markup.ts`).

Each step can be a single long model call, so a blog run is a **deferred run**: the open page and the cron tick advance it one step at a time (lease 330 s, `maxDuration` 300). Runs started before this pipeline (the old section-by-section format) cannot be resumed and end with a clear message and a refund.

## Settings

- Per blog automation: **올릴 곳** (네이버 / 티스토리) and **꼭 넣고 싶은 내용**.
- Models: `AI_MODEL_PLANNER` / `AI_MODEL_WRITER` / `AI_MODEL_REVIEWER` (defaults Opus 5.5 / Fable 5.1 / Sonnet 5.5). Budget: `BUDGET_BLOG_USD` (20), `BUDGET_BLOG_ITEMS` (10), `BUDGET_BLOG_ITEM_CAP_USD` (3).
- The run's output records `generation` (per-step model, tokens, cost) and `factCheck`.

## Limits

- Fonts cannot be chosen: Naver's editor ignores pasted font families. Size, bold, colour and highlight survive paste; if a style is dropped, the plain text and photo spots are still correct.
- The AI never sees the owner's photos; it writes photo *spots* (what to shoot and where). The owner puts real photos in.
- Real posts get better with real details: fill in **꼭 넣고 싶은 내용** (signature item, story, event, parking) — that is the only source of specifics.


## Publishing guide (style, photo spots, SEO) — `src/server/blog/publishing-guide.ts`

Every post carries a guide made **in the same run** (one Sonnet call, no extra credit; it falls back to rules, so it can never fail the post). It is stored in `automation_runs.output.publishingGuide` (no migration) and shown as three tabs next to the post: 편집 가이드, 이미지 가이드, SEO·태그, plus "전체 게시 가이드 복사".

- **Style**: the model proposes font, sizes, colours, title alignment and an emphasis method for the industry and tone; the app *checks* them — colours need ≥ 4.5:1 contrast on white (body/title ≥ 7:1), at most two accent colours, Naver sizes snap to the SmartEditor list (11, 13, 15, 16, 19, 24, 28, 30, 34, 38), fonts must be in the editor's list, alignment only left/centre. The same values drive the "추천 스타일로 보기·복사" preview/HTML. Pasting is not guaranteed to keep styles (fonts are never kept on Naver); the screen says so.
- **Images**: positions are **read from the post** (`[사진]` blocks → section, "n번째 문단 다음", excerpt), so they always match the text and follow the owner's edits. The model only adds type / ratio / caption / alt text / reason per spot; without it the type cycles by promotion type (STORE exterior → interior → signature → location; PRODUCT whole → feature → use → detail; PLATFORM screen → feature → steps → result). Images the owner already uploaded for Shorts are named as usable; nothing is generated, and the UI says so.
- **SEO**: tags and keywords survive only if they are the owner's keywords/name/industry/place+keyword or really appear in the post; titles with unprovable claims are dropped; region keywords only for STORE; tags are offered as `#a #b` (Naver) and `a,b` (Tistory).
- Older posts (no stored guide) get a rule-based guide built on screen from the post and the profile.

## Shorts posting text — `src/server/shorts/publishing-metadata.ts`

Written from the planned script (after the plan, same run, no extra credit) and stored in `output.publishing`; the owner's edits live in `content_history.publishing` (migration 0072, written by a server action like the blog edit). A title, alternative title or description must share real wording with the video's script (bigram overlap) and may not contain unprovable or sensational words, otherwise the video's own hook is used. YouTube gets title / description (with `#Shorts`, ≤ 5 hashtags) / tags (API field); Instagram gets one caption (first line, text, CTA, ≤ 8 hashtags). "지금 게시" and scheduled posts send the edited text.
