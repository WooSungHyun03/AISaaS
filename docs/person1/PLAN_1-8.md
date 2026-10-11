# 티켓 1-8: 캘린더 개선 A — 생성 검증 복구 + 채널 정리 + 진단 연동

## 티켓 원문

> 1-8 [P1][IMPLEMENTABLE] 캘린더 개선 A: 생성 검증 복구 + 채널 정리 + 진단 연동
>
> 담당 부분: 캘린더 생성이 실제 AI 응답에서 실패하기 쉬운 구조와 새 채널 구성에 맞지 않는
> 부분을 고쳐요.
>
> 해야 할 일: 코드를 읽고 찾은 문제를 해결해요(실제 모델로 재현은 아직 못 했어요).
> - 계획 중 날짜가 범위를 벗어나거나 (날짜+채널)이 겹치거나 개수가 적으면 계획 전체를
>   거부해요.
> - 플랫폼 구분에 인스타 릴스가 있는데 생성이 불가능한 "막다른 항목"이고 새 방향(블로그·
>   유튜브)과도 맞지 않아요.
> - 생성이 옛 홈페이지 진단 존재 여부에 묶여 있어요.
>
> 구현 방법:
> - `validateGeneratedPlan`을 "범위 밖은 제외, 중복은 병합, 최소 개수만 확인"으로 바꾸고
>   제외 개수를 사용자에게 알려줘요.
> - 응답 스키마·프롬프트에서 `instagram_reels`를 제거해요. `calendar_items.platform` 체크
>   제약 변경은 0036으로 추가하되 기존 릴스 행은 보존해요.
> - 최신 `channel_diagnoses` 요약과 프로필을 컨텍스트로 쓰도록 `getLatestDiagnosis`를 바꾸고,
>   진단이 없어도 프로필 기반으로 만들 수 있게 `DIAGNOSIS_REQUIRED`를 안내만 하고 허용해요.
>
> 완료 조건: 날짜 범위 밖·중복·부족 개수를 섞은 모킹 응답도 가능한 항목만 저장해요. 릴스
> 항목이 새로 생기지 않아요. 진단 연동 테스트가 통과해요.
>
> 주의/의존성: 1-5(요약 함수) 필요. `calendar/*`만 수정하고 `triggerRunNow`
> (`automations/actions.ts`)는 건드리지 마세요.

## 확정된 결정 사항 (사람1 승인)

