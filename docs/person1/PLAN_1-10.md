# 티켓 1-10: YouTube OAuth 연결 고급 Analytics — 축소된 계획(사람1 영역만)

## 티켓 원문

> 1-10 [P2][IMPLEMENTABLE_WITH_CONDITIONS] YouTube OAuth 연결 고급 Analytics
>
> 담당 부분: 채널 소유자가 연결하면 시청 지속·노출 같은 비공개 지표를 스냅샷에 더하는 선택
> 기능이에요.
>
> 해야 할 일: 기존 YouTube OAuth(connect/callback)에 yt-analytics.readonly 스코프를 추가하고
> 연결된 채널에만 Analytics 지표를 수집해요.
>
> 구현 방법: 기존 integration_connections 암호화 저장과 loadYouTubeConnector를 재사용해요.
> 공개 지표(1-6)와 별도 이름 공간(yt_analytics.*)으로 저장하고 출처를 EXTERNAL_VERIFIED로
> 표시해요. 로컬은 mock 응답으로 테스트해요.
>
> 완료 조건: mock으로 연결 시 지표가 스냅샷에 쌓이고, 연결 해제 시 수집이 멈춰요.
>
> 주의/의존성: 구글 클라우드 설정은 제가 해요(심사 전이어도 테스트 사용자 100명까지 가능해서
> 학교 프로젝트에는 충분해요). 팀원은 코드와 테스트만 해요.

## 사전 조사 결과 (코드 수정 전 확인, 완료)

### 1. 영역 확인 — `src/server/connectors/youtube/*`는 Dev1 영역

`docs/TEAM_GUIDE.md`/`docs/ARCHITECTURE.md`에 `src/server/connectors/`가 명시적으로 Dev1
소유로 적혀 있음. 스코프 추가(`buildYouTubeAuthorizationUrl`), Analytics용 실제 OAuth 호출
구현, `/api/integrations/youtube/*` 라우트 변경은 전부 Dev1 영역 — **팀 답변을 기다리는
동안 이번 작업에서는 건드리지 않는다.** 대신:
- `src/server/channels/`(사람1 영역)에 **인터페이스 + mock만** 만들고, 실제 OAuth 호출은
  Dev1이 채울 자리로 비워둔다.
- `src/server/connectors/integrations.ts`의 `getConnection`(이미 export된 함수)은 **읽기
  전용으로 호출**만 한다 — 그 파일 자체는 수정하지 않는다.
- Dev1이 해야 할 일은 `docs/person1/REQUEST_FOR_DEV1_youtube_analytics.md`에 정리한다.

### 2. YouTube Analytics API 확인 (developers.google.com, 공식 문서, 2026-09 갱신 반영)

| 티켓 용어 | 실제 지표 | 확인 |
|---|---|---|
| "시청 지속" | `averageViewDuration`(평균 재생 길이, 초), `estimatedMinutesWatched`(총 시청 시간, 분) | ✅ `yt-analytics.readonly` 스코프, Channel reports(`ids=channel==MINE`)로 제공됨 |
| "노출" | — | ❌ **제공되지 않음.** `yt-analytics.readonly`에는 일반적인 노출수 지표가 없음. 있는 건 `annotationImpressions`/`cardImpressions`/`cardTeaserImpressions`(영상 내 주석·카드 기능용, 완전히 다른 것)뿐이고 `adImpressions`는 `yt-analytics-monetary.readonly` + YPP 가입이 필요한 별개 스코프. **이번 범위에서 제외**(사람1 확정) |

샘플 쿼리(공식 문서 그대로):
```
GET https://youtubeanalytics.googleapis.com/v2/reports?
  ids=channel==MINE&startDate=...&endDate=...&
  metrics=views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage&
  dimensions=day&sort=day
```

**데이터 지연**: 공식 문서(2026-09-09 갱신)에 "48~72시간 처리 지연, 완전히 처리된 마지막
날짜로 end-date 자동 절삭"이 명시됨.

### 3. 스냅샷 날짜 설계 (사람1 확정)

