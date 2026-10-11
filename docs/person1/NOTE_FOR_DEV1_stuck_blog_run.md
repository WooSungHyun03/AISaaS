# Dev1에게: 로컬에서 블로그 자동화 실행이 RUNNING으로 멈춰 있던 현상

티켓 1-9 작업 중 데모 사업체의 `automation_runs`에 **19분째 `RUNNING`으로 멈춘 행 1건**을
발견해서 정리했습니다. 원인 중 "캘린더에서 트리거하면 결과 페이지로 안 보내는 부분"은
1-9 범위(캘린더 쪽)라 사람1이 직접 고쳤습니다 — 아래 표시. 자동화 코드(`blog.ts`,
`runner.ts`, cron 라우트, `triggerRunNow`) 자체는 건드리지 않았고, 로컬에만 있는 cron
안전망 부재는 Dev1 전달 사항으로 남겨둡니다.

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

**(수정 완료 — 사람1 영역)** 원래는 캘린더 다이얼로그에서 생성을 트리거해도 ①로 이동하지도
②를 마운트하지도 않았습니다(`CalendarItemDialog.handleGenerate()`가 성공 토스트만 띄우고
다이얼로그를 닫을 뿐, `/automations/{id}` 결과 페이지로 보내지 않았음). 이건 1-9 항목
"생성된 항목이 블로그/숏폼으로 이어지는 흐름"에 해당해서 캘린더 쪽(사람1 영역)에서 고쳤습니다
(커밋 `5273a21`):
- `triggerCalendarItemNow`(`calendar/actions.ts`)가 이미 있던 `triggerRunNow`의 `pending`
  플래그에 `automationId`를 얹어서 돌려주도록만 바꿈(`triggerRunNow`/`runner.ts`/`blog.ts`/
  cron 라우트는 전부 그대로).
- `CalendarItemDialog`가 `pending`이면 "글을 쓰기 시작했어요..." 토스트에 "진행 상황 보기"
  액션 버튼을 달아서 `/automations/{automationId}`로 보내고, 그 페이지에 이미 있는
  `<RunProgress>`가 즉시 이어서 진행시킵니다(cron 틱을 기다릴 필요 없이 바로 시작).

로컬 개발 환경엔 pg_cron이 실제로 틱을 치거나 Edge Function이 로컬 Next 서버를 호출하는
구조가 없어서 ①은 여전히 전혀 일어나지 않습니다(**이 부분은 Dev1 영역이라 그대로 남음** —
아래 참고).

추가로, "멈춘 실행을 자동으로 정리하는" 유일한 안전장치인 `reapStaleRuns()`
(`src/server/automations/scheduler.ts:88`, deferred 실행은 `STALE_DEFERRED_RUN_MINUTES = 45`분
지나면 FAILED로 돌림)도 **`/api/cron/run-automations` 안에서만** 호출됩니다(같은 라우트,
57번째 줄 근처) — 로컬엔 그 라우트를 깨우는 주체가 없어서 이 안전장치도 같이 무력화됩니다.

## mock 환경 때문인가, 실제로도 생길 수 있는가

| 구분 | 내용 |
|---|---|
| **mock과 무관하게 항상 발생하는 부분** | `run()`이 첫 호출에서 무조건 `deferred`를 반환하는 설계. AI가 실제(openai/gemini)든 mock이든 똑같습니다. |
| **실제 운영에서도 생길 수 있었던 부분(사람1이 수정함)** | 캘린더에서 트리거했을 때 사용자가 결과 페이지로 이동하지 않아 cron 틱(최대 5분)까지 "멈춘 것처럼" 보이던 부분 — 위에서 설명한 캘린더 쪽 수정으로, 이제 토스트의 "진행 상황 보기"를 누르면 즉시 `/automations/{id}`로 이동해 `<RunProgress>`가 바로 이어서 진행시킵니다. (버튼을 안 누르면 여전히 cron 틱까지 기다려야 하는 건 동일 — 그건 cron 자체의 주기 문제라 캘린더 쪽에서 더 손댈 부분은 아니라고 판단했습니다.) |
| **로컬/mock 환경에만 해당하는 부분(Dev1 영역, 그대로 남음)** | pg_cron·Edge Function 체인이 로컬에는 전혀 없어서, `/automations/{id}` 결과 페이지를 아무도 열어보지 않고 다른 데로 가버리면 그 실행은 로컬에서 **영원히** 멈춥니다(운영처럼 "5분마다 결국 진행"되는 안전망이 로컬엔 없음). 이번에 제가 본 19분짜리 RUNNING 행이 이 경우였습니다. |

## Dev1 전달 사항 (제안, 수정 안 함)
- 로컬 개발 편의용으로, `npm run dev`와 함께 `/api/cron/run-automations`를 주기적으로
  호출해주는 간단한 스크립트(또는 안내 문서)가 있으면 "로컬에서만 영원히 멈춤" 현상을
  미리 발견하기 쉬울 것 같습니다 — 캘린더 쪽을 고쳐도 사용자가 결과 페이지를 안 열어보고
  떠나버리는 경로는 여전히 남아있어서, 로컬 안전망 자체가 없다는 점은 그대로입니다.
- 제안일 뿐이고, Dev1 영역이라 구현하지 않았습니다.
