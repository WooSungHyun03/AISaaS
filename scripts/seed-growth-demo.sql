-- ⚠️ 로컬 전용 데모 시드 — 운영 DB에는 절대 실행하지 마세요.
--
-- 성장 리포트(1-7)의 "3개 기간 그래프"를 로컬에서 확인해볼 수 있도록
-- marketing_metric_snapshots에 ~95일치 샘플 데이터를 직접 insert합니다.
-- 전부 source='DEMO_SEED'로 표시되고(0038에서 DB에만 허용된 값 — 앱 코드의
-- channelSnapshotSourceSchema는 이 값을 절대 만들지 못합니다), 화면에서는
-- "데모 데이터" 배지로 구분 표시해야 합니다.
--
-- 실행: bash scripts/dev-db.sh 로 로컬 Supabase를 띄운 뒤
--   docker exec -i supabase_db_<프로젝트>  psql -U postgres -d postgres < scripts/seed-growth-demo.sql
-- (dev-db.sh가 출력하는 DB_URL로 직접 psql 접속도 가능합니다.)
--
-- `scripts/dev-db.sh`가 만드는 user@autobiz.local 계정 아래에 데모 사업체 +
-- 유튜브 채널을 하나 만들고(이미 있으면 재사용), 그 채널에 지표를 채웁니다.
-- 몇 번 다시 실행해도 안전합니다(같은 채널/같은 날짜는 upsert).

do $$
declare
  v_user_id uuid;
  v_business_id uuid;
  v_channel_id uuid;
  v_day int;
  v_recorded_at timestamptz;
begin
  select id into v_user_id from auth.users where email = 'user@autobiz.local';
  if v_user_id is null then
    raise exception 'user@autobiz.local 계정이 없습니다. 먼저 bash scripts/dev-db.sh 로 로컬 Supabase를 띄워주세요.';
  end if;

  select id into v_business_id from public.businesses where owner_id = v_user_id and name = '데모 사업체(성장 리포트용)';
  if v_business_id is null then
    insert into public.businesses (owner_id, name, industry)
    values (v_user_id, '데모 사업체(성장 리포트용)', '카페')
    returning id into v_business_id;
  end if;

  select id into v_channel_id from public.tracked_channels where business_id = v_business_id and platform = 'youtube' and external_id = '@demo-growth-channel';
  if v_channel_id is null then
    insert into public.tracked_channels (business_id, platform, external_id, url, status)
    values (v_business_id, 'youtube', '@demo-growth-channel', 'https://youtube.com/@demo-growth-channel', 'ACTIVE')
    returning id into v_channel_id;
  end if;

  -- 95일 전부터 오늘까지, 구독자/조회수가 완만히 늘어나는 샘플 곡선.
  for v_day in 0..95 loop
    v_recorded_at := timezone('utc', now()) - (v_day || ' days')::interval;

    insert into public.marketing_metric_snapshots (channel_id, metric, value, recorded_at, source)
    values (v_channel_id, 'subscriberCount', 1000 + (95 - v_day) * 3, v_recorded_at, 'DEMO_SEED')
    on conflict (channel_id, metric, recorded_date) do update set value = excluded.value, source = excluded.source;

    insert into public.marketing_metric_snapshots (channel_id, metric, value, recorded_at, source)
    values (v_channel_id, 'viewCount', 50000 + (95 - v_day) * 120, v_recorded_at, 'DEMO_SEED')
    on conflict (channel_id, metric, recorded_date) do update set value = excluded.value, source = excluded.source;
  end loop;

  raise notice '데모 스냅샷 생성 완료 — business_id=%, channel_id=%', v_business_id, v_channel_id;
end $$;
