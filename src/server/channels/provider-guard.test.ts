import { describe, expect, it } from "vitest";
import { assertChannelDataProviderAllowed } from "./provider-guard";

describe("assertChannelDataProviderAllowed", () => {
  it("allows mock outside production", () => {
    expect(() => assertChannelDataProviderAllowed("mock", "development")).not.toThrow();
    expect(() => assertChannelDataProviderAllowed("mock", "test")).not.toThrow();
  });

  it("rejects mock in production", () => {
    expect(() => assertChannelDataProviderAllowed("mock", "production")).toThrow(/CHANNEL_DATA_PROVIDER/);
  });

  it("allows live in production", () => {
    expect(() => assertChannelDataProviderAllowed("live", "production")).not.toThrow();
  });
});
