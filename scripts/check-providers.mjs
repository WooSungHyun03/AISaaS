#!/usr/bin/env node
/**
 * Pre-flight check for the production AI + video setup. Reads the same env
 * vars the app does (from the shell or `node --env-file=.env.local`) and
 * makes ONE tiny Claude call (a few tokens, well under a cent). It never
 * generates a video (that costs money) and never prints a key.
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
  const model = env.AI_MODEL || "claude-haiku-4-5-20251001"; // pipeline roles use AI_MODEL_PLANNER/WRITER/REVIEWER/VISION (Opus 5.5 / Fable 5.1 / Sonnet 5.5 by default)
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

// --- Ad video (Wan 3.0 on fal, FFmpeg worker, Korean voice) ---------------
if (env.AD_VIDEO_PROVIDER !== "fal") {
  bad("AD_VIDEO_PROVIDER", `"${env.AD_VIDEO_PROVIDER ?? "(unset → mock)"}" — set fal for real ad videos (mock only returns a placeholder)`);
} else {
  if (!env.FAL_KEY) bad("FAL_KEY", "not set");
  else ok("FAL_KEY", `설정됨(유효성은 첫 영상에서 확인돼요 — ${env.WAN_MODEL || "alibaba/wan-3.0/reference-to-video"}, 720p 초당 $0.10)`);
  if (env.POSTPROCESS_PROVIDER !== "worker") bad("POSTPROCESS_PROVIDER", "worker가 아니에요 — 로고·문구·음성 합성을 하는 FFmpeg 서버가 필요해요(worker/ffmpeg)");
  else if (!env.POSTPROCESS_WORKER_URL || !env.POSTPROCESS_WORKER_TOKEN) bad("POSTPROCESS_WORKER_URL/TOKEN", "not set");
  else {
    try {
      const response = await fetch(`${env.POSTPROCESS_WORKER_URL.replace(/\/+$/, "")}/healthz`, { signal: AbortSignal.timeout(10_000) });
      if (response.ok) ok("FFmpeg worker", "healthz OK");
      else bad("FFmpeg worker", `healthz HTTP ${response.status}`);
    } catch (error) {
      bad("FFmpeg worker", `연결 실패: ${error instanceof Error ? error.message : error}`);
    }
  }
}
if (env.TTS_PROVIDER === "elevenlabs") {
  if (!env.ELEVENLABS_API_KEY || !env.TTS_VOICE_ID) bad("ELEVENLABS_API_KEY / TTS_VOICE_ID", "한국어 음성 보완에 둘 다 필요해요");
  else ok("한국어 음성", "설정됨(첫 사용에서 확인돼요)");
} else {
  bad("TTS_PROVIDER", `"${env.TTS_PROVIDER ?? "(unset → mock)"}" — 영상에 소리가 비었을 때 한국어 음성을 입히려면 elevenlabs로 설정하세요`);
}

// --- Spend budget -----------------------------------------------------------
if (env.ALLOW_PAID_AI_CALLS !== "true") bad("ALLOW_PAID_AI_CALLS", "true가 아니라서 유료 AI 호출이 모두 막혀 있어요(의도한 상태면 무시)");
else ok("ALLOW_PAID_AI_CALLS", "true — 유료 호출 허용");
if (!env.BUDGET_PERIOD_START || !env.BUDGET_PERIOD_END) bad("BUDGET_PERIOD_START/END", "운영 기간(YYYY-MM-DD)을 정해야 유료 생성이 돼요. 자동으로 매달 초기화되지 않아요");
else ok("예산 기간", `${env.BUDGET_PERIOD_START} ~ ${env.BUDGET_PERIOD_END} (끝 날짜 제외)`);
ok("예산 한도", `영상 $${env.BUDGET_VIDEO_USD || 50} / ${env.BUDGET_VIDEO_ITEMS || 10}편, 블로그 $${env.BUDGET_BLOG_USD || 20} / ${env.BUDGET_BLOG_ITEMS || 10}편`);

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
    "문의·환불 요청 (0062, 0064)": ["inquiries", "inquiry_messages", "refund_requests"],
    "마케팅 진단·성장 리포트 (0034~0042)": ["tracked_channels", "channel_diagnoses", "marketing_metric_snapshots"],
    "관리자 보안 (0065)": ["admin_users", "admin_audit_log"],
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
