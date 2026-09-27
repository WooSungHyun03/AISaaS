    # Repository Analysis Report — Dev3 (Directory / Data / Customer Support)

## Project Understanding

AutoBiz는 1인 사업자/소상공인을 위한 AI 업무 자동화 SaaS. 핵심 product flow는 `사업 정보 입력 → 자동화(블로그/인스타/뉴스레터/CS/숏폼) 등록 → 스케줄러가 주기 실행 → AI가 콘텐츠 생성 → (선택) 외부 플랫폼 게시`. **AI Tool Directory는 무료 acquisition 채널**, Automation이 실제 유료 product라는 원칙은 코드에도 반영되어 있다 — `automation_templates` 5종 중 `blog-marketing`만 `AUTOMATION_AVAILABILITY: "AVAILABLE"`이고 나머지(`customer-support` 포함)는 `"COMING_SOON"`.

## Architecture

문서(`docs/ARCHITECTURE.md`)와 실제 코드가 정확히 일치한다. Next.js 16 App Router 단일 레포, ORM 없음, `src/app`(라우트) / `src/server`(도메인 로직) 분리. 도메인 경계:

| Domain | Owner | 확인된 실제 파일 |
|---|---|---|
| AI provider | Dev1 | `src/server/ai/{provider,generate,index,errors}.ts` + `providers/{mock,openai,gemini}.ts` |
| Automations/Scheduler | Dev1 | `src/server/automations/`, `handlers/*.ts` |
| Connectors | Dev1 | `src/server/connectors/{wordpress,instagram,email,youtube}/` |
| Billing | Dev1 | `src/server/billing/` |
| Directory/CS | **Dev3** | `src/server/directory/`, `src/server/customer-support/` |
| App/UI | Dev2 | `src/app/`, `src/components/` |

## Database (migrations 0001–0015 확인됨, 0015가 최신)

- **`directory_tools`** (`0011`): `name, slug, description, github_url, stars, forks, language, license, category, tags[], last_github_sync_at, created_at, updated_at`. **`manual_override`/`active` 필드는 없음.** RLS: `select using (true)` — public read, insert/update/delete 정책 전혀 없음 → 쓰기는 반드시 service-role(`createAdminClient()`)로만 가능.
- **`faqs`** (`0013`): `question, answer, category, is_published, created_at, updated_at`. RLS는 `is_published = true`일 때만 select 가능한 정책 하나뿐. **insert/update/delete 정책 없음, `business_id` 컬럼도 없음** — 지금 FAQ는 business별이 아니라 전역 단일 FAQ 세트(가이드 페이지용)로 설계돼 있다. 문서 요구사항(business ownership)과 실제 스키마 사이에 갭이 있음.
- **`setup_requests`** (`0010`): `user_id, business_id, automation_type, description, budget_range, status(REQUESTED/CONTACTED/IN_PROGRESS/COMPLETED/CANCELLED)`. RLS: select/insert/update own — **완전히 구현되어 있고 실제로 쓰이는 중**(`src/app/(public)/pricing/actions.ts`의 `createSetupRequest` Server Action, "use server" 패턴).
- `support_conversations`/`support_messages`/`public_widget_id`/`widget_token` — **전부 존재하지 않음.**

## Directory Current State

- `src/server/directory/github.ts`: `fetchRepoStats()` (GitHub REST API, `GITHUB_TOKEN` optional, `next.revalidate: 6h`, 실패 시 throw 일반 `Error` — `AppError`/도메인 에러 패턴 미적용), `parseGithubUrl()`. **재시도 로직 없음, rate-limit(403/429) 분기 없음.**
- `src/server/directory/classifier.ts`: 키워드 매칭 기반 분류기(`automation/framework/backend/ai-model/other`). **AI 기반이 아님** — 파일 주석에 "Dev3가 나중에 AI 분류로 교체할 것"이라고 명시. `AIProvider`/`generateStructured()`와 연결된 코드 없음.
- **Sync job이 존재하지 않는다.** `github.ts`와 `classifier.ts`를 엮어 `directory_tools`에 upsert하는 코드(cron route, script, server action 어느 형태로도)는 레포 어디에도 없다. `admin.ts` 주석에 "the directory sync job"이라는 표현이 있지만 이는 아직 안 쓰인 aspirational 코멘트다.
- **검색/필터 없음.** `src/app/(public)/directory/page.tsx`는 `select("*").order("stars")`로 전체 목록만 렌더링. 쿼리 파라미터, 카테고리 필터, 텍스트 검색 전부 미구현.
- 시드 데이터 3개(LangChain/n8n/Supabase)만 존재, `last_github_sync_at`은 seed에서도 채워지지 않음(null).

