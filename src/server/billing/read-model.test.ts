import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({ rpc })) }));
vi.mock("./credits", () => ({ ensureTrialCredits: vi.fn() }));

import { getUsageHistory } from "./read-model";

describe("getUsageHistory", () => {
  beforeEach(() => rpc.mockReset());

  it("passes all filters to the owner-scoped RPC and maps safe display fields", async () => {
    rpc.mockResolvedValue({
      data: [{
        ledger_id: "ledger-1",
        event_type: "RESERVE",
        kind: "BLOG",
        delta: -1,
        created_at: "2026-10-11T00:00:00.000Z",
        terminal_event: "SETTLE",
        terminal_delta: 0,
        run_id: "run-1",
        run_status: "SUCCESS",
        automation_id: "automation-1",
        automation_name: "블로그 만들기",
        content_history_id: "content-1",
        content_title: "가을 메뉴",
        external_url: "https://example.com/post",
        total_count: 27,
      }],
      error: null,
    });

    const result = await getUsageHistory({
      kind: "BLOG",
      status: "SUCCESS",
      from: "2026-10-01T00:00:00.000Z",
      to: null,
    }, 2);

    expect(rpc).toHaveBeenCalledWith("get_usage_history", {
      p_page: 2,
      p_page_size: 20,
      p_kind: "BLOG",
      p_status: "SUCCESS",
      p_from: "2026-10-01T00:00:00.000Z",
      p_to: null,
    });
    expect(result).toEqual({
      items: [{
        id: "ledger-1",
        eventType: "RESERVE",
        kind: "BLOG",
        delta: -1,
        createdAt: "2026-10-11T00:00:00.000Z",
        terminalEvent: "SETTLE",
        terminalDelta: 0,
        runId: "run-1",
        runStatus: "SUCCESS",
        automationId: "automation-1",
        automationName: "블로그 만들기",
        contentHistoryId: "content-1",
        contentTitle: "가을 메뉴",
        externalUrl: "https://example.com/post",
      }],
      total: 27,
      pageSize: 20,
    });
  });

  it("clamps invalid pages and reports a user-facing loading error", async () => {
    rpc.mockResolvedValueOnce({ data: [], error: null });
    await getUsageHistory({ kind: null, status: null, from: null, to: null }, -5);
    expect(rpc).toHaveBeenCalledWith("get_usage_history", expect.objectContaining({ p_page: 1 }));

    rpc.mockResolvedValueOnce({ data: null, error: { message: "database unavailable" } });
    await expect(getUsageHistory({ kind: null, status: null, from: null, to: null }, 1))
      .rejects.toThrow("이용내역을 불러오지 못했습니다.");
  });
});
