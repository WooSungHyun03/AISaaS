-- Formalizes directory_tools.category into a fixed taxonomy (Dev3 ticket #3).
-- Values/labels/descriptions are defined once in src/server/directory/taxonomy.ts;
-- this constraint must always mirror that list.
--
-- Any FUTURE migration that changes the allowed category values must drop
-- and re-add a constraint named `directory_tools_category_check` (same
-- name) — src/server/directory/taxonomy.test.ts finds the highest-numbered
-- migration mentioning that name and asserts its value list matches
-- DIRECTORY_CATEGORIES, so keeping the name stable is what lets that check
-- follow future changes automatically.

-- Remap rows written under the old ad-hoc taxonomy
-- (automation/framework/backend/ai-model/other) before the constraint below
-- would otherwise reject them.
update public.directory_tools
set category = case category
  when 'framework' then 'ai-infrastructure'
  when 'backend' then 'ai-infrastructure'
  when 'ai-model' then 'ai-infrastructure'
  when 'automation' then 'automation-platform'
  else category
end
where category is not null;

alter table public.directory_tools
  add constraint directory_tools_category_check
  check (
    category is null or category in (
      'automation-platform',
      'ai-infrastructure',
      'content-creation',
      'marketing-automation',
      'customer-support',
      'productivity',
      'other'
    )
  );
