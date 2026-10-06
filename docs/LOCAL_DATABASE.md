# 로컬 Supabase 개발 환경

이 환경은 원격 Supabase 프로젝트를 건드리지 않고 저장소의 모든 migration과 로그인 흐름을 검증하기 위한 팀 공용 개발 DB입니다.

## 준비물

- Node.js 20 이상과 `npm install`이 끝난 저장소
- 실행 중인 Docker Desktop 또는 Docker 호환 런타임
- Supabase CLI
  - 프로젝트 설치: `npm install --save-dev supabase`
  - 또는 [Supabase 공식 CLI 설치 방법](https://supabase.com/docs/guides/local-development/cli/getting-started)에 따라 전역 설치
- Windows에서는 Git Bash에서 명령을 실행합니다.

## 한 번에 시작하기

```bash
bash scripts/dev-db.sh
```

스크립트는 다음 작업을 순서대로 수행합니다.

1. `.tmp/dev-db`에 폐기 가능한 Supabase 프로젝트를 만듭니다.
2. `supabase/migrations`를 임시 프로젝트로 복사합니다.
3. 같은 migration version이 두 번 나오면 두 번째 임시 파일에만 고유 version을 부여합니다. 원본 파일은 수정하지 않습니다.
4. `0027_instagram_marketing_assets_bucket.sql`은 public bucket 생성만 임시 사본에 유지합니다. 로컬 migration 역할이 소유하지 않는 `storage.objects`의 RLS·policy DDL은 제외합니다.
5. 기본 Supabase 포트가 아닌 빈 포트 묶음을 자동으로 찾습니다. 기본 검색은 55320번대부터 시작합니다.
6. 모든 migration과 `supabase/seed.sql`을 적용합니다.
7. 로컬 관리자와 일반 사용자를 생성하고 두 계정 모두 비밀번호 로그인을 실제로 검증합니다.
8. 로컬 접속 키를 `.env.local.supabase`에 저장합니다. 이 파일은 git에서 제외됩니다.

첫 실행은 Supabase Docker 이미지를 내려받기 때문에 수 분이 걸릴 수 있습니다.

## 시드 계정

| 구분 | 이메일 | 비밀번호 | Auth app metadata |
|---|---|---|---|
| 로컬 관리자 | `admin@autobiz.local` | `Admin1234!` | `role: admin` |
| 일반 사용자 | `user@autobiz.local` | `User1234!` | `role: user` |

이 계정은 로컬 컨테이너에서만 사용합니다. `role: admin`은 개발 데이터 구분용 metadata이며 운영 관리자 권한을 추가하지 않습니다.

값을 바꾸려면 실행 전에 환경변수를 설정합니다.

```bash
DEV_ADMIN_EMAIL=owner@example.test \
DEV_ADMIN_PASSWORD='LocalOwner1234!' \
DEV_USER_EMAIL=member@example.test \
DEV_USER_PASSWORD='LocalMember1234!' \
bash scripts/dev-db.sh reset
```

## Next.js 연결

스크립트가 생성한 `.env.local.supabase`의 Supabase 항목을 `.env.local`에 복사합니다. 기존 외부 API 키가 있다면 `.env.local` 전체를 덮어쓰지 말고 다음 세 값만 교체합니다.

```dotenv
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
```

그다음 애플리케이션을 실행합니다.

```bash
npm run dev
```

## 반복 실행과 초기화

```bash
# 새 migration 사본을 반영하고 미적용 migration 실행
bash scripts/dev-db.sh start

# 로컬 DB를 지우고 전체 migration + seed + 계정 시드 재적용
bash scripts/dev-db.sh reset

# 컨테이너 중지. 데이터는 유지
bash scripts/dev-db.sh stop
```

자동 선택된 포트가 팀원의 다른 서비스와 겹치면 100 이상의 offset을 지정할 수 있습니다. 이 값은 새 임시 프로젝트를 만들 때 적용됩니다.

```bash
DEV_DB_PORT_OFFSET=2000 bash scripts/dev-db.sh
```

이미 만들어진 프로젝트의 포트를 바꾸려면 먼저 `stop`한 뒤 `.tmp/dev-db`를 삭제하고 다시 시작합니다.

## 문제 해결

- `Docker가 실행 중이 아닙니다`: Docker Desktop을 시작한 다음 재실행합니다.
- `Supabase CLI를 찾지 못했습니다`: `npm install --save-dev supabase` 또는 공식 전역 설치를 사용합니다.
- migration을 처음부터 확인해야 함: `bash scripts/dev-db.sh reset`을 실행합니다.
- 변환 결과 확인: `.tmp/dev-db/supabase/migrations/LOCAL_MIGRATION_MANIFEST.json`에서 원본과 임시 파일명을 비교합니다.
- 로컬 환경 전체를 새로 만들기: `stop` 후 `.tmp/dev-db`를 삭제하고 다시 실행합니다. `.tmp` 아래만 삭제하며 `supabase/migrations` 원본은 삭제하지 않습니다.

Supabase CLI는 `start` 시 migration 적용 후 seed를 실행합니다. 자세한 동작은 [공식 로컬 개발 문서](https://supabase.com/docs/guides/local-development)와 [공식 seeding 문서](https://supabase.com/docs/guides/local-development/seeding-your-database)를 참고하세요.

