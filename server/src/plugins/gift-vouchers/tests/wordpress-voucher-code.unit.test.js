/**
 * assets/voucher-code.js agrees with the server's code module (specs/gift-vouchers/gift-vouchers.md rules 30, 34): on
 * 1000 generated codes, and on EVERY single-character substitution of one code. The two files are
 * a port of each other; this is what keeps them one.
 *
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const client = require('../../../../../integrations/wordpress/guestflow-booking/assets/voucher-code.js');
const server = require('../code');

test('same alphabet and length', () => {
  assert.equal(client.ALPHABET, server.ALPHABET);
  assert.equal(client.CODE_LENGTH, server.CODE_LENGTH);
});

test('1000 random codes: normalise, format, well-formedness and check agree, and every generated code passes', () => {
  for (let i = 0; i < 1000; i += 1) {
    const code = server.generate();
    const typed = server.format(code).toLowerCase().replace(/-/g, i % 2 ? ' ' : '·');
    assert.equal(client.normalise(typed), server.normalise(typed));
    assert.equal(client.normalise(typed), code);
    assert.equal(client.format(code), server.format(code));
    assert.equal(client.isWellFormed(code), server.isWellFormed(code));
    assert.equal(client.hasValidCheck(code), true);
    assert.equal(server.hasValidCheck(code), true);
  }
});

test('every single substitution of one code is refused, by the client as by the server', () => {
  const code = server.generate();
  let refused = 0;
  for (let position = 0; position < code.length; position += 1) {
    for (const letter of server.ALPHABET) {
      if (letter === code[position]) continue;
      const altered = code.slice(0, position) + letter + code.slice(position + 1);
      assert.equal(client.hasValidCheck(altered), server.hasValidCheck(altered));
      assert.equal(client.hasValidCheck(altered), false, `${altered} passed`);
      refused += 1;
    }
  }
  assert.equal(refused, 16 * 31);
});

test('adjacent swaps, short, long and foreign input behave like the server', () => {
  const code = server.generate();
  for (let i = 0; i < code.length - 1; i += 1) {
    const swapped = code.slice(0, i) + code[i + 1] + code[i] + code.slice(i + 2);
    assert.equal(client.hasValidCheck(swapped), server.hasValidCheck(swapped));
  }
  for (const input of ['', null, undefined, 'abc', `${code}0`, code.slice(1), 'UUUU-UUUU-UUUU-UUUU', 'oOiIlL-_. ·']) {
    assert.equal(client.normalise(input), server.normalise(input));
    assert.equal(client.hasValidCheck(client.normalise(input)), server.hasValidCheck(server.normalise(input)));
  }
  assert.equal(client.format('7K2QHD'), '7K2Q-HD');
  assert.equal(client.format(''), '');
});