1. **migration 없음 — 티켓 원문과 다른 선택, 이유를 명시함.** 티켓 원문은 "`calendar_items.platform`
   체크 제약 변경은 0036으로 추가하되 기존 릴스 행은 보존"하라고 적어뒀지만, 이번 구현은
   **migration을 만들지 않는다.** `check (platform in ('blog','instagram_reels','youtube_shorts'))`
   (0030)를 `check (platform in ('blog','youtube_shorts'))`로 좁히는 migration은, 기존에
   `instagram_reels` 값을 가진 행이 하나라도 남아 있는 한 그 migration 적용 자체가 실패한다
   (`alter table ... add constraint`는 기존 행까지 전부 재검사하므로). "기존 행 보존"과
   "새로 못 만들게"를 **같은 제약으로** 동시에 만족시킬 방법이 없고, `NOT VALID` 제약(아래 B안)도
   영구히 미검증 상태로 남아 다음에 `VALIDATE CONSTRAINT`를 돌리면 또 같은 이유로 실패하는
   반쪽짜리 방어라서 보류했다.

   대신 생성 스키마(`calendarPlanItemSchema`, zod)만 `z.enum(["blog","youtube_shorts"])`로
   좁혀서, `calendar_items`에 새 행을 쓰는 유일한 앱 경로(`generateCalendarPlan`, 아래
   "insert 경로 확인" 참고)를 통과한 값에는 `instagram_reels`가 절대 나올 수 없게 만든다.
   "DB는 더 허용 / 앱 enum은 더 엄격"인 선례가 이미 이 저장소에 있다 —
   `marketing_metric_snapshots.source`가 DB는 `DEMO_SEED`까지 허용하지만 앱의
   `channelSnapshotSourceSchema`(zod)는 의도적으로 그 값을 거부하고, `snapshot-source.test.ts`가
   그 간극 자체를 테스트로 문서화한다(0038 migration 주석 참고). 같은 패턴을
   `calendar.test.ts`에도 추가해 문서화한다.

   **팀장 공유용 한 줄 요약**: "인스타 릴스 신규 생성은 앱 코드(zod)에서 막았고, DB 체크
   제약은 기존 릴스 기록이 남아 있어 그대로 유지했습니다(제약을 좁히는 migration은 기존 행
   때문에 적용이 실패함) — 1-6의 DEMO_SEED 때와 같은 'DB는 넓게 허용, 앱은 좁게 차단'
   패턴입니다."

   **B안(참고, 선택 안 함)**: 기존 제약을 drop하고 `check (...) not valid`로 재추가하면 기존
   행은 검사하지 않고 신규 insert/update부터 DB가 강제한다 — DB 레벨 이중 방어가 꼭 필요하면
   나중에 이 옵션으로 전환 가능. 이번엔 앱 레벨(zod) 차단 + 아래 "insert 경로 확인"으로
   유일한 경로임을 확인했으므로 불필요하다고 판단해 보류.

   **insert 경로 확인 (수정 전 점검)**: `calendar_items`에 **insert하는 앱 코드는
   `generateCalendarPlan`(calendar.ts:311) 단 한 곳**. `calendar/actions.ts`의
   `triggerCalendarItemNow`와 `automations/actions.ts`의 두 지점은 모두 기존 행을
   select/update만 하고(status/automation_id/content_history_id 갱신) 새로 insert하지
   않는다. 그래서 zod 스키마 한 곳만 고치면 앱을 통한 새 릴스 행 생성은 전부 막힌다.

   **RLS 직접 호출 위험 (보고만, 수정하지 않음)**: `calendar_items_insert_own` 정책(0030)은
   `business_id` 소유권만 확인하고 `platform`/`topic` 등 컬럼 값에는 제약이 없다. DB 체크
   제약은 여전히 `instagram_reels`를 허용하므로, 사용자가 앱을 거치지 않고 자신의 Supabase
   세션으로 PostgREST에 직접 insert를 호출하면 `platform: "instagram_reels"` 행을 스스로
   만들 수 있다. **위험도: 낮음** — 영향 범위가 본인 소유 `business_id`로 한정되고(RLS가 그
   경계는 지킴), 그렇게 만든 행도 `triggerCalendarItemNow`가 `instagram_reels`를 여전히
   거부해 콘텐츠 생성으로 이어지지 않으며, 결국 레이트리밋/중복검사 같은 앱 로직만 우회해
   자기 캘린더에 쓰레기 행을 쌓는 정도다. 이 성격은 이번 티켓이 만든 문제가 아니라
   "owner 기준 RLS + DB enum만 있고 그 외 컬럼 값 제약이 없는" 이 테이블의 기존 설계
   특성이며, 수정 범위 밖이라 그대로 둔다.

2. **파일 범위**: "calendar/\*"는 캘린더 기능 전체로 해석. 수정 대상 —
   `src/server/marketing/calendar.ts`(+test), `src/app/(app)/calendar/page.tsx`,
   `src/app/(app)/marketing/calendar/actions.ts`(실제 생성 Server Action이 있는 파일),
   필요시 `src/components/marketing/calendar-plan-generator.tsx`. **안 건드림**:
   `automations/actions.ts`(`triggerRunNow` 포함 전체), `calendar/actions.ts`의
   `triggerCalendarItemNow`(이미 릴스를 안전하게 막고 있어 변경 불필요),
   `calendar-item-dialog.tsx`(이미 릴스를 "준비 중"으로 잘 표시하고 있어 변경 불필요 —
   표시가 깨지지 않는지 확인만 함).

## 기존 코드 조사 결과

- `validateGeneratedPlan`(calendar.ts:192)은 현재 범위 밖/중복을 **즉시 throw**(계획 전체
  폐기)하고, 개수 체크도 상한(`weeks*7`)까지 포함. 티켓이 원하는 "제외/병합 후 최소 개수만
  확인"과 다름.
- `getLatestDiagnosis`(calendar.ts:99)는 `marketing_diagnoses` 테이블을 직접 읽고,
  `generateCalendarPlan`은 그 결과가 없으면 `DIAGNOSIS_REQUIRED`로 **하드 블록**
  (calendar.ts:244). `getMarketingCalendarPageData`의 `hasDiagnosis`도 같은 테이블 기준이고,
  `/calendar` 페이지(`page.tsx`)가 이 플래그로 "계획 만들기" 버튼을 `disabled`시킴.
