# Team Guide

3인 팀 개발을 위한 파일 소유권, 공유 코드 규칙, PR/브랜치 규칙, Codex(vibe coding) 작업 시 주의사항입니다.

## File Ownership

| Dev | 담당 영역 | 주요 경로 |
|---|---|---|
| **Dev1** — AI/Automation/Deployment | LLM, 프롬프트, Automation Runner/Scheduler, 커넥터, 결제 백엔드, 배포/CI | `src/server/ai/`, `src/server/automations/`, `src/server/connectors/`, `src/server/billing/`, `supabase/functions/`, `netlify.toml`, `.env.example` |
| **Dev2** — Frontend/UX | 랜딩, 대시보드, 마켓플레이스, 자동화 설정 마법사, 사업체 프로필 UI, 요금제/결제 UI, 설정, 반응형 | `src/app/`, `src/components/` |
| **Dev3** — Directory/Data/Customer Support | GitHub API, AI 툴 디렉토리, 검색/필터, 카테고리, 자동화 가이드, FAQ, 고객 응대 AI | `src/server/directory/`, `src/server/customer-support/` |

각자 담당 폴더 안에서는 자유롭게 파일을 추가/수정합니다. 다른 사람의 담당 폴더를 수정해야 한다면 먼저 이야기하거나 작은 PR로 분리하세요.

## Shared Code Policy

다음은 세 사람 모두가 참조하는 공유 영역입니다 — **자주 바꾸지 않습니다**:

```
src/types/       공유 타입 (Database, Automation, Business, Subscription, DirectoryTool ...)
src/lib/         Supabase 클라이언트, env, logger, 공용 유틸
supabase/migrations/   DB 스키마
```

새 기능에 타입/인터페이스가 필요하면:

1. `src/types/`에 먼저 타입을 추가한다 (작은 PR).
2. 팀에 공유한다 (Slack/카톡 한 줄이면 충분).
3. 각자 자기 담당 영역에서 그 타입을 사용해 구현한다.

DB 스키마를 바꿔야 한다면 기존 마이그레이션 파일을 고치지 말고 `supabase/migrations/00XX_설명.sql`로 새 파일을 추가하고, `src/types/database.types.ts`를 같이 갱신하세요.

## Branch Strategy

```
main                     항상 실행 가능한 상태 유지
feature/automation-ai    Dev1
feature/frontend         Dev2
feature/directory-cs     Dev3
```

- 몇 주씩 브랜치를 오래 유지하지 않습니다. 작은 단위로 자주 `main`에 merge하세요.
- `main`에 직접 push하지 말고 PR을 거칩니다.
- merge 전 최소한 `npm run lint`와 `npm run build`가 통과해야 합니다.

## PR Rules

- PR 설명에 "무엇을/왜"를 한두 줄로 씁니다.
- 담당 폴더 밖의 파일을 건드렸다면 이유를 설명합니다 (예: 공유 타입 추가).
- UI 변경이면 스크린샷 한 장을 첨부합니다.
- 리뷰어는 최소 1명 — 팀원 중 아무나 괜찮습니다. 3인 팀이므로 빠르게 승인하고, 문제는 다음 PR에서 고쳐도 됩니다.

## Codex(Vibe Coding) 작업 시 주의사항

Codex(또는 다른 AI 코딩 도구)에게 작업을 맡길 때 다음을 지켜주세요 — 이 프로젝트의 구조가 그대로 유지되도록 하기 위한 최소한의 규칙입니다.

1. **먼저 조사한다.** 비슷한 기능이 이미 있는지 (`src/server/`, `src/components/`) 확인하고 새 파일을 만든다.
2. **새 라이브러리를 추가하기 전에** 기존 dependency로 해결 가능한지 확인한다 (`package.json` 확인).
3. **의존성을 최소화한다.** 같은 역할을 하는 라이브러리를 중복 설치하지 않는다.
4. **파일을 너무 크게도, 너무 잘게도 쪼개지 않는다.**
5. **UI 컴포넌트 안에 DB 쿼리/AI API/외부 플랫폼 API를 직접 작성하지 않는다.** 반드시 Server Action 또는 `src/server/`를 거친다.
6. **`.env` 시크릿을 client bundle에 노출하지 않는다.** 서버 전용 값은 `src/lib/env/server.ts`를 거치고, 그 파일이 import하는 `"server-only"` 패키지가 실수를 빌드 타임에 막아준다.
7. **API key/password/service-role key를 커밋하지 않는다.** `.env.local`은 이미 gitignore 되어 있다.
8. **mock과 실제 구현을 구분한다.** `AI_PROVIDER=mock`, `BILLING_PROVIDER=mock`이 기본값이며, 실제 연동은 명시적으로 켜야 한다.
9. **기능 구현 전에 관련 타입/인터페이스부터 확인한다** (`src/types/`, 해당 도메인의 `types.ts`/`provider.ts`).
10. **새 abstraction은 실제로 두 곳 이상에서 필요할 때만 만든다.** 하나의 사용처만 있다면 인라인으로 둔다.

## Local Setup Checklist

- [ ] `npm install`
- [ ] `.env.example` → `.env.local` 복사 후 Supabase 값 채우기
- [ ] `supabase/migrations/*.sql` 적용 (README 참고)
- [ ] `npm run dev`로 로컬 확인
- [ ] `AI_PROVIDER=mock`, `BILLING_PROVIDER=mock`으로 시작 (실제 키 없이 전체 플로우 테스트 가능)
