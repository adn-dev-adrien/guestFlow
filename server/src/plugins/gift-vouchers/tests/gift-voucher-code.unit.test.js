// specs/gift-vouchers.md rules 30, 32, 34 — the voucher code: alphabet, length, the check character, normalisation, the
// HMAC key, the encrypted copy, and no code in clear in any row.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const code = require('../code');
const fx = require('./giftVoucherFixtures');

const { ALPHABET } = code;
const randomCode = () => code.generate();

test('rule 30: the alphabet is Crockford base-32 — 32 distinct characters, no I, L, O or U', () => {
  assert.equal(ALPHABET.length, 32);
  assert.equal(new Set(ALPHABET).size, 32);
  assert.deepEqual([...'ILOU'].filter((c) => ALPHABET.includes(c)), []);
});

test('rule 30: a generated code is 16 characters of the alphabet and passes its own check', () => {
  for (let i = 0; i < 200; i += 1) {
    const c = randomCode();
    assert.equal(c.length, 16);
    assert.ok(code.isWellFormed(c));
    assert.ok(code.hasValidCheck(c), c);
  }
});

test('rule 30: 15 characters come from the injected random bytes, the 16th is the check', () => {
  const zeros = code.generate(() => Buffer.alloc(15, 0));
  assert.equal(zeros, '0000000000000000');
  const bytes = Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 255]);
  const c = code.generate(() => bytes);
  assert.equal(c.slice(0, 15), '0123456789ABCDZ'.replace('Z', ALPHABET[31]));
  assert.ok(code.hasValidCheck(c));
});

test('rule 30: the five low bits of a byte are uniform — 150 000 draws stay within 5 sigma of even', () => {
  const counts = new Map([...ALPHABET].map((c) => [c, 0]));
  for (let i = 0; i < 10000; i += 1) [...code.generate().slice(0, 15)].forEach((c) => counts.set(c, counts.get(c) + 1));
  const expected = (10000 * 15) / 32;
  const sigma = Math.sqrt(10000 * 15 * (1 / 32) * (31 / 32));
  counts.forEach((n, c) => assert.ok(Math.abs(n - expected) < 5 * sigma, `${c}: ${n}`));
});

test('rule 30: 10 000 draws, no collision', () => {
  const seen = new Set();
  for (let i = 0; i < 10000; i += 1) seen.add(code.generate());
  assert.equal(seen.size, 10000);
});

test('rule 34: the check character catches every single-character substitution (random sample, every position, every other character)', () => {
  for (let n = 0; n < 300; n += 1) {
    const c = randomCode();
    for (let pos = 0; pos < 16; pos += 1) {
      for (const other of ALPHABET) {
        if (other === c[pos]) continue; // eslint-disable-line no-continue
        assert.equal(code.hasValidCheck(`${c.slice(0, pos)}${other}${c.slice(pos + 1)}`), false, `${c} @${pos}→${other}`);
      }
    }
  }
});

test('rule 34: the check character catches every adjacent transposition of two different characters', () => {
  for (let n = 0; n < 2000; n += 1) {
    const c = randomCode();
    for (let pos = 0; pos < 15; pos += 1) {
      if (c[pos] === c[pos + 1]) continue; // eslint-disable-line no-continue
      const swapped = `${c.slice(0, pos)}${c[pos + 1]}${c[pos]}${c.slice(pos + 2)}`;
      assert.equal(code.hasValidCheck(swapped), false, `${c} swap @${pos}`);
    }
  }
});

test('rule 34: exhaustive — for any prefix, the 32 values of one character give 32 different check characters (a Latin square)', () => {
  for (let n = 0; n < 50; n += 1) {
    const prefix = code.generate().slice(0, 14);
    const checks = new Set([...ALPHABET].map((c) => code.generate(() => Buffer.from([...`${prefix}${c}`].map((ch) => ALPHABET.indexOf(ch)))).slice(15)));
    assert.equal(checks.size, 32);
  }
});

test('rule 30: normalise — upper case, I and L read as 1, O as 0, separators dropped', () => {
  assert.equal(code.normalise('7k2q-hd9m 4txb_3npc'), '7K2QHD9M4TXB3NPC');
  assert.equal(code.normalise('oOiIlL'), '001111');
  assert.equal(code.normalise(null), '');
  assert.equal(code.normalise(undefined), '');
  const c = randomCode();
  assert.equal(code.normalise(code.format(c).toLowerCase()), c);
});

test('rule 30: a code is shown in groups of four, masked to its last four characters on the operator’s page', () => {
  assert.equal(code.format('7K2QHD9M4TXB3NPC'), '7K2Q-HD9M-4TXB-3NPC');
  assert.equal(code.mask('7K2QHD9M4TXB3NPC'), '····3NPC');
});

test('rule 34: a code of the wrong length or with a character outside the alphabet is not well formed', () => {
  assert.equal(code.isWellFormed('7K2QHD9M4TXB3NP'), false);
  assert.equal(code.isWellFormed('7K2QHD9M4TXB3NPCC'), false);
  assert.equal(code.isWellFormed('7K2QHD9M4TXB3NPU'), false);
  assert.equal(code.hasValidCheck('7K2QHD9M4TXB3NPU'), false);
});

test('rule 32: the lookup key is HMAC-SHA-256 under the pepper — stable, hex, different under another pepper', () => {
  const c = randomCode();
  const a = code.hashCode('pepper-a', c);
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.equal(a, code.hashCode('pepper-a', c));
  assert.notEqual(a, code.hashCode('pepper-b', c));
  assert.equal(a, crypto.createHmac('sha256', 'pepper-a').update(c).digest('hex'));
});

test('rule 32: the code is never stored in clear — no table of the plugin holds it, in any shape', async () => {
  const fixture = fx.buildApi();
  const server = await fx.start(fixture);
  try {
    const { id } = await fx.issueManual(server);
    const plain = await fx.revealedCode(server, id);
    await server.call('GET', `/api/gift-vouchers/${id}`);
    const row = fixture.db.prepare('SELECT * FROM gift_vouchers WHERE id = ?').get(id);
    assert.notEqual(row.codeHash, plain);
    assert.equal(row.codeHash, code.hashCode(fx.PEPPER, plain));
    assert.match(row.codeEncrypted, /^enc:|:/, 'stored through the core encryption helper');
    const dump = JSON.stringify(['gift_voucher_orders', 'gift_vouchers', 'gift_voucher_movements', 'gift_voucher_checks']
      .map((t) => fixture.db.prepare(`SELECT * FROM ${t}`).all()));
    assert.equal(dump.includes(plain), false);
    assert.equal(dump.includes(code.format(plain)), false);
    assert.equal(fx.sdk.coreModule('encryption').safeDecrypt(row.codeEncrypted).value, plain, 'the encrypted copy shows it again');
  } finally {
    await server.close();
  }
});

test('rule 32: the same code under another pepper is not found (a stolen database cannot test a code)', async () => {
  const fixture = fx.buildApi();
  const server = await fx.start(fixture);
  try {
    const { id } = await fx.issueManual(server);
    const plain = await fx.revealedCode(server, id);
    assert.ok(fixture.api.vouchers.findByCodeHash(code.hashCode(fx.PEPPER, plain)));
    assert.equal(fixture.api.vouchers.findByCodeHash(code.hashCode('another-pepper', plain)), null);
  } finally {
    await server.close();
  }
});
