# 티켓 1-9: 캘린더 개선 B — 실행·UX 안정화 (조사 단계, 아직 수정 안 함)

## 티켓 원문

> 1-9 [P1][IMPLEMENTABLE] 캘린더 개선 B: 실행·UX 안정화
>
> 담당 부분: 캘린더 사용 흐름의 날짜·월 이동·상태·반응형 문제를 검증하고 고쳐요.
>
> 해야 할 일: 로컬에서 직접 실행해 확인하고 문제를 고쳐요.
> - 월 이동(?month=)과 사업체 전환 시 선택 유지
> - KST 날짜 경계(자정 전후 "오늘" 판정)
> - 한 날짜에 여러 항목과 건너뛰기·삭제 같은 상태 변경 UI의 유무
> - 로딩/오류 화면, 모바일·태블릿 레이아웃
> - 생성된 항목이 블로그/숏폼으로 이어지는 흐름과 완료 상태 반영
>
> 구현 방법: 로컬 Supabase에서 시나리오를 직접 실행하고, 발견한 문제만 티켓 안에서 수정하며
> 수정마다 테스트를 추가해요. 건너뛰기·삭제 서버 액션이 없으면 기존 RLS update/delete 정책을
> 활용해 최소한으로 추가해요.
>
> 완료 조건: 위 목록 각각에 대해 재현 → 수정 → 테스트를 정리한 체크리스트가 PR에 있고 모두
> 통과해요.
>
> 주의/의존성: 1-8 이후.

## 이번 작업의 규칙 (사람1 지시)
- 1-8에서 바꾼 부분(`validateGeneratedPlan`, 진단 연동)은 다시 건드리지 않는다.
- `triggerRunNow`(`automations/actions.ts`)는 건드리지 않는다.
- KST 자정 경계는 기준 시각을 주입해서 23:59 / 00:00 / 00:01 KST 세 지점을 테스트한다.
- 건너뛰기·삭제 서버 액션을 추가하기 전에 기존 RLS update/delete 정책이 실제로 소유자만
  허용하는지 로컬 DB에서 먼저 확인한다.
- 지금 단계는 조사만 — 사람1의 재현 확인 전에는 코드를 수정하지 않는다.

---

## 항목별 조사 결과

### 1. 월 이동(`?month=`)과 사업체 전환 시 선택 유지

**코드**: `src/app/(app)/calendar/page.tsx`의 `calendarHref(month, businessId)`,
`shiftMonth(year, month, amount)`, `parseMonth(value)`. 이전/다음 달 링크와 사업체 선택
링크 모두 `calendarHref`를 통해 "현재 month + 현재 business"를 같이 실어 보낸다.

**직접 확인함(curl, 브라우저 불필요)**:
- `/calendar?month=2026-11&business=<id>`에서 이전 달 링크 → `/calendar?month=2026-10&business=<id>`, 다음 달 링크 → `/calendar?month=2026-12&business=<id>` — **사업체 id가 정확히 유지됨**.
- 연도 경계: `month=2026-12`의 다음 달 → `2027-01`, `month=2027-01`의 이전 달 → `2026-12` — **정상**.

**결론**: 재현된 버그 없음. 로컬엔 사업체가 1개뿐이라 "사업체 전환 시 월 유지"는 똑같은
`calendarHref` 로직을 타므로 코드상 안전하다고 판단하지만, 실제 버튼 클릭으로 2개 이상의
사업체를 오갈 때 시각적으로 확인하고 싶다면 아래 "브라우저 확인" 2번 참고.

**사소한 결함 후보(원문 5개 항목엔 없음, 참고만)**: `?business=` 값이 내 사업체 목록에
없으면(삭제됐거나 잘못된 링크) `selectedBusiness`가 조용히 첫 번째 사업체로 바뀌고 URL도
안내도 없음. 심각하지 않아서 고치려면 별도로 알려주세요.

