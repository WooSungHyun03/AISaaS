import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

function localEnv(): Record<string, string> | null {
  try {
    const text = readFileSync(path.join(process.cwd(), ".env.local.supabase"), "utf8");
    return Object.fromEntries(text.split(/\r?\n/).map((line) => /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())).filter((match): match is RegExpExecArray => Boolean(match)).map((match) => [match[1], match[2].replace(/^['"]|['"]$/g, "")]));
  } catch {
    return null;
  }
}

const env = process.env.RUN_DB_TESTS ? localEnv() : null;
const suite = env ? describe : describe.skip;
type Db = SupabaseClient<Database>;

function assertData<T>(result: { data: T; error: { message: string } | null }, label: string): T {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
}

suite("admin security against the real database", () => {
  const url = env?.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
  const password = "Admin-security-1!";
  let service: Db;
  let customer: Db;
  let userId = "";
  let fixtureUserId = "";
  let auditId = "";

  beforeAll(async () => {
    service = createClient<Database>(url, env!.SUPABASE_SERVICE_ROLE_KEY, options);
    const email = `admin-security-${crypto.randomUUID()}@autobiz.local`;
    const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error || !created.data.user) throw created.error ?? new Error("user not created");
    userId = created.data.user.id;
    const profile = await service.from("profiles").upsert({ id: userId, email, display_name: "Admin security test" });
    if (profile.error) throw profile.error;
    customer = createClient<Database>(url, env!.NEXT_PUBLIC_SUPABASE_ANON_KEY, options);
    const signedIn = await customer.auth.signInWithPassword({ email, password });
    if (signedIn.error) throw signedIn.error;
  });

  afterAll(async () => {
    if (fixtureUserId) await service.auth.admin.deleteUser(fixtureUserId);
    if (userId) await service.auth.admin.deleteUser(userId);
  });

  it("registers the local seeded admin in the database", async () => {
    const listed = await service.auth.admin.listUsers({ page: 1, perPage: 100 });
    if (listed.error) throw listed.error;
    const seeded = listed.data.users.find((user) => user.email === "admin@autobiz.local");
    expect(seeded).toBeDefined();
    const membership = await service.from("admin_users").select("user_id").eq("user_id", seeded!.id).maybeSingle();
    expect(membership.error).toBeNull();
    expect(membership.data?.user_id).toBe(seeded!.id);
  });

  it("blocks customer table reads and the dashboard RPC", async () => {
    expect((await customer.from("admin_users").select("user_id")).error).not.toBeNull();
    expect((await customer.from("admin_audit_log").select("id")).error).not.toBeNull();
    expect((await customer.rpc("get_admin_dashboard_counts", { p_active_since: new Date(0).toISOString() })).error).not.toBeNull();
  });

  it("keeps the audit log append-only even for the service role", async () => {
    const inserted = await service.from("admin_audit_log").insert({
      actor_user_id: userId,
      actor_email: "redacted-admin-test@example.com",
      action: "ADMIN_DB_TEST",
      target_type: "test",
      target_id: userId,
      metadata: { state: "created" },
    }).select("id").single();
    const insertedRow = assertData(inserted, "insert audit row");
    if (!insertedRow) throw new Error("insert audit row returned no data");
    auditId = insertedRow.id;

    const headers = {
      apikey: env!.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env!.SUPABASE_SERVICE_ROLE_KEY}`,
      "content-type": "application/json",
    };
    const update = await fetch(`${url}/rest/v1/admin_audit_log?id=eq.${auditId}`, { method: "PATCH", headers, body: JSON.stringify({ action: "MUTATED" }) });
    const deletion = await fetch(`${url}/rest/v1/admin_audit_log?id=eq.${auditId}`, { method: "DELETE", headers });
    expect(update.ok).toBe(false);
    expect(deletion.ok).toBe(false);
  });

  it("returns dashboard counts that exactly match the seeded database", async () => {
    const since = new Date(Date.now() - 60_000).toISOString();
    const fixtureEmail = `admin-dashboard-${crypto.randomUUID()}@autobiz.local`;
    const fixtureUser = await service.auth.admin.createUser({ email: fixtureEmail, password, email_confirm: true });
    if (fixtureUser.error || !fixtureUser.data.user) throw fixtureUser.error ?? new Error("dashboard fixture user not created");
    fixtureUserId = fixtureUser.data.user.id;
    const fixtureProfile = await service.from("profiles").upsert({ id: fixtureUserId, email: fixtureEmail, display_name: "Dashboard fixture" });
    if (fixtureProfile.error) throw fixtureProfile.error;

    const paidAt = new Date().toISOString();
    const order = await service.from("billing_orders").insert({
      user_id: fixtureUserId,
      product_id: "BLOG_5",
      kind: "BLOG",
      credit_amount: 5,
      price_krw: 9_900,
      validity_days: 30,
      status: "PAID",
      provider: "mock",
      provider_order_id: `admin-dashboard-${crypto.randomUUID()}`,
      paid_at: paidAt,
    });
    if (order.error) throw order.error;

    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1_000).toISOString();
    const grant = await service.rpc("grant_credit", { p_user_id: fixtureUserId, p_kind: "BLOG", p_amount: 1, p_expires_at: expiresAt, p_reference_id: "admin-dashboard-test" });
    if (grant.error) throw grant.error;
    const reservation = await service.rpc("reserve_credit", { p_user_id: fixtureUserId, p_kind: "BLOG", p_amount: 1, p_reference_id: "admin-dashboard-test" });
    if (reservation.error) throw reservation.error;
    const settled = await service.rpc("settle_credit", { p_reservation_id: reservation.data, p_reference_id: "admin-dashboard-test" });
    if (settled.error) throw settled.error;

    const business = await service.from("businesses").insert({ owner_id: fixtureUserId, name: "Admin dashboard fixture" }).select("id").single();
    if (business.error) throw business.error;
    const templates = await service.from("automation_templates").select("id,slug").in("slug", ["blog-marketing", "shorts"]);
    if (templates.error) throw templates.error;
    const templateBySlug = new Map(templates.data.map((template) => [template.slug, template.id]));
    const automations = await service.from("automations").insert([
      { user_id: fixtureUserId, business_id: business.data.id, template_id: templateBySlug.get("blog-marketing")!, name: "Blog fixture" },
      { user_id: fixtureUserId, business_id: business.data.id, template_id: templateBySlug.get("shorts")!, name: "Shorts fixture" },
    ]).select("id,name");
    if (automations.error) throw automations.error;
    const automationByName = new Map(automations.data.map((automation) => [automation.name, automation.id]));
    const history = await service.from("content_history").insert([
      { business_id: business.data.id, automation_id: automationByName.get("Blog fixture")!, content_type: "blog", title: "fixture" },
      { business_id: business.data.id, automation_id: automationByName.get("Shorts fixture")!, content_type: "shorts", title: "fixture" },
    ]);
    if (history.error) throw history.error;

    const [afterResult, profiles, ledger, orders, content] = await Promise.all([
      service.rpc("get_admin_dashboard_counts", { p_active_since: since }),
      service.from("profiles").select("id"),
      service.from("credit_ledger").select("user_id").gte("created_at", since).in("event_type", ["RESERVE", "SETTLE", "RELEASE"]),
      service.from("billing_orders").select("user_id").eq("status", "PAID"),
      service.from("content_history").select("content_type").in("content_type", ["blog", "shorts"]),
    ]);
    const after = assertData(afterResult, "read counts after")?.[0];
    if (!after) throw new Error("dashboard counts after fixture returned no row");
    const profileRows = assertData(profiles, "read profiles");
    const ledgerRows = assertData(ledger, "read active ledger");
    const orderRows = assertData(orders, "read paid orders");
    const contentRows = assertData(content, "read generated content");
    if (!profileRows || !ledgerRows || !orderRows || !contentRows) throw new Error("dashboard source query returned no rows");
    expect(after.total_users).toBe(profileRows.length);
    expect(after.active_users).toBe(new Set(ledgerRows.map((row) => row.user_id)).size);
    expect(after.paid_users).toBe(new Set(orderRows.map((row) => row.user_id)).size);
    expect(after.blog_generations).toBe(contentRows.filter((row) => row.content_type === "blog").length);
    expect(after.shorts_generations).toBe(contentRows.filter((row) => row.content_type === "shorts").length);
    expect(profileRows.some((row) => row.id === fixtureUserId)).toBe(true);
  });
});
