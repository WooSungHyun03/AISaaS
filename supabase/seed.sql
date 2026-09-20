-- Seed data for local development / demo. Safe to re-run.
insert into public.automation_templates (slug, name, description, category, icon, is_active)
values
  ('blog-marketing', '블로그 마케팅 자동화', 'AI가 주제를 선정하고 블로그 글을 생성해 정해진 주기로 게시합니다.', 'marketing', 'file-text', true),
  ('instagram-marketing', '인스타그램 마케팅 자동화', '브랜드 톤에 맞춘 캡션과 이미지 아이디어를 생성해 게시를 준비합니다.', 'marketing', 'instagram', true),
  ('newsletter', '뉴스레터 자동화', '고객에게 보낼 뉴스레터 초안을 정기적으로 생성합니다.', 'marketing', 'mail', true),
  ('customer-support', '고객 응대 자동화', '자주 묻는 질문에 대한 답변 초안을 자동으로 생성합니다.', 'support', 'life-buoy', true),
  ('shorts', '숏폼 콘텐츠 자동화', '짧은 영상 콘텐츠의 대본과 아이디어를 자동으로 생성합니다.', 'marketing', 'clapperboard', true)
on conflict (slug) do update set
  name = excluded.name,
  description = excluded.description,
  category = excluded.category,
  icon = excluded.icon,
  is_active = excluded.is_active;

insert into public.directory_tools (name, slug, description, github_url, stars, forks, language, license, category, tags)
values
  ('LangChain', 'langchain', 'LLM 애플리케이션 개발을 위한 프레임워크', 'https://github.com/langchain-ai/langchain', 90000, 14000, 'Python', 'MIT', 'framework', array['llm', 'agent', 'rag']),
  ('n8n', 'n8n', '오픈소스 워크플로우 자동화 툴', 'https://github.com/n8n-io/n8n', 50000, 15000, 'TypeScript', 'Sustainable Use', 'automation', array['workflow', 'no-code']),
  ('Supabase', 'supabase', '오픈소스 Firebase 대안 (Postgres 기반 BaaS)', 'https://github.com/supabase/supabase', 70000, 7500, 'TypeScript', 'Apache-2.0', 'backend', array['database', 'auth', 'baas'])
on conflict (slug) do update set
  description = excluded.description,
  github_url = excluded.github_url,
  stars = excluded.stars,
  forks = excluded.forks,
  language = excluded.language,
  license = excluded.license,
  category = excluded.category,
  tags = excluded.tags;