### 2. KST 날짜 경계(자정 전후 "오늘" 판정)

**코드**: `page.tsx`의 `currentKstDate()`/`currentKstMonth()` — `Intl.DateTimeFormat`에
`timeZone: "Asia/Seoul"`을 명시해서 포맷하므로, 서버의 로컬 타임존이 UTC든 뭐든 상관없이
항상 KST 기준으로 연/월/일을 계산한다(수동 `+9시간` 산술이 아니라 IANA 타임존 DB를 사용).

**검증(추론 + 원칙 확인, 브라우저 불필요)**: KST 자정은 UTC 15:00(전날)과 같다.
- UTC 14:59 → KST 23:59(그 날) → `currentKstDate()`가 그 날짜를 반환해야 함
- UTC 15:00 → KST 00:00(다음 날) → 날짜가 바로 넘어가야 함
- UTC 15:01 → KST 00:01(다음 날) → 넘어간 날짜 유지

`Intl.DateTimeFormat`이 하는 일이 정확히 이 변환이라 로직 자체는 맞다고 판단합니다.

**진짜 문제**: `currentKstDate()`/`currentKstMonth()`가 내부에서 `new Date()`를 직접
호출해서, **기준 시각을 주입할 수 없어 단위 테스트가 불가능**합니다. `AGENT_RULES.md`의
"현재 시각은 테스트에서 고정할 수 있게 주입한다" 규칙과 어긋나고, 티켓이 명시적으로 요구한
"기준 시각 주입으로 23:59/00:00/00:01 테스트"를 지금 코드로는 쓸 수 없습니다.

**제안(수정 승인 전에는 안 함)**: 이 두 함수(+ `parseMonth`/`shiftMonth`/`calendarHref`)를
순수 함수로 뽑아서 `now?: Date` 매개변수를 받게 하고, 새 테스트 파일에서 위 3개 경계
시각(UTC로 표현)을 주입해 테스트. 로직 버그가 아니라 "지금은 맞는데 테스트로 보장이 안 됨"
상태라, 1-9의 "재현된 버그"로 칠지 "테스트 보강"으로 칠지는 사람1 판단이 필요합니다 — 둘 중
어느 쪽이든 실제 수정 방향은 같습니다(추출 + 테스트).

### 3. 한 날짜에 여러 항목 + 건너뛰기·삭제 UI

**건너뛰기/삭제 UI 자체가 없음 — 확인됨(코드 읽기)**: `CalendarItemDialog`
(`src/components/marketing/calendar-item-dialog.tsx`)엔 "이 콘텐츠 만들기"/"만든 결과
보기" 버튼만 있고, `src/app/(app)/calendar/actions.ts`에도 `triggerCalendarItemNow` 하나뿐
— 건너뛰기(`SKIPPED`)나 삭제를 호출하는 경로가 전혀 없습니다.

**RLS 사전 확인 — 실제 로컬 DB에서 직접 테스트함(브라우저 불필요)**: 캘린더 항목 하나를
만들고, PostgREST가 쓰는 것과 같은 방식(`set role authenticated; set request.jwt.claims`)으로
소유자가 아닌 사용자로 흉내 내서 UPDATE/DELETE를 시도했습니다.

| 시도 | 결과 |
|---|---|
| 다른 사용자가 UPDATE(status 변경) | `UPDATE 0` — 차단됨 |
| 다른 사용자가 DELETE | `DELETE 0` — 차단됨 |
| 실제 소유자가 UPDATE | `UPDATE 1` — 성공 |
| 실제 소유자가 DELETE | `DELETE 1` — 성공, 행 사라짐 |

**결론**: `calendar_items_update_own`/`calendar_items_delete_own` 정책(0030)이 실제로
소유자만 허용합니다. 새 migration 없이 이 정책에 기대어 건너뛰기/삭제 Server Action을
추가해도 안전합니다.

