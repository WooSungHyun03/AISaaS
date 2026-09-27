# AutoBiz

사업 정보를 한 번 입력하면 AI가 마케팅/고객응대 업무를 정해진 주기로 반복 실행해주는 AI 업무 자동화 SaaS. 1인 사업자, 자영업자, 크리에이터, 소규모 기업을 위한 서비스입니다.

## Stack

- **App**: Next.js (App Router) + TypeScript + React + Tailwind CSS + shadcn/ui (Radix 기반)
- **Backend/DB**: Supabase (PostgreSQL, Auth, RLS, Edge Functions/Cron)
- **AI**: 벤더 중립 `AIProvider` 인터페이스 (`mock` / `openai` / `gemini`, `AI_PROVIDER` 환경변수로 전환)
- **Billing**: 벤더 중립 `BillingProvider` 인터페이스 (`mock` 제공, 실제 PG 연동 시 어댑터만 교체)
- **Hosting**: Vercel Free (GitHub 연동, `main` push 시 자동 배포) + Cloudflare (도메인 DNS)
- **Email**: Resend (뉴스레터 자동화)
- **Container**: 프로덕션 `Dockerfile`(multi-stage) + 로컬 실행용 `compose.yaml` — Vercel 배포와는 별개로, 이식 가능한 실행 방법을 원할 때 사용

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

### Vercel (프론트엔드)

1. GitHub 저장소를 Vercel에 연결합니다 — Next.js는 zero-config로 인식되므로 빌드 설정을 따로 건드릴 필요가 없습니다.
2. Vercel 프로젝트 환경변수(Production/Preview)에 `.env.example`의 항목들을 등록합니다.
3. `main` 브랜치에 push하면 자동 배포됩니다.
4. 커스텀 도메인을 쓴다면 Vercel의 안내 레코드를 Cloudflare DNS에 등록합니다 — 처음에는 "DNS only"(회색 구름)로 두어 SSL 발급 충돌을 피하고, 필요할 때만 "Proxied"로 전환하세요 (그 경우 Cloudflare SSL/TLS 모드를 "Full (strict)"로).

### Supabase (백엔드/스케줄러)

1. 마이그레이션 적용 (위 Database 섹션). `vault`, `pg_cron`, `pg_net` extension이 필요합니다 (Database → Extensions).
2. Cron 트리거 배포:

   ```bash
   supabase functions deploy run-due-automations
   supabase secrets set SITE_URL=https://<your-domain> CRON_SECRET=<CRON_SECRET과 동일한 값>
   ```

3. `supabase/migrations/0014_scheduler_cron.sql`이 pg_cron으로 5분마다 이 함수를 호출하도록 이미 등록하고, `0018_scheduler_cron_auth.sql`이 그 호출에 인증 헤더를 추가합니다 — Vercel의 무료 플랜 Cron Jobs는 하루 1회로 제한되어 이 용도에 맞지 않으므로 사용하지 않습니다.
4. **필수 — 한 번만 수동으로 실행 (마이그레이션에는 실제 키를 커밋하지 않습니다):** Supabase Edge Function은 기본적으로 요청의 Authorization 헤더에 유효한 Supabase JWT(anon 또는 service_role 키)가 없으면 거부합니다(`verify_jwt`). `0018_scheduler_cron_auth.sql`이 등록하는 pg_cron 작업은 이 값을 하드코딩하지 않고, DB 레벨 설정에서 실행 시점에 읽어옵니다 — SQL Editor에서 프로젝트의 **service_role** 키로 한 번만 설정하세요:

   ```sql
   alter database postgres set app.settings.service_role_key = '<service role key>';
   ```

   이 설정 없이는 cron 작업이 계속 401로 실패합니다(이전과 동일하게 안전하게 실패 — 자동으로 보안이 느슨해지지 않습니다). 실제 트리거 보호는 여전히 `CRON_SECRET`(2단계)이 담당합니다: 이 헤더는 Supabase 게이트웨이가 Edge Function 호출 자체를 허용하도록 하는 것일 뿐, `POST /api/cron/run-automations`는 별도로 `CRON_SECRET`을 확인합니다.

### Resend (뉴스레터 자동화)

1. Resend에서 발신 도메인을 추가하고(루트 도메인에 이미 다른 이메일 라우팅이 있다면 `mail.<domain>` 같은 서브도메인 사용), DKIM/SPF/DMARC 레코드를 DNS에 등록합니다.
2. Sending 권한만 있는 API 키를 발급해 `RESEND_API_KEY`/`RESEND_FROM_EMAIL`에 등록합니다.

## Docker

Vercel이 실제 배포 대상이지만, 이식 가능한 실행이 필요하면 Docker로도 빌드/실행할 수 있습니다.

```bash
docker build -t autobiz .
docker run -p 3000:3000 --env-file .env.local autobiz
# 또는
docker compose up --build
```

`Dockerfile`은 3단계(deps → builder → runner) 빌드로 최종 이미지에 소스/devDependencies가 남지 않고, `next.config.ts`의 `output: "standalone"`이 필요한 `node_modules`만 추립니다. 실제 시크릿은 이미지에 포함되지 않고 컨테이너 실행 시(`--env-file`/`env_file`)에만 주입됩니다. `/api/health`가 헬스체크 엔드포인트입니다.

## CI

`.github/workflows/ci.yml`이 `main` push와 그 대상 PR에서 lint → typecheck → test → build → docker build를 순서대로 실행합니다 (실제 배포는 그대로 Vercel의 git 연동이 담당 — 이 워크플로는 검증 게이트입니다). 불필요한 Actions 사용량을 피하기 위해 다른 브랜치에서는 실행되지 않습니다.

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
.github/workflows/ci.yml   # lint/typecheck/test/build/docker build
Dockerfile, .dockerignore, compose.yaml   # 컨테이너 빌드/로컬 실행
```

## Free Infrastructure Note

MVP는 Vercel Free + Supabase Free 범위 안에서 동작하도록 설계되었습니다. AI Provider(OpenAI/Gemini)는 사용량에 따라 비용이 발생하므로, 로컬/데모 환경에서는 `AI_PROVIDER=mock`을 기본값으로 사용하세요. 플랜별 실행 한도(`src/server/billing/plans.ts`)가 비용 폭주를 막는 1차 방어선입니다.
