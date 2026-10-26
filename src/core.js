/**
 * cidr-range-subtract-utils — pure-ESM IPv4 CIDR range subtraction.
 *
 * The trick that makes this fast: convert CIDR blocks to integer ranges
 * [start, end], merge them, then subtract. Operating on half-open
 * integer ranges lets us treat IPv4 as a flat 32-bit unsigned number line,
 * which makes union and difference purely arithmetic. No netmask fiddling
 * per host. We only return to CIDR notation at the very end.
 *
 * Output is canonical: CIDR blocks are minimal, sorted, and non-overlapping.
 */

const IP_V4_BITS = 32;
const MAX_UINT32 = 0xFFFFFFFF;

/**
 * Convert dotted-decimal IPv4 to a 32-bit unsigned integer.
 * Throws RangeError if the string is malformed or any octet exceeds 255.
 */
export function ipv4ToInt(ip) {
  const parts = ip.split('.');
  if (parts.length !== 4) {
    throw new RangeError(`Invalid IPv4 address: ${ip}`);
  }
  let result = 0;
  for (const part of parts) {
    if (!/^\d+$/.test(part)) {
      throw new RangeError(`Invalid IPv4 octet: ${part}`);
    }
    const octet = Number(part);
    if (octet > 255) {
      throw new RangeError(`IPv4 octet out of range: ${octet}`);
    }
    result = result * 256 + octet;
  }
  // Coerce to unsigned 32-bit. result is already <= MAX_UINT32 by the octet
  // checks, but >>> 0 documents intent and protects against surprising
  // signed-integer behaviour in downstream code.
  return result >>> 0;
}

/**
 * Convert a 32-bit unsigned integer back to dotted-decimal IPv4.
 * Input must be in [0, 2^32-1].
 */
export function intToIpv4(value) {
  if (!Number.isInteger(value) || value < 0 || value > MAX_UINT32) {
    throw new RangeError(`Integer out of IPv4 range: ${value}`);
  }
  const a = (value >>> 24) & 0xFF;
  const b = (value >>> 16) & 0xFF;
  const c = (value >>> 8) & 0xFF;
  const d = value & 0xFF;
  return `${a}.${b}.${c}.${d}`;
}

/**
 * Parse a CIDR block like "192.168.0.0/24" into the half-open integer
 * range [start, end] where end is inclusive (i.e. the last usable host).
 * The /0 block covers the full 32-bit space.
 */
export function parseCidr(cidr) {
  const slashIdx = cidr.indexOf('/');
  let ipPart, prefix;
  if (slashIdx === -1) {
    ipPart = cidr;
    prefix = IP_V4_BITS;
  } else {
    ipPart = cidr.slice(0, slashIdx);
    const prefixStr = cidr.slice(slashIdx + 1);
    if (!/^\d+$/.test(prefixStr)) {
      throw new RangeError(`Invalid CIDR prefix: ${cidr}`);
    }
    prefix = Number(prefixStr);
  }
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > IP_V4_BITS) {
    throw new RangeError(`CIDR prefix out of range: ${cidr}`);
  }
  const base = ipv4ToInt(ipPart);
  if (prefix === 0) {
    return { start: 0, end: MAX_UINT32 };
  }
  // Arithmetic with >>> 0 to keep within unsigned 32-bit space. Without
  // this, 1 << 31 becomes negative and the whole mask collapses.
  const mask = ((0xFFFFFFFF << (IP_V4_BITS - prefix)) >>> 0);
  const blockSize = 1 << (IP_V4_BITS - prefix);
  const start = base & mask;
  const end = start + blockSize - 1;
  return { start: start >>> 0, end: end >>> 0 };
}

/**
 * Merge a list of integer ranges so that subsequent operations work on
 * disjoint, sorted input. Adjacent ranges are coalesced (e.g. [0..10] and
 * [11..20] become [0..20]) because they form a contiguous span and there is
 * nothing to be gained by keeping them separate.
 */
