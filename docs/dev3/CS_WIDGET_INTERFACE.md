# Customer Support Widget — Dev2 Interface Spec

Dev3가 만든 서버 함수/DB 계약을 한 곳에 정리한 문서. Dev2는 이 문서만 보고 `/widget/[widgetId]` 페이지와 사업자 설정 화면을 붙이면 된다. 실제 UI 컴포넌트, Route Handler 파일(`src/app/**`)은 Dev2/Dev1 영역이라 Dev3가 만들지 않았다.

관련 서버 코드: `src/server/customer-support/widget.ts`, `src/server/customer-support/answer.ts`.

---

## 1. `/widget/[widgetId]` — 임베드 페이지 (신규, Dev2가 만들 것)

**방식**: iframe. 사업자 사이트에 `<iframe src="https://<도메인>/widget/{public_widget_id}">`로 삽입된다. 외부 사이트가 이 페이지를 직접 iframe으로 여는 형태라, 이 페이지 자체는 **인증이 없다** — `public_widget_id`만으로 접근한다.

**페이지가 할 일**:
1. `getWidgetDisplayInfo(admin, widgetId)` (from `@/server/customer-support/widget`) 호출.
2. `null`이면 "위젯을 찾을 수 없습니다" 같은 안내 화면(404 아님 — iframe 안에 그냥 표시할 정도면 충분).
3. `{ businessName }`만 받는다 — 그 외 business 내부 필드(`id`, `owner_id` 등)는 이 함수가 애초에 안 줌. **`getBusinessByWidgetId`라는 함수는 export되어 있지 않다** — 전체 row(owner_id 포함)를 반환해서 공개 페이지에 잘못 쓰면 내부 uuid가 샐 수 있기 때문. 이 페이지에서 필요하면 반드시 `getWidgetDisplayInfo`만 쓸 것.
4. 채팅 UI(질문 입력 → 답변 표시)는 이 페이지의 **클라이언트 컴포넌트**가 아래 `2번` API를 `fetch`로 호출. 같은 출처(same-origin)라 **CORS 설정이 필요 없다**.

**admin client 사용**: `getWidgetDisplayInfo`는 service-role 클라이언트(`createAdminClient()`)가 필요하다(비로그인 페이지라 RLS로 보호 불가 — `#10` 보고서와 동일한 이유).

---

## 2. `POST /api/support/[widgetId]` — 채팅 API (아직 미생성, Dev2/Dev1이 만들 것)

`#10`에서 정리한 스펙 그대로. 로직은 전부 `handleWidgetChatRequest`/`describeWidgetChatError`(`@/server/customer-support/widget`)에 있고, Route Handler는 얇게 호출만 한다.

**요청**:
```
POST /api/support/{widgetId}
Content-Type: application/json

{ "question": "몇 시에 여나요?" }
```

**응답 (200)**:
```json
{ "answer": "평일 오전 9시부터 오후 6시까지입니다.", "isFallback": false }
```

**에러 응답** (`{ "error": string }` + 상태 코드):

| 상황 | HTTP |
|---|---|
| 잘못된 입력(질문 없음/500자 초과) | 400 |
| 존재하지 않는 widgetId | 404 |
| rate limit 초과 | 429 |
| AI 응답 생성 실패 | 503 |
| 예상 못 한 내부 오류 | 500 |

**구현 예시**:
```ts
// src/app/api/support/[widgetId]/route.ts
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { describeWidgetChatError, handleWidgetChatRequest } from "@/server/customer-support/widget";

export async function POST(request: Request, { params }: { params: Promise<{ widgetId: string }> }) {
  const { widgetId } = await params;
  const body = await request.json().catch(() => null);
  const requesterIp = getClientIp(request);

  const outcome = await handleWidgetChatRequest(createAdminClient(), widgetId, body, requesterIp);

  if (outcome.status !== "ok") {
    const { httpStatus, message } = describeWidgetChatError(outcome.status);
    return NextResponse.json({ error: message }, { status: httpStatus });
  }

  return NextResponse.json({ answer: outcome.answer, isFallback: outcome.isFallback });
}

function getClientIp(request: Request): string | null {
  const forwardedFor = request.headers.get("x-forwarded-for");
  return forwardedFor?.split(",")[0]?.trim() ?? null;
}
```

