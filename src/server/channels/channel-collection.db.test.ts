import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

/** Real database + RLS for migration 0075. Needs `bash scripts/dev-db.sh`; skipped otherwise (RUN_DB_TESTS=1 to run). */
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

suite("channel collection tables (migration 0075)", () => {
  const url = env?.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
  const stamp = Date.now();
  let admin: Db;
  const users: Array<{ id: string; db: Db }> = [];
  let channelId = "";

  async function signUp(label: string) {
    const email = `collect-${label}-${stamp}@autobiz.local`;
    const created = await admin.auth.admin.createUser({ email, password: "Collect-test-1!", email_confirm: true });
    if (created.error || !created.data.user) throw created.error ?? new Error("user not created");
    const db = createClient<Database>(url, env!.NEXT_PUBLIC_SUPABASE_ANON_KEY, options);
    const signedIn = await db.auth.signInWithPassword({ email, password: "Collect-test-1!" });
    if (signedIn.error) throw signedIn.error;
    users.push({ id: created.data.user.id, db });
    return users[users.length - 1];
  }

  beforeAll(async () => {
    admin = createClient<Database>(url, env!.SUPABASE_SERVICE_ROLE_KEY, options);
    const owner = await signUp("owner");
    await signUp("other");
    const business = await owner.db.from("businesses").insert({ owner_id: owner.id, name: "수집 테스트" }).select("id").single();
    if (business.error) throw business.error;
    const channel = await owner.db.from("tracked_channels").insert({ business_id: business.data.id, platform: "youtube", external_id: "UCtest0000000000000000", url: "https://youtube.com/channel/UCtest0000000000000000" }).select("id").single();
    if (channel.error) throw channel.error;
    channelId = channel.data.id;
  });

  afterAll(async () => {
    for (const user of users) await admin.auth.admin.deleteUser(user.id);
  });

  const row = (overrides: Record<string, unknown> = {}) => ({ channel_id: channelId, external_content_id: "video-1", title: "영상", snapshot_date: "2026-10-13", metrics: { viewCount: 10 }, ...overrides });

  it("lets only the service role write per-content snapshots, and only the owner read them", async () => {
    const [owner, other] = users;
    expect((await owner.db.from("channel_content_snapshots").insert(row())).error).not.toBeNull();
    expect((await admin.from("channel_content_snapshots").insert(row())).error).toBeNull();
    expect((await owner.db.from("channel_content_snapshots").select("id")).data).toHaveLength(1);
    expect((await other.db.from("channel_content_snapshots").select("id")).data).toHaveLength(0);
  });

  it("keeps one row per video per day: a second collection the same day updates it instead of duplicating", async () => {
    const again = await admin.from("channel_content_snapshots").upsert(row({ metrics: { viewCount: 25 } }), { onConflict: "channel_id,external_content_id,snapshot_date" });
    expect(again.error).toBeNull();
    const { data } = await admin.from("channel_content_snapshots").select("metrics").eq("channel_id", channelId);
    expect(data).toEqual([{ metrics: { viewCount: 25 } }]);
    const nextDay = await admin.from("channel_content_snapshots").upsert(row({ snapshot_date: "2026-10-14" }), { onConflict: "channel_id,external_content_id,snapshot_date" });
    expect(nextDay.error).toBeNull();
    expect((await admin.from("channel_content_snapshots").select("id").eq("channel_id", channelId)).data).toHaveLength(2);
  });

  it("hides the collection run log from customers entirely (service role only)", async () => {
    const inserted = await admin.from("channel_collection_runs").insert({ trigger: "CRON", scheduled_for: new Date().toISOString() }).select("id").single();
    expect(inserted.error).toBeNull();
    for (const user of users) {
      expect((await user.db.from("channel_collection_runs").select("id")).data ?? []).toHaveLength(0);
      expect((await user.db.from("channel_collection_runs").insert({ trigger: "CRON", scheduled_for: new Date().toISOString() })).error).not.toBeNull();
    }
    await admin.from("channel_collection_runs").delete().eq("id", inserted.data!.id);
  });

  it("rejects values the collector must never write", async () => {
    expect((await admin.from("channel_collection_runs").insert({ trigger: "WHENEVER", scheduled_for: new Date().toISOString() })).error).not.toBeNull();
    expect((await admin.from("tracked_channels").update({ last_collection_status: "MAYBE" }).eq("id", channelId)).error).not.toBeNull();
    expect((await admin.from("tracked_channels").update({ last_collection_status: "QUOTA_EXCEEDED" }).eq("id", channelId)).error).toBeNull();
  });

  it("removes a channel's content snapshots with the channel", async () => {
    await admin.from("tracked_channels").delete().eq("id", channelId);
    expect((await admin.from("channel_content_snapshots").select("id").eq("channel_id", channelId)).data).toHaveLength(0);
  });
});
