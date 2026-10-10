# 티켓 1-5: 채널 진단 화면·액션 개편 — 계획

이전 세션이 중간에 끊겨서 재시작하며 정리한 계획. 단계가 끝나고 테스트가 통과할 때마다
아래 체크박스를 갱신하고 `ticket 1-5 step N`으로 로컬 커밋한다. push는 사람1이 직접 함.

## 확정된 결정 사항

- 실제 코드는 티켓과 반대로 `/diagnosis`가 `/marketing/diagnosis`로 리다이렉트하는 상태였음.
  이번에 `/diagnosis`를 새 채널 진단 화면으로 만들고, `/marketing/diagnosis`는 `/diagnosis`로
  영구 리다이렉트(308, 쿼리스트링 보존)만 남긴다.
- 마케팅 준비 점수: 점수 계산을 `src/server/marketing/readiness.ts`(`getReadinessScore`)로
  추출하고, `ReadinessScoreCard` 컴포넌트로 분리해 `/diagnosis` 상단에 배치한다. 컴포넌트 안에서
  Supabase 직접 조회 금지, 서버 함수 경유. `/dashboard/page.tsx`는 사람2 담당이라 수정하지 않고,
  `docs/person1/READINESS_SCORE_FOR_DASHBOARD.md`에 사람2 요청 메모를 작성한다.
- 홈페이지 진단은 사업 정보의 "홈페이지로 자동 채우기" 버튼으로 축소(`diagnoseWebsite` 재사용,
  기존 `prefill.ts`의 빈 칸만 채우는 로직 재사용).
- 세 플랫폼 공용 `diagnoseChannel()` 오케스트레이터 + `raw-metrics.ts`(`collectRawChannelMetrics`)로
  수집을 공용화한다. 1-2/1-6 기존 테스트는 그대로 통과해야 한다.
- `content_score`: 새 migration 0040으로 nullable 변경. 티스토리/네이버는 null + findings에 사유,
  화면은 "측정 불가" 표시. `overallScore`는 측정 가능한 항목만 평균(이미 각 채점 함수가 그렇게 함).
  `docs/person1/CHANNEL_DASHBOARD_API.md`의 `contentScore`를 `number | null`로 갱신한다.
- AI 설명(`channel-narrative.ts`) + 숫자 후검증 `src/server/shared/ai-number-guard.ts`
  (`stripUnverifiedNumbers`, 1-7에서도 재사용): 입력에 없는 숫자가 있는 문장은 문장 단위로 제거,
  날짜는 연/월/일로 분해해서 허용. 소수점 보호, 종결부호 없는 한국어 문장, 번호/불릿 목록 처리 +
  테스트. 전부 제거되면 규칙 기반 요약으로 대체. AI 실패해도 규칙 기반 결과는 저장·표시한다.
- 시간당 한도: 새 테이블 `channel_diagnosis_attempts`(migration 0041, RLS select/insert own,
  delete 정책 없음). 캐시 미스로 실제 수집기를 호출하기 직전에 기록(성공/실패 무관), 1시간 캐시
  반환은 기록하지 않는다. business 기준 5회/시간. 1-6의 크론/"지금 수집" 경로는 기록되지 않게 한다.
  오래된 행(1일 이상)은 기록 시 가끔 정리한다.
- 결과 카드에 플랫폼별 한계 안내(네이버 `NAVER_SEARCH_LIMITATION_NOTICE` 재사용, 티스토리 RSS
  관측 기준, mock 샘플 데이터) 빠짐없이 표시.
- 캘린더 생성(`getLatestDiagnosis`가 `marketing_diagnoses`를 읽는 부분)이 깨지지 않는지 확인만
  하고, 캘린더 코드 수정은 1-8 몫.
- `stash@{0}`(메뉴 개편 WIP)은 건드리지 않는다.