**요청자 IP 헤더**: `x-forwarded-for`의 **첫 번째 값**을 쓴다. 이 프로젝트는 Vercel 배포가 기준(`README.md`)이고, Vercel 엣지 프록시가 함수로 전달하기 직전에 이 헤더를 실제 발신 IP로 덮어쓴다고 알려져 있다(클라이언트가 미리 값을 채워도 엣지 홉 이후엔 신뢰 가능한 값으로 대체됨) — **다만 Vercel 공식 문서로 최신 동작을 한 번 더 확인할 것**(이번 세션에서 실시간 재확인은 못 했음). Docker/자체 호스팅(이 프로젝트의 `Dockerfile`/`compose.yaml` 경로)으로 배포하면 이 가정이 깨지므로, 앞단 리버스 프록시가 이 헤더를 신뢰할 수 있게 설정하는지 별도 확인 필요.

**CORS**: 필요 없음(위 1번 참고 — iframe이 같은 출처에서 호출).

---

## 3. 사업자 설정 화면 — embed 스니펫 보여주기 (Dev2 영역)

사업자가 자기 `public_widget_id`는 RLS(`businesses_select_own`)로 이미 조회 가능하다 — 새 함수 불필요, 기존 business 조회 결과에서 `business.public_widget_id`를 그대로 쓰면 된다.

**보여줄 HTML 스니펫**은 아래 함수로 생성한다(직접 문자열 조립하지 말 것 — width/height/loading/escaping이 이미 처리돼 있음):

```ts
import { clientEnv } from "@/lib/env/client";
import { buildWidgetEmbedSnippet } from "@/server/customer-support/widget";

const snippet = buildWidgetEmbedSnippet(
  clientEnv.NEXT_PUBLIC_SITE_URL,
  business.public_widget_id,
  business.name,
);
// snippet을 <textarea readOnly> 또는 복사 버튼과 함께 보여주면 됨
```

생성되는 형태 예시:
```html
<iframe src="https://autobiz.app/widget/xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" title="OO카페 고객 지원 챗봇" width="380" height="600" loading="lazy" style="border:none;"></iframe>
```

- `title`(사업자 이름 포함)은 HTML 이스케이프 처리됨 — 이름에 `<`, `"`, `'` 등이 있어도 안전.
- 기본 크기는 380×600 — 필요하면 사업자가 자기 사이트 CSS로 덮어써도 되고, 나중에 크기 옵션을 추가하고 싶으면 `buildWidgetEmbedSnippet`에 파라미터를 늘리는 방향으로.

---

## 4. 나중에 전역 보안 헤더를 추가할 때 주의할 점

현재 `next.config.ts`에는 `X-Frame-Options`/CSP `frame-ancestors` 같은 헤더가 **전혀 없다**(직접 확인함). 그래서 지금은 `/widget/[widgetId]`가 별도 설정 없이도 다른 사이트의 iframe에 들어갈 수 있다.

**나중에 로그인 페이지/대시보드에 클릭재킹 방지용 헤더를 전역으로 추가하게 되면, `/widget/[widgetId]` 경로는 반드시 그 정책에서 제외해야 한다** — 안 그러면 이 위젯 기능 자체가 깨진다(iframe에 안 들어가짐). Next.js의 `headers()`(next.config.ts) 또는 미들웨어에서 경로 매칭으로 제외하는 방식을 검토할 것.

---

## 5. `#11` 관련 메모 — 대화 내용 저장 안내 문구

`#11`에서 만든 `support_conversations` 로그가 질문/답변을 저장한다(이메일/전화/IP는 저장 안 함, 단 고객이 질문에 직접 개인정보를 타이핑하면 그 텍스트 자체는 남을 수 있음). **위젯 UI 어딘가에 "상담 품질 개선을 위해 대화 내용이 저장될 수 있습니다" 같은 안내 문구가 필요한지 검토가 필요하다** — 법적/UX 판단이 필요해 Dev2·팀 논의로 남겨둔다.

---

## 6. 향후 과제 (지금 구현 안 함)

**문제**: 지금 구조에서는 `public_widget_id`만 알면 **누구나, 어떤 사이트에서든** 이 위젯을 자기 페이지에 iframe으로 심어 그 사업자의 AI 사용량(비용)을 소모시킬 수 있다. widget id 자체가 추측 불가능한 값이라 무작위로 알아내긴 어렵지만, 한 번 유출되면(예: 페이지 소스 보기) 제3자가 무단으로 재사용할 수 있다.

**향후 검토 방향**: business별로 "이 위젯을 허용할 도메인 목록"을 받아서, `/widget/[widgetId]` 응답에 CSP `frame-ancestors https://사업자도메인.com`을 동적으로 설정 — 등록 안 된 도메인에서의 embed는 브라우저가 아예 렌더링을 거부하게 만드는 방식. 지금은 구현하지 않음(스키마 변경 + 설정 UI 필요 — 별도 티켓으로 다룰 것).
