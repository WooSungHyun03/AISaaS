import "server-only";
import { serverEnv } from "@/lib/env/server";

export interface VideoPipelineCheck {
  /** The environment variable(s) involved: names only, never values. */
  name: string;
  label: string;
  ok: boolean;
  /** What to do when it is not ok. */
  hint: string;
  /** Without this the ad video cannot be made at all (the voice service is only needed for the "Korean voice" option). */
  required: boolean;
}

/**
 * What the ad-video pipeline needs in this deployment, one line per requirement. The run is refused when a required
 * line is not ok (see the Shorts handler's preflight); this is what lets an administrator see WHICH one, without ever
 * showing a secret.
 */
export function getVideoPipelineChecks(): VideoPipelineCheck[] {
  const env = serverEnv;
  return [
    { name: "AD_VIDEO_PROVIDER", label: "영상 생성 서비스 선택", ok: env.AD_VIDEO_PROVIDER === "fal", hint: "AD_VIDEO_PROVIDER=fal", required: true },
    { name: "FAL_KEY", label: "영상 생성(fal) 키", ok: Boolean(env.FAL_KEY), hint: "fal.ai 키를 FAL_KEY 로 넣어요", required: true },
    { name: "AI_PROVIDER", label: "AI(Claude) 선택", ok: env.AI_PROVIDER === "anthropic", hint: "AI_PROVIDER=anthropic", required: true },
    { name: "ANTHROPIC_API_KEY", label: "Claude 키", ok: Boolean(env.ANTHROPIC_API_KEY), hint: "ANTHROPIC_API_KEY", required: true },
    { name: "POSTPROCESS_PROVIDER", label: "영상 후처리 서버 선택", ok: env.POSTPROCESS_PROVIDER === "worker", hint: "POSTPROCESS_PROVIDER=worker", required: true },
    { name: "POSTPROCESS_WORKER_URL", label: "영상 후처리(FFmpeg) 서버 주소", ok: Boolean(env.POSTPROCESS_WORKER_URL), hint: "worker/ffmpeg 를 배포하고 그 https 주소를 넣어요(docs/AD_SHORTS.md)", required: true },
    { name: "POSTPROCESS_WORKER_TOKEN", label: "영상 후처리 서버 토큰", ok: Boolean(env.POSTPROCESS_WORKER_TOKEN), hint: "워커의 WORKER_TOKEN 과 같은 값(16자 이상)", required: true },
    { name: "ALLOW_PAID_AI_CALLS", label: "유료 AI 호출 허용", ok: env.ALLOW_PAID_AI_CALLS === "true", hint: "ALLOW_PAID_AI_CALLS=true", required: true },
    { name: "BUDGET_PERIOD_START/END", label: "예산 기간", ok: Boolean(env.BUDGET_PERIOD_START && env.BUDGET_PERIOD_END), hint: "BUDGET_PERIOD_START, BUDGET_PERIOD_END (YYYY-MM-DD)", required: true },
    { name: "TTS_PROVIDER · ELEVENLABS_API_KEY · TTS_VOICE_ID", label: "한국어 음성(선택)", ok: env.TTS_PROVIDER === "elevenlabs" && Boolean(env.ELEVENLABS_API_KEY) && Boolean(env.TTS_VOICE_ID), hint: "‘한국어 음성’ 옵션을 쓸 때만 필요해요", required: false },
  ];
}

/** The required requirements that are not met, by name. */
export function missingVideoRequirements(): string[] {
  return getVideoPipelineChecks().filter((check) => check.required && !check.ok).map((check) => check.name);
}