**"하루에 여러 항목" — 실제 버그 재현함(curl, 브라우저 불필요)**: 2026-10-20에 블로그
항목 5개를 심고 `/calendar?month=2026-10`을 직접 렌더링해서 확인:
- **데스크톱 그리드**(`xl:block`, 1280px 이상): `items.slice(0, 3)`이라 3개만 보이고,
  나머지는 클릭도 안 되는 평범한 텍스트 `+2개 더 있어요`로만 표시 — **4번째/5번째 항목을
  데스크톱 화면에서는 아예 열어볼 방법이 없음**(펼치기, "더보기" 링크, 가로 스크롤 전혀 없음).
- **모바일/태블릿 리스트**(`xl:hidden`, 1280px 미만): 같은 날의 5개 항목이 전부, 잘림 없이
  나옴.

이건 명백한 재현된 버그입니다 — 데스크톱 폭에서 하루 4개 이상 계획하면 일부가 영구히
숨겨집니다.

### 4. 로딩/오류 화면, 모바일·태블릿 레이아웃

**로딩/오류 — 코드 확인, 구조적 문제 없음**: `calendar/loading.tsx`/`calendar/error.tsx`
모두 다른 라우트와 똑같이 공용 `PageLoading`/`ErrorState` 컴포넌트를 그대로 쓰고 있어
패턴이 일관적입니다. 실제로 로딩 스켈레톤이 뜨는 순간이나 에러 화면 전환은 서버 렌더링
결과만으론 "눈으로 보는" 확인이 어려워서 브라우저 확인이 필요합니다(아래 4번).

**반응형 분기 기준 — 의심되는 부분**: 데스크톱 그리드 ↔ 모바일 리스트 전환 기준이
`xl:`(1280px)입니다. 흔한 태블릿 폭(아이패드 세로 768px, 가로 1024px, 아이패드 프로
1194~1366px)의 상당수가 "모바일 리스트" 쪽으로 분류됩니다. 의도적인 선택인지, 그리드가
태블릿 가로 모드에서도 보여야 하는지는 시각적 판단이 필요해서 사람1 확인 요청합니다(아래
1번).

### 5. 생성 → 블로그/숏폼 흐름과 완료 상태 반영

**코드 추적(수정 없이 읽기만 함)**:
`CalendarItemDialog.handleGenerate()` → `triggerCalendarItemNow`(`calendar/actions.ts`,
수정 가능 영역) → `resolveAutomationId` → `triggerRunNow`(`automations/actions.ts`, **건드리지
않음**) → `runAutomationNow`(`runner.ts`) → 성공 시 `runner.ts` 자체의 `linkCalendarItem()`과
`triggerCalendarItemNow`의 수동 update가 **둘 다** `status: "GENERATED"`,
`automation_id`, `content_history_id`를 같은 `.eq("status","PLANNED")` 조건으로 갱신
(먼저 실행되는 쪽이 적용되고, 나머지는 조건이 더 이상 안 맞아 조용히 no-op — 충돌 아님).

**DB에서 확인함**: `automation_templates`에 `blog-marketing`/`shorts` 둘 다 있고,
`AUTOMATION_AVAILABILITY`도 둘 다 `AVAILABLE` — 두 경로 모두 실제로 도달 가능.

**한계(당시)**: Next.js Server Action은 내부 프로토콜(해시된 액션 id)을 써서 curl로 직접
호출하기 어려워, 실제 클릭 확인이 필요하다고 적었던 부분입니다.

**업데이트 — 실제로 문제가 있었음, 수정 완료**: 1-9 정리 중 데모 사업체의
`automation_runs`에서 19분째 `RUNNING`으로 멈춘 블로그 실행 1건을 발견했습니다. 원인은
`blog.ts`의 outline→섹션→품질검사 파이프라인이 **항상** 1번째 호출에서 `deferred`로
끝나는 설계(mock 여부와 무관)인데, 이어서 진행시키는 두 경로(cron 틱, 또는
`/automations/{id}` 결과 페이지에 있는 `<RunProgress>` 폴링) 중 어느 쪽에도 캘린더
트리거가 연결돼 있지 않았던 것 — `CalendarItemDialog.handleGenerate()`가 성공 토스트만
띄우고 다이얼로그를 닫을 뿐, 결과 페이지로 보내지 않았습니다. 상세 원인은
`docs/person1/NOTE_FOR_DEV1_stuck_blog_run.md` 참고.

