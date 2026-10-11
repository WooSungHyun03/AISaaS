# Dev1에게: 티켓 1-10 — YouTube Analytics용 OAuth 스코프 추가 요청

티켓 1-10(YouTube OAuth 연결 고급 Analytics)의 사람1 쪽(`src/server/channels/`)은
완료했습니다. `src/server/connectors/youtube/*`는 Dev1 영역이라 **전혀 건드리지
않았고**, 이 문서에 정리한 부분만 Dev1 쪽에서 채워주시면 전체 기능이 완성됩니다.
자세한 설계/결정 배경은 `docs/person1/PLAN_1-10.md` 참고하세요.

## 사람1 쪽에 이미 준비된 것

- `src/server/channels/providers/youtube-analytics-types.ts` — `YouTubeAnalyticsCollector`
  타입(함수 시그니처)과 `YouTubeAnalyticsDailyMetrics`(날짜 + `estimatedMinutesWatched` +
  `averageViewDuration`, "노출" 필드는 없음 — API에 해당 지표가 없어서 뺐습니다).
- `src/server/channels/providers/youtube-analytics-mock.ts` + `getYouTubeAnalyticsCollector()`
  (`providers/index.ts`) — `CHANNEL_DATA_PROVIDER=mock`일 때만 mock 구현을 돌려주고,
  `=live`일 때는 **`null`을 돌려줍니다**(실제 구현이 아직 없으니 호출 자체를 막는
  용도 — 에러를 던지지 않음).
- `src/server/channels/youtube-analytics-scope.ts` — `hasYouTubeAnalyticsScope(connection)`:
  `connection.metadata.scope`(Dev1의 `completeYouTubeOAuth`가 이미 저장하는 값)에
  `yt-analytics.readonly`가 포함되는지 확인하는 함수. Dev1 쪽 화면(설정 등)에서도
  재사용 가능합니다.
- `src/server/channels/youtube-analytics-pipeline.ts` — 연결 상태/스코프를 확인해서
  `yt_analytics.*` 네임스페이스로 스냅샷을 저장하는 파이프라인. `processDueChannels`/
  `collectChannelNow` 두 곳에 이미 연결됨.
- `src/server/channels/growth-series.ts` — 연결+스코프가 있는 YouTube 채널에만
  `yt_analytics.*` 지표를 성장 리포트에 노출(`source: "EXTERNAL_VERIFIED"`).

## Dev1이 해줘야 할 일

### 1. OAuth 스코프 추가

`src/server/connectors/youtube/oauth.ts`의 `YOUTUBE_UPLOAD_SCOPE` 단일 상수를 쓰는
자리(`buildYouTubeAuthorizationUrl`)를 아래처럼 스코프 목록으로 바꿔주세요.

```ts
const YOUTUBE_SCOPES = [
  YOUTUBE_UPLOAD_SCOPE,
  "https://www.googleapis.com/auth/yt-analytics.readonly",
].join(" ");
```

그리고 `buildYouTubeAuthorizationUrl`이 `scope` 파라미터에 이 값을 쓰게 해주세요.
(`include_granted_scopes=true`, `prompt=consent`는 이미 있어서 안 바꿔도 됩니다 —
바로 아래 재동의 흐름에서 이게 왜 중요한지 설명합니다.)

### 2. 이미 연결된 사용자의 재동의 흐름 — 별도 UI 불필요

기존 연결 사용자는 토큰에 `yt-analytics.readonly`가 없는 상태입니다(스코프 추가 전에
동의했으니까요). 하지만 `buildYouTubeAuthorizationUrl`이 이미 `include_granted_scopes=true`
+ `prompt=consent`를 쓰고 있어서(기존 코드, 확인했습니다), **지금 있는 "YouTube
연결하기" 버튼을 다시 누르기만 하면** 업로드 스코프를 유지한 채 Analytics 스코프까지
포함한 새 리프레시 토큰을 받습니다. 그 사이엔 기존 리프레시 토큰이 업로드 기능에
계속 쓰이므로 끊기지 않습니다 — 별도의 "재연결" 버튼/플로우를 새로 만들 필요는
없다고 판단했습니다.

