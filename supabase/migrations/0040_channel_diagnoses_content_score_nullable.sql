-- Ticket 1-5 (채널 진단 화면·액션 개편): tistory/naver_blog have no
-- view/visitor data to score content with (see
-- src/server/channels/tistory-scoring.ts's TISTORY_CONTENT_SCORE_UNAVAILABLE_NOTICE
-- and naver-blog-scoring.ts's NAVER_SEARCH_LIMITATION_NOTICE) — content_score
-- must be able to record "not measurable" instead of a fabricated 0.
alter table public.channel_diagnoses alter column content_score drop not null;

-- Re-create with the same constraint name (0035's check already allows
-- null implicitly once the column itself is nullable, but Postgres re-checks
-- the existing constraint text as-is, so this just documents the new
-- "null is allowed" shape explicitly for anyone reading this table later).
alter table public.channel_diagnoses drop constraint if exists channel_diagnoses_content_score_check;
alter table public.channel_diagnoses add constraint channel_diagnoses_content_score_check check (content_score is null or (content_score >= 0 and content_score <= 100));