- `src/server/channels`의 `getLatestChannelDiagnosisSummary(businessId)`(1-5)는 이미
  `{businessId, channels: ChannelDiagnosisSummaryItem[], hasAnyData}`를 돌려주고, 각 항목에
  `overallScore/activityScore/consistencyScore/contentScore/findings/recommendations` 등
  이미 정제된 필드만 있음(원문 웹페이지 텍스트 없음) — `getLatestDiagnosis`를 대체할 안전한
  출처.
- `CalendarPlatform` 타입(`"blog"|"instagram_reels"|"youtube_shorts"`, database.types.ts)과
  `calendar-item-dialog.tsx`의 `PLATFORM_LABEL`/`disabledReason`, `growth-report.ts`의
  `PLATFORM_LABEL`은 전부 이미 `instagram_reels`를 안전하게 처리하고 있음(라벨, "준비 중"
  안내) — **이 파일들은 변경 불필요**, 기존 릴스 행이 그대로 잘 보여야 함만 테스트/확인.
- `automations/actions.ts`의 `triggerRunNow`는 확인만 했고 전혀 수정 안 함.

## 설계 상세

### validateGeneratedPlan 재설계
```
반환값: { items: 필터링된 배열, excludedOutOfRange: number, mergedDuplicates: number }
1. 날짜가 startDate~endDate 밖이면 제외(count: excludedOutOfRange)
2. (date, platform) 키가 중복되면 "먼저 나온 것을 남기고" 이후 것은 병합(버림, count: mergedDuplicates)
   — "먼저 나온 것이 이긴다"는 같은 파일의 근접 중복 주제 처리 규칙과 동일한 관례를 재사용
3. 남은 개수가 weeks*2 미만이면 CalendarPlanError("INVALID_AI_RESULT", "...")로 거부
   (상한선 weeks*7 체크는 제거 — calendarPlanSchema가 이미 .max(28)로 상한을 걺)
```
`generateCalendarPlan`은 이 결과의 `items`로 계속 진행(근접 중복 주제 필터링은 그 다음
단계에서 그대로), 반환값에 `excludedOutOfRange`/`mergedDuplicates`를 추가해서
`generateMarketingCalendar`(Server Action)의 성공 메시지에 "범위 밖 N건 제외, 중복 M건
병합"을 덧붙인다.

### instagram_reels 제거
- `calendarPlanItemSchema.platform`: `z.enum(["blog","instagram_reels","youtube_shorts"])` →
  `z.enum(["blog","youtube_shorts"])`.
- `buildCalendarPrompt`의 "platform은 blog, instagram_reels, youtube_shorts 중 하나만" →
  "blog, youtube_shorts 중 하나만"으로 수정.
- `calendar_items.platform` DB 제약/타입은 안 바꿈(위 결정 1).

### 진단 연동
- `getLatestDiagnosis`/`diagnosisSchema`/`DIAGNOSIS_CONTEXT_KEYS`/`diagnosisContext()` 삭제.
- `generateCalendarPlan`: `getLatestChannelDiagnosisSummary(businessId)` 호출 →
  `hasAnyData`이면 각 채널의 `channel/overallScore/findings/recommendations`만 추려 프롬프트에
  포함(`safeContextValue`로 한 번 더 방어), 없으면 그 섹션을 통째로 생략. **`DIAGNOSIS_REQUIRED`
  에러 코드 자체를 제거**(더 이상 던지는 곳이 없음) — 프로필만 있어도 생성 진행.
  - 진단도 없고 프로필도 비어 있는 경우: 새로운 하드 블록을 추가하지 않음. 이미 프롬프트의
    시스템 지시문("모르면 일반적인 주제로 제안하세요")이 빈 프로필을 처리하도록 되어 있어,
    AI가 일반적인 업종 불문 주제로 계획을 만든다. `PROFILE_REQUIRED`(사업체 자체가 없는
    경우)만 기존대로 유지.
- `getMarketingCalendarPageData`: `hasDiagnosis`를 `getLatestChannelDiagnosisSummary(...).hasAnyData`
  기준으로 변경.
- `/calendar/page.tsx`: "계획 만들기" 버튼의 `disabled={!data.hasDiagnosis}` 제거(더 이상
  필수 아님). 안내 문구를 "먼저 진단이 필요해요"(경고/차단 톤) → "채널 진단을 받으면 계획이
  더 정확해져요"(권장 톤, 링크는 `/diagnosis`로 — 1-5에서 바뀐 경로)로 변경. 진단 없을 때의
  빈 상태 설명도 "먼저 받으면 만들 수 있어요" → 조건 없이 "기간을 고르고 만들기를 누르면
  된다"로 변경.

