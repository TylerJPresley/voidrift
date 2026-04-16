/**
 * SSRF guard for HTTP tools (REQ-SEC-3).
 */

import { lookup } from "node:dns/promises";

export class SSRFError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SSRFError";
  }
}

// Blocked IP ranges — checked against resolved addresses
const BLOCKED_RANGES: Array<[bigint, bigint]> = [
  ...cidr4("169.254.0.0", 16),   // link-local
  ...cidr4("10.0.0.0", 8),       // RFC 1918
  ...cidr4("172.16.0.0", 12),    // RFC 1918
  ...cidr4("192.168.0.0", 16),   // RFC 1918
  ...cidr4("100.64.0.0", 10),    // CGNAT
];

// Loopback (127.0.0.0/8) is ALLOWED for local dev servers

function cidr4(base: string, prefix: number): Array<[bigint, bigint]> {
  const parts = base.split(".").map(Number);
  const ip = BigInt(((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0);
  const mask = BigInt(0xFFFFFFFF) << BigInt(32 - prefix) & BigInt(0xFFFFFFFF);
  const start = ip & mask;
  const end = start | (~mask & BigInt(0xFFFFFFFF));
  return [[start, end]];
}

function ip4ToInt(ip: string): bigint | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const nums = parts.map(Number);
  if (nums.some(n => isNaN(n) || n < 0 || n > 255)) return null;
  return BigInt(((nums[0] << 24) | (nums[1] << 16) | (nums[2] << 8) | nums[3]) >>> 0);
}

function isBlocked(ip: string): boolean {
  // IPv6 check (REQ-SEC-3)
  if (ip.includes(":")) {
    // Allow IPv4-mapped loopback
    if (ip === "::1") return false;
    if (ip === "::ffff:127.0.0.1") return false;
    // Block unique-local (fc00::/7), link-local (fe80::/10), loopback (::1 already allowed)
    const lower = ip.toLowerCase();
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // fc00::/7
    if (lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb")) return true; // fe80::/10
    // Block IPv4-mapped private addresses
    if (lower.startsWith("::ffff:")) {
      const v4 = lower.slice(7);
      const v4Int = ip4ToInt(v4);
      if (v4Int !== null) return isBlockedV4(v4Int);
    }
    return false;
  }

  const n = ip4ToInt(ip);
  if (n === null) return false;
  return isBlockedV4(n);
}

function isBlockedV4(n: bigint): boolean {
  // Allow loopback
  if (n >= ip4ToInt("127.0.0.0")! && n <= ip4ToInt("127.255.255.255")!) return false;
  for (const [start, end] of BLOCKED_RANGES) {
    if (n >= start && n <= end) return true;
  }
  return false;
}

function matchesAllowList(ip: string, hostname: string, allowList: string[]): boolean {
  for (const entry of allowList) {
    if (entry === hostname) return true;
    if (entry.includes("/")) {
      // CIDR match
      const n = ip4ToInt(ip);
      if (n === null) continue;
      const [base, prefixStr] = entry.split("/");
      const baseN = ip4ToInt(base);
      if (baseN === null) continue;
      const prefix = Number(prefixStr);
      const mask = BigInt(0xFFFFFFFF) << BigInt(32 - prefix) & BigInt(0xFFFFFFFF);
      if ((n & mask) === (baseN & mask)) return true;
    }
  }
  return false;
}

export async function checkSsrf(url: string, allowList: string[] = []): Promise<void> {
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    throw new SSRFError(`Cannot parse hostname from URL: ${url}`);
  }
  if (!hostname) throw new SSRFError(`Cannot parse hostname from URL: ${url}`);

  if (allowList.includes(hostname)) return;

  let address: string;
  try {
    const result = await lookup(hostname);
    address = result.address;
  } catch (e) {
    throw new SSRFError(`Cannot resolve hostname '${hostname}': ${e}`);
  }

  if (matchesAllowList(address, hostname, allowList)) return;

  if (isBlocked(address)) {
    throw new SSRFError(`Request to '${url}' blocked: resolved IP ${address} is in a blocked range`);
  }
}