이건 1-9 항목 5(생성→완료 상태 반영)에 정확히 해당해서 **캘린더 쪽(사람1 영역)에서
고쳤습니다**: `triggerCalendarItemNow`(calendar/actions.ts)가 `automationId`를 결과에
포함하고, `CalendarItemDialog`가 `pending`이면 "진행 상황 보기" 액션 토스트로
`/automations/{automationId}`에 보내 기존 `<RunProgress>`가 즉시 이어서 진행하게 함
(`5273a21`). `triggerRunNow`/`runner.ts`/`blog.ts`/cron 라우트는 전부 미수정. "로컬에
cron 체인이 없어서 아무도 결과 페이지를 안 열면 영원히 멈추는" 부분만 Dev1 전달 사항으로
남김(cron/자동화 코드 영역).

---

## 직접 확인한 것 (브라우저 불필요, 전부 완료)
- [x] RLS: `calendar_items_update_own`/`calendar_items_delete_own`이 실제로 소유자만 허용(실제 JWT claim으로 로컬 DB에서 테스트)
- [x] 월 이동 시 `?business=` 파라미터가 그대로 유지됨(curl + href 추출)
- [x] 연도 경계 월 이동(2026-12 ↔ 2027-01) 정상
- [x] 하루 5개 항목 시드 → 데스크톱 그리드는 3개+안내문구만, 모바일 리스트는 5개 전부 — 재현됨
- [x] `automation_templates`/`AUTOMATION_AVAILABILITY`에 blog-marketing/shorts 둘 다 있어 생성 흐름이 도달 가능함을 확인
- [x] KST 날짜 로직 자체는 `Intl.DateTimeFormat`을 쓰므로 맞다고 판단되나, 기준 시각 주입이 안 되어 테스트 불가능함을 확인

## 브라우저가 필요한 것 (사람1이 직접 확인) — **생략하기로 결정함**

사람1 지시로 브라우저 확인은 생략하고, 이미 확인된(curl/DB/코드 추적) 항목만 수정했습니다.
아래 내용은 생략 전 작성한 원래 안내로, 나중에 필요하면 그대로 쓸 수 있어 남겨둡니다.

### 환경은 이미 준비해 뒀습니다
- 로컬 Supabase는 이미 떠 있고, `.env.local`을 로컬 Supabase 값으로 **임시로** 바꿔
  두었습니다(원래는 placeholder였음 — 확인 끝나면 알려주시면 원래대로 복구하겠습니다).
- 개발 서버가 이미 `http://localhost:3000`에서 백그라운드로 떠 있습니다(`npm run dev`).
  꺼져 있다면 그냥 다시 `npm run dev`.
- 로그인: `user@autobiz.local` / `User1234!`
- 사업체: "데모 사업체(성장 리포트용)" — 1-7 작업 때 만든 것, 그대로 재사용
- 테스트 데이터를 일부 남겨 뒀습니다(확인 후 지워도 되고, 알려주시면 제가 지우겠습니다 —
  RLS로 본인 소유만 지울 수 있다는 걸 이미 확인했으니 삭제해도 안전합니다):
  - `2026-10-20`에 블로그 항목 5개("항목 1"~"항목 5") — 3번 항목(여러 개) 확인용

