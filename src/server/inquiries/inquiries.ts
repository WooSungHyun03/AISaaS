import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import {
  INQUIRIES_PER_HOUR,
  INQUIRY_REPLY_MAX,
  INQUIRY_STATUSES,
  inquiryInputSchema,
  type InquiryMessageView,
  type InquiryStatus,
  type InquiryView,
} from "@/types/inquiries";

type Db = SupabaseClient<Database>;
type InquiryRow = Database["public"]["Tables"]["inquiries"]["Row"];
type MessageRow = Database["public"]["Tables"]["inquiry_messages"]["Row"];

export type InquiryResult = { ok: true; id?: string } | { ok: false; error: string };
const fail = (error: string): InquiryResult => ({ ok: false, error });

function messageView(row: MessageRow): InquiryMessageView {
  return { id: row.id, kind: row.kind, body: row.body, fromStatus: row.from_status, toStatus: row.to_status, createdAt: row.created_at };
}

function inquiryView(row: InquiryRow, messages: MessageRow[]): InquiryView {
  return {
    id: row.id,
    category: row.category,
    subject: row.subject,
    body: row.body,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    messages: messages.filter((message) => message.inquiry_id === row.id).map(messageView),
  };
}

/** A customer writes to the service team. Length limits and the hourly cap are enforced here and again by the database. */
export async function submitInquiry(db: Db, userId: string, raw: unknown): Promise<InquiryResult> {
  const parsed = inquiryInputSchema.safeParse(raw);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "문의 내용을 확인해주세요.");

  const since = new Date(Date.now() - 3_600_000).toISOString();
  const { count, error: countError } = await db.from("inquiries").select("id", { count: "exact", head: true }).eq("user_id", userId).gte("created_at", since);
  if (countError) throw countError;
  if ((count ?? 0) >= INQUIRIES_PER_HOUR) return fail("문의를 너무 자주 보냈어요. 잠시 뒤(최대 1시간)에 다시 보내주세요.");

  const { data, error } = await db.from("inquiries").insert({ user_id: userId, ...parsed.data }).select("id").single();
  if (error || !data) return fail("문의를 보내지 못했어요. 잠시 후 다시 시도해주세요.");
  return { ok: true, id: data.id };
}

/** The customer's own inquiries, newest first, each with its answers and status changes. */
export async function listMyInquiries(db: Db, userId: string, limit = 30): Promise<InquiryView[]> {
  const { data: rows, error } = await db.from("inquiries").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(limit);
  if (error) throw error;
  const inquiries = rows ?? [];
  if (inquiries.length === 0) return [];
  const { data: messages, error: messagesError } = await db.from("inquiry_messages").select("*").in("inquiry_id", inquiries.map((row) => row.id)).order("created_at");
  if (messagesError) throw messagesError;
  return inquiries.map((row) => inquiryView(row, messages ?? []));
}

// ---- service team (service-role client; callers have already checked isAdminUser) ----------------------------------

export interface AdminInquiryListItem {
  id: string;
  category: InquiryView["category"];
  subject: string;
  status: InquiryStatus;
  createdAt: string;
  userEmail: string;
}

export const ADMIN_PAGE_SIZE = 30;

export async function listInquiriesForAdmin(admin: Db, options: { status?: InquiryStatus; page?: number; search?: string } = {}): Promise<{ items: AdminInquiryListItem[]; total: number }> {
  const page = Math.max(1, options.page ?? 1);
  let matchingUserIds: string[] | null = null;
  if (options.search?.trim()) {
    const { data: matches, error: matchError } = await admin.from("profiles").select("id").ilike("email", `%${options.search.trim().slice(0, 120)}%`).limit(500);
    if (matchError) throw matchError;
    matchingUserIds = (matches ?? []).map((row) => row.id);
    if (matchingUserIds.length === 0) return { items: [], total: 0 };
  }
  let query = admin.from("inquiries").select("id,category,subject,status,created_at,user_id", { count: "exact" }).order("created_at", { ascending: false }).range((page - 1) * ADMIN_PAGE_SIZE, page * ADMIN_PAGE_SIZE - 1);
  if (options.status) query = query.eq("status", options.status);
  if (matchingUserIds) query = query.in("user_id", matchingUserIds);
  const { data, error, count } = await query;
  if (error) throw error;
  const rows = data ?? [];
  const { data: profiles, error: profileError } = rows.length > 0 ? await admin.from("profiles").select("id,email").in("id", [...new Set(rows.map((row) => row.user_id))]) : { data: [], error: null };
  if (profileError) throw profileError;
  const emails = new Map((profiles ?? []).map((profile) => [profile.id, profile.email]));
  return {
    total: count ?? rows.length,
    items: rows.map((row) => ({ id: row.id, category: row.category, subject: row.subject, status: row.status, createdAt: row.created_at, userEmail: emails.get(row.user_id) ?? "(알 수 없음)" })),
  };
}

