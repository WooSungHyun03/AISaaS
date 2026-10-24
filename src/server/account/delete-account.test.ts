import { afterEach, describe, expect, it, vi } from "vitest";

const { adminMock, disconnectConnectionMock } = vi.hoisted(() => ({ adminMock: { current: null as unknown }, disconnectConnectionMock: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => adminMock.current }));
vi.mock("@/server/connectors/integrations", () => ({ disconnectConnection: disconnectConnectionMock }));
vi.mock("@/server/shorts/assets", () => ({ REFERENCE_BUCKET: "shorts-references", VIDEO_BUCKET: "shorts-videos" }));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const { deleteUserAccount, removeShortsFiles } = await import("./delete-account");

type Entry = { name: string; id: string | null };

function makeAdmin({ folders, listError, deleteUserError }: { folders: Record<string, Entry[]>; listError?: { message: string }; deleteUserError?: unknown }) {
  const remove = vi.fn().mockResolvedValue({ error: null });
  const list = vi.fn(async (prefix: string) => (listError ? { data: null, error: listError } : { data: folders[prefix] ?? [], error: null }));
  const deleteUser = vi.fn().mockResolvedValue({ error: deleteUserError ?? null });
  const eq = vi.fn().mockResolvedValue({ data: [{ id: "conn-1" }, { id: "conn-2" }], error: null });
  const admin = {
    from: vi.fn(() => ({ select: vi.fn(() => ({ eq })) })),
    storage: { from: vi.fn(() => ({ list, remove })) },
    auth: { admin: { deleteUser } },
  };
  adminMock.current = admin;
  return { admin, remove, deleteUser, eq };
}

afterEach(() => vi.clearAllMocks());

describe("deleteUserAccount", () => {
  it("purges Vault secrets and the user's own uploads, then deletes the auth user", async () => {
    const { remove, deleteUser, eq } = makeAdmin({
      folders: {
        "user-1": [{ name: "auto-1", id: null }],
        "user-1/auto-1": [{ name: "ref.png", id: "f1" }, { name: "frames", id: null }],
        "user-1/auto-1/frames": [{ name: "run-0.png", id: "f2" }],
      },
    });

    await deleteUserAccount("user-1");

    expect(eq).toHaveBeenCalledWith("user_id", "user-1");
    expect(disconnectConnectionMock.mock.calls.map((call) => call[1])).toEqual(["conn-1", "conn-2"]);
    expect(remove).toHaveBeenCalledWith(["user-1/auto-1/ref.png", "user-1/auto-1/frames/run-0.png"]);
    expect(deleteUser).toHaveBeenCalledWith("user-1");
  });

  it("still deletes the account when the storage bucket was never created", async () => {
    const { remove, deleteUser } = makeAdmin({ folders: {}, listError: { message: "Bucket not found" } });
    await deleteUserAccount("user-1");
    expect(remove).not.toHaveBeenCalled();
    expect(deleteUser).toHaveBeenCalledWith("user-1");
  });

  it("throws when the auth user cannot be deleted", async () => {
    makeAdmin({ folders: {}, deleteUserError: { message: "boom" } });
    await expect(deleteUserAccount("user-1")).rejects.toThrow("계정을 삭제하지 못했습니다.");
  });
});

describe("removeShortsFiles", () => {
  it("removes only what is under one automation's folder, in both buckets", async () => {
    const { admin, remove } = makeAdmin({
      folders: {
        "user-1/auto-1": [{ name: "assets", id: null }, { name: "run-1", id: null }],
        "user-1/auto-1/assets": [{ name: "photo.png", id: "f1" }],
        "user-1/auto-1/run-1": [{ name: "final.mp4", id: "f2" }],
        "user-1/auto-2": [{ name: "other.png", id: "f3" }],
      },
    });

    await removeShortsFiles(admin as never, "user-1/auto-1");

    expect(admin.storage.from).toHaveBeenCalledWith("shorts-videos");
    expect(remove).toHaveBeenCalledWith(["user-1/auto-1/assets/photo.png", "user-1/auto-1/run-1/final.mp4"]);
    expect(remove.mock.calls.flat(2)).not.toContain("user-1/auto-2/other.png");
  });

  it("never throws: a storage error is logged and the caller's deletion goes on", async () => {
    const { admin } = makeAdmin({ folders: {}, listError: { message: "storage down" } });
    await expect(removeShortsFiles(admin as never, "user-1/auto-1")).resolves.toBeUndefined();
  });
});
