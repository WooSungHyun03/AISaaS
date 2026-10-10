# 채널 지표 수집 — pg_cron / Edge Function 등록 (팀장 몫)

티켓 1-6은 수집 파이프라인(`/api/cron/collect-metrics`, `processDueChannels`, `cleanupOldSnapshots`)까지만 만들고 **실제 일일 작업 등록은 팀장이 합니다.** `supabase/migrations/0039_pg_cron_metrics_extension.sql`은 `pg_cron` extension만 방어적으로 활성화하고, 아래 `cron.schedule(...)` 호출은 **포함하지 않습니다** — `0014_scheduler_cron.sql`(자동화 스케줄러)은 마이그레이션 안에 `cron.schedule`을 직접 넣지만, 이번 티켓은 "등록은 제가 해요"라고 명시했기 때문에 일부러 다르게 했습니다.

## 1. pg_cron 일일 작업 등록 (준비된 SQL, 실행은 팀장이)

`run-due-automations`처럼 Edge Function을 거쳐 `/api/cron/collect-metrics`를 호출합니다. 매일 한 번(예: 새벽 3시 KST = UTC 18시)이면 충분합니다 — `tracked_channels.next_snapshot_at`이 각 채널의 실제 수집 주기를 조절하므로, cron 자체는 "하루에 한 번 깨워서 due 채널을 처리하라"는 트리거 역할만 합니다.

```sql
-- Supabase SQL Editor 또는 psql에서 직접 실행 (마이그레이션 아님)
select cron.schedule(
  'collect-channel-metrics',
  '0 18 * * *',  -- 매일 UTC 18:00 = KST 03:00
  $cron$
    select net.http_post(
      url := 'https://<project-ref>.functions.supabase.co/run-due-automations?job=metrics',
      headers := '{"Content-Type": "application/json"}'::jsonb
    );
  $cron$
);
```

`<project-ref>`는 실제 프로젝트 ref로 바꿔주세요(`0014_scheduler_cron.sql`에 적힌 것과 같은 프로젝트).

## 2. Edge Function `?job=metrics` 확장 (제안, 미적용)

`supabase/functions/`는 TEAM_GUIDE.md상 Dev1 담당 경로라 직접 수정하지 않았습니다. 기존 `run-due-automations/index.ts`에 아래와 같은 분기를 추가하는 걸 제안합니다 — 새 Edge Function을 또 만들지 않고 쿼리 파라미터로 목적지만 바꾸는 방식입니다.

```ts
// supabase/functions/run-due-automations/index.ts 에 추가 제안 (diff, 미적용)
Deno.serve(async (req) => {
  const siteUrl = Deno.env.get("SITE_URL");
  const cronSecret = Deno.env.get("CRON_SECRET");
  if (!siteUrl || !cronSecret) {
    return new Response(JSON.stringify({ error: "SITE_URL / CRON_SECRET not configured" }), { status: 500 });
  }

  const job = new URL(req.url).searchParams.get("job");
  const path = job === "metrics" ? "/api/cron/collect-metrics" : "/api/cron/run-automations";

  const response = await fetch(`${siteUrl}${path}`, { method: "POST", headers: { "x-cron-secret": cronSecret } });
  const body = await response.text();
  return new Response(body, { status: response.status });
});
```

적용 전 Dev1과 먼저 상의해주세요.

## 3. 로컬 확인 결과

`supabase db reset`으로 `0039_pg_cron_metrics_extension.sql`을 로컬에 적용한 결과는 `docs/person1/LOCAL_VERIFICATION.md`에 추가해뒀습니다 — 로컬 Supabase 컨테이너에 `pg_cron`이 있는지와 무관하게 `db reset` 자체는 에러 없이 끝나는 것(방어적 `exception when others`)을 확인했습니다.
