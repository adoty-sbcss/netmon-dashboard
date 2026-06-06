/**
 * Tiny IPv4 helpers — pure, no deps, client-safe (used by the AI chat tools, the
 * topology coverage model, and the client-side map coverage overlay). IPv4 only;
 * IPv6 inputs return null/false and the caller treats them as "not matched".
 */

/** Dotted-quad → unsigned 32-bit int, or null if not a valid IPv4 address. */
export function ipToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const o = Number(p);
    if (!Number.isInteger(o) || o < 0 || o > 255) return null;
    n = (n << 8) | o;
  }
  return n >>> 0;
}

/** True if `ip` falls inside `cidr` (e.g. "10.4.0.0/24"). IPv4 only. */
export function ipInCidr(ip: string, cidr: string): boolean {
  const [range, bitsStr] = cidr.split("/");
  const bits = Number(bitsStr);
  if (!Number.isFinite(bits) || bits < 0 || bits > 32) return false;
  const a = ipToInt(ip);
  const b = ipToInt(range);
  if (a == null || b == null) return false;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (a & mask) === (b & mask);
}

/** True if `ip` is inside ANY of the CIDRs. */
export function ipInAnyCidr(ip: string | null | undefined, cidrs: string[]): boolean {
  if (!ip) return false;
  for (const c of cidrs) if (ipInCidr(ip, c)) return true;
  return false;
}

/**
 * Normalize a CIDR (often a host address + mask like "10.4.10.5/24") to its
 * network form ("10.4.10.0/24"). Returns null for non-IPv4 input.
 */
export function normalizeCidr(cidr: string | null | undefined): string | null {
  if (!cidr) return null;
  const [range, bitsStr] = cidr.split("/");
  const bits = bitsStr == null ? 32 : Number(bitsStr);
  if (!Number.isFinite(bits) || bits < 0 || bits > 32) return null;
  const a = ipToInt(range);
  if (a == null) return null;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  const net = (a & mask) >>> 0;
  const octets = [(net >>> 24) & 255, (net >>> 16) & 255, (net >>> 8) & 255, net & 255];
  return `${octets.join(".")}/${bits}`;
}

/** The /24 bucket an IPv4 belongs to ("10.4.20.37" → "10.4.20.0/24"), or null. */
export function slash24(ip: string | null | undefined): string | null {
  if (!ip) return null;
  return normalizeCidr(`${ip}/24`);
}