### 1. 반응형 레이아웃 (항목 3, 4)
1. `http://localhost:3000/calendar?month=2026-10&business=516512f0-03db-42c9-bc33-87c96e3ece0a` 접속
2. 브라우저 창을 1280px 이상으로 넓혀서 10월 20일 칸을 보세요 — 항목이 3개만 보이고
   "+2개 더 있어요"라는 글자만 있고 클릭이 안 되는지 확인해주세요(지금 제가 재현한 버그).
3. 창을 1280px 아래로(또는 개발자 도구 반응형 모드에서 태블릿 폭 768px, 1024px) 줄여서
   같은 날짜의 리스트 뷰에 5개가 다 보이는지 확인해주세요.
4. 태블릿 가로 폭(1024px 근처)에서 리스트 뷰가 보이는 게 괜찮은지, 아니면 그리드가
   보여야 할지 의견 주세요 — 이게 "xl: 기준이 너무 높다"를 고칠지 말지 결정합니다.

### 2. 생성 → 완료 상태 반영 (항목 5)
1. 같은 사업체로 "계획 만들기"를 눌러 2주 계획을 하나 만들어보세요(AI_PROVIDER=mock이라
   실제 비용 없음).
2. 블로그 항목 하나를 열어 "이 콘텐츠 만들기"를 눌러보세요.
3. 성공 토스트가 뜨고 다이얼로그가 닫힌 뒤, 그 항목의 배지가 "제작 완료"로 바뀌고 "만든
   결과 보기" 버튼이 나오는지 확인해주세요.
4. (선택, 더 오래 걸림) 유튜브 쇼츠 항목에서도 같이 확인해보시면 좋습니다.

### 3. 월 이동/사업체 전환 (항목 1, 선택)
- 제가 curl로는 확인했지만, 실제 클릭으로 이전/다음 달 버튼을 눌러보고 주소창의
  `business=`가 계속 같은지 한 번 봐주시면 더 확실합니다. 사업체가 1개뿐이라 "사업체
  전환"까지는 로컬에서 보기 어렵습니다(2개째 등록하면 가능).

### 4. 로딩/오류 화면 (항목 4)
- 개발자 도구 Network 탭에서 느린 3G로 쓰로틀링하고 `/calendar` 새로고침 — 스켈레톤
  로딩 화면(`PageLoading`)이 잠깐이라도 보이는지, 자리 배치가 실제 화면과 비슷한지 확인.
- 에러 화면은 임의로 유발하기 어려워서(의도적으로 DB 연결을 끊어야 함) 급하지 않으면
  생략해도 됩니다.

---

## 재현 → 수정 → 테스트 체크리스트 (PR용)

브라우저 확인은 사람1 요청으로 생략하고, 이미 확인된(curl/DB/코드 추적) 항목만 수정했습니다.

