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
  bad("ANIMATION_PROVIDER", `"${env.ANIMATION_PROVIDER ?? "(unset → mock)"}" — set fal to really animate characters (optional)`);
}
if (env.VIDEO_RENDER_PROVIDER !== "json2video") {
  bad("VIDEO_RENDER_PROVIDER", `"${env.VIDEO_RENDER_PROVIDER ?? "(unset → mock)"}" — set json2video for real videos`);
} else {
  if (!env.VIDEO_RENDER_API_KEY) bad("VIDEO_RENDER_API_KEY", "not set");
  else ok("VIDEO_RENDER_API_KEY", "설정됨(유효성은 첫 영상 만들기에서 확인돼요)");
  if (!env.VIDEO_RENDER_TEMPLATE_ID) bad("VIDEO_RENDER_TEMPLATE_ID", "not set — docs/VIDEO_RENDERING.md 의 템플릿을 만든 뒤 ID를 넣으세요");
  else ok("VIDEO_RENDER_TEMPLATE_ID", "설정됨");
}

// --- Billing safety ---------------------------------------------------------
if (env.BILLING_PROVIDER === "mock" && env.ALLOW_MOCK_BILLING !== "true") {
  bad("BILLING_PROVIDER", "mock 결제는 운영 환경에서 막혀 있어요. toss로 바꾸거나(데모라면) ALLOW_MOCK_BILLING=true");
}

for (const { name, state, detail } of results) console.log(`${state === "OK" ? "✅" : "❌"} ${name}: ${detail}`);
process.exit(results.some((entry) => entry.state === "FIX") ? 1 : 0);
