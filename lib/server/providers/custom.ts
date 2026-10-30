import { lookup as dnsLookup } from "node:dns";
import { isIP, type LookupFunction } from "node:net";
import ipaddr from "ipaddr.js";
import { Agent } from "undici";

/** Generic endpoints require an exact operator-controlled hostname allowlist. */
export function parseCustomCredential(
  value: string,
  allowlist = process.env.GRACE_CUSTOM_PROVIDER_HOSTS
): { baseUrl: string; apiKey: string } {
  const input: unknown = JSON.parse(value);
  if (
    !input ||
    typeof input !== "object" ||
    !("baseUrl" in input) ||
    !("apiKey" in input) ||
    typeof input.baseUrl !== "string" ||
    typeof input.apiKey !== "string" ||
    !input.apiKey ||
    input.apiKey.length > 8192 ||
    /[\r\n]/.test(input.apiKey)
  ) {
    throw new Error("Invalid custom provider configuration");
  }
  const url = new URL(input.baseUrl);
  const allowed = new Set(
    (allowlist ?? "")
      .split(",")
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean)
  );
  if (
    input.baseUrl.includes("%") ||
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.port ||
    isIP(url.hostname) ||
    !url.hostname.includes(".") ||
    !allowed.has(url.hostname.toLowerCase()) ||
    !/^\/[A-Za-z0-9._~/-]*$/.test(url.pathname) ||
    url.pathname.length > 200
  ) {
    throw new Error("Custom provider host is not permitted");
  }
  return {
    apiKey: input.apiKey,
    baseUrl: `${url.origin}${url.pathname.replace(/\/+$/, "")}`,
  };
}

/** Reject every non-public answer, including IPv4-mapped IPv6 addresses. */
export function isPublicAddress(address: string): boolean {
  if (!ipaddr.isValid(address)) {
    return false;
  }
  const parsed = ipaddr.process(address);
  if (
    parsed.kind() === "ipv6" &&
    !parsed.match(ipaddr.IPv6.parse("2000::"), 3)
  ) {
    return false;
  }
  return parsed.range() === "unicast";
}

export const publicLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
    if (
      error ||
      !addresses.length ||
      addresses.some((item) => !isPublicAddress(item.address))
    ) {
      callback(error ?? new Error("Custom provider DNS is not public"), "", 0);
      return;
    }
    if (options.all) {
      callback(null, addresses);
      return;
    }
    const [first] = addresses;
    callback(null, first.address, first.family);
  });
};

const dispatcher = new Agent({ connect: { lookup: publicLookup } });
/** The underlying connection uses the DNS answers validated by publicLookup. */
export function customProviderFetch(
  baseUrl: string,
  request: typeof fetch = fetch
): typeof fetch {
  const base = new URL(baseUrl);
  return (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (
      url.origin !== base.origin ||
      !url.pathname.startsWith(`${base.pathname.replace(/\/$/, "")}/`)
    ) {
      throw new Error("Custom provider request URL rejected");
    }
    return request(input, {
      ...init,
      dispatcher,
      redirect: "error",
    } as RequestInit);
  };
}
