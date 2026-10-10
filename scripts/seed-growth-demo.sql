-- ⚠️ 로컬 전용 데모 시드 — 운영 DB에는 절대 실행하지 마세요.
--
-- 성장 리포트(1-7)의 "3개 기간(7/30/90일) 그래프 + 이전 기간 대비"를 로컬에서
-- 확인해볼 수 있도록 marketing_metric_snapshots에 ~190일치 샘플 데이터를 직접
-- insert합니다. "90일 vs 이전 90일" 비교에는 180일치 데이터가 필요해서(1-7),
-- 1-6 때의 95일로는 부족합니다 — 190일(< marketing_metric_snapshots의
-- RETENTION_DAYS=200, collect-pipeline.ts)로 늘렸습니다.
--
-- 전부 source='DEMO_SEED'로 표시되고(0038에서 DB에만 허용된 값 — 앱 코드의
-- channelSnapshotSourceSchema는 이 값을 절대 만들지 못합니다), 화면에서는
-- "데모 데이터" 배지로 구분 표시해야 합니다.
--
-- 유튜브 채널 하나(구독자/조회수) 외에 네이버 블로그·티스토리 채널도 하나씩
-- 심어서(1-7의 "네이버·티스토리엔 조회수 안 보임"을 화면에서 직접 확인할 수
-- 있도록) 각 플랫폼이 실제로 쌓는 지표만 채웁니다 — raw-metrics.ts의
-- toSnapshotMetricsRecord와 동일하게 naver_blog/tistory에는 viewCount류를
-- 절대 넣지 않습니다.
--
-- 실행: bash scripts/dev-db.sh 로 로컬 Supabase를 띄운 뒤
--   docker exec -i supabase_db_<프로젝트>  psql -U postgres -d postgres < scripts/seed-growth-demo.sql
-- (dev-db.sh가 출력하는 DB_URL로 직접 psql 접속도 가능합니다.)
--
-- `scripts/dev-db.sh`가 만드는 user@autobiz.local 계정 아래에 데모 사업체 +
-- 채널들을 만들고(이미 있으면 재사용), 지표를 채웁니다.
-- 몇 번 다시 실행해도 안전합니다(같은 채널/같은 날짜는 upsert).

do $$
declare
  v_user_id uuid;
  v_business_id uuid;
  v_youtube_channel_id uuid;
  v_naver_channel_id uuid;
  v_tistory_channel_id uuid;
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

  select id into v_youtube_channel_id from public.tracked_channels where business_id = v_business_id and platform = 'youtube' and external_id = '@demo-growth-channel';
  if v_youtube_channel_id is null then
    insert into public.tracked_channels (business_id, platform, external_id, url, status)
    values (v_business_id, 'youtube', '@demo-growth-channel', 'https://youtube.com/@demo-growth-channel', 'ACTIVE')
    returning id into v_youtube_channel_id;
  end if;

  select id into v_naver_channel_id from public.tracked_channels where business_id = v_business_id and platform = 'naver_blog' and external_id = 'demo-growth-blog';
  if v_naver_channel_id is null then
    insert into public.tracked_channels (business_id, platform, external_id, url, status)
    values (v_business_id, 'naver_blog', 'demo-growth-blog', 'https://blog.naver.com/demo-growth-blog', 'ACTIVE')
    returning id into v_naver_channel_id;
  end if;

  select id into v_tistory_channel_id from public.tracked_channels where business_id = v_business_id and platform = 'tistory' and external_id = 'demo-growth-blog';
  if v_tistory_channel_id is null then
    insert into public.tracked_channels (business_id, platform, external_id, url, status)
    values (v_business_id, 'tistory', 'demo-growth-blog', 'https://demo-growth-blog.tistory.com/', 'ACTIVE')
    returning id into v_tistory_channel_id;
  end if;

  -- 189일 전부터 오늘까지(총 190일), 완만히 늘어나는 샘플 곡선.
  for v_day in 0..189 loop
    v_recorded_at := timezone('utc', now()) - (v_day || ' days')::interval;

    insert into public.marketing_metric_snapshots (channel_id, metric, value, recorded_at, source)
    values (v_youtube_channel_id, 'subscriberCount', 1000 + (189 - v_day) * 3, v_recorded_at, 'DEMO_SEED')
    on conflict (channel_id, metric, recorded_date) do update set value = excluded.value, source = excluded.source;

    insert into public.marketing_metric_snapshots (channel_id, metric, value, recorded_at, source)
    values (v_youtube_channel_id, 'viewCount', 50000 + (189 - v_day) * 120, v_recorded_at, 'DEMO_SEED')
    on conflict (channel_id, metric, recorded_date) do update set value = excluded.value, source = excluded.source;

    -- naver_blog: matchedPostCount/postsLast30Days만 — 조회수·방문자 없음.
    insert into public.marketing_metric_snapshots (channel_id, metric, value, recorded_at, source)
    values (v_naver_channel_id, 'matchedPostCount', 20 + floor((189 - v_day) / 3), v_recorded_at, 'DEMO_SEED')
    on conflict (channel_id, metric, recorded_date) do update set value = excluded.value, source = excluded.source;

    insert into public.marketing_metric_snapshots (channel_id, metric, value, recorded_at, source)
    values (v_naver_channel_id, 'postsLast30Days', 4 + (v_day % 4), v_recorded_at, 'DEMO_SEED')
    on conflict (channel_id, metric, recorded_date) do update set value = excluded.value, source = excluded.source;

    -- tistory: postCount만 — 조회수·방문자 없음.
    insert into public.marketing_metric_snapshots (channel_id, metric, value, recorded_at, source)
    values (v_tistory_channel_id, 'postCount', 15 + floor((189 - v_day) / 4), v_recorded_at, 'DEMO_SEED')
    on conflict (channel_id, metric, recorded_date) do update set value = excluded.value, source = excluded.source;
  end loop;

  raise notice '데모 스냅샷 생성 완료 — business_id=%, youtube=%, naver_blog=%, tistory=%', v_business_id, v_youtube_channel_id, v_naver_channel_id, v_tistory_channel_id;
end $$;