function mergeRanges(ranges) {
  if (ranges.length === 0) return [];
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const merged = [sorted[0]];
  for (const range of sorted.slice(1)) {
    const last = merged[merged.length - 1];
    // +2 because last.end is inclusive; adjacent means last.end+1 == range.start.
    if (range.start <= last.end + 1) {
      if (range.end > last.end) last.end = range.end;
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

/**
 * Subtract `subtrahend` ranges from `minuend` ranges. Both inputs are
 * lists of {start, end} inclusive integer ranges. Returns a list of
 * non-overlapping ranges sorted by start.
 */
function subtractRanges(minuend, subtrahend) {
  const mergedMinuend = mergeRanges(minuend);
  const mergedSubtrahend = mergeRanges(subtrahend);
  if (mergedSubtrahend.length === 0) return mergedMinuend;
  if (mergedMinuend.length === 0) return [];

  const result = [];
  let mIdx = 0;
  for (const s of mergedSubtrahend) {
    while (mIdx < mergedMinuend.length) {
      const m = mergedMinuend[mIdx];
      if (m.end < s.start) {
        // Minuend entirely before subtrahend — keep it, move on.
        result.push({ start: m.start, end: m.end });
        mIdx++;
      } else if (m.start > s.end) {
        // Minuend entirely after subtrahend — stop, this and later minuend
        // segments are not affected by the current subtrahend.
        break;
      } else {
        // Overlap. Emit the surviving left portion, then advance or shrink.
        if (m.start < s.start) {
          result.push({ start: m.start, end: s.start - 1 });
        }
        if (m.end > s.end) {
          // Right portion survives; shrink in place so later subtrahends
          // can still bite it.
          mergedMinuend[mIdx] = { start: s.end + 1, end: m.end };
          break;
        } else {
          // Minuend fully consumed.
          mIdx++;
        }
      }
    }
  }
  // Flush any remaining minuend segments.
  while (mIdx < mergedMinuend.length) {
    result.push({ start: mergedMinuend[mIdx].start, end: mergedMinuend[mIdx].end });
    mIdx++;
  }
  return result;
}

/**
 * Split a single inclusive integer range into the minimal set of CIDR
 * blocks that cover exactly that range. Uses the classic greedy approach:
 * at each step, take the largest aligned block that fits. We deliberately
 * use multiplication and addition to compute the block size from the number
 * of trailing zeros, because left-shift by 32 in JavaScript yields a
 * 32-bit signed result that breaks the arithmetic.
 */
function rangeToCidrBlocks(start, end) {
  const blocks = [];
  while (start <= end) {
    // Number of zero bits at the low end of `start`. These are the bits
    // we are free to set, i.e. the maximum width of a block rooted here.
    const trailingZeros = ntz(start);
    const maxBlockBits = Math.min(trailingZeros, IP_V4_BITS);
    // How many bits we would need to span all the way to `end`.
    let rangeBits = 0;
    if (end > start) {
      rangeBits = Math.floor(Math.log2(end - start + 1));
    }
    const prefixLen = IP_V4_BITS - Math.min(maxBlockBits, rangeBits);
    const size = pow2(IP_V4_BITS - prefixLen);
    blocks.push(intToIpv4(start) + '/' + prefixLen);
    start += size;
  }
  return blocks;
}

/** Number of trailing zero bits in a 32-bit unsigned integer. */
function ntz(n) {
  if (n === 0) return IP_V4_BITS;
  let count = 0;
  while ((n & 1) === 0) {
    count++;
    n = n >>> 1;
  }
  return count;
}

/** 2^k for small k (0..32), using multiplication to avoid the 1<<32 trap. */
function pow2(k) {
  if (k === 0) return 1;
  let result = 1;
  for (let i = 0; i < k; i++) result *= 2;
  return result;
}

/**
 * Subtract a list of CIDR blocks (subtrahend) from a list of CIDR blocks
 * (minuend). Returns the remaining address space as a minimal, sorted,
 * non-overlapping list of CIDR strings.
 *
 * @param {string[]} minuend - Blocks to subtract from.
 * @param {string[]} subtrahend - Blocks to remove.
 * @returns {string[]} Remaining CIDR blocks.
 */
export function subtractCidr(minuend, subtrahend) {
  if (!Array.isArray(minuend) || !Array.isArray(subtrahend)) {
    throw new TypeError('Both arguments must be arrays of CIDR strings');
  }
  const minuendRanges = minuend.map(parseCidr);
  const subtrahendRanges = subtrahend.map(parseCidr);
  const remaining = subtractRanges(minuendRanges, subtrahendRanges);
  const blocks = [];
  for (const { start, end } of remaining) {
    blocks.push(...rangeToCidrBlocks(start, end));
  }
  return blocks;
}
