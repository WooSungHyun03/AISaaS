# 사람 1 작업 규칙 (AI 코딩 에이전트용)

너는 AutoBiz 프로젝트에서 "사람 1"(채널 진단 · 성장 리포트 · 캘린더 담당)을 돕는 코딩 에이전트다.
스택: Next.js 16(App Router) + TypeScript + Supabase(Postgres/Auth/RLS). ORM 없음.
나는 Spring Boot 배경이고 TypeScript/Next.js/Supabase는 아직 익숙하지 않다.

## 작업 방식
1. 코드를 쓰기 전에 관련 파일을 읽고 비슷한 기능이 이미 있는지 검색한다. 티켓에 "재사용"이라고 적힌 함수는 실제 위치와 시그니처를 확인하고 재사용한다.
2. 큰 티켓은 구현 전에 "변경할 파일 + 할 일 + 설계 결정"을 보여주고 승인을 기다린다.
3. 티켓 설명과 실제 코드가 다르면(함수가 없음, 이름이 다름, 이미 다른 사람이 구현함) 추측하지 말고 먼저 알린다.
4. 설계 판단이 필요하면 선택지와 트레이드오프를 제시한다.
5. 계획이 확정되면 docs/person1/PLAN_<티켓번호>.md에 저장하고, 단계가 끝날 때마다 완료 표시를 업데이트한다.
6. 큰 작업은 단계로 나누고, 테스트가 통과한 단계마다 로컬 커밋한다.
7. 완료 후 변경 요약을 쓰고, 중요한 TypeScript/Next.js 패턴은 Spring Boot에 빗대 짧게 설명한다.

## 절대 규칙
- 기존 supabase/migrations/*.sql은 수정하지 않는다. 새 migration은 작성 직전에 폴더를 확인해 다음 빈 번호로 만든다(티켓에 적힌 번호보다 실제 폴더가 우선).
- 새 테이블에는 enable row level security + 소유자 확인 정책. insert/update에는 with check.
- enum 성격의 값은 DB check constraint + zod enum(as const 배열 단일 소스) + 두 목록 일치 테스트 패턴.
- AI 기능은 src/server/ai의 generateText / generateStructured만 사용한다. AI 출력의 숫자는 src/server/shared/ai-number-guard.ts로 후검증한다.
- 새 npm 패키지를 추가하지 않는다. 필요해 보이면 먼저 물어본다.
- 외부 API 키는 하드코딩하지 않고 src/lib/env 패턴으로 읽는다.
- 테스트에서 실제 네트워크를 호출하지 않는다(실제 API 테스트는 기본 skip).
- 지어낸 수치를 화면에 보여주지 않는다. 샘플/데모 데이터는 화면에서 구분 표시한다.
- 날짜는 KST 기준을 명시하고, "현재 시각"은 테스트에서 고정할 수 있게 주입한다.
- 팀장 몫(pg_cron 등록, 구글 클라우드 설정 등)은 하지 않고 문서로만 남긴다.
- 사람 2 영역(/dashboard 등)이나 다른 사람 영역 파일은 수정하지 않는다. 필요하면 멈추고 보고하고, 요청 메모를 docs/person1/에 남긴다.
- stash에 보관된 작업은 건드리지 않는다.
- git merge --abort, git reset --hard, git push --force, git checkout -- 같은 되돌리기 명령은 승인 없이 실행하지 않는다.

## git
- 커밋은 main에 한다(내 지시). 커밋 메시지에 티켓 번호를 넣고 기존 git log 스타일을 따른다.
- push는 내가 직접 한다. 에이전트는 push하지 않는다.
- docs/PROJECT_OVERVIEW.md는 커밋하지 않는다.

## 완료 조건
- npm run lint && npm run typecheck && npm run test && npm run build 모두 통과
- migration을 추가했다면 로컬 DB reset(scripts/dev-db.sh reset 등)으로 실제 적용 확인. 못 했으면 못 했다고 명확히 보고.
- 완료 보고에 위 결과와 git status를 반드시 포함
- 화면 티켓은 내가 브라우저로 확인할 체크리스트를 같이 준다.

## 진행 현황
- 완료: 1-1, 1-2, 1-3, 1-4, 1-6, 1-5, 1-7
- 남음: 1-8, 1-9, 1-10
- 참고 문서: docs/person1/ 아래 PLAN_1-5.md, PLAN_1-7.md, CHANNEL_DASHBOARD_API.md, MIGRATION_NUMBERING_NOTES.md 등
