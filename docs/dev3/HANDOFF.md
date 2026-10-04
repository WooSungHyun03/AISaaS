# Dev3 → Team Handoff

`feature/directory-cs` 브랜치 작업 관련, 팀이 알아야 할 것들을 정리합니다.

## 1. Setup Request(#13)이 main과 중복 구현됨 — main을 기준으로 통합

`origin/main`을 merge하는 과정에서, ticket #13(Setup Request 워크플로우)이 제가 만들기
전에 이미 main에 독립적으로 완전히 구현되어 있는 것을 발견했습니다(스키마 확장, RLS
정책, 서버 함수, 화면까지 전부). 두 구현이 같은 범위를 각자 다르게 설계한 상태로
충돌했습니다.

**해결 방향**: main의 스키마(`setup_requests` 컬럼 확장)·RLS(`setup_requests_cancel_own`)·
화면은 그대로 채택했습니다. 제가 만들었던 별도 버전(`setup-request-status.ts`,
`0023_setup_requests_workflow.sql` 등)은 폐기했습니다. 그 대신 상태 전이 검증 로직만
`src/server/customer-support/setup-request-transitions.ts`라는 새 파일로 분리해
추가했습니다 — main의 스키마/RLS 위에 얇게 얹히는 형태입니다.

- `canTransition()`: 추상적인 상태 머신 전체(REQUESTED→CONTACTED→IN_PROGRESS→COMPLETED,
  각 단계에서 CANCELLED 포함)를 정의합니다. 이건 문서/향후 운영 도구를 위한 참고용 전체
  그림이며, 아래 이유로 이 중 일부만 실제로 이 함수를 통해 실행 가능합니다.
- `updateSetupRequestStatus()`: 실제 이 코드로 실행 가능한 건 "자기 요청 취소"뿐입니다
  (`CONTACTED→IN_PROGRESS`, `IN_PROGRESS→COMPLETED` 등은 애플리케이션 코드 경로 자체가
  없고, 운영자가 Supabase Studio에서 service-role로 직접 바꿉니다 —
  `docs/dev3/SETUP_REQUESTS_OPERATIONS.md` 참고).

이전 티켓 진행 중 제가 만들었던 `docs/dev3/SETUP_REQUESTS_OPERATIONS.md`도 main의 실제
정책 이름/구조에 맞춰 다시 썼습니다.

## 2. main에 마이그레이션 번호 `0018`이 두 번 쓰였습니다 (수정하지 않음)

`0018_scheduler_cron_auth.sql`과 `0018_setup_request_funnel.sql`이 둘 다 main에
존재합니다(각각 서로 다른 목적, 서로 다른 테이블). 두 파일 다 이미 main에 커밋되어 있고
서로 파일명이 다르므로 로컬 적용 자체는 문제없이 되지만, 번호만 보면 중복입니다.

이건 main 쪽 히스토리라 제가 임의로 고치지 않았습니다(마이그레이션 파일은 이미 적용된
것으로 간주하고 새 번호만 추가하는 게 팀 규칙이라, 기존 파일을 건드리는 판단은 만든 사람
쪽에서 하는 게 맞다고 생각합니다). 다만 제 브랜치가 가져온 디렉토리/CS 도메인
마이그레이션 7개는 `0016`~`0022` 번호가 main의 `0016`(`automation_run_source`)/`0017`
(`billing_checkout_sessions`)/`0018`과 겹쳐서, 이번에 `0019`~`0025`로 재배치했습니다:

| 원래 번호 (제 브랜치) | 새 번호 |
|---|---|
| `0016_directory_tools_category_taxonomy.sql` | `0019_directory_tools_category_taxonomy.sql` |
| `0017_directory_tools_search_indexes.sql` | `0020_directory_tools_search_indexes.sql` |
| `0018_directory_tools_status.sql` | `0021_directory_tools_status.sql` |
| `0019_business_faqs.sql` | `0022_business_faqs.sql` |
| `0020_support_widget.sql` | `0023_support_widget.sql` |
| `0021_support_conversations.sql` | `0024_support_conversations.sql` |
| `0022_directory_tools_classification_source.sql` | `0025_directory_tools_classification_source.sql` |

파일 내용은 전혀 바꾸지 않고 이름/번호만 옮겼습니다(각 파일 안에 자기 옛 번호를 참조하는
내용이 없는 것도 확인했습니다).

## 3. 확인 요청: `IN_PROGRESS`부터는 사용자 자기 취소가 불가능한 게 의도된 설계인가요?

main의 `setup_requests_cancel_own` 정책은 `using (status in ('REQUESTED', 'CONTACTED'))`
라서, 요청이 `IN_PROGRESS`로 넘어간 순간부터는 그 요청을 만든 사용자 본인도 더 이상 취소할
수 없습니다(운영자가 Studio에서 직접 바꿔야만 CANCELLED가 됩니다). 예를 들어 "작업 착수는
됐는데 고객이 마음이 바뀐 경우" 같은 실제 시나리오에서 사용자가 스스로 취소 버튼을 눌러도
계속 실패하게 됩니다.

이게 의도된 설계인지(예: 착수 후 취소는 반드시 운영자를 거치게 하려는 정책적 판단) 아니면
단순히 놓친 경계 케이스인지 확인 부탁드립니다. 만약 의도가 아니라면 RLS 정책의 `using` 절에
`IN_PROGRESS`를 추가하고, 그에 맞춰 `setup-request-transitions.ts`의
`USER_CANCELLABLE_FROM` 상수도 함께 넓히면 됩니다(현재는 정확히 RLS와 동일한 경계를
미러링하도록 만들어뒀습니다).

> **해결됨 (2026-10)**: 운영 DB에는 0016~0033이 한 번에 적용되었고(그 전까지 0015에서 멈춰 있었음),
> 중복 번호는 `0018_setup_request_funnel.sql` → `001801_setup_request_funnel.sql` 로 버전만 바꿔 정리했습니다
> (SQL 내용은 동일, 운영에는 이미 적용됨 — `supabase migration repair --status applied 001801`로 기록 맞춤).
> `0027_instagram_marketing_assets_bucket.sql`은 `storage.objects` 소유 권한이 없는 환경(호스티드 CLI,
> 로컬)에서 중단되지 않도록 권한 오류 시 건너뛰게 감쌌습니다(버킷은 public이라 정책 없이도 URL로 읽힙니다).