## Customer Support Current State

- `src/server/customer-support/faq.ts`: `listPublishedFaqs()` 하나뿐 — 읽기 전용, `/guides` 페이지가 소비. **CRUD 없음(insert/update/delete 없음), 관리 UI/Server Action 없음.**
- **AI 답변, chat API, conversation 로그, embed widget — 전부 미구현.** `src/app/api/`에는 `billing/webhook`, `cron/run-automations`, `health` 세 Route Handler만 존재.
- 주의: `src/server/automations/handlers/customer-support.ts`는 다른 개념이다 — 이건 **Dev1 소유의 automation template 핸들러**(고객 문의에 실시간 응답하는 게 아니라, "자주 묻는 질문에 대한 답변 초안을 주기적으로 생성"하는 자동화)이며 현재 `throw new Error("not implemented yet")` placeholder. Dev3가 만들 "실시간 CS AI 응답 API"와는 별개 기능이므로 혼동해서 이 파일을 건드리면 안 됨.

## Existing AI Interface

`src/server/ai/index.ts`가 진입점 — `getAIProvider()`가 `AI_PROVIDER` env(mock/openai/gemini)로 싱글턴 provider를 고른다. Dev3는:

```ts
import { generateText, generateStructured } from "@/server/ai"; // or "@/server/ai/generate"
```

- `generateText({ system?, prompt, maxTokens?, temperature? }) → Promise<string>`
- `generateStructured<T>({ system?, prompt, schema: ZodType<T>, maxTokens? }) → Promise<T>` — 실패 시 자동 1회 재시도 후 `AIProviderError("INVALID_STRUCTURED_RESPONSE", ...)`.

프롬프트는 `src/server/ai/prompts/blog.ts`처럼 도메인별 `prompts/` 하위에 함수로 분리하는 패턴이 확립돼 있음 — Directory classification, CS answer 둘 다 이 패턴을 따라 `src/server/directory/prompts.ts`, `src/server/customer-support/prompts.ts` 식으로 추가하면 된다. **새 SDK/새 provider 절대 추가하지 않는다.**

## Existing Server Patterns

- **Server Component 직접 read**: 페이지에서 `createClient()`(RLS-scoped) → `.from(table).select()` 바로 호출 (예: `directory/page.tsx`, `guides/page.tsx`).
- **Server Action (`"use server"`)**: 쓰기는 colocated `actions.ts`에 — `pricing/actions.ts`의 `createSetupRequest`가 표준 예시(인증 체크 → validation → insert → `revalidatePath`).
- **Route Handler**: 외부 caller(cron, webhook) 전용, secret 헤더로 보호 (`x-cron-secret` in `api/cron/run-automations/route.ts`). Dev3의 public CS widget API를 만들 경우 이 패턴(Route Handler + 별도 인증 방식, 예: `widget_token`)을 따라야 함.
- **Service-role client**: `src/lib/supabase/admin.ts`의 `createAdminClient()` — RLS 우회, "trusted server code에서만" 사용. Directory sync, FAQ 관리 write는 여기 해당.
- **에러 처리**: `src/server/shared/errors.ts`의 `AppError`(`.domain/.code/.retryable`) 상속 패턴. `ConnectorError`가 실사례. **`github.ts`는 현재 이 패턴을 따르지 않고 있음** — sync job 구현 시 `DirectoryError` 같은 도메인 에러 타입을 추가해 맞추는 게 일관성 있음.
- **Logging**: `src/lib/logger`의 `info/warn/error`만 사용, `console.*` 금지.

## Dev3 Ownership

주 수정 대상:
- `src/server/directory/` — sync job, search/filter query, AI classification 연동
- `src/server/customer-support/` — FAQ CRUD, CS AI answer 함수, (필요시) conversation 로그, widget 인증
- `supabase/migrations/0016_*.sql` 이후 — `directory_tools` 확장 컬럼, `faqs`에 `business_id`/CRUD RLS 추가, `support_conversations`/`support_messages` 신설, widget identifier 테이블
- `src/types/domain.ts` — 새 테이블 타입은 공유 규칙(TEAM_GUIDE)대로 작은 PR로 먼저 추가

## Dependencies on Dev1

