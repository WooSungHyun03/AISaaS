-- 운영 최초 관리자 등록용 수동 SQL입니다.
-- Supabase SQL Editor에서 아래 이메일만 실제 운영 관리자 이메일로 바꾼 뒤
-- 운영 담당자가 한 번 실행합니다. 애플리케이션에서는 관리자 등록을 제공하지 않습니다.

do $$
declare
  target_email text := 'replace-admin@example.com';
  target_user_id uuid;
  inserted_user_id uuid;
begin
  select id
    into target_user_id
    from auth.users
   where lower(email) = lower(target_email)
     and email_confirmed_at is not null
   limit 1;

  if target_user_id is null then
    raise exception '확인된 Auth 사용자를 찾지 못했습니다: %', target_email;
  end if;

  insert into public.admin_users (user_id, created_by)
  values (target_user_id, target_user_id)
  on conflict (user_id) do nothing
  returning user_id into inserted_user_id;

  insert into public.admin_audit_log (
    actor_user_id,
    actor_email,
    action,
    target_type,
    target_id,
    metadata
  ) values (
    target_user_id,
    target_email,
    case when inserted_user_id is null then 'BOOTSTRAP_ADMIN_CONFIRMED' else 'BOOTSTRAP_ADMIN_ADDED' end,
    'admin_user',
    target_user_id::text,
    jsonb_build_object('source', 'docs/ADMIN_BOOTSTRAP.sql')
  );
end;
$$;