| # | 항목 | 재현 | 수정 | 테스트 |
|---|---|---|---|---|
| 1 | 월 이동/사업체 전환 파라미터 유지 | 재현 안 됨(curl로 정상 확인) | 불필요 | 불필요 |
| 2 | KST 자정 경계 | 로직은 원래부터 맞음(Intl + 명시적 Asia/Seoul) — 기준 시각 주입이 안 되어 **테스트가 불가능**했던 게 진짜 문제 | **완료** — `currentKstDate()`를 `src/app/(app)/calendar/kst-date.ts`로 추출, `now?: Date` 매개변수 추가(`76d9fff`) | **완료** — 23:59/00:00/00:01 KST 경계 + 비경계 지점 + 기본값 동작 총 5개 테스트(`kst-date.test.ts`), 전부 통과(버그 아님을 재확인) |
| 3-a | 건너뛰기/삭제 UI 없음 | 코드상 확인됨(기능 자체가 없었음), RLS는 로컬 DB에서 실제 JWT claim으로 사전 확인(소유자만 UPDATE/DELETE 허용) | **완료** — migration 없이 `skipCalendarItem`/`unskipCalendarItem`(건너뛰기, 되돌리기 가능)/`deleteCalendarItem`(확인 다이얼로그 뒤에서 실행) 추가(`b4ba715`) | **완료** — `actions.test.ts`에 로그인 필요/상태 전이 실패/DB 에러 포함 12개 테스트 추가, 기존 4개 포함 총 16개 통과 |
| 3-b | 하루 4개+ 항목이 데스크톱에서 일부 안 보임 | **재현됨**(curl로 직접 확인: 5개 심었을 때 그리드는 3개+텍스트만, 리스트 뷰는 5개 전부) | **완료** — `CalendarDayItemsDialog` 추가: "+N개 더 있어요"를 그날 전체 항목을 보여주는 다이얼로그로 전환(`5de137b`) | 이 컴포넌트는 순수 UI 트리거라 서버 로직 테스트 대상이 없음(이 저장소 관례상 `.tsx` 렌더 테스트 없음) — typecheck/lint로 커버 |
| 4-a | 로딩/오류 화면 | 코드상 이상 없음(다른 라우트와 같은 공용 컴포넌트) | **수정 안 함** — 사람1 지시로 이번엔 보류. **코드상 정상, 브라우저 미확인** | — |
| 4-b | 반응형 분기(`xl:` 기준이 태블릿엔 너무 높음) | 의심됨(1280px 기준이 아이패드 가로 1024px보다 큼) | **수정 안 함** — 사람1 지시로 이번엔 보류. **코드상 정상(의도적 설계일 수 있음), 브라우저 미확인** | — |
| 5 | 생성 → 완료 상태 반영 | **추가로 재현됨**: 즉시 끝나는 실행은 DB로 정상 확인됐지만, 블로그 생성은 `blog.ts`의 outline→섹션→품질검사 파이프라인 설계상 **항상 1번째 호출에서 deferred로 끝남**(mock 여부와 무관) — 이어서 진행시키는 cron 틱/`<RunProgress>` 중 어느 쪽에도 캘린더 트리거 경로가 연결돼 있지 않아, 실제로 19분째 `RUNNING`으로 멈춘 실행 1건을 발견함(`docs/person1/NOTE_FOR_DEV1_stuck_blog_run.md`에 상세 기록) | **완료** — `triggerCalendarItemNow`(calendar/actions.ts)가 `automationId`를 결과에 포함하도록 수정, `CalendarItemDialog`가 `pending`일 때 "진행 상황 보기" 토스트 액션으로 `/automations/{automationId}`에 보내 기존 `<RunProgress>`가 즉시 이어서 진행하게 함(`5273a21`). `triggerRunNow`/`runner.ts`/`blog.ts`/cron 라우트는 전부 미수정. 로컬에 cron 체인이 없어서 "아무도 결과 페이지를 안 열면 로컬에서 영원히 멈춤" 자체는 Dev1 전달 사항으로 남김 | `actions.test.ts`에 `automationId`가 pending/완료 결과 양쪽에 포함되는지 테스트 2개 추가, 기존 포함 총 18개 통과. 토스트 분기 자체는 `.tsx` 렌더 테스트 관례가 없어 typecheck/lint로 커버 |

## 변경 요약 (PR 본문용)
- `fix(calendar): make "+N개 더 있어요" open a dialog with all of that day's items` (`5de137b`)
- `feat(calendar): add skip/unskip/delete for calendar items (no migration)` (`b4ba715`)
- `test(calendar): make the KST midnight boundary testable with an injectable now` (`76d9fff`)
- `docs(person1): note for Dev1 — stuck blog automation run investigation` (`3aae210`)
- `fix(calendar): link deferred generation to its result page (ticket 1-9)` (`5273a21`)
- 4-a, 4-b번은 이번 범위에서 코드 변경 없음 — 표에 이유 기록함. 5번은 캘린더 쪽 추가 버그를
  발견해서 수정함(위 참고), 로컬 cron 안전망 부재는 Dev1 전달 사항(`NOTE_FOR_DEV1_stuck_blog_run.md`).
