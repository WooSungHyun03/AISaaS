
# Dev3 작업 요약 — 지금까지 정리 + 할 일 + 바이브 코딩 가이드

> 김진석(Dev3) — Directory / Data / Customer Support 담당. Spring Boot 배경, TypeScript/Next.js/Supabase는 처음.
> 이 문서는 지금까지 세션에서 나온 내용을 한 곳에 모은 것. 상세 분석은 아래 두 문서를 참고:
> - `docs/DEV3_REPOSITORY_ANALYSIS.md` — 레포 전체 구조/DB/도메인 분석
> - `docs/dev3/IMPLEMENTATION_GUIDE.md` — 티켓별 상세 구현 가이드(설계 힌트, skeleton, 단계별 힌트)

---

## 1. 이 프로젝트가 뭔지 (한 줄 요약)

AutoBiz — 1인 사업자용 AI 업무 자동화 SaaS. Next.js 16(App Router) + TypeScript + Supabase(Postgres/Auth/RLS), **ORM 없음**, ai/automations/connectors/billing은 Dev1, app/components는 Dev2, **directory(AI Tool 디렉토리)와 customer-support(고객 응대)는 나(Dev3)**.

## 2. Spring Boot → 이 프로젝트, 개념 대응표

| Spring Boot | 여기서 | 위치 |
|---|---|---|
| `@RestController` | Route Handler | `src/app/api/**/route.ts` |
| 폼 처리하는 `@PostMapping` (컨트롤러+서비스 합친 느낌) | Server Action (`"use server"`) | `src/app/(public)/pricing/actions.ts` 참고 |
| `@Repository`/JPA | **없음** — Supabase client `.from("table").select()`가 대신함 | SQL은 `supabase/migrations/*.sql`에 직접 씀 |
| Spring Security (`@PreAuthorize`) | **DB의 RLS(Row Level Security) 정책** — 코드가 아니라 DB가 "네 row만 보여줌"을 강제 | `supabase/migrations/0012_row_level_security.sql` |
| `@Valid` + Bean Validation | `zod` 스키마 (일부 파일만 사용, 전사 강제 아님) | `src/types/blog-automation.ts`의 `blogSetupSchema` |
| `@ControllerAdvice`/custom Exception | `AppError` 상속 클래스 | `src/server/shared/errors.ts` |
| `application.yml`/`@Value` | zod로 검증되는 env 객체 | `src/lib/env/server.ts` |
| `@Scheduled` | `pg_cron`(DB 내부 cron) + Edge Function | `supabase/migrations/0014_scheduler_cron.sql` |
| DI로 구현체 교체 | env 변수로 구현체 선택(`AI_PROVIDER=mock/openai/gemini`) | `src/server/ai/index.ts`의 `getAIProvider()` |

**계층 구조 차이**: Spring의 Controller/Service/Repository 3계층이 아니라 사실상 `src/app`(화면+컨트롤러 역할) → `src/server`(서비스 역할, 도메인 로직) → Supabase client 호출(레포지토리 역할) **2~3단**으로 끝난다. 파일 수가 적은 이유.

## 3. TypeScript 최소 문법 (Java 대응)

| Java | TypeScript |
|---|---|
| `import com.foo.Bar;` | `import { Bar } from "./foo";` |
| `public` 붙여서 외부 공개 | 앞에 `export` 붙이면 다른 파일에서 사용 가능 |
| `interface Foo { String name; }` | `interface Foo { name: string; }` — **`이름: 타입`** 순서 |
| 값이 없을 수도 있음 | `name?: string` (필드가 없어도 됨) 또는 `string \| null` |
| 메서드 | `function foo() {}` 또는 `const foo = () => {}`(화살표 함수/람다) |
| `CompletableFuture<String>` + `.get()` | `Promise<string>` + `await` (`async function`) |
| `String.format`/`+` 연결 | 백틱 템플릿 리터럴: `` `hello ${name}` `` |
| 여러 필드 한번에 꺼내기 | 구조분해: `const { data, error } = await supabase...` |

## 4. 이미 만들어둔 문서

1. **`docs/DEV3_REPOSITORY_ANALYSIS.md`** — 전체 아키텍처, DB 스키마(`directory_tools`/`faqs`/`setup_requests` 등), 현재 뭐가 있고 없는지, 첫 5개 티켓 개요.
2. **`docs/dev3/IMPLEMENTATION_GUIDE.md`** — 아래 14개 티켓 각각에 대해 목표/왜 필요한지/현재 상태/개념 설명/파일 위치/DB migration 구조/함수 시그니처·skeleton/단계별 힌트(`<details>` 접힌 힌트 3단계)/자주 하는 실수/점검 질문/테스트 방법/완료 기준까지 상세히 정리됨. **바이브 코딩 할 때도 이 문서를 계속 열어두고 참고할 것** — AI에게 시킬 일의 "스펙 문서" 역할을 한다.

## 5. 해야 할 일 — 티켓 목록 & 권장 순서

의존관계: 타입/스키마 결정이 먼저, 그다음 수집→검색→분류, FAQ는 CS 응답의 전제조건.

```
#7 Guides 구조 확인(가벼움, 독립)
  ↓
#3 taxonomy 확정 + curated 목록 + 0016 migration
  ↓
#1 GitHub 수집기 보강 (rate-limit/에러 분류)
  ↓
#2 Directory Sync Job (cron 배치, upsert)
  ↓ ↓ ↓
#5 검색/필터   #6 상세 데이터   #4 AI 카테고리 분류
  ↓
#8 FAQ 스키마 결정 + CRUD (business_id 추가 여부 결정)
  ↓
#9 CS AI 응답 Engine (hallucination 방지)
  ↓
#10 CS Chat API (public_widget_id, rate limit)
  ↓ ↓
#11 대화 로그   #12 Widget Embed 방식
─────────────────────────
#13 Setup Request Workflow (위와 독립, 아무 때나 가능)
#14 테스트/Seed 정리 (항상 마지막 또는 각 티켓 직후)
```

