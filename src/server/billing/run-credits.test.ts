import { afterEach, describe, expect, it, vi } from "vitest";

const { reserveCreditMock, settleCreditMock, releaseCreditMock } = vi.hoisted(() => ({
  reserveCreditMock: vi.fn(),
  settleCreditMock: vi.fn(),
  releaseCreditMock: vi.fn(),
}));
vi.mock("./credits", () => ({
  reserveCredit: reserveCreditMock,
  settleCredit: settleCreditMock,
  releaseCredit: releaseCreditMock,
}));

const {
  InsufficientCreditsError,
  creditKindForTemplate,
  readCreditReservationId,
  releaseRunCredit,
  reserveRunCredit,
  settleRunCredit,
} = await import("./run-credits");

afterEach(() => vi.clearAllMocks());

describe("run credits", () => {
  it("meters only Blog and Shorts, each with its own kind", () => {
    expect(creditKindForTemplate("blog-marketing")).toBe("BLOG");
    expect(creditKindForTemplate("shorts")).toBe("SHORTS");
    expect(creditKindForTemplate("newsletter")).toBeNull();
  });

  it("reserves exactly one credit of the template's kind, referenced by the run", async () => {
    reserveCreditMock.mockResolvedValueOnce("resv-1");
    await expect(reserveRunCredit("user-1", "shorts", "run-1")).resolves.toBe("resv-1");
    expect(reserveCreditMock).toHaveBeenCalledWith({ userId: "user-1", kind: "SHORTS", amount: 1, referenceId: "run-1" });
  });

  it("does not touch the ledger for a template that is not metered", async () => {
    await expect(reserveRunCredit("user-1", "newsletter", "run-1")).resolves.toBeNull();
    expect(reserveCreditMock).not.toHaveBeenCalled();
  });

  it("turns the database's insufficient-credit error into a purchase hint", async () => {
    reserveCreditMock.mockRejectedValueOnce({ code: "P0001", message: "insufficient BLOG credits: missing 1" });
    const error = await reserveRunCredit("user-1", "blog-marketing", "run-1").catch((e) => e);
    expect(error).toBeInstanceOf(InsufficientCreditsError);
    expect(error.message).toContain("블로그 이용권");
    expect(error.message).toContain("구매");
  });

  it("lets unrelated database errors through instead of pretending the balance is empty", async () => {
    reserveCreditMock.mockRejectedValueOnce({ code: "XX000", message: "boom" });
    await expect(reserveRunCredit("user-1", "blog-marketing", "run-1")).rejects.toMatchObject({ code: "XX000" });
  });

  it("settle and release do nothing without a reservation and never throw on bookkeeping errors", async () => {
    await settleRunCredit(null, "run-1");
    await releaseRunCredit(undefined, "run-1", "run_failed");
    expect(settleCreditMock).not.toHaveBeenCalled();
    expect(releaseCreditMock).not.toHaveBeenCalled();

    settleCreditMock.mockRejectedValueOnce(new Error("db down"));
    releaseCreditMock.mockRejectedValueOnce(new Error("db down"));
    await expect(settleRunCredit("resv-1", "run-1")).resolves.toBeUndefined();
    await expect(releaseRunCredit("resv-1", "run-1", "run_failed")).resolves.toBeUndefined();
  });

  it("reads the reservation id back from a run's input", () => {
    expect(readCreditReservationId({ creditReservationId: "resv-9" })).toBe("resv-9");
    expect(readCreditReservationId({})).toBeNull();
    expect(readCreditReservationId(null)).toBeNull();
    expect(readCreditReservationId([])).toBeNull();
  });
});