- **AIProvider**: 이미 사용 가능, 대기 불필요.
- Directory sync를 cron으로 돌리려면(`pg_cron`/Edge Function 패턴) `supabase/functions/`, `0014_scheduler_cron.sql` 방식을 참고해야 하는데 이 영역은 Dev1 소유 — Vercel Cron Job(하루 1회, directory sync엔 충분할 수도)으로 Dev3가 자체 Route Handler + `vercel.json`으로 해결 가능한지, 아니면 Dev1의 pg_cron 인프라에 얹어야 하는지 확인 필요.
- `customer-support` automation 템플릿(주기적 FAQ 초안 생성)은 Dev1 소유 handler — Dev3의 실시간 CS 응답 기능과 이름이 겹치니 사전 커뮤니케이션 권장.

## Dependencies on Dev2

- Directory 검색/필터 UI, FAQ 관리 대시보드 UI, CS 위젯 프리뷰/설치 가이드 UI, `setup_requests` 상태 확인 대시보드 UI — Dev3는 서버 함수만 제공.

## Do Not Touch

`src/server/ai/`, `src/server/automations/`, `src/server/connectors/`, `src/server/billing/`, `supabase/functions/`, `src/app/`, `src/components/`(directory/customer-support 관련 최소 확인용 수정 제외) — TEAM_GUIDE/ARCHITECTURE에 명시된 Dev1/Dev2 영역.

## Risks

1. **GitHub rate limit / 무한 재시도**: `fetchRepoStats()`가 실패 시 그냥 `Error` throw — 403/429/network를 구분하지 않음. Sync job을 cron으로 걸면 무권한 상태에서 60req/h 한계에 쉽게 부딪힘.
2. **Duplicate data / upsert 안전성**: `directory_tools.slug`는 unique지만 sync 로직이 없어 `on conflict` 처리 패턴이 검증 안 됨(seed.sql엔 있음, 실제 sync 코드엔 없음).
3. **RLS 갭**: `faqs`/`directory_tools` 모두 쓰기 정책이 전혀 없다 — 이는 의도된 설계(service-role only)지만, 향후 business-scoped FAQ로 확장 시 RLS를 새로 설계해야 하고 실수하면 전체 공개될 위험.
4. **AI hallucination (CS)**: 현재 CS AI 응답 기능이 전혀 없으므로 "제공된 정보 밖은 답하지 않음" 가드레일을 프롬프트 설계 단계에서부터 넣어야 함 — 참고할 기존 구현이 없어 처음부터 설계.
5. **Public API abuse**: CS widget API가 아직 없어 `public_widget_id`/`widget_token` 같은 구조 전무 — DB UUID를 그대로 노출하지 않도록 처음부터 별도 식별자 설계 필요(레이트리밋도 없음, Route Handler 패턴엔 전례 없음).
6. **schema overlap**: `customer-support` automation 템플릿과 신규 CS AI 기능이 이름/개념이 겹쳐 혼동 위험(위 설명 참조).

## Recommended First 5 Tickets

### 1. Directory GitHub Sync Job
- **현재 상태**: `github.ts`/`classifier.ts`만 존재, 연결하는 코드 없음.
- **구현 방법**: `src/server/directory/sync.ts` 신규 — curated repo 목록(초기엔 코드 상수 또는 새 테이블)을 순회하며 `fetchRepoStats()` 호출 → `createAdminClient()`로 `directory_tools` upsert(`slug` on conflict) → `last_github_sync_at` 갱신. `github.ts`에 `AppError` 상속한 `DirectoryError`(`RATE_LIMITED`/`NOT_FOUND`/`NETWORK_FAILURE`) 추가해 무한 재시도 방지.
- **수정 예상 파일**: `src/server/directory/{sync.ts,errors.ts}`, `github.ts`(에러 타입 교체), 신규 `src/app/api/cron/sync-directory/route.ts`(secret 보호, `run-automations` route 패턴 따름).
- **DB 변경**: 없음(기존 컬럼으로 충분) — 필요시 `0016_directory_curated_list.sql`로 curated repo 목록 테이블 추가 검토.
- **다른 팀원 dependency**: Dev1 — cron 트리거 방식(Vercel Cron vs pg_cron) 상의 필요.
- **테스트 방법**: mock GitHub 응답으로 unit test(`vitest`), local에서 `GITHUB_TOKEN` 없이 60req/h 이내로 수동 실행 확인.
- **완료 기준**: `directory_tools`가 실제 GitHub 데이터로 갱신되고, rate-limit/network 에러 시 크래시 없이 로깅 후 스킵.