### 기본 규칙
기존 migration 수정 금지, 새 테이블 RLS 필수, AI는 `src/server/ai`만 사용, 새 npm 패키지 금지,
테스트에서 실제 네트워크 호출 금지, 다른 사람 영역 파일 수정 필요하면 멈추고 보고.

## 진행 단계

- [x] **1단계** — `ai-number-guard.ts` + 테스트 (11/11 통과)
- [x] **2단계** — `raw-metrics.ts` 추출(`collectRawChannelMetrics`, `toSnapshotMetricsRecord`),
  `diagnose.ts`를 `diagnoseYouTubeChannel` → 세 플랫폼 공용 `diagnoseChannel()`로 일반화,
  `collect-pipeline.ts`도 `raw-metrics.ts` 경유로 리팩터. 티스토리/네이버 스코어링에
  `contentScore: null` + 사유(findings) 추가, `ChannelDiagnosis.contentScore`를
  `number | null`로 변경, `docs/person1/CHANNEL_DASHBOARD_API.md` 갱신.
  **순서 변경**: migration 0040(content_score nullable)을 4단계에서 앞당겨 이 단계에서 같이
  적용함 — null을 insert하려면 DB 제약이 먼저 nullable이어야 해서(0035가 `not null`이었음)
  분리할 수 없었음. `src/types/database.types.ts`의 `content_score` 타입도 함께 갱신.
  채널/스코어링 전체 테스트(135개) + 전체 테스트(879개) + typecheck + lint 통과.
- [x] **3단계** — `channel-narrative.ts`(+ `ai-number-guard` 연동) + `register.ts` + 테스트.

  **register.ts 정의** (이전 세션 계획에서 가져옴, 사람1 확인):
  `src/server/channels/register.ts`의 `registerAndDiagnoseChannel(businessId, url, platformHint?)`:
  1. URL 파싱(1-1의 `url-parser`, 티스토리 커스텀 도메인은 `platformHint` 사용)
  2. `tracked_channels`에 없으면 생성(같은 business+platform+external_id면 중복 생성 안 함 —
     update RLS 정책이 없어서 select-then-insert로 구현, unique violation(23505)이면 재조회)
  3. `diagnoseChannel()` 호출
  4. 첫 스냅샷 저장은 `diagnoseChannel()` 자신의 기존 동작(2단계에서 3플랫폼으로 일반화한
     ticket 1-6 "진단 시 자동 저장")이 그대로 수행 — `register.ts`에서 별도로 호출하지 않음.

  Server Action(`runChannelDiagnosis`, 5단계에서 작성)이 소유권 확인 + 시간당 한도 확인 후
  이 함수를 호출하는 구조. `channel-narrative.ts`의 `buildChannelNarrative(diagnosis, business)`는
  AI가 설명을 쓰고 `ai-number-guard`로 숫자를 검증, 실패/전부 제거 시 규칙 기반 요약으로 대체
  (narrative는 DB에 저장하지 않고 화면 렌더링 시점에 생성 — 이미 저장된 채널 진단 자체는
  AI 단계 성공 여부와 무관하게 그대로 표시됨).

  테스트: `register.test.ts`(8개), `channel-narrative.test.ts`(6개). 전체 테스트 893개 +
  typecheck + lint 통과.
- [x] **4단계** — migration 0041(`channel_diagnosis_attempts`, select/insert own RLS, delete 정책 없음)
  + `src/server/channels/diagnosis-rate-limit.ts`(`recordDiagnosisAttempt`). `diagnoseChannel()`의
  캐시 미스 분기(실제 수집기 호출 직전)에서만 호출 — business 기준 5회/시간, 초과 시
  `DiagnosisRateLimitError`. 1-6의 크론(`processDueChannels`)/"지금 수집"
  (`collectChannelNow`)은 `snapshotChannelMetrics`를 직접 호출하는 별도 경로라 이 체크를
  타지 않음(가드 코드가 아니라 호출 그래프 자체가 분리되어 있어서 자연히 제외됨).
  오래된 행(1일 이상) 정리는 삭제 RLS 정책이 없어서 서비스 롤 클라이언트(`createAdminClient`)로
  "가끔"(10% 확률) 수행, 실패해도 호출자의 진단 요청은 막지 않음(로그만 남김).
  0040은 2단계에서 이미 적용함. 테스트: `diagnosis-rate-limit.test.ts`(7개) +
  `diagnose.test.ts`에 레이트리밋 연동 테스트 2개 추가. 전체 테스트 901개 + typecheck + lint 통과.
