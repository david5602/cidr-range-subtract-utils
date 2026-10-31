# cidr-range-subtract-utils

Removes one set of IPv4 CIDR blocks from another and returns the remaining address space as a minimal, sorted, non-overlapping list of CIDR blocks. Pure ESM, zero dependencies.

## Usage

```js
import { subtractCidr } from 'cidr-range-subtract-utils';

// Remove 10.0.0.0/26 from 10.0.0.0/24
const remaining = subtractCidr(['10.0.0.0/24'], ['10.0.0.0/26']);
// => ['10.0.0.64/26']

// Subtraction can split a block into several pieces
const pieces = subtractCidr(['10.0.0.0/24'], ['10.0.0.100/32']);
// => ['10.0.0.0/26', '10.0.0.128/25'] (the /32 sits inside the first /26)
```

Exports:
- `subtractCidr(minuend: string[], subtrahend: string[]) : string[]`
- `ipv4ToInt(ip: string): number`
- `intToIpv4(value: number): string`

Both arrays of CIDR strings are passed as-is; the function does not mutate them. Empty inputs are fine: subtracting `[]` from anything returns the minuend merged and canonicalised.

## Why this exists

Calculating "what address space is left after I carve out these allocations" comes up in network planning, firewall rule generation, and capacity reporting. The straightforward approach — walk the prefix tree and emit surviving nodes — is fiddly to get right, especially around partial overlaps and adjacency. This library sidesteps the tree entirely: every CIDR block becomes a half-open integer range, subtraction becomes integer arithmetic on a sorted list, and the result is converted back to CIDR form at the end.

The trade-off is memory: we hold the working set as flat integer ranges rather than a compact trie. For typical planning inputs (hundreds to low thousands of blocks) this is irrelevant and the code stays simple enough to audit.

## The awkward edge

A subtraction can produce blocks smaller than the inputs: removing a single /32 host from the middle of a /24 yields two pieces, one of which (`10.0.0.2/31`) is only two addresses. The output is always minimal and aligned, but it may contain many more entries than either input. There is no "simplify to fewer, larger blocks" post-pass — the output is already canonical CIDR.

The other thing to note: `ipv4ToInt` returns a JavaScript `number`, which is a 64-bit float. IPv4 fits in 32 bits, so every representable value is an exact integer — but be aware that arithmetic on the result uses float semantics. The library stays within the 32-bit range internally and masks with `>>> 0` where signed-shift hazards appear.

## Performance

The window keeps a bounded buffer, so `push` is constant time and memory does not
grow with the length of the stream. `peak` and `trough` are linear in the window
size, which is the trade that keeps `push` cheap.

