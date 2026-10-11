import "server-only";

import { createClient } from "@/lib/supabase/server";
import { toSafeAutomationRunOutput } from "./run-output";

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
  if (runError) throw new Error("이용내역을 불러오지 못했습니다.", { cause: runError });
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
