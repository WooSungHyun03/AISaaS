import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { answerInquiry, closeOwnInquiry, getInquiryForAdmin, listInquiriesForAdmin, listMyInquiries, submitInquiry } from "./inquiries";

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

suite("inquiries against the real database", () => {
  const url = env?.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
  const stamp = Date.now();
  let admin: Db;
  const users: Array<{ id: string; db: Db }> = [];
  const valid = { category: "PAYMENT", subject: "결제가 안 돼요", body: "토스 테스트 결제 중 오류가 났어요. 주문 번호를 확인해주세요." };

  beforeAll(async () => {
    admin = createClient<Database>(url, env!.SUPABASE_SERVICE_ROLE_KEY, options);
    for (const label of ["a", "b"]) {
      const email = `inq-${label}-${stamp}@autobiz.local`;
      const created = await admin.auth.admin.createUser({ email, password: "Inquiry-test-1!", email_confirm: true });
      if (created.error || !created.data.user) throw created.error ?? new Error("user not created");
      const db = createClient<Database>(url, env!.NEXT_PUBLIC_SUPABASE_ANON_KEY, options);
      const signedIn = await db.auth.signInWithPassword({ email, password: "Inquiry-test-1!" });
      if (signedIn.error) throw signedIn.error;
      users.push({ id: created.data.user.id, db });
    }
  });

  afterAll(async () => {
    for (const user of users) await admin.auth.admin.deleteUser(user.id);
  });

  it("a customer submits, and sees only their own inquiry as RECEIVED", async () => {
    const [a, b] = users;
    const result = await submitInquiry(a.db, a.id, valid);
    expect(result.ok).toBe(true);
    const mine = await listMyInquiries(a.db, a.id);
    expect(mine[0]).toMatchObject({ subject: valid.subject, status: "RECEIVED", category: "PAYMENT", messages: [] });
    expect(await listMyInquiries(b.db, b.id)).toEqual([]);
  });

  it("refuses short, long and malformed input before saving", async () => {
    const [a] = users;
    expect((await submitInquiry(a.db, a.id, { ...valid, subject: "a" })).ok).toBe(false);
    expect((await submitInquiry(a.db, a.id, { ...valid, body: "짧아요" })).ok).toBe(false);
    expect((await submitInquiry(a.db, a.id, { ...valid, body: "가".repeat(4001) })).ok).toBe(false);
    expect((await submitInquiry(a.db, a.id, { ...valid, category: "SPAM" })).ok).toBe(false);
  });

  it("the database itself blocks forged rows: someone else's id, a non-RECEIVED status, edits and deletes", async () => {
    const [a, b] = users;
    const row = { category: "OTHER" as const, subject: "직접 호출", body: "API를 직접 호출해서 만든 문의예요." };
    expect((await b.db.from("inquiries").insert({ user_id: a.id, ...row })).error).not.toBeNull();
    expect((await b.db.from("inquiries").insert({ user_id: b.id, ...row, status: "ANSWERED" })).error).not.toBeNull();

    const mine = await listMyInquiries(a.db, a.id);
    const id = mine[0].id;
    // no update/delete grant for customers
    expect((await a.db.from("inquiries").update({ status: "CLOSED" }).eq("id", id)).error).not.toBeNull();
    expect((await a.db.from("inquiries").delete().eq("id", id)).error).not.toBeNull();
    // and they cannot write answers to themselves
    expect((await a.db.from("inquiry_messages").insert({ inquiry_id: id, kind: "REPLY", body: "스스로 답변" })).error).not.toBeNull();
    expect((await listMyInquiries(a.db, a.id))[0].status).toBe("RECEIVED");
  });

  it("caps new inquiries at five per hour — also through the API directly", async () => {
    const [, b] = users;
    for (let i = 0; i < 5; i++) expect((await submitInquiry(b.db, b.id, { ...valid, subject: `연속 문의 ${i + 1}` })).ok).toBe(true);
    expect((await submitInquiry(b.db, b.id, valid)).ok).toBe(false);
    const direct = await b.db.from("inquiries").insert({ user_id: b.id, category: "OTHER", subject: "한도 우회", body: "API로 직접 보내서 한도를 넘겨보는 문의예요." });
    expect(direct.error).not.toBeNull();
  });

  it("the service team answers: reply, status history, and the customer reads it", async () => {
    const [a] = users;
    const id = (await listMyInquiries(a.db, a.id))[0].id;

    const answered = await answerInquiry(admin, a.id, id, { reply: "확인했어요. 주문 번호를 알려주세요." });
    expect(answered.ok).toBe(true);
    const view = (await listMyInquiries(a.db, a.id))[0];
    expect(view.status).toBe("ANSWERED");
    expect(view.messages.map((message) => message.kind)).toEqual(["REPLY", "STATUS_CHANGE"]);
    expect(view.messages[0].body).toContain("주문 번호");
    expect(view.messages[1]).toMatchObject({ fromStatus: "RECEIVED", toStatus: "ANSWERED" });

    // status only, no reply
    expect((await answerInquiry(admin, a.id, id, { status: "IN_REVIEW" })).ok).toBe(true);
    expect((await listMyInquiries(a.db, a.id))[0].status).toBe("IN_REVIEW");
    // bad input
    expect((await answerInquiry(admin, a.id, id, {})).ok).toBe(false);
    expect((await answerInquiry(admin, a.id, id, { status: "DONE" })).ok).toBe(false);
    expect((await answerInquiry(admin, a.id, "00000000-0000-0000-0000-000000000000", { reply: "x" })).ok).toBe(false);
  });

  it("the admin list shows the writer's email; a customer can close only their own inquiry", async () => {
    const [a, b] = users;
    const { items } = await listInquiriesForAdmin(admin, { status: "IN_REVIEW" });
    expect(items.some((item) => item.userEmail.startsWith(`inq-a-${stamp}`))).toBe(true);
    const id = (await listMyInquiries(a.db, a.id))[0].id;
    expect((await getInquiryForAdmin(admin, id))?.userEmail).toContain(`inq-a-${stamp}`);

    expect((await closeOwnInquiry(admin, b.id, id)).ok).toBe(false); // someone else's
    expect((await closeOwnInquiry(admin, a.id, id)).ok).toBe(true);
    const closed = (await listMyInquiries(a.db, a.id))[0];
    expect(closed.status).toBe("CLOSED");
    expect(closed.messages.at(-1)).toMatchObject({ kind: "STATUS_CHANGE", toStatus: "CLOSED" });
  });
});
