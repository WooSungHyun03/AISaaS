# 티켓 1-7: 성장 리포트 개편 + 차트 — 계획

## 티켓 원문

> 1-7 [P0][IMPLEMENTABLE] 성장 리포트 개편 + 차트
>
> 담당 부분: 성장 리포트를 채널별 실제 변화 중심으로 바꾸는 작업이에요. 기존 내부 기록(콘텐츠 수·성공률 등) 리포트는 보조 섹션으로 유지해요.
>
> 해야 할 일: 채널 선택, 기간(7일/30일/3개월), 현재 값, 이전 기간 대비 변화, 추이 그래프, 콘텐츠 활동량, AI 해석·추천을 보여줘요.
>
> 구현 방법:
> - 기존 growth-report.ts의 출처 태그(INTERNAL, EXTERNAL_VERIFIED, UNAVAILABLE)와 순수 함수 구조를 확장하고 스냅샷에서 기간별 시계열을 만들어요.
> - 의존성 없는 SVG 라인 차트 컴포넌트를 새로 만들고 접근성(요약 텍스트)을 갖춰요.
> - AI는 계산된 변화량(예: "+38명")만 입력으로 받아 해석과 제안을 쓰고, 입력에 없는 증감 수치는 후검증으로 제거해요. 스냅샷이 2개 미만이면 "수집 중" 상태를 보여줘요.
>
> 완료 조건: 시드 데이터로 3개 기간 그래프와 증감이 맞게 나와요. 네이버·티스토리에는 방문자·조회수 같은 지표를 절대 보여주지 않아요. 지어낸 수치가 걸러지는 테스트가 있어요.
>
> 주의/의존성: 1-6 필요.

## 기존 코드 조사 결과 (재사용 지점)

- `getGrowthSummary(businessId, {days, now})` — `src/server/channels/summary.ts`. 1-1 문서(`docs/person1/CHANNEL_DASHBOARD_API.md`)와 시그니처 일치 확인됨. **이번 작업에서 시그니처/동작 안 바꿈.**
- `latestBefore(rows, beforeMs)` — summary.ts 내부 비공개 헬퍼. "기간 경계 시점 **이하**의 가장 최근 값"이 이미 구현된 빈칸 처리 규칙. **export해서 재사용**(새로 안 만듦).
- `deltaPercent(current, previous)` — previous가 `null`이거나 `0`이면 `null` 반환 — "비교 불가" 요구사항을 이미 만족. 확인만 하고 그대로 둠.
- `src/server/marketing/growth-report.ts` — `MetricSource`(INTERNAL/EXTERNAL_VERIFIED/ESTIMATED/UNAVAILABLE) + 순수 함수 `buildGrowthReport`. 그대로 두고 페이지에서 보조 섹션으로 유지.
- `scripts/seed-growth-demo.sql` + `snapshot-source.ts`의 `MARKETING_METRIC_SNAPSHOTS_DB_SOURCES` — `DEMO_SEED`가 1-6에서 이미 준비됨. 지금 96일치라 "90일 vs 이전 90일" 비교 확인이 안 됨 → 190일치로 확장.
- `raw-metrics.ts`(1-5)의 `toSnapshotMetricsRecord` — 실제로 스냅샷에 쓰는 지표: youtube(`viewCount`,`videoCount`,`subscriberCount`), tistory(`postCount`), naver_blog(`matchedPostCount`,`postsLast30Days`). 네이버/티스토리엔 조회수·방문자 키 자체가 없음 — 그래도 구조적 허용 목록으로 한 번 더 막음.
- `src/server/shared/ai-number-guard.ts`(1-5) — `stripUnverifiedNumbers`/`buildAllowedNumbers` 그대로 재사용.
- `src/components/marketing/score-ring.tsx` — 의존성 없는 SVG(`viewBox`) 선례. 라인 차트도 같은 방식.
- `youtube-types.ts`의 `hiddenSubscriberCount: boolean`, `subscriberCount: number | null` — 구독자 숨김 채널은 `raw-metrics.ts`가 `subscriberCount` 키 자체를 스냅샷에 안 남김(존재 자체가 없음). 화면에서는 "측정 불가(null)"로 보여주고 차트에서 빼야 하므로, 지표 목록을 "그 채널에 실제로 있는 지표"가 아니라 "그 플랫폼에서 보여줄 수 있는 지표 전체 목록" 기준으로 순회해야 함(없으면 null 슬롯).

## 확정된 결정 사항

