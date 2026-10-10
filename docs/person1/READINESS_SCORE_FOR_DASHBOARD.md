# 마케팅 준비 점수 함수 (사람 2용 메모)

티켓 1-5에서 `/marketing/diagnosis`에 있던 "마케팅 준비 점수" 계산을
`src/server/marketing/readiness.ts`의 `getReadinessScore(business, userId)`로 빼냈습니다.
점수 산식은 그대로이고, 화면(`/diagnosis` 상단의 `ReadinessScoreCard`)만 옮긴 것이라
기존에 `/dashboard`에서 보여주던 것과 겹치는 내용이 있다면 이 함수를 가져다 쓰면 중복 계산 없이
같은 점수를 보여줄 수 있어요.

```ts
import { getReadinessScore } from "@/server/marketing/readiness";

const result = await getReadinessScore(business, user.id);
// result.score: number (0~100)
// result.rows: 항목별 { key, label, ready, detail, href, cta, todo, points, max }
// result.nextTodo: 아직 안 된 항목 중 첫 번째 (전부 완료면 null)
```

- `business`는 `businesses` 테이블 Row 전체(`Business` 타입)를 그대로 넘기면 됩니다.
- Server Component/Server Action에서만 호출하세요(`"server-only"` + RLS가 걸린 `createClient()`를
  내부에서 씁니다).
- 이미 렌더링된 카드 UI가 필요하면 `src/components/marketing/readiness-score-card.tsx`의
  `ReadinessScoreCard`를 그대로 가져다 써도 됩니다(`{ businessName, result }`만 받음, 내부에서
  DB 조회 없음).
- 강제로 통합하지는 않았습니다 — `/dashboard/page.tsx`는 사람 2 영역이라 건드리지 않았어요.
  필요 없으면 무시해도 됩니다.