**"데이터 기준 날"을 쓴다, "수집한 날"이 아니다.** Analytics 응답의 `dimensions=day`가
돌려주는 실제 날짜를 `recorded_at`으로 써서 그 날짜 행을 upsert한다.
`marketing_metric_snapshots`의 기존 `unique(channel_id, metric, recorded_date)` 제약이
"같은 날 재수집 시 덮어쓰기"를 이미 지원하므로, 지연 때문에 값이 나중에 확정돼도 같은
날짜 행이 최신값으로 자동 갱신된다. **스키마 변경 없음.**

## 설계 확인 사항 (답변)

1. **스코프 누락 감지**: `connect.ts`의 `completeYouTubeOAuth`가 이미 토큰 응답의 `scope`
   문자열을 `metadata.scope`에 저장하고 있음(기존 코드, 안 바꿈) — 새 컬럼 없이
   `connection.metadata.scope`에 `yt-analytics.readonly`가 포함되는지만 확인하면 됨.
   이 확인 함수(`hasYouTubeAnalyticsScope`)는 사람1 영역(`src/server/channels/`)에 만든다.
2. **토큰 갱신/로그 안전**: 수집 파이프라인은 리프레시 토큰을 직접 다루지 않는다
   (Dev1이 구현할 실제 Analytics 커넥터 쪽 책임). 사람1 쪽 코드는 토큰 값을 전혀 보지
   않으므로 로그에 찍힐 수가 없음 — 에러 로그에는 `channelId`/에러 메시지만 남긴다.