## 테스트 계획
- `calendar.test.ts`에서 새/변경되는 동작:
  - 범위 밖 날짜 섞인 응답 → 그 항목만 제외, 나머지는 저장, `excludedOutOfRange` 값 확인
  - (날짜+채널) 중복 섞인 응답 → 먼저 나온 것만 저장, `mergedDuplicates` 값 확인
  - 범위 밖+중복을 같이 섞어서 필터링 후 최소 개수(weeks\*2) 미만이면 거부
  - `instagram_reels`를 포함한 AI 응답은 zod 파싱 자체가 거부됨(새 릴스 행 없음)
  - 기존 "DIAGNOSIS_REQUIRED" 테스트 제거, 대신: 진단 없이도(채널 진단 summary가
    `hasAnyData:false`) 생성이 진행된다는 테스트 추가
  - 채널 진단 summary의 findings/recommendations가 프롬프트에 포함되고 원문 민감정보는
    안 들어간다는 테스트(기존 "민감정보 안 샘" 테스트를 channel summary 기준으로 갱신)
  - `getMarketingCalendarPageData`의 `hasDiagnosis` 테스트를 channel summary 기준으로 갱신
- `calendar-item-dialog.tsx`/`page.tsx`는 자동 테스트가 없는 영역(.tsx 컴포넌트 테스트 관례
  없음) — 기존 릴스 항목이 깨지지 않는지는 6단계에서 로컬 DB에 릴스 항목을 하나 넣어 직접
  화면으로 확인.

## 진행 단계
- [x] **1단계** — `validateGeneratedPlan` 재설계: 범위 밖 항목 제외(`excludedOutOfRange`),
  (날짜+플랫폼) 중복은 먼저 나온 것이 남고 나머지 병합(`mergedDuplicates`), 남은 개수가
  `weeks*2` 미만이면만 거부(에러 메시지에 실제 남은 개수 포함). 상한선(`weeks*7`) 체크는
  제거 — `calendarPlanSchema.max(28)`가 이미 상한을 걺. `generateCalendarPlan`의 반환값에
  `excludedOutOfRange`/`mergedDuplicates` 추가(기존 `skippedDuplicates`는 근접 주제 필터링
  개수로 의미 유지). 새 테스트 3개(제외 후 저장, 병합 확인, 제외+부족으로 거부) + 기존
  "범위 밖이면 저장 안 함" 테스트가 "제외 후에도 부족해서 거부"로 의미가 바뀐 걸 확인.
  전체 테스트 937개 + typecheck + lint 통과.
- [x] **2단계** — `calendarPlanItemSchema.platform`을 `z.enum(["blog","youtube_shorts"])`로
  좁히고(위 결정 1 그대로), 프롬프트의 "platform은 blog, instagram_reels, youtube_shorts
  중 하나만" 문구도 instagram_reels 삭제. `calendar_items.platform` DB 제약/타입은 안 바꿈.
  테스트를 위해 `calendarPlanSchema`를 export하고(`generateStructured`가 모킹된 테스트
  환경에서는 실제 zod 검증을 안 거치므로, 스키마 자체를 직접 `.safeParse()`로 검증) "릴스는
  거부, blog/youtube_shorts는 허용" 테스트 2개 추가. 기존 테스트 fixture
  (`generatedItems`)에 남아있던 `instagram_reels` 항목도 `youtube_shorts`로 교체(실제로는
  절대 통과할 수 없는 값이 테스트 데이터에 섞여 있던 것 정리). 전체 테스트 939개 +
  typecheck + lint 통과.
- [ ] **3단계** — 진단 연동: `getLatestChannelDiagnosisSummary` 재사용, `DIAGNOSIS_REQUIRED` 제거,
  `hasDiagnosis` 갱신 + 테스트
- [ ] **4단계** — `/calendar/page.tsx` 안내 문구/버튼 활성화 변경, `marketing/calendar/actions.ts`
  성공 메시지에 제외/병합 개수 반영
- [ ] **5단계** — 로컬에서 기존 릴스 `calendar_items` 행을 하나 만들어 `/calendar` 화면에서
  깨지지 않고 보이는지 직접 확인 + lint/typecheck/test/build + git status

## 기본 규칙 (AGENT_RULES.md 상속)
기존 migration 수정 금지(이번엔 migration 자체를 안 만듦), AI는 `src/server/ai`만 사용,
새 npm 패키지 금지, 테스트에서 실제 네트워크 호출 금지, 지어낸 수치 금지,
`automations/actions.ts`의 `triggerRunNow` 미수정, push는 사람1.
