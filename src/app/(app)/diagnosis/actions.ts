"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { diagnoseWebsite, DiagnosisError } from "@/server/marketing/diagnosis";
import type { ScoreItem } from "@/server/marketing/scoring";
import { ChannelsError, DiagnosisRateLimitError, channelPlatformSchema, diagnoseChannel, registerAndDiagnoseChannel } from "@/server/channels";
import type { ChannelPlatform } from "@/server/channels";
import type { BusinessSnsLinks, Json } from "@/types/domain";

export interface ChannelActionState {
  error?: string;
  channelId?: string;
}

/** Shared by addChannel/rediagnoseChannel below — maps every error diagnoseChannel/registerAndDiagnoseChannel can throw to a Korean message. */
function describeChannelError(error: unknown): string {
  if (error instanceof DiagnosisRateLimitError) return error.message;
  if (error instanceof ChannelsError) return "채널 정보를 처리하는 중 오류가 발생했어요. 잠시 후 다시 시도해주세요.";
  if (error instanceof Error && "code" in error) {
    switch ((error as Error & { code?: string }).code) {
      case "QUOTA_EXCEEDED":
        return "유튜브 API 할당량을 초과했어요. 잠시 후 다시 시도해주세요.";
      case "CHANNEL_NOT_FOUND":
        return "채널을 찾을 수 없어요. 주소를 확인해주세요.";
      case "TIMEOUT":
        return "응답이 지연됐어요. 잠시 후 다시 시도해주세요.";
      case "RATE_LIMITED":
        return "요청이 많아 잠시 제한됐어요. 잠시 후 다시 시도해주세요.";
      case "INVALID_API_KEY":
      case "INVALID_CREDENTIALS":
        return "채널 데이터 연동 설정에 문제가 있어요. 관리자에게 문의해주세요.";
      case "INVALID_RESPONSE":
        return "채널 정보를 해석하지 못했어요.";
      default:
        return "채널 진단 중 오류가 발생했어요. 잠시 후 다시 시도해주세요.";
    }
  }
  return "채널 진단 중 알 수 없는 오류가 발생했어요.";
}

/**
 * "채널 추가" — URL을 파싱해 tracked_channels에 등록(이미 등록돼 있으면 그대로
 * 재사용)하고 바로 진단한다. 같은 URL을 다시 제출하면 "다시 진단하기"와
 * 동일하게 동작한다(registerAndDiagnoseChannel이 등록 여부를 알아서 처리).
 */
export async function addChannel(_prevState: ChannelActionState, formData: FormData): Promise<ChannelActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "로그인이 필요합니다." };

  const businessId = String(formData.get("businessId") ?? "");
  const url = String(formData.get("url") ?? "").trim();
  const platformHintRaw = String(formData.get("platformHint") ?? "");
  if (!businessId || !url) return { error: "채널 주소를 입력해주세요." };

  const { data: business, error: businessError } = await supabase.from("businesses").select("id").eq("id", businessId).eq("owner_id", user.id).maybeSingle();
  if (businessError) return { error: "사업체 정보를 확인하는 중 오류가 발생했습니다." };
  if (!business) return { error: "본인의 사업체를 선택해주세요." };

  const platformHintParsed = channelPlatformSchema.safeParse(platformHintRaw);
  const platformHint: ChannelPlatform | undefined = platformHintParsed.success ? platformHintParsed.data : undefined;

  let result;
  try {
    result = await registerAndDiagnoseChannel(businessId, url, platformHint);
  } catch (error) {
    return { error: describeChannelError(error) };
  }
  if (!result.ok) return { error: result.message };

  revalidatePath("/diagnosis");
  return { channelId: result.channelId };
}

