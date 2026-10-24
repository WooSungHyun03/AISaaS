-- Shorts library: every finished ad Short is one stored content item (a content_history row) that points at its own
-- MP4 in the private `shorts-videos` bucket (<user>/<automation>/<run>/final.mp4), like a blog post does for its text.
--
-- video_path / duration / bytes are written by the runner when the run succeeds (after the stored file was checked) and
-- copied here from automation_runs.output for rows that already exist. They are what the library lists and signs; the
-- run's output keeps the same facts, so nothing is removed or rewritten there. Customers still have no UPDATE/DELETE
-- policy on content_history: changes go through server actions (service role) after an ownership check.
alter table public.content_history
  add column video_path text,
  add column video_duration_sec numeric(6, 1),
  add column video_bytes bigint,
  add column video_checked_at timestamptz;

alter table public.content_history
  add constraint content_history_video_path_shape
  check (video_path is null or (char_length(video_path) between 3 and 500 and video_path not like '%..%' and video_path not like '/%'));

-- Existing Shorts made by the ad pipeline: take the stored file's location and length from the run that produced them.
-- Rows whose run kept only an external address (older character/promo pipelines) get nothing here; the library reads
-- those from the run output and offers to move them into Storage, or says they can no longer be recovered.
update public.content_history as ch
set video_path = nullif(r.output ->> 'videoPath', ''),
    video_duration_sec = case
      when (r.output ->> 'durationSec') ~ '^[0-9]+(\.[0-9]+)?$' then least(((r.output ->> 'durationSec')::numeric), 9999)
      else null
    end
from public.automation_runs as r
where r.id = ch.run_id
  and ch.content_type = 'shorts'
  and ch.video_path is null
  and coalesce(r.output ->> 'videoPath', '') <> ''
  and char_length(r.output ->> 'videoPath') between 3 and 500
  and (r.output ->> 'videoPath') not like '%..%'
  and (r.output ->> 'videoPath') not like '/%';

-- One content item per run, so a retried or duplicated "run finished" event cannot store the same video twice.
-- Rows that were already duplicated before this migration are left alone (nothing is deleted from production): the
-- index is created only when the data allows it, and the runner also checks for an existing row before inserting.
do $$
begin
  if exists (select 1 from public.content_history where run_id is not null group by run_id having count(*) > 1) then
    raise notice 'content_history has several rows for one run; unique index content_history_run_id_unique not created';
  else
    create unique index if not exists content_history_run_id_unique on public.content_history (run_id) where run_id is not null;
  end if;
end $$;

-- The library lists a business's Shorts newest first.
create index if not exists content_history_shorts_library_idx
  on public.content_history (business_id, created_at desc)
  where content_type = 'shorts';