1. **AI 해석 호출 시점**: 페이지 로드마다 AI를 부르지 않는다. **같은 채널+같은 기간(7/30/90)+같은 날(KST)이면 캐시 재사용**, 없으면 새로 생성해서 저장. 새 테이블 `channel_growth_narratives`(migration 0042) — `channel_diagnoses`/`channel_diagnosis_attempts`와 같은 "insert-only, 최신 행 선택" 패턴(RLS는 select/insert own만, update/delete 없음 — 같은 날 재생성해도 새 행을 추가 insert하고 조회 시 그날 가장 최근 행 하나만 씀. upsert가 아니므로 update 정책이 필요 없음).
2. **데모 시드**: `scripts/seed-growth-demo.sql`을 190일치로 확장(보관 기간 200일 이내), 재실행해도 안전(같은 채널+같은 날 upsert, 기존 로직 그대로).
3. **비교 불가 처리**: `deltaPercent`는 이미 previous가 null/0이면 null — 그대로 재사용. 절대 변화량(`current - previous`)은 둘 다 값이 있을 때만 계산하는 새 필드(`absoluteDelta: number | null`)를 growth-series 쪼개서 추가(기존 `getGrowthSummary`의 `ChannelMetricTrend`엔 added 안 함 — 1-1 문서 시그니처 보존).
4. **유튜브 구독자 숨김**: 지표 목록을 "플랫폼별 허용 지표 전체"로 고정 순회 → 숨김/데이터 없음이면 `current: null, previous: null, series: []`로 표시, 차트에선 자동 제외(그릴 포인트가 없음).
5. **차트 범위**: 선택한 기간(`days`)만 그래프로 그림(2배로 안 늘림). 이전 기간 대비는 숫자 비교로만 표시.
6. **AI 해석 빈도**: 채널당 1번(지표마다 따로 안 부름) — 그 채널의 모든 지표 변화량을 한 번에 입력으로 줌.
7. **콘텐츠 활동량**: 새로 계산 안 하고 기존 `buildGrowthReport`의 `report.contentCount`(같은 기간)를 채널 섹션에서도 재사용.

## 파일 계획

| 파일 | 작업 |
|---|---|
| `scripts/seed-growth-demo.sql` | 96일 → 190일로 확장, 재실행 안전 확인 |
| `src/server/channels/summary.ts` | `latestBefore` export (이름 유지, 동작/시그니처 불변) |
| `src/server/channels/growth-series.ts` | 신규 — 플랫폼별 허용 지표 목록 + 시계열 빌더(`latestBefore` 재사용) + DEMO_SEED 포함 플래그 + "수집 중"(스냅샷 2개 미만) + `absoluteDelta` |
| `supabase/migrations/0042_channel_growth_narratives.sql` | 신규 — 캐시 테이블 + RLS(select/insert own) |
| `src/server/channels/growth-narrative.ts` | 신규 — 캐시 조회/저장 + AI 해석(채널당 1번, `ai-number-guard` 재사용, 실패 시 규칙 기반 대체) |
| `src/components/channels/growth-line-chart.tsx` | 신규 — 의존성 없는 반응형 SVG 라인 차트, sr-only 요약, 0/1개 데이터 처리 |
| `src/app/(app)/growth-report/page.tsx` | 수정 — 채널 선택 + 기간 탭(기존 유지) + 채널별 현재값/변화/차트/콘텐츠 활동량/AI 해석, 기존 내부 리포트는 보조 섹션으로 그대로 유지 |
| `src/server/channels/index.ts` | export 추가 |
| 테스트 | `growth-series.test.ts`, `growth-narrative.test.ts`(캐시 재사용/신규 생성/숫자 후검증), 차트의 좌표 변환 순수 함수 테스트 |

## 진행 단계

- [x] **1단계** — `scripts/seed-growth-demo.sql` 190일 확장(youtube/naver_blog/tistory 채널 각 1개,
  네이버·티스토리엔 조회수류 없음). 로컬에서 두 번 실행해 확인: DEMO_SEED 950행(190일×5지표) 그대로,
  채널 중복 생성 없음(멱등성 확인됨). 데모 business_id는 로컬 DB에 남겨둠(6단계 브라우저 확인용).
- [ ] **2단계** — `growth-series.ts`(허용 지표 목록, 시계열, DEMO_SEED, 수집 중, absoluteDelta, 구독자 숨김 null 처리) + 테스트, `summary.ts`의 `latestBefore` export
- [ ] **3단계** — migration 0042 + `growth-narrative.ts`(캐시 + AI + ai-number-guard 재사용) + 테스트
- [ ] **4단계** — `growth-line-chart.tsx`(의존성 없음, 반응형, sr-only, 0/1개 처리) + 좌표 변환 테스트
- [ ] **5단계** — `/growth-report` 페이지 개편 + `index.ts` export
- [ ] **6단계** — `supabase db reset` + 시드 적용 → 7/30/90일 증감이 시드 데이터와 맞는지 직접 확인 → lint/typecheck/test/build → git status → 브라우저 체크리스트 전달 (push는 사람1이 직접)

## 기본 규칙 (AGENT_RULES.md 상속)

기존 migration 수정 금지, 새 테이블 RLS 필수, AI는 `src/server/ai`만 사용 + `ai-number-guard` 후검증, 새 npm 패키지 금지, 테스트에서 실제 네트워크 호출 금지, 지어낸 수치 금지, 샘플/데모 데이터 구분 표시, 사람2 영역 미수정, stash 미수정, push는 사람1.
