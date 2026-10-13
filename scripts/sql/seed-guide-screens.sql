-- ⚠️ 로컬 전용 샘플 데이터 — 운영 DB에는 절대 실행하지 마세요.
-- 이용방법 화면 캡처(scripts/e2e/capture-guide.mjs)가 비어 있지 않은 화면을 찍을 수 있도록,
-- 로컬 시드 사용자(user@autobiz.local)의 사업체에 홈페이지 진단·채널 진단·일정 몇 개를 넣어요.
-- 먼저 scripts/seed-growth-demo.sql 로 채널을 만든 뒤 실행하세요(채널이 없으면 채널 진단은 건너뛰어요).
do $$
declare
  v_user uuid;
  v_business uuid;
  v_channel record;
begin
  select id into v_user from auth.users where email = 'user@autobiz.local';
  if v_user is null then raise exception 'user@autobiz.local 계정이 없어요. bash scripts/dev-db.sh 를 먼저 실행하세요.'; end if;
  select id into v_business from public.businesses where owner_id = v_user and name = '성수 소금빵집';
  if v_business is null then raise exception '성수 소금빵집 사업체가 없어요.'; end if;

  delete from public.marketing_diagnoses where business_id = v_business;
  insert into public.marketing_diagnoses (business_id, source_type, source_url, score, missing_channels, content_status, sns_activity, recommendations, raw_summary, score_breakdown, evidence)
  values (
    v_business, 'website', 'https://seongsu-saltbread.example', 72, array['naver_place', 'kakao_channel'], '메뉴 소개는 있지만 최근 소식이 적어요', '인스타그램 링크가 있어요',
    array['네이버 플레이스를 등록하면 근처 손님이 찾기 쉬워져요', '메뉴 페이지에 가격과 사진을 함께 보여주세요', '홈페이지에 예약·문의 버튼을 눈에 띄게 넣어보세요'],
    '샘플 진단 결과',
    '[
      {"key":"https","group":"website","label":"보안 연결(https)","points":5,"max":5,"detail":"https로 연결돼요."},
      {"key":"title","group":"website","label":"페이지 제목","points":8,"max":10,"detail":"제목이 있지만 지역 이름이 빠져 있어요."},
      {"key":"mobile","group":"website","label":"휴대폰 화면 대응","points":5,"max":5,"detail":"휴대폰 화면에 맞게 보여요."},
      {"key":"text","group":"content","label":"본문 분량","points":10,"max":15,"detail":"소개 글이 있지만 메뉴 설명이 짧아요."},
      {"key":"contact","group":"contact","label":"연락처","points":10,"max":10,"detail":"전화번호와 주소가 보여요."},
      {"key":"cta","group":"contact","label":"행동 유도 문구","points":4,"max":10,"detail":"예약·문의 안내가 눈에 잘 띄지 않아요."},
      {"key":"channels","group":"channels","label":"연결된 채널","points":15,"max":25,"detail":"인스타그램 링크가 있어요. 네이버 플레이스·카카오톡 채널은 찾지 못했어요."},
      {"key":"fresh","group":"freshness","label":"최근 업데이트","points":15,"max":20,"detail":"한 달 안의 소식이 있어요."}
    ]'::jsonb,
    '{}'::jsonb
  );

  for v_channel in select id, platform from public.tracked_channels where business_id = v_business loop
    delete from public.channel_diagnoses where channel_id = v_channel.id;
    insert into public.channel_diagnoses (business_id, channel_id, overall_score, activity_score, consistency_score, content_score, metrics, findings, recommendations, completeness, data_source)
    values (
      v_business, v_channel.id,
      case v_channel.platform when 'youtube' then 68 when 'naver_blog' then 74 else 61 end,
      case v_channel.platform when 'youtube' then 70 when 'naver_blog' then 80 else 60 end,
      case v_channel.platform when 'youtube' then 64 when 'naver_blog' then 72 else 58 end,
      null,
      '{}'::jsonb,
      array['최근 30일 안에 새 글이 꾸준히 올라와요', '게시 간격이 일정한 편이에요'],
      array['글 제목에 지역과 메뉴 이름을 함께 넣어보세요', '사진을 글마다 3장 이상 넣어보세요'],
      'COMPLETE', 'live'
    );
  end loop;

  delete from public.calendar_events where user_id = v_user;
  insert into public.calendar_events (user_id, title, description, starts_at, ends_at, all_day, color, category) values
    (v_user, '여름 신메뉴 블로그 글 올리기', '소금빵 사진 3장 준비', date_trunc('day', now()) + interval '2 days 9 hours', date_trunc('day', now()) + interval '2 days 10 hours', false, 'blue', 'MARKETING'),
    (v_user, '정기 휴무', null, date_trunc('day', now()) + interval '5 days', date_trunc('day', now()) + interval '5 days', true, 'gray', 'GENERAL'),
    (v_user, '숏폼 광고 영상 확인', '영상 미리보기 확인 후 게시', date_trunc('day', now()) + interval '7 days 14 hours', date_trunc('day', now()) + interval '7 days 15 hours', false, 'purple', 'MARKETING'),
    (v_user, '가을 이벤트 준비', '쿠폰 문구 정하기', date_trunc('day', now()) + interval '10 days 11 hours', date_trunc('day', now()) + interval '10 days 12 hours', false, 'orange', 'DEADLINE'),
    (v_user, '거래처 미팅', null, date_trunc('day', now()) + interval '12 days 15 hours', date_trunc('day', now()) + interval '12 days 16 hours', false, 'green', 'MEETING');
  insert into public.calendar_events (user_id, title, description, starts_at, ends_at, color, category, recur_freq, recur_interval, recur_weekdays)
  values (v_user, '인스타그램 소식 올리기', '매주 월요일 오전', date_trunc('week', now()) + interval '9 hours', date_trunc('week', now()) + interval '9 hours 30 minutes', 'red', 'MARKETING', 'WEEKLY', 1, array[1]);
end $$;
