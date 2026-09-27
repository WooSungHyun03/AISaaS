# Setup Request Operations (Dev3 ticket #13)

## 운영자 화면은 없습니다

이 프로젝트엔 "관리자/운영자" 역할이나 화면이 전혀 없습니다(코드베이스 전체 확인 완료 — `is_staff`/`is_admin` 같은 개념 자체가 없음). `setup_requests.status`를 `REQUESTED` → `CONTACTED` → `IN_PROGRESS` → `COMPLETED`로 진행시키는 것은 **애플리케이션 코드에 그 경로가 없습니다** — RLS(`0023_setup_requests_workflow.sql`)가 일반 사용자의 자기 요청 수정 권한을 "아직 안 끝난 요청을 CANCELLED로 바꾸는 것"만으로 명시적으로 제한하기 때문입니다.

## 운영자가 상태를 바꾸는 방법 — Supabase Studio에서 직접

1. Supabase 대시보드(로컬이면 `http://localhost:54323`) → Table Editor → `setup_requests`.
2. 처리할 요청의 `status` 셀을 직접 수정(`CONTACTED`/`IN_PROGRESS`/`COMPLETED` 중 하나).
3. Table Editor는 프로젝트의 service-role 권한으로 동작하므로 RLS(사용자 스코프 제한)를 완전히 우회합니다 — 이게 유일하게 이 전이들을 실행할 수 있는 경로입니다.
4. `check` 제약(`setup_requests_status_values_check`)은 여전히 유효하므로 오타/잘못된 값은 DB가 막아줍니다.

이 방식은 요청량이 적은 지금 규모에 맞춘 임시 방편입니다. 요청이 쌓이기 시작하면 별도 티켓으로 "운영자 역할 + 관리 화면"을 정식으로 논의하는 걸 권장합니다(`IMPLEMENTATION_GUIDE.md` #13 원안의 관리자 처리 방법 비교표 참고).

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

-- 3. 자기 요청을 REQUESTED가 아닌 다른 값(예: COMPLETED)으로 바꾸려는 시도 — 실패해야 정상
--    (with check 위반 — 0 rows, 에러 없이 조용히 실패. 사전에 service-role로 어떤 row를 IN_PROGRESS로 만들어두고 시도)
update public.setup_requests set status = 'IN_PROGRESS' where id = '<some_own_request_id>';
-- UPDATE 0 이어야 함(에러가 아니라 "0 rows affected")

-- 4. ★ 종료된 요청을 취소하려는 시도 — 실패해야 정상
--    미리 service-role로 어떤 요청 하나를 COMPLETED로 만들어둔 뒤:
update public.setup_requests set status = 'CANCELLED' where id = '<completed_request_id>';
-- UPDATE 0 이어야 함 — using 절의 "status in (REQUESTED, CONTACTED, IN_PROGRESS)" 조건에 안 걸려서
-- 이 row 자체가 업데이트 후보에서 제외되기 때문(에러가 아니라 조용히 0건)

-- 5. 다른 사용자의 요청을 취소하려는 시도 — 실패해야 정상
update public.setup_requests set status = 'CANCELLED' where id = '<other_user_request_id>';
-- UPDATE 0 이어야 함

-- 6. 세션 원복
reset role;
```

**정상 판정 기준**: 2번만 `UPDATE 1`, 나머지(3/4/5번)는 전부 `UPDATE 0`(에러 없이 조용히 0건 — Postgres RLS의 표준 동작). 4번이 특히 이번 티켓에서 새로 추가된 보호(`using` 절의 종료 상태 제외)를 검증하는 케이스입니다.
