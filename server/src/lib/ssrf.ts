import dns from "node:dns/promises";

/** Fail-closed check: unparseable input counts as private. */
function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts;
  return (
    a === 10 || // 10.0.0.0/8
    (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12
    (a === 192 && b === 168) || // 192.168.0.0/16
    a === 127 || // 127.0.0.0/8 loopback
    (a === 169 && b === 254) || // 169.254.0.0/16 link-local
    (a === 100 && b >= 64 && b <= 127) || // 100.64.0.0/10 CGNAT
    (a === 198 && (b === 18 || b === 19)) || // 198.18.0.0/15 benchmarking
    (a === 192 && b === 0 && parts[2] === 2) || // 192.0.2.0/24 TEST-NET-1
    (a === 198 && b === 51 && parts[2] === 100) || // 198.51.100.0/24 TEST-NET-2
    (a === 203 && b === 0 && parts[2] === 113) || // 203.0.113.0/24 TEST-NET-3
    a === 0 // 0.0.0.0/8
  );
}

function isPrivateIPv6(ip: string): boolean {
  const n = ip.toLowerCase();
  return (
    n === "::1" ||
    n === "::" ||
    n.startsWith("fe80:") || // link-local
    n.startsWith("fc") ||
    n.startsWith("fd") // fc00::/7 unique local
  );
}

/**
 * Validates a user-supplied URL before we hand it to headless Chromium.
 * Guards against SSRF: http/https only, no localhost-style hostnames,
 * and the resolved IP must not be private/loopback/link-local.
 * (This also blocks 127.0.0.1.nip.io style DNS tricks.)
 * Throws an Error with a human-readable message on failure.
 */
export async function validateAuditUrl(raw: string): Promise<string> {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error("That doesn't look like a valid URL — include the scheme, e.g. https://example.com");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http:// and https:// URLs can be audited.");
  }
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) {
    throw new Error("Local addresses can't be audited.");
  }

  let addresses: string[];
  try {
    addresses = (await dns.lookup(host, { all: true })).map((a) => a.address);
  } catch {
    throw new Error(`Couldn't resolve "${host}". Check the URL and try again.`);
  }
  for (const ip of addresses) {
    const privateIp = ip.includes(":") ? isPrivateIPv6(ip) : isPrivateIPv4(ip);
    if (privateIp) {
      throw new Error("That URL resolves to a private or local address, which can't be audited.");
    }
  }
  return url.toString();
}
