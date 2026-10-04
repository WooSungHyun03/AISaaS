import { describe, expect, it } from "vitest";
import { isPrivateAddress } from "./ssrf";

describe("isPrivateAddress", () => {
  it.each([
    "0.0.0.0", "10.1.2.3", "127.0.0.1", "169.254.169.254", "172.16.0.1", "172.31.255.255",
    "192.168.1.1", "100.64.0.1", "192.0.0.1", "192.0.2.5", "198.18.0.1", "198.51.100.7", "203.0.113.9", "224.0.0.1", "255.255.255.255",
  ])("blocks private/reserved IPv4 %s", (address) => {
    expect(isPrivateAddress(address)).toBe(true);
  });

  it.each(["8.8.8.8", "93.184.215.14", "172.15.0.1", "172.32.0.1", "100.63.0.1", "198.20.0.1"])("allows public IPv4 %s", (address) => {
    expect(isPrivateAddress(address)).toBe(false);
  });

  it.each([
    "::1", "::", "fc00::1", "fd12:3456::1", "fe80::1", "febf::1", "fec0::1", "ff02::1",
    "::ffff:127.0.0.1", "::ffff:10.0.0.1", "::ffff:7f00:1", "64:ff9b::7f00:1", "2002:7f00:1::1", "2001:0:abcd::1", "2001:db8::1",
  ])("blocks private/internal IPv6 %s", (address) => {
    expect(isPrivateAddress(address)).toBe(true);
  });

  it.each(["2606:4700:4700::1111", "2a00:1450:4001:81b::200e"])("allows public IPv6 %s", (address) => {
    expect(isPrivateAddress(address)).toBe(false);
  });

  it("refuses malformed IPv4 instead of letting it through", () => {
    expect(isPrivateAddress("999.1.1.1")).toBe(true);
    expect(isPrivateAddress("1.2.3")).toBe(true);
  });
});
