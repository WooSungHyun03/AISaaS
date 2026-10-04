-- Users can review and edit what the AI generated before they publish it
-- themselves. The original generation stays untouched in
-- automation_runs.output; content_history holds the user's working copy, and
-- edited_at records that it no longer matches the AI's output.
alter table public.content_history
  add column edited_at timestamptz;