### 2. Directory Search/Filter
- **현재 상태**: `directory/page.tsx`가 전체 목록만 조회, 필터 UI/쿼리 없음.
- **구현 방법**: `src/server/directory/query.ts`에 `searchDirectoryTools({ q, category, language })` 함수 — Postgres `ilike`/`= any` 필터. Dev2에 최소 연동 지점(searchParams → 함수 호출)만 제공.
- **수정 예상 파일**: `src/server/directory/query.ts`(신규), `directory/page.tsx`는 최소 수정(searchParams 전달)만.
- **DB 변경**: 없음(단, 검색량 늘면 `pg_trgm` 인덱스 migration 고려).
- **다른 팀원 dependency**: Dev2 — 필터 UI 컴포넌트.
- **테스트 방법**: unit test로 쿼리 빌더 검증, `/directory?q=lang&category=framework` 수동 확인.
- **완료 기준**: 카테고리/키워드로 결과가 정확히 좁혀짐.

### 3. AI 기반 Directory Classification
- **현재 상태**: 키워드 매칭뿐.
- **구현 방법**: `src/server/directory/prompts.ts`에 `buildClassifyPrompt(description, topics)` + `generateStructured()`로 `{ category: enum, tags: string[], shortSummary, difficulty }` 반환. `category`는 고정 enum(zod)으로 제한, sync job에서 신규/미분류 tool에만 호출(비용 절감).
- **수정 예상 파일**: `src/server/directory/{prompts.ts,classifier.ts}`(AI 경로 추가, 키워드 fallback 유지), `sync.ts` 연동.
- **DB 변경**: 없음.
- **다른 팀원 dependency**: 없음(AIProvider 그대로 사용).
- **테스트 방법**: `AI_PROVIDER=mock`으로 전체 플로우 확인, zod 파싱 실패 케이스 unit test.
- **완료 기준**: 새 repo 추가 시 category가 predefined enum 내에서 자동 채워짐.

### 4. FAQ CRUD (관리 기능)
- **현재 상태**: 읽기(`listPublishedFaqs`)만 존재, CRUD/RLS insert-update-delete 정책 전무.
- **구현 방법**: `src/server/customer-support/faq.ts`에 `createFaq/updateFaq/deleteFaq`(service-role 또는 추후 admin-role 기반) 추가. RLS는 현재 "쓰기 정책 없음 = service-role 전용" 설계를 유지할지, 사업자별 FAQ로 확장할지 먼저 결정(문서는 business ownership을 요구하지만 현 스키마엔 `business_id`가 없음 — 이 갭을 티켓에서 명시적으로 해소).
- **수정 예상 파일**: `src/server/customer-support/faq.ts`, 신규 migration.
- **DB 변경**: `0016_faqs_business_scope.sql`(가칭) — `business_id` 컬럼 + RLS 정책, 또는 전역 FAQ 유지 결정 시 스킵.
- **다른 팀원 dependency**: Dev2 — 관리 UI.
- **테스트 방법**: RLS 정책 Supabase SQL editor로 직접 검증(다른 사용자 FAQ 접근 차단).
- **완료 기준**: 사업자가 자신의 FAQ만 CRUD 가능, 미인증/타인 요청은 거부됨.

### 5. Customer Support AI Answer (MVP)
- **현재 상태**: 전무.
- **구현 방법**: `src/server/customer-support/answer.ts` — `generateStructured()`로 business 정보 + FAQ 컨텍스트만 프롬프트에 넣고, "정보 밖 사실 생성 금지" system instruction 명시. 우선 Server Action으로 노출(위젯 public API는 별도 티켓).
- **수정 예상 파일**: `src/server/customer-support/{answer.ts,prompts.ts}`.
- **DB 변경**: 로그 저장이 필요하면 `0017_support_conversations.sql`(최소 컬럼: business_id, question, answer, created_at — email/전화/IP 등 개인정보는 수집하지 않음).
- **다른 팀원 dependency**: Dev1 없음; Dev2 — CS 테스트용 최소 UI.
- **테스트 방법**: FAQ에 없는 질문("사우나 있나요?") 입력 시 "확인 어렵습니다" 응답 확인 — hallucination 가드 검증이 핵심 승인 기준.
- **완료 기준**: FAQ 범위 내 질문엔 정확히 답하고, 범위 밖 질문엔 사실을 지어내지 않고 정중히 거절.