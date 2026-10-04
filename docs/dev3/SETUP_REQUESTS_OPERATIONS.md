# Setup Request Operations (Dev3 ticket #13)

> **2026-09 업데이트**: `main`이 이 티켓과 동일한 범위(Setup Request 상태 전이)를 독립적으로
> 먼저 구현해 merge 시 겹쳤습니다. 스키마/RLS/화면은 전부 `main` 것을 그대로 채택했고,
> `src/server/customer-support/setup-request-transitions.ts`에 상태 전이 로직만 별도로
> 얹었습니다. 아래 내용은 그 최종 상태를 기준으로 다시 씁니다. 자세한 경위는
> `docs/dev3/HANDOFF.md`를 참고하세요.

## 운영자 화면은 없습니다

이 프로젝트엔 "관리자/운영자" 역할이나 화면이 전혀 없습니다(코드베이스 전체 확인 완료 —
`is_staff`/`is_admin` 같은 개념 자체가 없음). `setup_requests.status`를 `REQUESTED` →
`CONTACTED` → `IN_PROGRESS` → `COMPLETED`로 진행시키는 것은 **애플리케이션 코드에 그 경로가
없습니다** — RLS 정책 `setup_requests_cancel_own`(`supabase/migrations/001801_setup_request_funnel.sql`)이
일반 사용자의 자기 요청 수정 권한을 다음 두 가지로 명시적으로 제한하기 때문입니다:

```sql
create policy "setup_requests_cancel_own" on public.setup_requests
  for update
  using (auth.uid() = user_id and status in ('REQUESTED', 'CONTACTED'))
  with check (auth.uid() = user_id and status = 'CANCELLED');
```

- `using`: 자기 행이면서, 현재 상태가 `REQUESTED` 또는 `CONTACTED`일 때만 그 행을 업데이트 후보로
  볼 수 있습니다. `IN_PROGRESS`/`COMPLETED`/`CANCELLED` 상태의 자기 행은 이 정책상 아예 업데이트
  대상이 되지 못합니다.
- `with check`: 업데이트 결과가 `status = 'CANCELLED'`가 아니면 반려됩니다. 즉 사용자가 스스로
  할 수 있는 유일한 상태 변경은 "REQUESTED/CONTACTED → CANCELLED"뿐이고, 그 외 다른 컬럼만
  바꾸거나 다른 상태로 가는 시도는 전부 막힙니다.

`src/server/customer-support/setup-request-transitions.ts`의 `updateSetupRequestStatus()`는
이 RLS 제약을 애플리케이션 레벨에서 미리 반영합니다(`USER_CANCELLABLE_FROM = ["REQUESTED",
"CONTACTED"]`) — `IN_PROGRESS`인 요청을 취소하려 하면 DB까지 가지 않고 그 자리에서
`INVALID_TRANSITION` 에러로 막습니다. 이렇게 하지 않으면 RLS가 조용히 0 rows로 막은 것을
"동시에 다른 사람이 상태를 바꿨다"는 CAS(compare-and-swap) 레이스 에러로 잘못 보고하게 됩니다 —
같은 파일의 `canTransition()`/`USER_CANCELLABLE_FROM` 주석에 이 구분을 자세히 적어뒀습니다.

`CONTACTED → IN_PROGRESS`, `IN_PROGRESS → COMPLETED` 같은, 사용자 취소가 아닌 나머지 전이는
애플리케이션에도 RLS에도 경로가 없습니다 — 아래처럼 운영자가 Supabase Studio에서 service-role로
직접 바꿔야 합니다.

## 운영자가 상태를 바꾸는 방법 — Supabase Studio에서 직접

1. Supabase 대시보드(로컬이면 `http://localhost:54323`) → Table Editor → `setup_requests`.
2. 처리할 요청의 `status` 셀을 직접 수정(`CONTACTED`/`IN_PROGRESS`/`COMPLETED` 중 하나).
3. Table Editor는 프로젝트의 service-role 권한으로 동작하므로 RLS(사용자 스코프 제한)를 완전히
   우회합니다 — 이게 유일하게 이 전이들을 실행할 수 있는 경로입니다.
