import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { buildShortsPublishing, shortsPublishingSchema } from "./publishing-metadata";

/** Real database + RLS. Needs `bash scripts/dev-db.sh`; skipped otherwise (RUN_DB_TESTS=1 to run). */
function localEnv(): Record<string, string> | null {
  try {
    const text = readFileSync(path.join(process.cwd(), ".env.local.supabase"), "utf8");
    return Object.fromEntries(text.split(/\r?\n/).map((line) => /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())).filter((m): m is RegExpExecArray => Boolean(m)).map((m) => [m[1], m[2].replace(/^['"]|['"]$/g, "")]));
  } catch {
    return null;
  }
}
const env = process.env.RUN_DB_TESTS ? localEnv() : null;
const suite = env ? describe : describe.skip;
type Db = SupabaseClient<Database>;

suite("Short posting text on content_history (migration 0072)", () => {
  const url = env?.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
  const stamp = Date.now();
  let admin: Db;
  const users: Array<{ id: string; db: Db }> = [];
  let contentId = "";

  beforeAll(async () => {
    admin = createClient<Database>(url, env!.SUPABASE_SERVICE_ROLE_KEY, options);
    for (const label of ["a", "b"]) {
      const email = `pub-${label}-${stamp}@autobiz.local`;
      const created = await admin.auth.admin.createUser({ email, password: "Publish-test-1!", email_confirm: true });
      if (created.error || !created.data.user) throw created.error ?? new Error("user not created");
      const db = createClient<Database>(url, env!.NEXT_PUBLIC_SUPABASE_ANON_KEY, options);
      const signedIn = await db.auth.signInWithPassword({ email, password: "Publish-test-1!" });
      if (signedIn.error) throw signedIn.error;
      users.push({ id: created.data.user.id, db });
    }
    const [a] = users;
    const business = await admin.from("businesses").insert({ owner_id: a.id, name: "테스트 빵집" }).select("id").single();
    const template = await admin.from("automation_templates").select("id").eq("slug", "shorts").single();
    if (business.error || template.error) throw business.error ?? template.error;
    const automation = await admin.from("automations").insert({ user_id: a.id, business_id: business.data.id, template_id: template.data.id, name: "숏폼", schedule: { frequency: "DAILY", timeOfDay: "09:00" } } as never).select("id").single();
    if (automation.error) throw automation.error;
    const publishing = buildShortsPublishing({ promotionType: "STORE", businessName: "테스트 빵집", industry: null, location: null, keywords: ["소금빵"], topic: "소금빵 예약", hook: "소금빵 예약하셨나요?", sceneTexts: ["소금빵 예약하셨나요?", "전날 예약하면 아침에 바로"], link: null });
    const content = await admin.from("content_history").insert({ business_id: business.data.id, automation_id: automation.data.id, content_type: "shorts", title: "t", content: "script" }).select("id").single();
    if (content.error) throw content.error;
    contentId = content.data.id;
    expect((await admin.from("content_history").update({ publishing: publishing as never }).eq("id", contentId)).error).toBeNull();
  });

  afterAll(async () => {
    for (const user of users) await admin.auth.admin.deleteUser(user.id);
  });

  it("stores and returns the posting text, and the owner can read it back in the shape the app expects", async () => {
    const [a] = users;
    const { data, error } = await a.db.from("content_history").select("publishing").eq("id", contentId).single();
    expect(error).toBeNull();
    expect(shortsPublishingSchema.safeParse(data?.publishing).success).toBe(true);
  });

  it("does not let a customer edit it directly, and another customer cannot even see it", async () => {
    const [a, b] = users;
    const direct = await a.db.from("content_history").update({ publishing: { title: "직접 수정" } as never }).eq("id", contentId).select("id");
    expect(direct.data ?? []).toEqual([]);
    const { data: other } = await b.db.from("content_history").select("id").eq("id", contentId);
    expect(other ?? []).toEqual([]);
    const { data: stored } = await admin.from("content_history").select("publishing").eq("id", contentId).single();
    expect(shortsPublishingSchema.safeParse(stored?.publishing).success).toBe(true);
  });

  it("only accepts a JSON object", async () => {
    const result = await admin.from("content_history").update({ publishing: ["x"] as never }).eq("id", contentId);
    expect(result.error).not.toBeNull();
  });
});
