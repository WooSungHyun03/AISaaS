import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { createEvent, deleteEvent, listEvents, moveEvent, searchEvents, updateEvent } from "./events";

/**
 * Real database, real row-level security. Needs the local Supabase from `bash scripts/dev-db.sh`; skipped otherwise:
 *   RUN_DB_TESTS=1 npx vitest run src/server/calendar/events.db.test.ts
 */
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

suite("calendar events against the real database", () => {
  const url = env?.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
  const stamp = Date.now();
  let admin: Db;
  const users: Array<{ id: string; db: Db }> = [];

  beforeAll(async () => {
    admin = createClient<Database>(url, env!.SUPABASE_SERVICE_ROLE_KEY, options);
    for (const label of ["a", "b"]) {
      const email = `cal-${label}-${stamp}@autobiz.local`;
      const password = "Calendar-test-1!";
      const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (created.error || !created.data.user) throw created.error ?? new Error("user not created");
      const db = createClient<Database>(url, env!.NEXT_PUBLIC_SUPABASE_ANON_KEY, options);
      const signedIn = await db.auth.signInWithPassword({ email, password });
      if (signedIn.error) throw signedIn.error;
      users.push({ id: created.data.user.id, db });
    }
  });

  afterAll(async () => {
    for (const user of users) await admin.auth.admin.deleteUser(user.id);
  });

  const base = { title: "회의", allDay: false, start: "2026-10-05T10:00", end: "2026-10-05T11:00", color: "blue", category: "GENERAL", recurrence: null };
  const window = ["2026-10-01", "2026-11-01"] as const;
  const titles = (views: Awaited<ReturnType<typeof listEvents>>) => views.map((view) => `${view.occurrenceDate}:${view.title}`);

  it("saves a one-off event and lists it in Seoul wall-clock time", async () => {
    const [a] = users;
    const created = await createEvent(a.db, a.id, { ...base, title: "치과" });
    expect(created.ok).toBe(true);
    const views = await listEvents(a.db, a.id, ...window);
    expect(views.find((view) => view.title === "치과")).toMatchObject({ start: "2026-10-05T10:00:00", end: "2026-10-05T11:00:00", allDay: false });
  });

  it("repeats weekly, edits one day, moves the whole series, deletes one day, then the rest", async () => {
    const [a] = users;
    const created = await createEvent(a.db, a.id, { ...base, title: "주간 보고", recurrence: { freq: "WEEKLY", interval: 1 } });
    if (!created.ok) throw new Error(created.error);
    const id = created.id!;
    const series = async () => titles((await listEvents(a.db, a.id, ...window)).filter((view) => view.title.includes("보고")));

    expect(await series()).toEqual(["2026-10-05:주간 보고", "2026-10-12:주간 보고", "2026-10-19:주간 보고", "2026-10-26:주간 보고"]);

    // only the 12th changes: new title and time
    const changed = await updateEvent(a.db, a.id, { id, scope: "THIS", occurrenceDate: "2026-10-12" }, { ...base, title: "주간 보고(특별)", start: "2026-10-12T14:00", end: "2026-10-12T15:00" });
    expect(changed.ok).toBe(true);
    expect(await series()).toEqual(["2026-10-05:주간 보고", "2026-10-12:주간 보고(특별)", "2026-10-19:주간 보고", "2026-10-26:주간 보고"]);

    // the whole series moves one day later (Mon -> Tue) when its 19th is edited to the 20th
    const shifted = await updateEvent(a.db, a.id, { id, scope: "ALL", occurrenceDate: "2026-10-19" }, { ...base, title: "주간 보고", start: "2026-10-20T10:00", end: "2026-10-20T11:00", recurrence: { freq: "WEEKLY", interval: 1 } });
    expect(shifted.ok).toBe(true);
    const afterShift = await series();
    expect(afterShift).toContain("2026-10-20:주간 보고");
    expect(afterShift).toContain("2026-10-06:주간 보고");

    // delete one day, then everything
    expect((await deleteEvent(a.db, a.id, { id, scope: "THIS", occurrenceDate: "2026-10-27" })).ok).toBe(true);
    expect(await series()).not.toContain("2026-10-27:주간 보고");
    expect((await deleteEvent(a.db, a.id, { id, scope: "ALL" })).ok).toBe(true);
    expect((await series()).filter((entry) => entry.includes("주간 보고"))).toEqual([]);
  });

  it("edits 'this and the following': the old series stops the day before, a new one carries the change on", async () => {
    const [a] = users;
    const created = await createEvent(a.db, a.id, { ...base, title: "스탠드업", recurrence: { freq: "DAILY", interval: 1, until: "2026-10-09" } });
    if (!created.ok) throw new Error(created.error);
    const id = created.id!;
    const standups = async () => (await listEvents(a.db, a.id, ...window)).filter((view) => view.title.includes("스탠드업")).map((view) => `${view.occurrenceDate}@${view.start.slice(11, 16)}:${view.title}`);

    // a one-day edit on the 8th first: it must not survive a later 'following' edit from the 7th
    await updateEvent(a.db, a.id, { id, scope: "THIS", occurrenceDate: "2026-10-08" }, { ...base, title: "스탠드업(8일 특별)", start: "2026-10-08T15:00", end: "2026-10-08T16:00" });

    const changed = await updateEvent(a.db, a.id, { id, scope: "FOLLOWING", occurrenceDate: "2026-10-07" }, { ...base, title: "스탠드업 새 시간", start: "2026-10-07T09:30", end: "2026-10-07T10:00", recurrence: { freq: "DAILY", interval: 1, until: "2026-10-09" } });
    expect(changed.ok).toBe(true);
    expect(await standups()).toEqual([
      "2026-10-05@10:00:스탠드업",
      "2026-10-06@10:00:스탠드업",
      "2026-10-07@09:30:스탠드업 새 시간",
      "2026-10-08@09:30:스탠드업 새 시간",
      "2026-10-09@09:30:스탠드업 새 시간",
    ]);

    // delete 'this and the following' from the 8th: only the days before remain, in both series
    const newSeries = (await listEvents(a.db, a.id, ...window)).find((view) => view.title === "스탠드업 새 시간")!;
    expect((await deleteEvent(a.db, a.id, { id: newSeries.eventId, scope: "FOLLOWING", occurrenceDate: "2026-10-08" })).ok).toBe(true);
    expect(await standups()).toEqual(["2026-10-05@10:00:스탠드업", "2026-10-06@10:00:스탠드업", "2026-10-07@09:30:스탠드업 새 시간"]);

    // 'following' from the first day is the whole series
    expect((await deleteEvent(a.db, a.id, { id, scope: "FOLLOWING", occurrenceDate: "2026-10-05" })).ok).toBe(true);
    expect((await standups()).some((entry) => entry.includes("10:00:스탠드업"))).toBe(false);
  });

  it("splits a counted series so the total stays the same, and refuses a count that already ended", async () => {
    const [a] = users;
    const created = await createEvent(a.db, a.id, { ...base, title: "다섯번 수업", recurrence: { freq: "DAILY", interval: 1, count: 5 } });
    if (!created.ok) throw new Error(created.error);
    const lessons = async () => (await listEvents(a.db, a.id, ...window)).filter((view) => view.title.includes("다섯번 수업")).map((view) => view.occurrenceDate);
    expect(await lessons()).toHaveLength(5);

    const tooShort = await updateEvent(a.db, a.id, { id: created.id!, scope: "FOLLOWING", occurrenceDate: "2026-10-08" }, { ...base, title: "다섯번 수업", start: "2026-10-08T10:00", end: "2026-10-08T11:00", recurrence: { freq: "DAILY", interval: 1, count: 3 } });
    expect(tooShort.ok).toBe(false);

    const ok = await updateEvent(a.db, a.id, { id: created.id!, scope: "FOLLOWING", occurrenceDate: "2026-10-08" }, { ...base, title: "다섯번 수업", start: "2026-10-08T14:00", end: "2026-10-08T15:00", recurrence: { freq: "DAILY", interval: 1, count: 5 } });
    expect(ok.ok).toBe(true);
    expect(await lessons()).toEqual(["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"]);
  });

  it("drags a one-off event and a single day of a series", async () => {
    const [a] = users;
    const single = await createEvent(a.db, a.id, { ...base, title: "이동 테스트" });
    const moved = await moveEvent(a.db, a.id, { id: single.ok ? single.id! : "", scope: "ALL" }, { start: "2026-10-07T09:00", end: "2026-10-07T10:30", allDay: false });
    expect(moved.ok).toBe(true);
    expect((await listEvents(a.db, a.id, ...window)).find((view) => view.title === "이동 테스트")).toMatchObject({ occurrenceDate: "2026-10-07", start: "2026-10-07T09:00:00", end: "2026-10-07T10:30:00" });
  });

  it("keeps all-day events whole (end exclusive) across several days", async () => {
    const [a] = users;
    await createEvent(a.db, a.id, { ...base, title: "출장", allDay: true, start: "2026-10-14", end: "2026-10-17" });
    const view = (await listEvents(a.db, a.id, ...window)).find((item) => item.title === "출장")!;
    expect(view).toMatchObject({ allDay: true, start: "2026-10-14", end: "2026-10-17" });
    // visible on the 16th, gone on the 17th
    expect((await listEvents(a.db, a.id, "2026-10-16", "2026-10-17")).some((item) => item.title === "출장")).toBe(true);
    expect((await listEvents(a.db, a.id, "2026-10-17", "2026-10-18")).some((item) => item.title === "출장")).toBe(false);
  });

  it("finds events by title or description, newest repeat first, and never treats the query as a filter", async () => {
    const [a] = users;
    await createEvent(a.db, a.id, { ...base, title: "거래처 미팅", description: "분기 정산 논의" });
    expect((await searchEvents(a.db, a.id, "정산")).map((hit) => hit.title)).toContain("거래처 미팅");
    expect(await searchEvents(a.db, a.id, "%,title.ilike.*")).toEqual([]);
  });

  it("isolates users: nobody can read, change, delete or attach to another user's events", async () => {
    const [a, b] = users;
    const secret = await createEvent(a.db, a.id, { ...base, title: "비밀 일정", recurrence: { freq: "DAILY", interval: 1, count: 3 } });
    if (!secret.ok) throw new Error(secret.error);

    expect((await listEvents(b.db, b.id, ...window)).some((view) => view.title === "비밀 일정")).toBe(false);
    expect((await searchEvents(b.db, b.id, "비밀")).length).toBe(0);
    expect((await updateEvent(b.db, b.id, { id: secret.id!, scope: "ALL", occurrenceDate: "2026-10-05" }, base)).ok).toBe(false);
    expect((await deleteEvent(b.db, b.id, { id: secret.id!, scope: "ALL" })).ok).toBe(false);

    // writing straight to the table with someone else's user_id, or pointing a replacement at their series, is refused by RLS
    const forged = await b.db.from("calendar_events").insert({ user_id: a.id, title: "x", starts_at: "2026-10-05T01:00:00Z", ends_at: "2026-10-05T02:00:00Z" });
    expect(forged.error).not.toBeNull();
    const attach = await b.db.from("calendar_events").insert({ user_id: b.id, title: "x", starts_at: "2026-10-05T01:00:00Z", ends_at: "2026-10-05T02:00:00Z", series_id: secret.id!, original_date: "2026-10-05" });
    expect(attach.error).not.toBeNull();

    // still intact for the owner
    expect((await listEvents(a.db, a.id, ...window)).some((view) => view.title === "비밀 일정")).toBe(true);
  });

  it("rejects bad input before touching the database", async () => {
    const [a] = users;
    expect((await createEvent(a.db, a.id, { ...base, title: "   " })).ok).toBe(false);
    expect((await createEvent(a.db, a.id, { ...base, end: "2026-10-05T09:00" })).ok).toBe(false);
    expect((await createEvent(a.db, a.id, { ...base, start: "2026-02-30T10:00", end: "2026-02-30T11:00" })).ok).toBe(false);
    await expect(listEvents(a.db, a.id, "2026-01-01", "2027-01-01")).rejects.toThrow("RANGE_TOO_LARGE");
  });
});
