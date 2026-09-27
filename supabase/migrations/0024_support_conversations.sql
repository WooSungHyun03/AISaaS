-- Customer Support conversation log (Dev3 ticket #11). Minimal, intentionally:
-- only enough to (a) show a business owner which questions their FAQ didn't
-- cover (is_fallback = true) and (b) let a human review actual Q&A pairs to
-- improve FAQ content. Every column answers "why is this here":
--   question/answer  — the actual exchange, the entire point of this log
--   used_faq_ids      — which FAQs backed a grounded answer (empty for fallback)
--   is_fallback       — the #9/#10 SupportAnswer.isFallback signal, lets an
--                       owner filter straight to "questions we couldn't answer"
--   created_at        — when
--
-- Deliberately NOT stored: customer email/name/phone, IP address (already
-- only ever hashed for support_widget_requests, and not linked here),
-- User-Agent, or any other visitor-identifying data — this is a content
-- quality log, not a CRM. That said, `question` is free text a customer
-- typed, so it can still incidentally contain a phone number or name they
-- volunteered — the delete policy below exists specifically so a business
-- owner can remove such a row on request.
--
-- used_faq_ids intentionally has NO foreign key — Postgres can't constrain
-- individual elements of an array column against another table anyway, and
-- a FAQ getting deleted later must never make old log rows unreadable (see
-- src/server/customer-support/conversations.ts).
create table public.support_conversations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  question text not null,
  answer text not null,
  used_faq_ids uuid[] not null default '{}',
  is_fallback boolean not null,
  created_at timestamptz not null default timezone('utc', now())
);

create index support_conversations_business_id_idx
  on public.support_conversations (business_id, created_at desc);

-- Speeds up "which questions did we fail to answer" — the log's main
-- practical value per the ticket. Same partial-index pattern as
-- automations_due_idx (0005_automations.sql).
create index support_conversations_business_fallback_idx
  on public.support_conversations (business_id, created_at desc)
  where is_fallback = true;

alter table public.support_conversations enable row level security;

-- Same ownership-subquery pattern as content_history_select_own
-- (0012_row_level_security.sql).
create policy "support_conversations_select_own" on public.support_conversations
  for select using (
    exists (
      select 1 from public.businesses b
      where b.id = support_conversations.business_id
        and b.owner_id = auth.uid()
    )
  );

-- A customer's free-text question can incidentally contain personal info
-- they volunteered (a phone number, a name) — an owner needs to be able to
-- delete such a row on request. No insert/update policy: every write comes
-- from the service-role client in widget.ts (an anonymous widget visitor
-- has no session an insert policy could check against anyway), and rows
-- are never edited, only ever deleted.
create policy "support_conversations_delete_own" on public.support_conversations
  for delete using (
    exists (
      select 1 from public.businesses b
      where b.id = support_conversations.business_id
        and b.owner_id = auth.uid()
    )
  );