- [x] **5단계** — 화면단.
  - `src/server/marketing/readiness.ts`(`getReadinessScore`) + 테스트: 옛 `/marketing/diagnosis`의
    점수 계산을 그대로 추출(산식 안 바꿈). `docs/person1/READINESS_SCORE_FOR_DASHBOARD.md`에
    사람2용 메모 작성(강제 통합은 안 함, `/dashboard/page.tsx` 미수정).
  - `ReadinessScoreCard`(`src/components/marketing/readiness-score-card.tsx`) — 점수 링/체크리스트
    UI, DB 조회 없음, `/diagnosis` 상단에 배치.
  - `/diagnosis/page.tsx`를 새 채널 진단 화면으로 교체: 준비 점수 카드 + `AddChannelForm`(채널
    추가, `addChannel` 액션) + 채널별 `ChannelDiagnosisCard`(점수/완전성·샘플데이터 배지/
    `buildChannelNarrative` AI 설명/`findings` 전부 표시 — 네이버 검색 한계·티스토리 관측 한계·
    콘텐츠 점수 측정 불가 사유가 findings에 이미 들어있어서 따로 하드코딩 안 함/추천 +
    `RediagnoseChannelButton`, `rediagnoseChannel` 액션).
  - `/marketing/diagnosis/page.tsx`를 `permanentRedirect`(308, 쿼리스트링 보존)로 교체 — 기존엔
    반대 방향(`/diagnosis` → `/marketing/diagnosis`)이었던 것을 뒤집음. 리다이렉트 테스트 작성.
  - 홈페이지 진단은 `/business`의 `AutoFillFromWebsiteButton`으로 축소 — `runDiagnosis`(= 기존
    `diagnoseWebsite`) 그대로 재사용, `BusinessFormDialog`의 기존 prefill 로직
    (`mergeBusinessDefault`/`mergeSnsLinks`, prefill.ts) 그대로 재사용. `marketing_diagnoses`에는
    계속 저장되므로 캘린더(`calendar.ts`의 `getLatestDiagnosis`)는 안 깨짐(코드 수정 없음, 확인만).
  - 이제 쓰이는 곳이 없어진 `diagnosis-form.tsx`/`diagnosis-result.tsx` 삭제(죽은 코드).
  - `addChannel`/`rediagnoseChannel` 액션 + 에러 메시지 매핑(`DiagnosisRateLimitError`,
    `ChannelsError`, 플랫폼별 수집기 에러 코드) + 테스트. `runDiagnosis`의 `revalidatePath`를
    더 이상 존재하지 않는 역할의 `/marketing/diagnosis` 대신 `/business`로 변경.
  - 전체 테스트 917개 + typecheck + lint + `next build` 통과.
  - **DB 적용 미확인**: 이 환경에 Docker가 떠 있지 않아 0040/0041이 실제 로컬 DB에 적용되는지는
    6단계에서 Docker 뜨면 `scripts/dev-db.sh reset`으로 확인 필요.
- [ ] **6단계** — `supabase db reset`(0040/0041 적용 확인) → lint/typecheck/test/build →
  `git status` 재확인 → main에 커밋 (push는 사람1이 직접)

## 커밋 규칙

- 각 단계 완료 + 테스트 통과 시마다 로컬 커밋, 메시지에 `ticket 1-5 step N` 표시.
- `docs/PROJECT_OVERVIEW.md`는 이 티켓과 무관한 별도 파일이므로 커밋에 포함하지 않는다.
