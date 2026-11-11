import { describe, expect, it } from "vitest";
import { assertAllowedUrl, isBlockedAddress, policyFromEnv, StepError } from "../../src/engine/network";

const strict = { allowPrivate: false, allowedHosts: [] };
const resolvesTo =
  (...addresses: string[]) =>
  async () =>
    addresses;

describe("isBlockedAddress", () => {
  it("blocks loopback, private, link-local and reserved IPv4 ranges", () => {
    for (const address of [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.10",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
      "224.0.0.1",
    ]) {
      expect(isBlockedAddress(address), address).toBe(true);
    }
  });

  it("allows public IPv4 addresses", () => {
    for (const address of ["1.1.1.1", "8.8.8.8", "172.32.0.1", "140.82.112.3"]) {
      expect(isBlockedAddress(address), address).toBe(false);
    }
  });

  it("handles IPv6, including IPv4-mapped addresses", () => {
    expect(isBlockedAddress("::1")).toBe(true);
    expect(isBlockedAddress("fd00::1")).toBe(true);
    expect(isBlockedAddress("fe80::1")).toBe(true);
    expect(isBlockedAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isBlockedAddress("::ffff:8.8.8.8")).toBe(false);
    expect(isBlockedAddress("2606:4700:4700::1111")).toBe(false);
  });

  it("blocks anything that is not an IP address", () => {
    expect(isBlockedAddress("localhost")).toBe(true);
    expect(isBlockedAddress("")).toBe(true);
  });
});

describe("assertAllowedUrl", () => {
  it("accepts a public host", async () => {
    const url = await assertAllowedUrl("https://api.example.com/x", strict, resolvesTo("93.184.216.34"));
    expect(url.hostname).toBe("api.example.com");
  });

  it("rejects hosts that resolve to private addresses", async () => {
    await expect(assertAllowedUrl("http://internal.example.com", strict, resolvesTo("10.0.0.5"))).rejects.toThrow(
      /private or reserved/,
    );
  });

  it("rejects a host if any of its addresses is private", async () => {
    await expect(
      assertAllowedUrl("http://mixed.example.com", strict, resolvesTo("93.184.216.34", "127.0.0.1")),
    ).rejects.toThrow(StepError);
  });

  it("rejects literal private addresses without a DNS lookup", async () => {
    const neverCalled = async () => {
      throw new Error("should not resolve");
    };
    await expect(assertAllowedUrl("http://169.254.169.254/latest/meta-data", strict, neverCalled)).rejects.toThrow(
      /private or reserved/,
    );
    await expect(assertAllowedUrl("http://[::1]:8080/", strict, neverCalled)).rejects.toThrow(/private or reserved/);
  });

  it("rejects other schemes, credentials and malformed URLs", async () => {
    await expect(assertAllowedUrl("file:///etc/passwd", strict)).rejects.toThrow(/http and https/);
    await expect(assertAllowedUrl("https://user:pass@example.com", strict)).rejects.toThrow(/credentials/);
    await expect(assertAllowedUrl("not a url", strict)).rejects.toThrow(/not a valid URL/);
  });

  it("marks configuration errors as not retryable and DNS failures as retryable", async () => {
    const blocked = await assertAllowedUrl("http://10.0.0.1", strict).catch((error: StepError) => error);
    expect(blocked).toMatchObject({ retryable: false });
    const unresolved = await assertAllowedUrl("http://nope.example.com", strict, async () => {
      throw new Error("ENOTFOUND");
    }).catch((error: StepError) => error);
    expect(unresolved).toMatchObject({ retryable: true });
  });

  it("lets explicitly allowed hosts through", async () => {
    const policy = { allowPrivate: false, allowedHosts: ["app"] };
    const url = await assertAllowedUrl("http://app:3000/api/demo/echo", policy, resolvesTo("172.18.0.4"));
    expect(url.host).toBe("app:3000");
  });
});

describe("policyFromEnv", () => {
  it("is strict by default", () => {
    expect(policyFromEnv({})).toEqual({ allowPrivate: false, allowedHosts: [] });
  });

  it("reads the allow list", () => {
    expect(policyFromEnv({ HTTP_ALLOW_HOSTS: " App , internal.local ", ALLOW_PRIVATE_NETWORK: "true" })).toEqual({
      allowPrivate: true,
      allowedHosts: ["app", "internal.local"],
    });
  });
});
