# 채널 지표 수집 — 매일 06:00 KST 자동 수집

2026-10-13에 방식이 바뀌었습니다. **새로 등록할 cron 작업은 없습니다.** 이미 운영 중인 5분 틱을 그대로 씁니다.

```
pg_cron (5분마다, 0014/0018) → Edge Function run-due-automations → POST /api/cron/run-automations (x-cron-secret)
                                                                      └ processDueChannels(): next_snapshot_at 이 지난 ACTIVE 채널만 수집
```

## 왜 이렇게 했나

- 채널을 등록하면 `tracked_channels.next_snapshot_at` 을 **다음 06:00 KST(= UTC 21:00)** 로 둡니다. 수집이 끝나면 다시 다음 날 06:00 KST 로 옮겨요.
  그래서 5분 틱이 06:00~06:05 사이에 모든 채널을 집어 갑니다. 새 스케줄러·유료 인프라가 필요 없고, Vercel Hobby의 시간 단위 cron 정밀도 문제도 피합니다.
- KST는 일광절약시간이 없어 UTC 21:00 이 항상 맞습니다. 스냅샷의 `recorded_date` 는 DB가 KST 날짜로 계산해 같은 날 다시 수집해도 같은 행을 갱신합니다(중복 없음).
- `/api/cron/collect-metrics` 도 남아 있지만(같은 비밀값 인증, 같은 함수) 일상 경로가 아닙니다. 수동 점검용이에요.

## 안전장치

| 상황 | 동작 |
|---|---|
| 두 틱·관리자 클릭이 겹침 | `next_snapshot_at` compare-and-set 으로 먼저 잡은 쪽만 수집(다른 쪽은 건너뜀) |
| 한 채널 실패 | 다른 채널은 계속. 이전 정상 데이터는 건드리지 않음 |
| 실패 재시도 | 30분 뒤 재시도, 같은 슬롯에서 3번 실패하면 다음 06:00 KST까지 대기, 연속 12번 실패하면 `PAUSED` |
| YouTube 할당량 소진 | 채널 탓이 아님. 그 틱의 남은 YouTube 채널은 호출하지 않고 1시간 뒤 재시도. 블로그는 계속 수집 |
| 블로그를 읽을 수 없음 | `UNAVAILABLE` (0으로 저장하지 않음). 반복되면 실패 일수로 세어 일시중지 |
| 시간 초과 | 틱의 시간 예산을 넘기면 나머지는 다음 틱(5분 뒤)에 처리 |
| 오래된 데이터 | 200일이 지난 스냅샷은 정리 |

## 기록과 수동 실행

- 일을 한 모든 배치는 `channel_collection_runs` 에 남습니다(트리거 CRON/MANUAL_ADMIN/MANUAL_USER, 성공·실패·건너뜀 수, 할당량 소진 여부, 오류 요약). 고객은 읽을 수 없고 관리자 `/admin/collection` 에서만 봅니다.
- 관리자 "지금 수집"은 모든 활성 채널을 한 번 더 수집하며 10분에 한 번만 가능합니다(YouTube 할당량 보호). 감사 로그에 남아요.
- 사용자는 자기 채널을 하루 한 번 "지금 수집"할 수 있습니다(KST 날짜 기준).

## 운영에서 확인할 것 (사람)

```sql
select jobname, schedule, active from cron.job;      -- run-due-automations  */5 * * * *  active
select started_at, trigger, status, channels_total, channels_succeeded, channels_failed, quota_exceeded
  from channel_collection_runs order by started_at desc limit 10;
```

`CRON_SECRET`(Vercel)과 Edge Function secret 이 같아야 하고, `YOUTUBE_API_KEY` 가 Production 에 있어야 합니다.
