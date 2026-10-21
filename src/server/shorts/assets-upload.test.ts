import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env/client", () => ({ clientEnv: { NEXT_PUBLIC_SITE_URL: "https://example.test" } }));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

type Result = { data: unknown; error: { message: string; status?: number } | null };
const ok = (data: unknown = {}): Result => ({ data, error: null });
const fail = (message: string, status = 400): Result => ({ data: null, error: { message, status } });

/** A stand-in for the Supabase Storage admin API: each call takes the next scripted answer. */
function makeAdmin(script: { sign?: Result[]; create?: Result[]; update?: Result[] }) {
  const calls = { sign: [] as string[], create: [] as Array<{ id: string; options: Record<string, unknown> }>, update: [] as Array<{ id: string; options: Record<string, unknown> }> };
  const next = (queue: Result[] | undefined, fallback: Result) => (queue && queue.length > 0 ? queue.shift()! : fallback);
  const sign = script.sign ?? [];
  const create = script.create ?? [];
  const update = script.update ?? [];
  const admin = {
    storage: {
      from: () => ({
        createSignedUploadUrl: vi.fn(async (path: string) => {
          calls.sign.push(path);
          return next(sign, ok({ path, token: "tok", signedUrl: "https://x" }));
        }),
      }),
      createBucket: vi.fn(async (id: string, options: Record<string, unknown>) => {
        calls.create.push({ id, options });
        return next(create, ok());
      }),
      updateBucket: vi.fn(async (id: string, options: Record<string, unknown>) => {
        calls.update.push({ id, options });
        return next(update, ok());
      }),
    },
  };
  return { admin: admin as never, calls };
}

// bucketsReady is module state: every test gets a fresh copy of the module
async function load() {
  vi.resetModules();
  return import("./assets");
}

beforeEach(() => vi.clearAllMocks());

describe("createAssetUpload", () => {
  it("asks for the signed URL first and does not touch the buckets when it works (the normal case)", async () => {
    const { createAssetUpload } = await load();
    const { admin, calls } = makeAdmin({});

    await expect(createAssetUpload(admin, "u/a/assets/x.jpg")).resolves.toEqual({ path: "u/a/assets/x.jpg", token: "tok" });

    expect(calls.create).toHaveLength(0);
    expect(calls.update).toHaveLength(0);
  });

  it("creates the buckets and asks again when the first request fails (bucket missing)", async () => {
    const { createAssetUpload } = await load();
    const { admin, calls } = makeAdmin({ sign: [fail("Bucket not found", 404)] });

    await expect(createAssetUpload(admin, "u/a/assets/x.jpg")).resolves.toMatchObject({ token: "tok" });

    expect(calls.create.map((call) => call.id)).toEqual(["shorts-references", "shorts-videos"]);
    expect(calls.sign).toHaveLength(2);
  });

  it("still uploads when a hosted project refuses the bucket's size limit (the production failure): the bucket is created without it", async () => {
    const { createAssetUpload } = await load();
    const { admin, calls } = makeAdmin({
      sign: [fail("Bucket not found", 404)],
      // the project's global upload limit (50 MB) is lower than the 100 MB / 200 MB the buckets ask for
      create: [fail("The object exceeded the maximum allowed size", 413), ok(), fail("The object exceeded the maximum allowed size", 413), ok()],
    });

    await expect(createAssetUpload(admin, "u/a/assets/x.jpg")).resolves.toMatchObject({ token: "tok" });

    const refused = calls.create[0].options;
    const retried = calls.create[1].options;
    expect(refused).toHaveProperty("fileSizeLimit");
    expect(retried).not.toHaveProperty("fileSizeLimit");
    expect(retried).toMatchObject({ public: false, allowedMimeTypes: expect.arrayContaining(["image/jpeg", "image/png", "image/webp"]) });
  });

  it("an existing bucket whose update is refused is still used: a failed settings update never blocks an upload", async () => {
    const { createAssetUpload } = await load();
    const { admin, calls } = makeAdmin({
      sign: [fail("Bucket not found", 404)],
      create: [fail("Bucket already exists", 409), fail("Bucket already exists", 409)],
      update: [fail("The object exceeded the maximum allowed size", 413), fail("denied", 403), fail("The object exceeded the maximum allowed size", 413), fail("denied", 403)],
    });

    await expect(createAssetUpload(admin, "u/a/assets/x.jpg")).resolves.toMatchObject({ token: "tok" });
    expect(calls.update.length).toBeGreaterThan(0);
  });

  it("reports a bucket that can be neither created nor found with a code, never as a raw error", async () => {
    const { createAssetUpload, AssetStorageError } = await load();
    const { admin } = makeAdmin({ sign: [fail("Bucket not found", 404)], create: [fail("boom", 500), fail("boom", 500)] });

    const error = await createAssetUpload(admin, "u/a/assets/x.jpg").catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AssetStorageError);
    expect(error).toMatchObject({ code: "STORAGE_BUCKET" });
  });

  it("reports a signed URL that still cannot be made after the buckets exist", async () => {
    const { createAssetUpload } = await load();
    const { admin } = makeAdmin({ sign: [fail("Bucket not found", 404), fail("Invalid key", 400)] });

    await expect(createAssetUpload(admin, "u/a/assets/x.jpg")).rejects.toMatchObject({ code: "STORAGE_SIGN" });
  });
});

describe("ensureShortsBuckets", () => {
  it("is done once per process, not on every call", async () => {
    const { ensureShortsBuckets } = await load();
    const { admin, calls } = makeAdmin({});

    await ensureShortsBuckets(admin);
    await ensureShortsBuckets(admin);

    expect(calls.create).toHaveLength(2); // the two buckets, once
  });

  it("is retried on the next call when it failed (a transient error must not be remembered as success)", async () => {
    const { ensureShortsBuckets } = await load();
    const { admin, calls } = makeAdmin({ create: [fail("boom", 500), fail("boom", 500)] });

    await expect(ensureShortsBuckets(admin)).rejects.toMatchObject({ code: "STORAGE_BUCKET" });
    await expect(ensureShortsBuckets(admin)).resolves.toBeUndefined();
    expect(calls.create.length).toBeGreaterThan(2);
  });
});