4. `setup_requests` 테이블 생성 시(`0010_setup_requests.sql`) 걸린 인라인 check 제약
   (`status in ('REQUESTED','CONTACTED','IN_PROGRESS','COMPLETED','CANCELLED')`)은 여전히
   유효하므로 오타/잘못된 값은 DB가 막아줍니다. 정확한 제약 이름은 Postgres가 자동 생성한
   것이라 마이그레이션에 나와 있지 않습니다 — 필요하면 SQL Editor에서 다음으로 확인하세요:
   ```sql
   select conname, pg_get_constraintdef(oid)
   from pg_constraint
   where conrelid = 'public.setup_requests'::regclass and contype = 'c';
   ```

이 방식은 요청량이 적은 지금 규모에 맞춘 임시 방편입니다. 요청이 쌓이기 시작하면 별도 티켓으로
"운영자 역할 + 관리 화면"을 정식으로 논의하는 걸 권장합니다(`IMPLEMENTATION_GUIDE.md` #13 원안의
관리자 처리 방법 비교표 참고). `docs/dev3/HANDOFF.md`에도 "IN_PROGRESS부터는 자기 취소 불가"가
의도된 설계인지 Dev1/Dev2에게 확인을 요청해뒀습니다 — 그 답에 따라 이 문서의 운영 절차도 바뀔 수
있습니다.

## RLS 교차 확인 SQL 절차 (로컬 Supabase에서 직접 따라 하기)

`#8`(business_faqs) 때와 같은 방식 — Supabase Studio SQL Editor에서:

```sql
-- 0. 준비: 실제 사용자 A의 setup_requests row 하나를 REQUESTED 상태로 확보
select id, user_id, status from public.setup_requests where user_id = '<user_a_id>' limit 5;

-- 1. 사용자 A로 "로그인한 것처럼" 세션을 흉내낸다
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"<user_a_id>"}';

-- 2. 자기 REQUESTED 요청을 취소 — 성공해야 정상
update public.setup_requests set status = 'CANCELLED' where id = '<requested_request_id>';
-- UPDATE 1 이어야 함

-- 3. 자기 요청을 CANCELLED가 아닌 다른 값(예: IN_PROGRESS)으로 바꾸려는 시도 — 실패해야 정상
--    (with check 위반 — 0 rows, 에러 없이 조용히 실패)
update public.setup_requests set status = 'IN_PROGRESS' where id = '<some_own_requested_or_contacted_id>';
-- UPDATE 0 이어야 함(에러가 아니라 "0 rows affected")

-- 4. ★ IN_PROGRESS 상태인 자기 요청을 취소하려는 시도 — 실패해야 정상
--    미리 service-role로 어떤 요청 하나를 IN_PROGRESS로 만들어두고 시도
--    (updateSetupRequestStatus()의 USER_CANCELLABLE_FROM 앱 레벨 가드가 막는 바로 그 케이스를
--     DB 쪽에서 재현하는 것 — using 절의 "status in (REQUESTED, CONTACTED)" 조건에 안 걸림)
update public.setup_requests set status = 'CANCELLED' where id = '<in_progress_request_id>';
-- UPDATE 0 이어야 함 — 에러가 아니라 조용히 0건

-- 5. 종료된 요청(COMPLETED)을 취소하려는 시도 — 실패해야 정상, 사유는 4번과 동일
update public.setup_requests set status = 'CANCELLED' where id = '<completed_request_id>';
-- UPDATE 0 이어야 함

-- 6. 다른 사용자의 요청을 취소하려는 시도 — 실패해야 정상
update public.setup_requests set status = 'CANCELLED' where id = '<other_user_request_id>';
-- UPDATE 0 이어야 함

-- 7. 세션 원복
reset role;
```

**정상 판정 기준**: 2번만 `UPDATE 1`, 나머지(3/4/5/6번)는 전부 `UPDATE 0`(에러 없이 조용히
0건 — Postgres RLS의 표준 동작). 4번이 `updateSetupRequestStatus()`의 앱 레벨 가드가 실제
RLS와 정확히 같은 경계에서 막고 있는지 검증하는 핵심 케이스입니다.