화면 어딘가(설정 등)에 "Analytics를 쓰려면 다시 연결해주세요" 안내를 붙이고 싶다면
`hasYouTubeAnalyticsScope(connection)`(사람1이 만든 함수, 위 참고)를 그대로 가져다
쓰면 됩니다 — `connection.status === 'CONNECTED' && !hasYouTubeAnalyticsScope(connection)`
이면 재동의가 필요한 상태입니다.

### 3. 실제 Analytics 호출 구현

`src/server/connectors/youtube/`에 새 함수를 만들어서(기존 `refreshYouTubeAccessToken`
재사용) `https://youtubeanalytics.googleapis.com/v2/reports`를 호출하고, 사람1이
정의한 시그니처에 맞게 결과를 변환해주세요.

**구현해야 할 인터페이스** (`src/server/channels/providers/youtube-analytics-types.ts`):
```ts
export type YouTubeAnalyticsCollector = (params: {
  userId: string;
  businessId: string;
  externalId: string;
  now: Date;
}) => Promise<YouTubeAnalyticsDailyMetrics[]>;

export interface YouTubeAnalyticsDailyMetrics {
  date: string; // YYYY-MM-DD, API가 돌려주는 실제 날짜(dimensions=day) — "오늘"로 덮어쓰지 말 것
  estimatedMinutesWatched: number;
  averageViewDuration: number;
}
```

참고 쿼리(공식 문서):
```
GET https://youtubeanalytics.googleapis.com/v2/reports?
  ids=channel==MINE&startDate=...&endDate=...&
  metrics=estimatedMinutesWatched,averageViewDuration&
  dimensions=day&sort=day
```

- 날짜는 API가 돌려주는 `day` 값 그대로 쓰세요. Analytics는 48~72시간 처리 지연이
  있어서(공식 문서 2026-09 갱신), "오늘" 날짜로 저장하면 안 됩니다 — `recorded_at`을
  데이터 자체의 날짜로 upsert하는 전제로 사람1 쪽 파이프라인을 짜 놨습니다.
- 토큰 값은 절대 로그/에러 메시지에 남기지 마세요(기존 `ConnectorError` 패턴 그대로).
- 완성되면 `src/server/channels/providers/index.ts`의 `getYouTubeAnalyticsCollector()`
  함수의 `live` 분기(`return null;`인 부분)에 한 줄만 연결해주시면 됩니다. 그 파일은
  사람1 영역이지만 이 한 줄은 Dev1이 직접 바꾸셔도 되고, 사람1에게 요청하셔도 됩니다.

## 연결 해제 후 데이터 처리 (확인해주세요)

연결을 해제(`disconnectConnection()`)하면 **그 다음 수집부터 자동으로 멈춥니다**
(사람1 쪽 파이프라인이 매번 `connection.status === 'CONNECTED'`를 확인하므로 —
Dev1 쪽 코드를 전혀 바꾸지 않아도 이미 동작합니다, 테스트로 확인함).

**해제 전까지 쌓인 `yt_analytics.*` 데이터는 보존되지만, 화면(성장 리포트)에는
더 표시되지 않습니다.** (`getChannelGrowthSeries`가 연결이 끊기면 그 지표를 목록에서
빼버리기 때문 — DB에서 지우지는 않습니다.) 다른 모든 스냅샷과 같은 보존 정책
(`cleanupOldSnapshots`, 200일)을 따라 자동으로 정리됩니다. 필요하면 나중에
"연결 해제 즉시 삭제" 정책을 별도 티켓으로 추가할 수 있습니다 — 지금은 추가하지
않았습니다(영역을 넘는 조율이 필요해서 사람1 단독으로 결정하지 않음).

## 질문/확인하고 싶은 것

- 위 1/2/3 작업량에 동의하시는지, 아니면 다른 방식(예: 별도 재연결 플로우)을
  선호하시는지 알려주세요.
- Analytics 호출 구현을 Dev1이 직접 `providers/index.ts`에 연결하실지, 사람1에게
  맡기실지도 편하신 쪽으로 알려주세요.