3. **수집 연결 지점**: 1-6의 `processDueChannels`(cron)와 `collectChannelNow`("지금
   수집") 두 곳에만 추가로 연결한다. `diagnose.ts`(채널 진단, 시간당 한도 있는 경로)는
   건드리지 않음 — 그래서 `channel_diagnosis_attempts` 한도에 전혀 영향 없음.
4. **ALLOWED_GROWTH_METRICS**: 정적 allow-list에 그냥 추가하면 연결 안 된 채널에도 항목이
   나열됨(값은 null이지만). 대신 `getChannelGrowthSeries()`가 매 호출마다 "이 business의
   youtube 연결이 CONNECTED + yt-analytics.readonly 스코프 보유"인지 확인해서, 그 경우만
   `yt_analytics.*` 지표를 추가로 나열한다.
5. **연결 해제 시 수집 중단**: 파이프라인 쪽 함수가 매번 `connection.status === 'CONNECTED'`를
   확인하므로, `disconnectConnection()`(Dev1 함수, 상태를 `DISCONNECTED`로 바꿈)이 호출된
   다음 수집부터는 자동으로 멈춘다 — 테스트로 확인(아래).
6. **쌓인 Analytics 데이터 보존/삭제 — 선택지 제시**:
   - **(A) 보존(추천)**: 아무 것도 안 함. 다른 모든 스냅샷과 똑같이
     `cleanupOldSnapshots`의 `RETENTION_DAYS`(200일) 지나면 자동 삭제되는 기존 정책을
     그대로 따름. 연결을 다시 하면 그 사이 비어있던 구간만 다시 쌓임.
   - **(B) 연결 해제 즉시 삭제**: `disconnectConnection()`이 호출되는 순간
     `yt_analytics.*` 스냅샷을 전부 지움. 이러려면 Dev1의 `disconnectConnection()`에
     훅을 추가하거나, 연결 해제 UI 쪽(Dev1/Dev2 영역)에서 별도로 내 쪽 삭제 함수를
     호출해야 함 — 영역을 넘는 조율이 필요해서 이번엔 안 함.
   - 사람1 승인 시 (A)로 진행. 나중에 "내 데이터 삭제" 요구가 생기면 (B)를 별도 티켓으로.
7. **enum/migration**: `marketing_metric_snapshots.metric`은 원래 **자유 텍스트라
   check 제약이 없음**(source/platform/status만 제약 있음) — `yt_analytics.*` 문자열을
   추가하는 데 **migration이 필요 없음**. `source`도 기존 `live`/`mock` 그대로 재사용
   (바뀌는 값 없음). **이번 티켓은 migration 0건.**

## 파일 계획 (전부 사람1 영역, `src/server/channels/` 및 그 테스트)

| 파일 | 작업 |
|---|---|
| `src/server/channels/providers/youtube-analytics-types.ts` | 신규 — `YouTubeAnalyticsDailyMetrics`(날짜 + `estimatedMinutesWatched` + `averageViewDuration`), `YouTubeAnalyticsCollector` 함수 시그니처(인터페이스만) |
| `src/server/channels/providers/youtube-analytics-mock.ts` | 신규 — 결정론적 mock 구현(`youtube-mock.ts`와 같은 스타일) |
| `src/server/channels/providers/index.ts` | 수정 — `getYouTubeAnalyticsCollector()` 추가. `live` 분기는 Dev1이 채울 자리(지금은 명확한 에러로 "아직 연결 안 됨"을 알림) |
| `src/server/channels/youtube-analytics-scope.ts` | 신규 — `YOUTUBE_ANALYTICS_SCOPE` 상수 + `hasYouTubeAnalyticsScope(connection)` |
| `src/server/channels/youtube-analytics-pipeline.ts` | 신규 — `collectYouTubeAnalyticsIfConnected(channel, ownerId, now)`: platform≠youtube/연결 없음/CONNECTED 아님/스코프 없음이면 조용히 리턴. 실패는 전부 삼키고 로그만(기존 공개 지표 파이프라인에 절대 영향 없음). `yt_analytics.estimatedMinutesWatched`/`yt_analytics.averageViewDuration`을 데이터 기준 날짜로 upsert |
| `src/server/channels/collect-pipeline.ts` | 수정 — `processDueChannels`가 `snapshotChannelMetrics` 성공 뒤 `collectYouTubeAnalyticsIfConnected` 추가 호출(기존 함수 시그니처/동작 안 바꿈). business 조회에 `owner_id` 추가 |
| `src/server/channels/collect-now.ts` | 수정 — `collectChannelNow`도 동일하게 추가 호출. business 조회에 `owner_id` 추가 |
| `src/server/channels/growth-series.ts` | 수정 — `getChannelGrowthSeries`가 youtube 채널의 business 연결 상태를 한 번 확인해서, 연결+스코프 있을 때만 `yt_analytics.*`를 지표 목록에 추가. 그 항목만 `source: "EXTERNAL_VERIFIED"`(기존 `growth-report.ts`의 `MetricSource` 재사용, 새 타입 안 만듦) 표시 |
| `src/components/channels/channel-growth-card.tsx` | 수정(최소) — `metric.source === "EXTERNAL_VERIFIED"`면 작은 배지 표시(`growth-report.ts`의 `SOURCE_LABEL` 재사용) |
| `src/server/channels/index.ts` | export 추가 |
| `docs/person1/REQUEST_FOR_DEV1_youtube_analytics.md` | 신규 — Dev1에게 요청 |
| `docs/person1/GOOGLE_CLOUD_SETUP_youtube_analytics.md` | 신규 — 팀장에게 요청 |

**`src/server/connectors/integrations.ts`의 `getConnection`을 import해서 읽기 전용으로
호출**(파일 자체는 안 바꿈) — `collect-pipeline.ts`, `collect-now.ts`, `growth-series.ts`
세 곳에서.

## Dev1 요청 문서에 들어갈 내용 (미리 정리)
- `src/server/connectors/youtube/oauth.ts`: `YOUTUBE_UPLOAD_SCOPE` 단일 상수를
  `YOUTUBE_SCOPES = [YOUTUBE_UPLOAD_SCOPE, "https://www.googleapis.com/auth/yt-analytics.readonly"].join(" ")`
  형태로 바꾸고 `buildYouTubeAuthorizationUrl`에서 사용.
- **재동의 흐름 제안**: 별도 UI/버튼 불필요. `buildYouTubeAuthorizationUrl`이 이미
  `include_granted_scopes=true`와 `prompt=consent`를 쓰고 있어서(기존 코드, 확인함),
  기존 사용자가 지금 있는 "YouTube 연결하기" 버튼을 다시 누르기만 하면 업로드+Analytics
  스코프를 모두 가진 새 리프레시 토큰을 받는다. 그 사이엔 기존 리프레시 토큰이 업로드
  기능에 계속 쓰이므로 끊기지 않는다.
- `hasYouTubeAnalyticsScope()`(사람1이 만듦, `src/server/channels/youtube-analytics-scope.ts`)를
  재사용해서, Dev1/Dev2가 원하는 화면(설정 등)에 "Analytics를 쓰려면 다시 연결해주세요"
  안내를 붙일 수 있음.
- 실제 Analytics 호출 구현: `src/server/connectors/youtube/`에 새 함수를 만들어
  (기존 `refreshYouTubeAccessToken` 재사용) `https://youtubeanalytics.googleapis.com/v2/reports`를
  호출하고, 사람1이 정의한 `YouTubeAnalyticsCollector` 시그니처(`src/server/channels/providers/youtube-analytics-types.ts`)에 맞게 결과를 변환.
  완성되면 `src/server/channels/providers/index.ts`의 `getYouTubeAnalyticsCollector()`
  `live` 분기에 한 줄 연결(그 함수는 사람1 파일 — 수정해도 되고, 사람1에게 요청해도 됨).
- 토큰 로그 금지: 기존 `ConnectorError` 패턴처럼 토큰 값을 절대 메시지/로그에 포함하지 않기.
- 날짜: Analytics 응답의 실제 날짜(`dimensions=day`)를 그대로 돌려주기 — "오늘"로
  덮어쓰지 않기(48~72시간 지연 때문).

## 진행 단계
- [x] **1단계** — `youtube-analytics-types.ts`(`YouTubeAnalyticsDailyMetrics`, `YouTubeAnalyticsCollector`
  — "노출" 필드 없음, 확인된 지표만), `youtube-analytics-mock.ts`(결정론적, 48~72시간 지연을
  반영해 최근 3일은 아예 반환 안 함), `providers/index.ts`의 `getYouTubeAnalyticsCollector()`.
  **사람1 추가 요청사항 1번 반영**: `live` 모드에서는 **`null`을 반환**(throw 안 함) — 실제
  구현이 없는 상태에서 호출 자체를 시도하지 않게, mock 값이 운영에 잘못 저장되거나
  "미구현" 에러가 기존 공개 지표 수집까지 끌고 내려가는 걸 원천적으로 막음. 테스트 13개
  (mock 결정론성, 48~72시간 지연 반영, `now` 기준 상대 날짜, `live`→null) 통과.
  전체 테스트 1036개 + typecheck + lint 통과.
- [ ] **2단계** — 스코프 확인 헬퍼(`youtube-analytics-scope.ts`) + 테스트
- [ ] **3단계** — 수집 파이프라인 연결(`youtube-analytics-pipeline.ts` + `collect-pipeline.ts`/`collect-now.ts` 호출 추가) + 테스트(연결 해제 시 중단 포함, 기존 공개 지표 테스트 안 깨짐 확인)
- [ ] **4단계** — 성장 리포트 연결(`growth-series.ts`의 조건부 `ALLOWED_GROWTH_METRICS` + `EXTERNAL_VERIFIED` 표시, `channel-growth-card.tsx` 배지) + 테스트
- [ ] **5단계** — Dev1 요청 문서 + 팀장(구글 클라우드) 문서 작성(코드 없음)
- [ ] **6단계** — 로컬 DB reset(migration 없지만 확인), lint/typecheck/test/build, git status, 브라우저 체크리스트

## 기본 규칙 (AGENT_RULES.md 상속)
Dev1 영역(`src/server/connectors/`) 미수정, 새 migration 없음(확인됨), AI 미사용(해당 없음),
새 npm 패키지 금지, 테스트에서 실제 구글 API 호출 금지(mock만), 지어낸 지표 금지("노출"
제외 확정), push는 사람1.
