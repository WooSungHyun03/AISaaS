#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
WORK_ROOT="$REPO_ROOT/.tmp/dev-db"
STATUS_ENV="$WORK_ROOT/supabase-status.env"
COMMAND="${1:-start}"

if [[ "$WORK_ROOT" != "$REPO_ROOT/.tmp/dev-db" ]]; then
  echo "[dev-db] 안전하지 않은 임시 경로입니다: $WORK_ROOT" >&2
  exit 1
fi

resolve_supabase_cli() {
  if [[ -x "$REPO_ROOT/node_modules/.bin/supabase" ]]; then
    SUPABASE_CMD=("$REPO_ROOT/node_modules/.bin/supabase")
  elif command -v supabase >/dev/null 2>&1; then
    SUPABASE_CMD=(supabase)
  elif command -v npx >/dev/null 2>&1; then
    SUPABASE_CMD=(npx --yes supabase@latest)
  else
    echo "[dev-db] Supabase CLI를 찾지 못했습니다. npm install -D supabase 또는 공식 CLI 설치 후 다시 실행해주세요." >&2
    exit 1
  fi
}

require_runtime() {
  command -v node >/dev/null 2>&1 || { echo "[dev-db] Node.js 20 이상이 필요합니다." >&2; exit 1; }
  command -v docker >/dev/null 2>&1 || { echo "[dev-db] Docker Desktop과 docker CLI가 필요합니다." >&2; exit 1; }
  docker info >/dev/null 2>&1 || { echo "[dev-db] Docker가 실행 중이 아닙니다. Docker Desktop을 먼저 시작해주세요." >&2; exit 1; }
}

resolve_supabase_cli

if [[ "$COMMAND" == "stop" ]]; then
  if [[ ! -f "$WORK_ROOT/supabase/config.toml" ]]; then
    echo "[dev-db] 중지할 로컬 DB가 없습니다."
    exit 0
  fi
  "${SUPABASE_CMD[@]}" stop --workdir "$WORK_ROOT"
  exit 0
fi

if [[ "$COMMAND" != "start" && "$COMMAND" != "reset" ]]; then
  echo "Usage: bash scripts/dev-db.sh [start|reset|stop]" >&2
  exit 1
fi

require_runtime
mkdir -p "$WORK_ROOT"

NEW_PROJECT=false
if [[ ! -f "$WORK_ROOT/supabase/config.toml" ]]; then
  rm -rf -- "$WORK_ROOT"
  mkdir -p "$WORK_ROOT"
  "${SUPABASE_CMD[@]}" init --workdir "$WORK_ROOT"
  NEW_PROJECT=true
fi

if [[ "$NEW_PROJECT" == "true" ]]; then
  node "$SCRIPT_DIR/prepare-dev-db.mjs" "$REPO_ROOT" "$WORK_ROOT"
else
  # Keep the already-selected ports/container identity, but refresh every
  # disposable migration copy from git before applying pending migrations.
  DEV_DB_KEEP_PORTS=1 node "$SCRIPT_DIR/prepare-dev-db.mjs" "$REPO_ROOT" "$WORK_ROOT"
fi

"${SUPABASE_CMD[@]}" start --workdir "$WORK_ROOT"

if [[ "$COMMAND" == "reset" ]]; then
  "${SUPABASE_CMD[@]}" db reset --local --workdir "$WORK_ROOT"
else
  "${SUPABASE_CMD[@]}" migration up --local --workdir "$WORK_ROOT"
fi

"${SUPABASE_CMD[@]}" status --workdir "$WORK_ROOT" --output env > "$STATUS_ENV"
node "$SCRIPT_DIR/seed-dev-users.mjs" "$STATUS_ENV" "$REPO_ROOT"

echo
echo "[dev-db] 로컬 Supabase 준비 완료"
echo "[dev-db] 환경 변수: .env.local.supabase (필요한 값을 .env.local에 복사)"
echo "[dev-db] 관리자: ${DEV_ADMIN_EMAIL:-admin@autobiz.local} / ${DEV_ADMIN_PASSWORD:-Admin1234!}"
echo "[dev-db] 사용자: ${DEV_USER_EMAIL:-user@autobiz.local} / ${DEV_USER_PASSWORD:-User1234!}"
echo "[dev-db] 종료: bash scripts/dev-db.sh stop"

