# Dev1에게: 로컬에서 블로그 자동화 실행이 RUNNING으로 멈춰 있던 현상

티켓 1-9 작업 중 데모 사업체의 `automation_runs`에 **19분째 `RUNNING`으로 멈춘 행 1건**을
발견해서 정리했습니다(삭제 전 원인만 조사, 자동화 코드는 건드리지 않았습니다 — Dev1 영역).
혹시 실제 운영에서도 비슷한 문의가 들어오면 참고하시라고 남깁니다.

## 무엇이었나
- 템플릿: **`blog-marketing`**(숏폼 아님)
- 트리거 경로: 캘린더 화면에서 "이 콘텐츠 만들기" 클릭 → `calendar/actions.ts`의
  `triggerCalendarItemNow` → `automations/actions.ts`의 `triggerRunNow` →
  `runner.ts`의 `runAutomationNow`
- 결과: `automation_runs.status = 'RUNNING'`에서 멈춘 채 19분 경과(그 사이 다른 블로그
  실행 2건은 정상적으로 `SUCCESS`까지 감).

## 코드 기준 원인 추정

`src/server/automations/handlers/blog.ts`의 `blogAutomationHandler.run()`은 **항상**
개요(outline)만 만들고 바로 `deferred(...)`를 반환합니다(271~287번째 줄) — AI_PROVIDER가
mock이라 빨라도, 설계상 1번째 호출에서 끝나는 경우가 없습니다("개요 → 섹션별 작성 →
품질 검사/재작성" 여러 단계를 나눠서 처리하는 구조, 주석에도 명시돼 있음). 즉 **mock이라서
생긴 느림이 아니라, 이 핸들러의 의도된 동작**입니다.

`deferred` 상태인 실행을 이어서 진행시키는(`resume` 호출) 경로는 두 가지뿐입니다
(`runner.ts`의 `advanceDeferredRun`/`advanceDeferredRuns`):
1. **cron 틱**: `supabase/migrations/0014_scheduler_cron.sql`의 pg_cron이 5분마다
   Supabase Edge Function(`supabase/functions/run-due-automations`)을 깨우고, 그게
   `/api/cron/run-automations`를 호출 → `advanceDeferredRuns` 실행.
2. **"결과 보기" 페이지가 열려 있을 때**: `src/components/automations/run-progress.tsx`의
   `<RunProgress>`가 6초마다 `advanceAutomationRun`을 호출(주석: "Keeps a deferred run
   moving while its result page is open").

**캘린더 다이얼로그에서 생성을 트리거하면 ①로 이동하지도 않고 ②를 마운트하지도 않습니다**
— `CalendarItemDialog.handleGenerate()`는 성공 토스트만 띄우고 다이얼로그를 닫을 뿐,
`/automations/{id}` 같은 결과 페이지로 보내지 않습니다. 그래서 1번째 `deferred` 응답을
받은 뒤로는 ②가 애초에 시작되지 않습니다.

로컬 개발 환경엔 pg_cron이 실제로 틱을 치거나 Edge Function이 로컬 Next 서버를 호출하는
구조가 없어서 ①도 전혀 일어나지 않습니다. 결과적으로 **이 실행을 이어서 진행시킬 방법이
로컬에는 전혀 없었고**, 멈춘 그대로 쌓였던 것입니다.

추가로, "멈춘 실행을 자동으로 정리하는" 유일한 안전장치인 `reapStaleRuns()`
(`src/server/automations/scheduler.ts:88`, deferred 실행은 `STALE_DEFERRED_RUN_MINUTES = 45`분
지나면 FAILED로 돌림)도 **`/api/cron/run-automations` 안에서만** 호출됩니다(같은 라우트,
57번째 줄 근처) — 로컬엔 그 라우트를 깨우는 주체가 없어서 이 안전장치도 같이 무력화됩니다.

## mock 환경 때문인가, 실제로도 생길 수 있는가

| 구분 | 내용 |
|---|---|
| **mock과 무관하게 항상 발생하는 부분** | `run()`이 첫 호출에서 무조건 `deferred`를 반환하는 설계. AI가 실제(openai/gemini)든 mock이든 똑같습니다. |
| **실제 운영에서도 생길 수 있는 부분** | 캘린더 다이얼로그에서 생성을 트리거하면 사용자가 `/automations/{id}` 결과 페이지로 이동하지 않으므로, **cron 틱(최대 5분 간격)이 올 때까지는 해당 사용자 화면 기준으로 "멈춘 것처럼" 보입니다.** cron이 정상 동작한다는 전제하에 결국은 끝까지 진행되긴 하지만(최악의 경우 섹션 수에 따라 여러 번의 5분 틱이 필요할 수 있어 보일 수 있는 지연이 꽤 깁니다), 사용자 입장에선 "캘린더에서 만들기 눌렀는데 계속 PLANNED/대기만 뜬다"는 문의로 들어올 수 있는 경로입니다. |
| **로컬/mock 환경에만 해당하는 부분** | pg_cron·Edge Function 체인이 로컬에는 전혀 없어서, 캘린더에서 트리거한 블로그 실행은 **영원히** 멈춥니다(운영처럼 "5분마다 결국 진행"되는 안전망이 로컬엔 없음). 이번에 제가 본 19분짜리 RUNNING 행이 바로 이 경우입니다. |

## 참고만 드리는 것(제안, 수정 안 함 — Dev1 영역)
- 캘린더에서 트리거한 직후에도 `<RunProgress>`를 어딘가에 마운트해서(예: 성공 토스트 뒤에
  "진행 상황 보기" 링크나, 다이얼로그를 닫지 않고 진행률을 보여주는 식) 최소한 ②번 경로로
  캘린더 트리거 실행도 즉시 이어지게 할 수 있을지 검토해볼 만해 보입니다.
- 로컬 개발 편의용으로, `npm run dev`와 함께 `/api/cron/run-automations`를 주기적으로
  호출해주는 간단한 스크립트(또는 안내 문서)가 있으면 이런 "로컬에서만 영원히 멈춤" 현상을
  미리 발견하기 쉬울 것 같습니다.
- 위 두 가지 모두 제안일 뿐이고, 1-9 범위/Dev1 영역이라 제가 구현하지는 않았습니다.
