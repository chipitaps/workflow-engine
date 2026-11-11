import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

export class StepError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly output?: unknown,
  ) {
    super(message);
  }
}

function ipv4Blocked(address: string) {
  const [a, b] = address.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

export function isBlockedAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return ipv4Blocked(address);
  if (version !== 6) return true;

  const lower = address.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (mapped) return ipv4Blocked(mapped[1]);
  return (
    lower === "::" ||
    lower === "::1" ||
    lower.startsWith("fc") ||
    lower.startsWith("fd") ||
    /^fe[89ab]/.test(lower) ||
    lower.startsWith("ff")
  );
}

export type NetworkPolicy = { allowPrivate: boolean; allowedHosts: string[] };

export function policyFromEnv(env: Record<string, string | undefined> = process.env): NetworkPolicy {
  return {
    allowPrivate: env.ALLOW_PRIVATE_NETWORK === "true",
    allowedHosts: (env.HTTP_ALLOW_HOSTS ?? "")
      .split(",")
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean),
  };
}

export async function assertAllowedUrl(
  raw: string,
  policy: NetworkPolicy,
  resolveHost: (host: string) => Promise<string[]> = async (host) =>
    (await dnsLookup(host, { all: true })).map((entry) => entry.address),
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new StepError(`"${raw.slice(0, 120)}" is not a valid URL.`, false);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new StepError("Only http and https URLs are allowed.", false);
  }
  if (url.username || url.password) {
    throw new StepError("URLs with embedded credentials are not allowed.", false);
  }

  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (policy.allowPrivate || policy.allowedHosts.includes(host)) return url;

  let addresses: string[];
  if (isIP(host)) {
    addresses = [host];
  } else {
    try {
      addresses = await resolveHost(host);
    } catch {
      throw new StepError(`Could not resolve ${host}.`, true);
    }
  }
  if (addresses.length === 0 || addresses.some(isBlockedAddress)) {
    throw new StepError(`${host} points to a private or reserved address, which is blocked.`, false);
  }
  return url;
}
