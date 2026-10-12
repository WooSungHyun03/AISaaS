-- The owner's working copy of a Short's posting text (title, alternative titles, description, keywords,
-- hashtags, call to action). The AI's first version stays untouched in automation_runs.output.publishing;
-- this column only holds what the owner changed, and is what gets posted. Like title/content, it is written
-- through the server action (service role) after the row is confirmed visible to the caller; there is still
-- no UPDATE policy for customers.
alter table public.content_history
  add column publishing jsonb;

alter table public.content_history
  add constraint content_history_publishing_is_object
  check (publishing is null or jsonb_typeof(publishing) = 'object');
