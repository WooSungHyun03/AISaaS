-- 채널 공개 데이터 수집 v2 (매일 06:00 KST).
--  1. YouTube 계정 연결(OAuth)을 없애면서 저장돼 있던 연결 토큰을 지운다. 연결 기록(행)은 이력으로 남기고 비밀값만 지워요.
--     YouTube Analytics 전용 스냅샷(`yt_analytics.*`)은 지우지 않고 보존한다(화면에서만 더 이상 보여주지 않아요).
--  2. tracked_channels에 표시 정보(채널명·프로필 이미지)와 마지막 수집 상태를 더한다.
--  3. 영상·게시글 단위 일별 스냅샷(channel_content_snapshots)과 수집 실행 로그(channel_collection_runs)를 만든다.
-- 기존 데이터는 수정하지 않고, 새 컬럼은 모두 null 허용이다.

-- 1) 더 이상 쓰지 않는 OAuth 연결의 비밀값 제거 -------------------------------------------------
do $$
declare
  connection record;
begin
  for connection in select id, secret_reference from public.integration_connections where secret_reference is not null loop
    begin
      perform public.integration_secret_delete(connection.secret_reference);
    exception when others then
      raise notice 'could not delete vault secret for connection %: %', connection.id, sqlerrm;
    end;
  end loop;
  update public.integration_connections
     set status = 'DISCONNECTED', secret_reference = null, metadata = '{}'::jsonb
   where provider in ('youtube', 'instagram') and (secret_reference is not null or status <> 'DISCONNECTED');
exception when undefined_function or undefined_table then
  raise notice 'integration cleanup skipped: %', sqlerrm;
end;
$$;

-- 2) tracked_channels: 표시 정보와 수집 상태 ----------------------------------------------------------
alter table public.tracked_channels
  add column if not exists display_name text,
  add column if not exists thumbnail_url text,
  add column if not exists last_collected_at timestamptz,
  add column if not exists last_collection_status text,
  add column if not exists last_error_code text;

alter table public.tracked_channels
  drop constraint if exists tracked_channels_last_collection_status_check;
alter table public.tracked_channels
  add constraint tracked_channels_last_collection_status_check
  check (last_collection_status is null or last_collection_status in ('SUCCESS', 'FAILED', 'QUOTA_EXCEEDED', 'UNAVAILABLE'));

-- 3) 영상·게시글 단위 일별 스냅샷 ------------------------------------------------------------------
create table if not exists public.channel_content_snapshots (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.tracked_channels (id) on delete cascade,
  -- YouTube 영상 id 또는 블로그 글 주소(정규화된 링크).
  external_content_id text not null check (char_length(external_content_id) between 1 and 500),
  title text check (title is null or char_length(title) <= 300),
  url text check (url is null or char_length(url) <= 1000),
  published_at timestamptz,
  -- 수집한 날의 KST 날짜. 같은 날 다시 수집하면 같은 행을 갱신한다.
  snapshot_date date not null,
  -- 공개로 확인된 값만(예: {"viewCount": 120, "likeCount": 3, "commentCount": 1}). 확인되지 않은 값은 키를 넣지 않는다.
  metrics jsonb not null default '{}'::jsonb,
  collected_at timestamptz not null default timezone('utc', now()),
  unique (channel_id, external_content_id, snapshot_date)
);
create index if not exists channel_content_snapshots_channel_date_idx on public.channel_content_snapshots (channel_id, snapshot_date desc);
create index if not exists channel_content_snapshots_published_idx on public.channel_content_snapshots (channel_id, published_at desc);

alter table public.channel_content_snapshots enable row level security;
-- 본인 사업체의 채널 스냅샷만 읽을 수 있고, 쓰기는 서비스 롤(수집 작업)만 한다 — 성장 수치를 사용자가 만들 수 없게(0036과 같은 원칙).
create policy "channel_content_snapshots_select_own" on public.channel_content_snapshots
  for select using (
    exists (
      select 1 from public.tracked_channels c
      join public.businesses b on b.id = c.business_id
      where c.id = channel_content_snapshots.channel_id and b.owner_id = auth.uid()
    )
  );

-- 4) 수집 실행 로그(관리자 전용: 정책이 없으면 서비스 롤만 접근) ------------------------------------------
create table if not exists public.channel_collection_runs (
  id uuid primary key default gen_random_uuid(),
  trigger text not null check (trigger in ('CRON', 'MANUAL_ADMIN', 'MANUAL_USER', 'REGISTER')),
  -- 이 실행이 맡은 수집 예정 시각(06:00 KST 등). 수동 실행은 시작 시각과 같다.
  scheduled_for timestamptz not null,
  started_at timestamptz not null default timezone('utc', now()),
  completed_at timestamptz,
  status text not null default 'RUNNING' check (status in ('RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED')),
  channels_total integer not null default 0 check (channels_total >= 0),
  channels_succeeded integer not null default 0 check (channels_succeeded >= 0),
  channels_failed integer not null default 0 check (channels_failed >= 0),
  channels_skipped integer not null default 0 check (channels_skipped >= 0),
  quota_exceeded boolean not null default false,
  error_summary text check (error_summary is null or char_length(error_summary) <= 2000),
  triggered_by uuid references auth.users (id) on delete set null
);
create index if not exists channel_collection_runs_started_idx on public.channel_collection_runs (started_at desc);
alter table public.channel_collection_runs enable row level security;

-- 5) 행 수 상한(0071의 방식): 직접 API로 한 채널에 영상 스냅샷을 무한히 넣는 것을 막는다 ------------------
do $$
begin
  if exists (select 1 from pg_proc where proname = 'enforce_row_cap') then
    drop trigger if exists channel_content_snapshots_row_cap on public.channel_content_snapshots;
    create trigger channel_content_snapshots_row_cap
      before insert on public.channel_content_snapshots
      for each row execute function public.enforce_row_cap('channel_id', '20000');
  end if;
end;
$$;
