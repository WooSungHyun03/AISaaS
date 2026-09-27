import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { AutomationRunSource, AutomationRunStatus } from "@/types/domain";
import { toSafeAutomationRunOutput } from "./run-output";

export type RunHistoryFilter = Extract<AutomationRunStatus, "SUCCESS" | "FAILED" | "RUNNING">;

export interface AutomationRunHistoryItem {
  id: string;
  automationId: string;
  automationName: string;
  source: AutomationRunSource;
  status: AutomationRunStatus;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

const PAGE_SIZE = 25;

export async function getAutomationRunHistory(userId: string, status: RunHistoryFilter | null, page: number) {
  const supabase = await createClient();
  const { data: automations, error: automationError } = await supabase
    .from("automations")
    .select("id,name")
    .eq("user_id", userId);
  if (automationError) throw new Error("자동화 목록을 불러오지 못했습니다.", { cause: automationError });

  const automationNames = new Map((automations ?? []).map((automation) => [automation.id, automation.name]));
  const automationIds = [...automationNames.keys()];
  if (automationIds.length === 0) return { runs: [], total: 0, pageSize: PAGE_SIZE };

  let query = supabase
    .from("automation_runs")
    .select("id,automation_id,source,status,started_at,completed_at,created_at", { count: "exact" })
    .in("automation_id", automationIds)
    .order("created_at", { ascending: false });
  if (status) query = query.eq("status", status);

  const from = (page - 1) * PAGE_SIZE;
  const { data, count, error } = await query.range(from, from + PAGE_SIZE - 1);
  if (error) throw new Error("실행 이력을 불러오지 못했습니다.", { cause: error });

  const runs: AutomationRunHistoryItem[] = (data ?? []).map((run) => ({
    id: run.id,
    automationId: run.automation_id,
    automationName: automationNames.get(run.automation_id) ?? "삭제된 자동화",
    source: run.source,
    status: run.status,
    startedAt: run.started_at,
    completedAt: run.completed_at,
    createdAt: run.created_at,
  }));
  return { runs, total: count ?? 0, pageSize: PAGE_SIZE };
}

export async function getAutomationRunDetail(userId: string, automationId: string, runId: string) {
  const supabase = await createClient();
  const { data: automation, error: automationError } = await supabase
    .from("automations")
    .select("id,name")
    .eq("id", automationId)
    .eq("user_id", userId)
    .maybeSingle();
  if (automationError) throw new Error("자동화 정보를 불러오지 못했습니다.", { cause: automationError });
  if (!automation) return null;

  // input is intentionally not selected. output is converted to an allowlisted
  // display model before crossing the server/UI boundary.
  const { data: run, error: runError } = await supabase
    .from("automation_runs")
    .select("id,automation_id,status,source,output,error_message,created_at,started_at,completed_at")
    .eq("id", runId)
    .eq("automation_id", automation.id)
    .maybeSingle();
  if (runError) throw new Error("실행 기록을 불러오지 못했습니다.", { cause: runError });
  if (!run) return null;

  return {
    automation,
    run: {
      id: run.id,
      automationId: run.automation_id,
      status: run.status,
      source: run.source,
      createdAt: run.created_at,
      startedAt: run.started_at,
      completedAt: run.completed_at,
      errorMessage: run.error_message,
      output: toSafeAutomationRunOutput(run.output),
    },
  };
}