export async function getInquiryForAdmin(admin: Db, id: string): Promise<(InquiryView & { userEmail: string }) | null> {
  const { data: row, error } = await admin.from("inquiries").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!row) return null;
  const [{ data: messages, error: messagesError }, { data: profile }] = await Promise.all([
    admin.from("inquiry_messages").select("*").eq("inquiry_id", id).order("created_at"),
    admin.from("profiles").select("email").eq("id", row.user_id).maybeSingle(),
  ]);
  if (messagesError) throw messagesError;
  return { ...inquiryView(row, messages ?? []), userEmail: profile?.email ?? "(알 수 없음)" };
}

/**
 * Answer an inquiry and/or move it to another status. Every change is written to the history with who made it.
 * A reply on an open inquiry marks it ANSWERED unless the admin picked a status.
 */
export async function answerInquiry(admin: Db, adminId: string, id: string, input: { reply?: string; status?: string }): Promise<InquiryResult> {
  const reply = input.reply?.trim() ?? "";
  if (reply.length > INQUIRY_REPLY_MAX) return fail(`답변은 ${INQUIRY_REPLY_MAX.toLocaleString()}자 이하로 입력해주세요.`);
  if (input.status !== undefined && !(INQUIRY_STATUSES as readonly string[]).includes(input.status)) return fail("상태 값이 올바르지 않아요.");
  if (!reply && !input.status) return fail("답변이나 상태 중 하나는 입력해주세요.");

  const { data: current, error } = await admin.from("inquiries").select("id,status").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!current) return fail("문의를 찾을 수 없어요.");

  const nextStatus = (input.status as InquiryStatus | undefined) ?? (reply && (current.status === "RECEIVED" || current.status === "IN_REVIEW") ? "ANSWERED" : current.status);
  const now = new Date().toISOString();

  if (reply) {
    const { error: replyError } = await admin.from("inquiry_messages").insert({ inquiry_id: id, kind: "REPLY", body: reply, actor_id: adminId, created_at: now });
    if (replyError) return fail("답변을 저장하지 못했어요.");
  }
  if (nextStatus !== current.status) {
    const { error: statusError } = await admin.from("inquiries").update({ status: nextStatus }).eq("id", id).eq("status", current.status);
    if (statusError) return fail("상태를 바꾸지 못했어요.");
    const { error: historyError } = await admin.from("inquiry_messages").insert({ inquiry_id: id, kind: "STATUS_CHANGE", from_status: current.status as InquiryStatus, to_status: nextStatus, actor_id: adminId, created_at: now });
    if (historyError) return fail("상태 변경 기록을 저장하지 못했어요.");
  } else if (reply) {
    await admin.from("inquiries").update({ updated_at: now }).eq("id", id);
  }
  return { ok: true, id };
}

/** A customer closes their own inquiry (the only thing they may change). Done by the app because customers have no update policy. */
export async function closeOwnInquiry(admin: Db, userId: string, id: string): Promise<InquiryResult> {
  const { data: row, error } = await admin.from("inquiries").select("id,status,user_id").eq("id", id).eq("user_id", userId).maybeSingle();
  if (error) throw error;
  if (!row) return fail("문의를 찾을 수 없어요.");
  if (row.status === "CLOSED") return { ok: true, id };
  const { error: updateError } = await admin.from("inquiries").update({ status: "CLOSED" }).eq("id", id).eq("user_id", userId);
  if (updateError) return fail("문의를 종료하지 못했어요.");
  await admin.from("inquiry_messages").insert({ inquiry_id: id, kind: "STATUS_CHANGE", from_status: row.status, to_status: "CLOSED", actor_id: userId });
  return { ok: true, id };
}
