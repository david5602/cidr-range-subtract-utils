import { test } from 'node:test';
import assert from 'node:assert/strict';
import { subtractCidr, ipv4ToInt, intToIpv4 } from '../src/core.js';

test('ipv4ToInt round-trips through intToIpv4', () => {
  assert.equal(intToIpv4(0), '0.0.0.0');
  assert.equal(ipv4ToInt('0.0.0.0'), 0);
  assert.equal(intToIpv4(0xFFFFFFFF), '255.255.255.255');
  assert.equal(ipv4ToInt('255.255.255.255'), 0xFFFFFFFF >>> 0);
  assert.equal(intToIpv4(ipv4ToInt('192.168.1.100')), '192.168.1.100');
});

test('ipv4ToInt rejects malformed input', () => {
  assert.throws(() => ipv4ToInt('1.2.3'), RangeError);
  assert.throws(() => ipv4ToInt('1.2.3.4.5'), RangeError);
  assert.throws(() => ipv4ToInt('256.1.1.1'), RangeError);
  assert.throws(() => ipv4ToInt('a.b.c.d'), RangeError);
});

test('intToIpv4 rejects out-of-range integers', () => {
  assert.throws(() => intToIpv4(-1), RangeError);
  assert.throws(() => intToIpv4(0x100000000), RangeError);
  assert.throws(() => intToIpv4(1.5), RangeError);
});

test('subtractCidr: exact match yields empty result', () => {
  assert.deepEqual(subtractCidr(['10.0.0.0/24'], ['10.0.0.0/24']), []);
});

test('subtractCidr: no overlap returns the minuend', () => {
  assert.deepEqual(subtractCidr(['10.0.0.0/24'], ['10.1.0.0/24']), ['10.0.0.0/24']);
});

test('subtractCidr: subtrahend larger than minuend yields empty', () => {
  assert.deepEqual(subtractCidr(['10.0.0.0/24'], ['10.0.0.0/8']), []);
});

test('subtractCidr: remove right half of /24', () => {
  assert.deepEqual(
    subtractCidr(['10.0.0.0/24'], ['10.0.0.128/25']),
    ['10.0.0.0/25']
  );
});

test('subtractCidr: remove left half of /24', () => {
  assert.deepEqual(
    subtractCidr(['10.0.0.0/24'], ['10.0.0.0/25']),
    ['10.0.0.128/25']
  );
});

test('subtractCidr: remove middle of /24 leaves two /25s', () => {
  assert.deepEqual(
    subtractCidr(['10.0.0.0/24'], ['10.0.0.64/26']),
    ['10.0.0.0/26', '10.0.0.128/25']
  );
});

test('subtractCidr: remove a single /32 host from a /30', () => {
  assert.deepEqual(
    subtractCidr(['10.0.0.0/30'], ['10.0.0.1/32']),
    ['10.0.0.0/32', '10.0.0.2/31']
  );
});

test('subtractCidr: multiple minuend blocks merge after subtraction', () => {
  // Adjacent blocks 10.0.0.0/24 and 10.0.1.0/24 together form a contiguous
  // /23. Removing nothing leaves them as the single /23.
  assert.deepEqual(
    subtractCidr(['10.0.0.0/24', '10.0.1.0/24'], []),
    ['10.0.0.0/23']
  );
});

test('subtractCidr: multiple subtrahend blocks merge before subtracting', () => {
  assert.deepEqual(
    subtractCidr(['10.0.0.0/24'], ['10.0.0.0/26', '10.0.0.64/26']),
    ['10.0.0.128/25']
  );
});

test('subtractCidr: full /8 minus a /16 leaves canonical blocks', () => {
  assert.deepEqual(
    subtractCidr(['10.0.0.0/8'], ['10.0.0.0/16']),
    ['10.1.0.0/16', '10.2.0.0/15', '10.4.0.0/14', '10.8.0.0/13', '10.16.0.0/12', '10.32.0.0/11', '10.64.0.0/10', '10.128.0.0/9']
  );
});

test('subtractCidr: /0 minus /0 is empty', () => {
  assert.deepEqual(subtractCidr(['0.0.0.0/0'], ['0.0.0.0/0']), []);
});

test('subtractCidr: rejects non-array arguments', () => {
  assert.throws(() => subtractCidr('10.0.0.0/24', []), TypeError);
  assert.throws(() => subtractCidr([], '10.0.0.0/24'), TypeError);
});