/** "다시 진단하기" — 이미 등록된 채널 하나를 다시 진단한다(1시간 캐시/시간당 한도는 diagnoseChannel 내부에서 그대로 적용됨). */
export async function rediagnoseChannel(channelId: string): Promise<ChannelActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "로그인이 필요합니다." };

  // RLS already scopes this select to the caller's own businesses, same as collectChannelNow.
  const { data: channel, error: channelError } = await supabase
    .from("tracked_channels")
    .select("id, business_id, external_id, url, platform")
    .eq("id", channelId)
    .maybeSingle();
  if (channelError) return { error: "채널 정보를 불러오지 못했습니다." };
  if (!channel) return { error: "채널을 찾을 수 없습니다." };

  const { data: business } = await supabase.from("businesses").select("name").eq("id", channel.business_id).maybeSingle();

  try {
    await diagnoseChannel(
      { id: channel.id, business_id: channel.business_id, external_id: channel.external_id, url: channel.url, platform: channelPlatformSchema.parse(channel.platform) },
      business?.name,
    );
  } catch (error) {
    return { error: describeChannelError(error) };
  }

  revalidatePath("/diagnosis");
  return { channelId: channel.id };
}

export interface DiagnosisProfileSuggestions {
  mainOffering: string | null;
  strengths: string | null;
  marketingGoal: string | null;
  snsLinks: BusinessSnsLinks;
}

/** At most this many diagnoses per business per hour: each one fetches a page and may call the AI. */
const DIAGNOSES_PER_HOUR = 5;

export interface DiagnosisResultView {
  id: string;
  score: number;
  /** Why the score is what it is — every item has points, max and a one-sentence reason. */
  scoreBreakdown: ScoreItem[];
  /** Quote from the page that backs each AI-suggested profile value. */
  evidence: Record<string, string>;
  createdAt: string | null;
  missingChannels: string[];
  contentStatus: string;
  snsActivity: string;
  recommendations: string[];
  sourceUrl: string | null;
  /**
   * Suggested Business Profile values (ticket 2) — never written to
   * `businesses` by this action. Purely a pass-through for the client to
   * offer as form defaultValues; only an explicit save in
   * BusinessFormDialog (src/components/business/business-form-dialog.tsx)
   * persists anything.
   */
  /** Only present right after a fresh diagnosis; stored results keep just the evidence. */
  profileSuggestions?: DiagnosisProfileSuggestions;
}

export interface DiagnosisActionState {
  error?: string;
  result?: DiagnosisResultView;
}

function describeDiagnosisError(error: unknown): string {
  if (error instanceof DiagnosisError) {
    switch (error.code) {
      case "INVALID_URL":
        return "올바른 홈페이지 주소를 입력해주세요 (http:// 또는 https://).";
      case "BLOCKED_TARGET":
        return "내부/사설 네트워크 주소는 진단할 수 없습니다. 외부에 공개된 주소를 입력해주세요.";
      case "TOO_MANY_REDIRECTS":
        return "리다이렉트가 너무 많아 홈페이지를 열 수 없습니다.";
      case "UNSUPPORTED_CONTENT":
        return "HTML 페이지만 진단할 수 있습니다.";
      case "TOO_LARGE":
        return "페이지 용량이 너무 커서 진단할 수 없습니다.";
      case "AI_INVALID_RESPONSE":
        return "AI 진단 결과를 처리하지 못했습니다. 잠시 후 다시 시도해주세요.";
      case "FETCH_FAILED":
      default:
        return "홈페이지에 연결하지 못했습니다. 주소를 확인한 뒤 다시 시도해주세요.";
    }
  }
  return "진단 중 알 수 없는 오류가 발생했습니다.";
}

/**
 * Fetches+analyzes `url` for the caller's own business and persists the
 * result. Ownership is enforced twice — once explicitly below (so a bad
 * businessId fails fast with a clear message) and again by
 * marketing_diagnoses_insert_own's RLS policy on the insert itself (see
 * supabase/migrations/0028_marketing_diagnoses.sql) — so this can never
 * write a diagnosis against a business the caller doesn't own, even if the
 * explicit check above were ever removed.
 */
