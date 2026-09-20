# AutoBiz

사업 정보를 한 번 입력하면 AI가 마케팅/고객응대 업무를 정해진 주기로 반복 실행해주는 AI 업무 자동화 SaaS. 1인 사업자, 자영업자, 크리에이터, 소규모 기업을 위한 서비스입니다.

## Stack

- **App**: Next.js (App Router) + TypeScript + React + Tailwind CSS + shadcn/ui (Radix 기반)
- **Backend/DB**: Supabase (PostgreSQL, Auth, RLS, Edge Functions/Cron)
- **AI**: 벤더 중립 `AIProvider` 인터페이스 (`mock` / `openai` / `gemini`, `AI_PROVIDER` 환경변수로 전환)
- **Billing**: 벤더 중립 `BillingProvider` 인터페이스 (`mock` 제공, 실제 PG 연동 시 어댑터만 교체)
- **Hosting**: Netlify Free (`netlify.toml` 포함)

의존성은 의도적으로 최소로 유지했습니다 (ORM 없이 Supabase client + SQL migration, ad-hoc 상태 관리 없이 Server Components/Server Actions 활용).

## Architecture

자세한 내용은 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)를 참고하세요. 요약:

- `src/app/(public)` — 랜딩, AI 디렉토리, 가이드, 요금제 (인증 불필요)
- `src/app/(auth)` — 로그인/회원가입
- `src/app/(app)` — 대시보드, 자동화, 사업체, 결제, 설정 (인증 필요, `proxy.ts`에서 보호)
- `src/server/` — AI, 자동화 실행/스케줄러, 커넥터, 결제 도메인 로직 (UI와 완전 분리)
- `supabase/migrations` — 스키마 + RLS 정책
- `supabase/functions` — cron 트리거용 Edge Function (얇은 wrapper)

## Local Development

```bash
git clone <repo-url>
cd sw-system
npm install
cp .env.example .env.local   # 값 채우기 (아래 Database 섹션 참고)
npm run dev
```

<http://localhost:3000> 에서 확인합니다. `AI_PROVIDER=mock`, `BILLING_PROVIDER=mock`이면 실제 API 키 없이 전체 플로우(자동화 생성 → 실행 → 결제 시뮬레이션)를 테스트할 수 있습니다.

## Database

1. [Supabase](https://supabase.com)에서 무료 프로젝트를 생성합니다.
2. Project Settings → API에서 URL/anon key/service role key를 `.env.local`에 채웁니다.
3. `supabase/migrations/*.sql`을 순서대로 SQL Editor에 붙여넣거나, Supabase CLI가 있다면:

   ```bash
   supabase link --project-ref <project-ref>
   supabase db push
   ```

4. 시드 데이터(자동화 템플릿, 디렉토리 예시)를 넣으려면 `supabase/seed.sql`을 실행합니다.

스키마 변경은 항상 새 마이그레이션 파일을 추가하는 방식으로 진행하고 (`00XX_설명.sql`), 기존 마이그레이션을 수정하지 않습니다. `src/types/database.types.ts`도 함께 갱신해주세요.

## Deployment

### Netlify (프론트엔드)

1. GitHub 저장소를 Netlify에 연결합니다 (`netlify.toml`이 빌드 설정을 포함).
2. Netlify 환경변수에 `.env.example`의 항목들을 등록합니다.
3. `main` 브랜치에 push하면 자동 배포됩니다.

### Supabase (백엔드/스케줄러)

1. 마이그레이션 적용 (위 Database 섹션).
2. Cron 트리거 배포:

   ```bash
   supabase functions deploy run-due-automations
   supabase secrets set SITE_URL=https://<netlify-site>.netlify.app CRON_SECRET=<CRON_SECRET과 동일한 값>
   ```

3. Supabase Dashboard → Database → Cron Jobs에서 `run-due-automations` 함수를 몇 분 간격으로 호출하도록 등록합니다.

## Branch Strategy

`main`은 항상 배포 가능한 상태를 유지합니다. 팀원별 작업 브랜치:

- `feature/automation-ai` — AI/자동화/결제/배포 (Dev1)
- `feature/frontend` — 프론트엔드 (Dev2)
- `feature/directory-cs` — 디렉토리/고객지원 (Dev3)

작은 단위로 자주 `main`에 merge합니다. 담당 영역과 PR 규칙은 [docs/TEAM_GUIDE.md](docs/TEAM_GUIDE.md)를 참고하세요.

## Directory Structure

```
src/
  app/            # 라우트 (public/auth/app 그룹 + api)
  components/     # UI 컴포넌트 (ui/, layout/, 도메인별)
  server/         # 서버 전용 도메인 로직 (ai, automations, connectors, billing, directory, customer-support)
  lib/            # supabase 클라이언트, env, logger, 공용 유틸
  types/          # 공유 타입 (Database, 도메인, 자동화, 빌링)
supabase/
  migrations/     # SQL 스키마 + RLS
  functions/      # Edge Function (cron 트리거)
  seed.sql        # 초기 데이터
docs/             # ARCHITECTURE.md, TEAM_GUIDE.md
```

## Free Infrastructure Note

MVP는 Netlify Free + Supabase Free 범위 안에서 동작하도록 설계되었습니다. AI Provider(OpenAI/Gemini)는 사용량에 따라 비용이 발생하므로, 로컬/데모 환경에서는 `AI_PROVIDER=mock`을 기본값으로 사용하세요. 플랜별 실행 한도(`src/server/billing/plans.ts`)가 비용 폭주를 막는 1차 방어선입니다.
