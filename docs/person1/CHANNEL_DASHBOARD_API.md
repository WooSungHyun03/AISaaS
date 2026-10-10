# 채널 대시보드 API (사람 2용)

티켓 1-1에서 확정한 두 함수의 시그니처와 반환 타입입니다. 둘 다 `src/server/channels`에서 가져다 씁니다(`import { getLatestChannelDiagnosisSummary, getGrowthSummary } from "@/server/channels"`). 둘 다 Server Component/Server Action에서만 호출하세요(내부에서 `createClient()`로 RLS가 걸린 Supabase 클라이언트를 만듭니다 — 로그인한 사용자 소유의 business가 아니면 자동으로 빈 결과가 됩니다).

둘 다 쿼리가 실패하면 `ChannelsError`(`code: "DATABASE_ERROR"`)를 던집니다. 쿼리는 성공했지만 데이터가 없는 경우(신규 사업, 아직 채널 미등록, 스냅샷 수집 전)는 에러가 아니라 **"데이터 없음" 상태를 가진 정상 객체**를 돌려줍니다 — 아래 `hasAnyData`를 보세요.

## `getLatestChannelDiagnosisSummary(businessId: string): Promise<ChannelDiagnosisSummary>`

사업에 등록된 채널들의 **가장 최근 진단 결과**를 채널당 1개씩 돌려줍니다.

```ts
interface ChannelDiagnosisSummary {
  businessId: string;
  channels: ChannelDiagnosisSummaryItem[]; // 진단이 있는 채널만. 아래 "데이터 없음" 참고
  hasAnyData: boolean;
}

interface ChannelDiagnosisSummaryItem {
  channelId: string;
  externalId: string;     // 예: "@mychannel", "myblogid", "myname"(tistory 서브도메인)
  url: string;
  channel: "youtube" | "naver_blog" | "tistory";
  overallScore: number;      // 0-100
  activityScore: number;     // 0-100
  consistencyScore: number;  // 0-100
  contentScore: number;      // 0-100
  metrics: Record<string, number>;  // 플랫폼마다 키가 다름, 화면에 그대로 찍지 말고 findings/recommendations 위주로 노출 추천
  findings: string[];
  recommendations: string[];
  dataSource: "live" | "mock";
  collectedAt: string;    // ISO timestamp
  completeness: "COMPLETE" | "PARTIAL" | "INSUFFICIENT_DATA";
}
```

**데이터 없음 상태:** `hasAnyData: false`이고 `channels: []`입니다. 이 경우 화면에는 점수/그래프 대신 "아직 진단된 채널이 없어요" 같은 빈 상태 문구를 보여주세요 — `channels`가 빈 배열이라고 해서 점수를 0으로 그리면 안 됩니다(지어낸 수치 금지 규칙).

`completeness: "INSUFFICIENT_DATA"`인 개별 항목이 있을 수 있습니다(채널은 등록됐지만 수집된 지표가 너무 적음) — 이 경우 그 채널의 점수들은 신뢰도가 낮다는 걸 UI에서 표시해주세요(예: "데이터 부족" 배지). `dataSource: "mock"`인 항목은 반드시 데모/샘플 데이터임을 화면에서 구분 표시하세요.

### 예시 응답 (데이터 있음)

```json
{
  "businessId": "b-1",
  "hasAnyData": true,
  "channels": [
    {
      "channelId": "c-1",
      "externalId": "@mychannel",
      "url": "https://youtube.com/@mychannel",
      "channel": "youtube",
      "overallScore": 78,
      "activityScore": 70,
      "consistencyScore": 85,
      "contentScore": 80,
      "metrics": { "subscriberCount": 1200, "uploadsLast28Days": 3 },
      "findings": ["최근 4주간 업로드가 꾸준해요"],
      "recommendations": ["주 2회 업로드 주기를 유지하세요"],
      "dataSource": "mock",
      "collectedAt": "2026-10-10T00:00:00.000Z",
      "completeness": "COMPLETE"
    }
  ]
}
```

### 예시 응답 (데이터 없음)

```json
{ "businessId": "b-2", "hasAnyData": false, "channels": [] }
```

## `getGrowthSummary(businessId: string, options?: { days?: number; now?: Date }): Promise<GrowthSummary>`

채널별·지표별로 **최근 `days`일(기본 7일) vs. 그 이전 `days`일**을 비교합니다. `now`는 테스트에서 "현재 시각"을 고정하기 위한 주입용이고, 화면 코드에서는 생략하면 됩니다.

```ts
interface GrowthSummary {
  businessId: string;
  days: number;
  trends: ChannelMetricTrend[]; // (채널, 지표) 조합마다 1개. 아래 "데이터 없음" 참고
  hasAnyData: boolean;
}

interface ChannelMetricTrend {
  channelId: string;
  platform: "youtube" | "naver_blog" | "tistory";
  metric: string;              // 예: "subscriberCount"
  current: number | null;      // 최근 `days`일 구간의 가장 최신 값. 그 구간에 값이 없으면 null
  previous: number | null;     // 그 이전 `days`일 구간의 가장 최신 값. 없으면 null
  deltaPercent: number | null; // (current-previous)/previous*100, 반올림. previous가 null/0이면 null
}
```

**데이터 없음 상태:** `hasAnyData: false`이고 `trends: []`입니다 (추적 채널이 아예 없거나, 있지만 두 구간 모두에 스냅샷이 없는 경우). `trends`에 항목이 있어도 `previous`가 `null`인 경우가 있을 수 있습니다(막 추적을 시작한 채널) — 이때 `deltaPercent`도 `null`이니, "+N%" 대신 "비교할 이전 데이터 없음" 같은 문구로 표시해주세요. `null`을 0%로 표시하면 안 됩니다.

### 예시 응답 (증가 추세)

```json
{
  "businessId": "b-1",
  "days": 7,
  "hasAnyData": true,
  "trends": [
    { "channelId": "c-1", "platform": "youtube", "metric": "subscriberCount", "current": 1200, "previous": 1100, "deltaPercent": 9 }
  ]
}
```

### 예시 응답 (비교 데이터 없음 — 막 추적 시작한 채널)

```json
{
  "businessId": "b-1",
  "days": 7,
  "hasAnyData": true,
  "trends": [
    { "channelId": "c-2", "platform": "tistory", "metric": "visitorCount", "current": 340, "previous": null, "deltaPercent": null }
  ]
}
```

### 예시 응답 (데이터 없음)

```json
{ "businessId": "b-3", "days": 7, "hasAnyData": false, "trends": [] }
```

## 참고

- 두 함수 모두 `src/server/marketing/growth-report.ts`(콘텐츠/자동화 실행 기반 "성장 리포트" 화면)와는 **별개**입니다. 데이터 소스도, 쓰이는 화면도 다릅니다 — 혼동해서 기존 `/growth-report` 페이지에 이 함수들을 끼워 넣지 마세요.
- `platform`/`completeness`/`dataSource` 값의 실제 허용 목록은 `src/server/channels/platform.ts`, `completeness.ts`, `snapshot-source.ts`가 단일 소스입니다. 화면 쪽에서 별도로 하드코딩하지 말고 이 파일들의 타입을 그대로 import 하세요.