| # | 티켓 | 우선순위 | 현재 상태 |
|---|---|---|---|
| 1 | GitHub AI Tool 수집기 | P0 | 일부 있음(`github.ts`), rate-limit 처리 없음 |
| 2 | GitHub Directory Sync Job | P0 | 없음 |
| 3 | 초기 데이터셋/taxonomy 확정 | P0 | 일부 있음(seed 3건), taxonomy 미확정 |
| 4 | AI 자동 카테고리 분류 | P1 | 없음(키워드 매칭만) |
| 5 | 검색/필터/정렬 Backend | P0 | 없음 |
| 6 | 상세 데이터 제공 | P0 | 없음 |
| 7 | Automation Guides 구조 | P0 | 있음(정적 데이터, 유지만 하면 됨) |
| 8 | Business FAQ 관리 CRUD | P0 | 없음(`faqs`에 `business_id` 자체가 없음) |
| 9 | CS AI 응답 Engine | P0 | 없음 |
| 10 | CS Chat API | P0 | 없음 |
| 11 | CS 대화 로그 | P1 | 없음 |
| 12 | CS Widget Embed | P1 | 없음 |
| 13 | Setup Request Workflow | P0 | 부분 있음(생성만 됨, 조회/상태전이 없음) |
| 14 | 테스트/Seed 정리 | P1 | 디렉토리/CS 테스트 0개 |

## 6. 바이브 코딩할 때 반드시 지킬 것 (AGENTS.md/TEAM_GUIDE 요약)

AI 코딩 툴에게 시키더라도 **이 규칙들은 프롬프트에 매번 포함시키거나 결과물에서 직접 확인**해야 한다 — 안 지키면 팀 컨벤션이 깨지고 리뷰에서 반려된다.

1. **기존 migration 파일을 수정하지 않는다.** 새 마이그레이션은 항상 `supabase/migrations/0016_...sql`부터 다음 번호로 추가(현재 마지막은 `0015`).
2. **새로 만드는 모든 테이블에 RLS를 반드시 건다** (`enable row level security` + 최소 select 정책).
3. **AI 기능은 반드시 `src/server/ai`의 `generateText`/`generateStructured`만 사용** — 새 SDK(OpenAI/Gemini 직접 호출) 추가 금지.
4. **새 ORM, 새 vector DB, 새 job queue, 새 search engine, 새 rate-limit 라이브러리를 추가하지 않는다** — 지금 스택(Postgres/Supabase)으로 해결 가능한지 먼저 확인.
5. **`src/server/ai/`, `src/server/automations/`, `src/server/connectors/`, `src/server/billing/`, `supabase/functions/`, `src/app/`, `src/components/`는 Dev1/Dev2 영역** — interface 연결 목적 외에는 건드리지 않는다.
6. **DB 내부 uuid(`businesses.id` 등)를 public API/widget identifier로 그대로 노출하지 않는다** — 별도 컬럼(`public_widget_id`) 발급.
7. **UI 컴포넌트 안에 DB 쿼리/AI 호출을 직접 넣지 않는다** — 항상 Server Action 또는 `src/server/` 함수를 거친다.
8. **secret/API key/service-role key를 코드에 하드코딩하거나 커밋하지 않는다** — `.env.local`만 사용.
9. **비슷한 기능이 이미 있는지 먼저 검색한다** — 예: FAQ 읽기는 이미 `src/server/customer-support/faq.ts`의 `listPublishedFaqs()`가 있으니 중복 함수 만들지 않기.
10. **파일을 너무 잘게도, 너무 크게도 쪼개지 않는다** — 기존 파일 크기/구조 감각을 따라간다.

## 7. 바이브 코딩 실전 워크플로우 제안

AI 코딩 툴(Codex 등)에게 티켓 하나를 시킬 때 프롬프트에 이렇게 포함시키는 것을 권장:

```
docs/dev3/IMPLEMENTATION_GUIDE.md의 "#N [티켓명]" 섹션을 참고해서 구현해줘.
- 기존 파일: [해당 티켓의 "수정/생성할 파일" 목록]
- 반드시 지킬 것: 기존 migration 수정 금지(다음 번호 0016~), RLS 필수,
  AIProvider(src/server/ai)만 사용, src/server/ai|automations|connectors|billing,
  supabase/functions, src/app, src/components는 건드리지 않기
- 완료 기준: [해당 티켓의 "완료 기준" 체크리스트]
```

그다음 **직접 확인**(AI 결과를 그대로 신뢰하지 말고):
- `npm run lint && npm run typecheck && npm run test && npm run build` 통과하는지
- RLS 정책이 실제로 걸려 있는지 (새 테이블 migration 파일 열어서 `enable row level security` 확인)
- Dev1/Dev2 영역 파일이 diff에 섞이지 않았는지 (`git status`/`git diff` 확인)
- `docs/dev3/IMPLEMENTATION_GUIDE.md`의 "자주 하는 실수" 목록과 결과물을 대조

## 8. 지금 당장 첫 스텝

1. `git pull origin main` → `npm install` → `.env.local`(`.env.example` 복사, `AI_PROVIDER=mock`) → `npm run dev`로 로컬 확인.
2. `docs/dev3/IMPLEMENTATION_GUIDE.md`의 `#7`(가벼움) → `#3`(taxonomy 결정) → `#1`(GitHub 수집기) 순서로 시작.
3. AI에게 시킬 때는 위 7장의 프롬프트 템플릿 + 해당 티켓 섹션 전체를 붙여넣기.
