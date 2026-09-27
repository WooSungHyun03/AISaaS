import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { SetupRequestContactMethod } from "@/types/domain";

export interface CreateSetupRequestInput {
  automationType: string;
  currentWork: string;
  desiredOutcome: string;
  budgetRange: string;
  contactMethod: SetupRequestContactMethod;
  contactValue: string;
  notes: string | null;
}

export async function createSetupRequestRecord(userId: string, input: CreateSetupRequestInput) {
  const supabase = await createClient();
  const { data: business, error: businessError } = await supabase
    .from("businesses")
    .select("id")
    .eq("owner_id", userId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (businessError) throw businessError;

  const { data, error } = await supabase
    .from("setup_requests")
    .insert({
      user_id: userId,
      business_id: business?.id ?? null,
      automation_type: input.automationType,
      current_work: input.currentWork,
      desired_outcome: input.desiredOutcome,
      budget_range: input.budgetRange,
      contact_method: input.contactMethod,
      contact_value: input.contactValue,
      description: input.notes,
    })
    .select("id,status,created_at")
    .single();
  if (error) throw error;
  return data;
}

export async function getSetupRequest(userId: string, requestId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("setup_requests")
    .select("id,automation_type,current_work,desired_outcome,budget_range,contact_method,contact_value,description,status,created_at,updated_at")
    .eq("id", requestId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getRecentSetupRequests(userId: string, limit = 3) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("setup_requests")
    .select("id,automation_type,status,created_at,updated_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}
