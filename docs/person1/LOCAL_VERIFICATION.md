# 로컬 검증 기록 (사람1)

## 2026-10-10 — 티켓 1-1: `0034`~`0036` 마이그레이션 적용 + RLS 교차 확인

커밋 `0c42e92`(채널 진단 도메인 모델) 시점에는 Docker가 떠 있지 않아 로컬 DB 적용을 확인하지 못했습니다. Docker Desktop을 켠 뒤 다시 확인했습니다.

### 마이그레이션 적용

`bash scripts/dev-db.sh reset` — `0001_extensions.sql`부터 `0036_marketing_metric_snapshots.sql`까지(레거시 `001801_setup_request_funnel.sql` 포함) **전체 36개 마이그레이션이 에러 없이 순서대로 적용**됐습니다. 이어서 관리자/일반 사용자 시드 계정 로그인 검증도 정상이었습니다.

### RLS 교차 확인

`admin@autobiz.local`/`user@autobiz.local` 두 시드 계정으로, 각자 소유한 business 아래 `tracked_channels`(유튜브 채널 1개) → `channel_diagnoses`(진단 1건) → `marketing_metric_snapshots`(스냅샷 1건)을 만들고, PostgREST가 쓰는 것과 같은 방식으로 `request.jwt.claim.sub`를 바꿔가며 직접 Postgres에 쿼리했습니다(테스트 데이터는 확인 후 정리함).

| 확인 | 결과 |
|---|---|
| 다른 사용자가 `tracked_channels` SELECT | 0건 |
| 다른 사용자가 `channel_diagnoses` SELECT | 0건 |
| 다른 사용자가 `marketing_metric_snapshots` SELECT | 0건 |
| 다른 사용자가 admin 소유 business에 `tracked_channels` INSERT 시도 | 차단 — `42501: new row violates row-level security policy for table "tracked_channels"` |
| 공격 시도 후 admin 쪽 row 개수 | 1건 (변화 없음, 삽입 안 됨) |
| 실제 소유자(admin)로 동일 테이블 SELECT | 전부 1건 (정상 조회) |

**결론**: 1-1 완료 조건 중 "migration이 로컬에서 적용되고 다른 사용자 접근이 RLS로 막힌다"는 실제로 충족됩니다.

## 2026-10-10 — 티켓 1-6: `0037`~`0039` 마이그레이션 적용 (1차 실패 → 원인 수정 → 재확인)

### 1차 시도: 실패

`0038_marketing_metric_snapshots_dedup_and_seed.sql`의 `recorded_date date generated always as ((recorded_at + interval '9 hours')::date) stored`가 아래 에러로 실패했습니다.

```
ERROR: generation expression is not immutable (SQLSTATE 42P17)
```

**원인**: `timestamptz`를 `date`로 캐스팅하는 연산은 내부적으로 세션의 `TimeZone` 설정을 거치기 때문에 Postgres가 STABLE(IMMUTABLE 아님)로 분류합니다 — generated column은 IMMUTABLE 표현식만 허용합니다.

**수정**: `extract(epoch from <interval>)`로 바꿨습니다 — `timestamptz - timestamptz`는 interval을 만들고, interval의 epoch 추출은 타임존과 무관해서 IMMUTABLE입니다. 거기서 나온 "1970-01-01 UTC로부터의 초"에 9시간을 더하고 86400으로 나눠 KST 기준 날짜 수를 구한 뒤 `date '1970-01-01' + N`(순수 날짜 연산, 역시 IMMUTABLE)으로 최종 날짜를 만듭니다. 로컬 스크래치 테이블로 먼저 검증한 뒤 마이그레이션에 반영했습니다.

### 2차 시도: 성공

```bash
bash scripts/dev-db.sh reset
```
`0001`~`0039`(레거시 `001801` 포함) **전체 마이그레이션이 에러 없이 적용**됐습니다. `pg_cron` extension도 정상 활성화됨을 확인(`select extname from pg_extension where extname='pg_cron';` → 1 row).

### 데모 시드 + 중복 수집(upsert) 실제 확인

- `docker exec -i ... psql ... < scripts/seed-growth-demo.sql`을 **두 번** 실행 — 데모 사업체/채널 1개 생성, `source='DEMO_SEED'` 스냅샷 192건(96일 × 2지표) 생성, 재실행해도 192건 그대로(중복 안 생김, upsert 확인).
- 같은 채널/지표에 같은 KST 날짜로 서로 다른 값 2번 insert(`111` → `222`) → 최종적으로 **row 1개, 값은 최신(222)** — "같은 날 두 번 수집해도 스냅샷 1건"을 실제 DB에서 확인. 테스트 row는 정리함.

**결론**: 1-6의 "같은 날 두 번 수집해도 스냅샷이 1건"과 "0039가 로컬 db reset에서 에러 없이 적용"이 실제로 확인됐습니다.
