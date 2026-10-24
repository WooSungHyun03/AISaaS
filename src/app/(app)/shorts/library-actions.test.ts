import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  getUser: vi.fn(),
  getShortsContent: vi.fn(),
  revalidate: vi.fn(),
  archive: vi.fn(),
  remove: vi.fn(),
  list: vi.fn(),
  tables: [] as Array<{ table: string; op: string; payload?: unknown; filters: Array<[string, unknown]> }>,
  rowError: { value: null as unknown },
}));

vi.mock("next/cache", () => ({ revalidatePath: m.revalidate }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: m.getUser } }) }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    storage: { from: () => ({ remove: m.remove, list: m.list }) },
    from: (table: string) => {
      const entry = { table, op: "", payload: undefined as unknown, filters: [] as Array<[string, unknown]> };
      m.tables.push(entry);
      const builder: Record<string, unknown> = {
        update: (payload: unknown) => { entry.op = "update"; entry.payload = payload; return builder; },
        delete: () => { entry.op = "delete"; return builder; },
        eq: (column: string, value: unknown) => { entry.filters.push([column, value]); return builder; },
        select: () => builder,
        maybeSingle: async () => ({ data: { id: "c1" }, error: m.rowError.value }),
        then: (resolve: (value: unknown) => unknown) => Promise.resolve({ error: m.rowError.value }).then(resolve),
      };
      return builder;
    },
  }),
}));
vi.mock("@/server/shorts/library", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/server/shorts/library")>()), getShortsContent: m.getShortsContent }));
vi.mock("@/server/shorts/library-archive", () => ({ archiveExternalVideo: m.archive }));

const { deleteShortsContent, renameShortsContent, archiveLegacyShortsVideo } = await import("./library-actions");

const CONTENT_ID = "11111111-1111-4111-8111-111111111111";
const content = (over: Record<string, unknown> = {}) => ({
  id: CONTENT_ID, runId: "run-1", businessId: "biz-1", automationId: "auto-1", title: "봄 신메뉴", output: { videoPath: "user-1/auto-1/run-1/final.mp4", videoUrl: "https://x", durationSec: 25 },
  source: { state: "STORED", path: "user-1/auto-1/run-1/final.mp4", externalUrl: null }, ...over,
});

beforeEach(() => {
  vi.resetAllMocks();
  m.tables.length = 0;
  m.rowError.value = null;
  m.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
  m.getShortsContent.mockResolvedValue(content());
  m.remove.mockResolvedValue({ error: null });
  m.list.mockResolvedValue({ data: [{ id: "f1", name: "final.mp4" }, { id: "f2", name: "voice.mp3" }], error: null });
});

describe("deleteShortsContent", () => {
  it("removes the files first, then the library row, and takes the video address out of the run (the run row itself stays)", async () => {
    expect(await deleteShortsContent(CONTENT_ID)).toEqual({ success: true });
    expect(m.remove).toHaveBeenCalledWith(["user-1/auto-1/run-1/final.mp4", "user-1/auto-1/run-1/voice.mp3"]);
    const ops = m.tables.map((entry) => `${entry.table}:${entry.op}`);
    expect(ops).toEqual(["content_history:delete", "automation_runs:update"]);
    expect(m.tables[0].filters).toEqual([["id", CONTENT_ID], ["business_id", "biz-1"]]);
    const output = m.tables[1].payload as { output: Record<string, unknown> };
    expect(output.output).toEqual({ durationSec: 25, libraryDeleted: true });
    expect(m.remove.mock.invocationCallOrder[0]).toBeLessThan(m.revalidate.mock.invocationCallOrder[0]);
  });

  it("keeps the library row when the file cannot be removed, so a retry can finish the job", async () => {
    m.remove.mockResolvedValue({ error: { message: "storage down" } });
    const result = await deleteShortsContent(CONTENT_ID);
    expect(result.error).toContain("영상 파일을 지우지 못했어요");
    expect(m.tables).toHaveLength(0);
  });

  it("answers 'not found' for a video the caller cannot see (RLS returned nothing), and touches nothing", async () => {
    m.getShortsContent.mockResolvedValue(null);
    expect((await deleteShortsContent(CONTENT_ID)).error).toContain("영상을 찾을 수 없어요");
    expect(m.remove).not.toHaveBeenCalled();
    expect(m.tables).toHaveLength(0);
  });

  it("refuses a stored path outside the caller's own folder", async () => {
    m.getShortsContent.mockResolvedValue(content({ source: { state: "STORED", path: "user-2/auto-1/run-1/final.mp4", externalUrl: null } }));
    expect((await deleteShortsContent(CONTENT_ID)).error).toBeTruthy();
    expect(m.remove).not.toHaveBeenCalled();
  });

  it("deletes an older video with no stored file without touching Storage", async () => {
    m.getShortsContent.mockResolvedValue(content({ source: { state: "UNAVAILABLE", path: null, externalUrl: null } }));
    expect(await deleteShortsContent(CONTENT_ID)).toEqual({ success: true });
    expect(m.remove).not.toHaveBeenCalled();
    expect(m.tables[0]).toMatchObject({ table: "content_history", op: "delete" });
  });

  it("requires a login", async () => {
    m.getUser.mockResolvedValue({ data: { user: null } });
    expect((await deleteShortsContent(CONTENT_ID)).error).toBe("로그인이 필요합니다.");
  });
});

describe("renameShortsContent", () => {
  it("saves a trimmed title and marks the item edited", async () => {
    const result = await renameShortsContent(CONTENT_ID, "  새 제목  ");
    expect(result).toEqual({ success: true, title: "새 제목" });
    expect(m.tables[0]).toMatchObject({ table: "content_history", op: "update", payload: { title: "새 제목", edited_at: expect.any(String) } });
  });

  it("rejects an empty or very long title before reading anything", async () => {
    expect((await renameShortsContent(CONTENT_ID, "   ")).error).toBe("제목을 입력해주세요.");
    expect((await renameShortsContent(CONTENT_ID, "가".repeat(101))).error).toContain("100자");
    expect(m.getShortsContent).not.toHaveBeenCalled();
  });
});

describe("archiveLegacyShortsVideo", () => {
  const legacy = () => content({ source: { state: "EXTERNAL", path: null, externalUrl: "https://cdn.example.com/v.mp4" } });

  it("records the copy only after it was saved and checked", async () => {
    m.getShortsContent.mockResolvedValue(legacy());
    m.archive.mockResolvedValue({ ok: true, path: "user-1/auto-1/run-1/final.mp4", bytes: 4_000_000 });
    expect(await archiveLegacyShortsVideo(CONTENT_ID)).toEqual({ success: true });
    expect(m.tables[0].payload).toMatchObject({ video_path: "user-1/auto-1/run-1/final.mp4", video_bytes: 4_000_000 });
  });

  it("says plainly that a video whose original is gone cannot be recovered, and records nothing", async () => {
    m.getShortsContent.mockResolvedValue(legacy());
    m.archive.mockResolvedValue({ ok: false, reason: "UNREACHABLE" });
    expect((await archiveLegacyShortsVideo(CONTENT_ID)).error).toContain("복구할 수 없어요");
    expect(m.tables).toHaveLength(0);
  });

  it("does nothing for a video that is already stored", async () => {
    expect(await archiveLegacyShortsVideo(CONTENT_ID)).toEqual({ success: true });
    expect(m.archive).not.toHaveBeenCalled();
  });
});
