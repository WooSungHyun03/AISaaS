#!/usr/bin/env node
/**
 * Pre-flight check for the production AI + video setup. Reads the same env
 * vars the app does (from the shell or `node --env-file=.env.local`) and
 * makes ONE tiny Claude call (a few tokens, well under a cent). It never
 * renders a video (that costs JSON2Video credits) and never prints a key.
 *
 *   node --env-file=.env.local scripts/check-providers.mjs
 */
const env = process.env;
const results = [];
const ok = (name, detail) => results.push({ name, state: "OK", detail });
const bad = (name, detail) => results.push({ name, state: "FIX", detail });

// --- AI -------------------------------------------------------------------
if (env.AI_PROVIDER !== "anthropic") {
  bad("AI_PROVIDER", `"${env.AI_PROVIDER ?? "(unset → mock)"}" — set AI_PROVIDER=anthropic for real Claude output`);
} else if (!env.ANTHROPIC_API_KEY) {
  bad("ANTHROPIC_API_KEY", "not set");
} else {
  const model = env.AI_MODEL || "claude-haiku-4-5-20251001";
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model, max_tokens: 40, messages: [{ role: "user", content: '다음 JSON만 그대로 출력: {"ok":true}' }] }),
      signal: AbortSignal.timeout(20_000),
    });
    if (response.ok) {
      const data = await response.json();
      ok("Claude", `${model} 응답 OK (입력 ${data.usage?.input_tokens ?? "?"} / 출력 ${data.usage?.output_tokens ?? "?"} 토큰)`);
    } else if (response.status === 401) bad("Claude", "키가 거부됐어요(401). ANTHROPIC_API_KEY를 확인하세요.");
    else if (response.status === 404) bad("Claude", `모델 "${model}"을(를) 찾을 수 없어요(404). AI_MODEL 값을 확인하세요.`);
    else if (response.status === 400) bad("Claude", `요청이 거부됐어요(400) — 결제 크레딧이 없을 때도 이렇게 나와요: ${(await response.text()).slice(0, 160)}`);
    else bad("Claude", `HTTP ${response.status}`);
  } catch (error) {
    bad("Claude", `연결 실패: ${error instanceof Error ? error.message : error}`);
  }
}

// --- Video ----------------------------------------------------------------
if (env.ANIMATION_PROVIDER === "fal") {
  if (!env.FAL_KEY) bad("FAL_KEY", "not set — ANIMATION_PROVIDER=fal needs it (characters would fall back to the simple motion effect)");
  else ok("FAL_KEY", "설정됨(유효성은 첫 캐릭터 영상에서 확인돼요 — 클립당 약 $0.35)");
} else {
  bad("ANIMATION_PROVIDER", `"${env.ANIMATION_PROVIDER ?? "(unset → mock)"}" — set fal to really animate characters (without it they only get the simple motion effect)`);
}
if (env.VIDEO_RENDER_PROVIDER !== "json2video") {
  bad("VIDEO_RENDER_PROVIDER", `"${env.VIDEO_RENDER_PROVIDER ?? "(unset → mock)"}" — set json2video for real videos`);
} else {
  if (!env.VIDEO_RENDER_API_KEY) bad("VIDEO_RENDER_API_KEY", "not set");
  else ok("VIDEO_RENDER_API_KEY", "설정됨(유효성은 첫 영상 만들기에서 확인돼요)");
}

// --- Billing ----------------------------------------------------------------
if (env.BILLING_PROVIDER === "mock" && env.ALLOW_MOCK_BILLING !== "true") {
  bad("BILLING_PROVIDER", "mock 결제는 운영 환경에서 막혀 있어요. toss로 바꾸거나(데모라면) ALLOW_MOCK_BILLING=true");
} else if (env.BILLING_PROVIDER === "toss") {
  const client = env.NEXT_PUBLIC_TOSS_CLIENT_KEY ?? "";
  const secret = env.TOSS_SECRET_KEY ?? "";
  if (!client) bad("NEXT_PUBLIC_TOSS_CLIENT_KEY", "not set (결제창에 필요해요. NEXT_PUBLIC 값은 설정 뒤 다시 배포해야 반영돼요)");
  else if (!client.startsWith("test_ck_")) bad("NEXT_PUBLIC_TOSS_CLIENT_KEY", "테스트 클라이언트 키(test_ck_…)만 쓸 수 있어요");
  else ok("NEXT_PUBLIC_TOSS_CLIENT_KEY", "테스트 키 형식 OK");
  if (!secret) bad("TOSS_SECRET_KEY", "not set");
  else if (!secret.startsWith("test_sk_")) bad("TOSS_SECRET_KEY", "테스트 시크릿 키(test_sk_…)만 쓸 수 있어요");
  else ok("TOSS_SECRET_KEY", "테스트 키 형식 OK");
} else {
  ok("BILLING_PROVIDER", `${env.BILLING_PROVIDER ?? "mock"} (실제 청구 없음)`);
}

// --- Database: every table the app reads must exist (a missing migration looks like a broken feature) ---
const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) {
  bad("Supabase", "NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — 테이블 점검을 건너뛰었어요");
} else {
  const required = {
    "결제·이용권 (0051~)": ["billing_orders", "credit_grants", "credit_ledger"],
    "마케팅 진단·성장 리포트 (0034~0042)": ["tracked_channels", "channel_diagnoses", "marketing_metric_snapshots"],
  };
  for (const [feature, tables] of Object.entries(required)) {
    const missing = [];
    for (const table of tables) {
      try {
        const response = await fetch(`${supabaseUrl}/rest/v1/${table}?select=*&limit=0`, {
          headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` },
          signal: AbortSignal.timeout(15_000),
        });
        if (!response.ok) missing.push(table);
      } catch {
        missing.push(`${table}(연결 실패)`);
      }
    }
    if (missing.length === 0) ok(`DB · ${feature}`, "테이블 OK");
    else bad(`DB · ${feature}`, `없는 테이블: ${missing.join(", ")} → npx supabase db push --linked 로 migration을 적용하세요`);
  }
}

for (const { name, state, detail } of results) console.log(`${state === "OK" ? "✅" : "❌"} ${name}: ${detail}`);
process.exit(results.some((entry) => entry.state === "FIX") ? 1 : 0);
