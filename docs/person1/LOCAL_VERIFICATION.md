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