export async function runDiagnosis(_prevState: DiagnosisActionState, formData: FormData): Promise<DiagnosisActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "로그인이 필요합니다." };

  const businessId = String(formData.get("businessId") ?? "");
  const url = String(formData.get("url") ?? "").trim();
  if (!businessId || !url) return { error: "사업체와 홈페이지 주소를 확인해주세요." };

  const { data: business, error: businessError } = await supabase
    .from("businesses")
    .select("id, name, industry, sns_links")
    .eq("id", businessId)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (businessError) return { error: "사업체 정보를 확인하는 중 오류가 발생했습니다." };
  if (!business) return { error: "본인의 사업체를 선택해주세요." };

  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count: recentCount } = await supabase
    .from("marketing_diagnoses")
    .select("id", { count: "exact", head: true })
    .eq("business_id", business.id)
    .gte("created_at", since);
  if ((recentCount ?? 0) >= DIAGNOSES_PER_HOUR) {
    return { error: "진단을 너무 자주 요청했어요. 잠시 뒤(최대 1시간)에 다시 시도해주세요." };
  }

  const { data: connections } = await supabase
    .from("integration_connections")
    .select("provider")
    .eq("user_id", user.id)
    .eq("business_id", business.id)
    .eq("status", "CONNECTED");

  let outcome;
  try {
    outcome = await diagnoseWebsite(business, url, {
      profileSnsLinks: (business.sns_links && typeof business.sns_links === "object" && !Array.isArray(business.sns_links) ? business.sns_links : {}) as BusinessSnsLinks,
      connectedProviders: (connections ?? []).map((connection) => connection.provider),
    });
  } catch (error) {
    return { error: describeDiagnosisError(error) };
  }

  const baseRow = {
    business_id: business.id,
    source_type: "website" as const,
    source_url: outcome.sourceUrl,
    score: outcome.score,
    missing_channels: outcome.missingChannels,
    content_status: outcome.contentStatus,
    sns_activity: outcome.snsActivity,
    recommendations: outcome.recommendations,
    raw_summary: outcome.rawSummary,
  };
  const withBreakdown = {
    ...baseRow,
    score_breakdown: outcome.scoreBreakdown as unknown as Json,
    evidence: outcome.evidence as unknown as Json,
  };
  let { data: inserted, error: insertError } = await supabase
    .from("marketing_diagnoses")
    .insert(withBreakdown)
    .select("id, created_at")
    .single();
  // 0032_audit_hardening.sql adds score_breakdown/evidence. If the code is deployed a moment before
  // that migration runs, store the diagnosis without them instead of failing the whole request.
  if (insertError && (insertError.code === "PGRST204" || insertError.code === "42703")) {
    ({ data: inserted, error: insertError } = await supabase.from("marketing_diagnoses").insert(baseRow).select("id, created_at").single());
  }
  if (insertError || !inserted) return { error: "진단 결과를 저장하지 못했습니다." };

  // 사람1(ticket 1-5): the website-diagnosis UI moved to /business (see
  // AutoFillFromWebsiteButton) — /marketing/diagnosis is now just a
  // redirect to /diagnosis and never renders this data.
  revalidatePath("/business");
  revalidatePath("/calendar");
  revalidatePath("/marketing/calendar");
  return {
    result: {
      id: inserted.id,
      createdAt: inserted.created_at ?? null,
      score: outcome.score,
      scoreBreakdown: outcome.scoreBreakdown,
      evidence: outcome.evidence,
      missingChannels: outcome.missingChannels,
      contentStatus: outcome.contentStatus,
      snsActivity: outcome.snsActivity,
      recommendations: outcome.recommendations,
      sourceUrl: outcome.sourceUrl,
      profileSuggestions: {
        mainOffering: outcome.mainOffering,
        strengths: outcome.strengths,
        marketingGoal: outcome.marketingGoal,
        snsLinks: outcome.snsLinks,
      },
    },
  };
}
