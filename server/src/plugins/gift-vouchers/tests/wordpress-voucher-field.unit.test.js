// specs/gift-vouchers.md rules 36-38 — the « Bon cadeau » field of the booking engine (WordPress block): the plugin's static
// contract. The code is normalised and its check character verified in the browser (`GF.voucherCode`) before any call, the field
// exists only while GuestFlow says a plugin takes one, only a paying request carries it, and what the page shows of the amounts
// comes from the server's `payment.prepaid` — never computed by the page.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const PLUGIN = path.join(__dirname, '..', '..', '..', '..', '..', 'integrations', 'wordpress', 'guestflow-booking');
const read = (...parts) => fs.readFileSync(path.join(PLUGIN, ...parts), 'utf8');

const view = read('blocks', 'booking', 'view.js');
const blocks = read('includes', 'class-gf-blocks.php');

test('the booking block loads the voucher code helper, and the field appears only when the quote lists a prepaid kind', () => {
  assert.match(blocks, /\$name === 'booking' \? \['gf-runtime', 'gf-voucher-code', 'gf-pow'\]/);
  assert.match(view, /var VC = GF\.voucherCode;/);
  assert.match(view, /paintVoucher\(q\.payment && q\.payment\.prepaidKinds\)/);
  assert.match(view, /if \(voucher\.kind \|\| !kinds \|\| !kinds\.length\) return;/);
  assert.match(view, /var voucherBox = GF\.el\('div', \{ class: 'gf-voucher', hidden: 'hidden' \}\)/);
});

test('a mistyped code is refused inline before any call: length, then the check character', () => {
  const apply = view.slice(view.indexOf('function applyVoucher()'), view.indexOf('function clearVoucher()'));
  assert.match(apply, /normalised\.length !== VC\.CODE_LENGTH\) \{ voucherMessage\('voucherLength', VC\.CODE_LENGTH\); return; \}/);
  assert.match(apply, /!VC\.hasValidCheck\(normalised\)\) \{ voucherMessage\('voucherMistyped'\); return; \}/);
  assert.ok(apply.indexOf('hasValidCheck') < apply.indexOf('recompute()'), 'the call comes after both checks');
});

test('the code travels with the quote (to be priced) and with a PAYING request only (to be held); a plain request holds nothing', () => {
  assert.match(view, /GF\.api\('POST', '\/quote', voucherPrepaid\(\) \? Object\.assign\(\{\}, stay, \{ prepaid: voucherPrepaid\(\) \}\) : stay\)/);
  assert.match(view, /if \(mode !== 'request' && paysNow\(\) && voucherPrepaid\(\)\) body\.prepaid = voucherPrepaid\(\);/);
  assert.equal((view.match(/body\.prepaid/g) || []).length, 1);
});

test('the amounts are the server’s: « − applied » and « À payer aujourd’hui » read from payment.prepaid, nothing is subtracted by the page', () => {
  assert.match(view, /prepaid\.appliedCents \/ 100/);
  assert.match(view, /prepaid\.dueTodayCents \/ 100/);
  assert.match(view, /GF\.t\('payToday'\)/);
  const painted = view.slice(view.indexOf('// « Bon cadeau ····3NPC'), view.indexOf('var total = q.totalStayPrice'));
  assert.equal(/ - |\.total|finalPrice/.test(painted), false, 'no arithmetic on the stay total');
});

test('nothing due: the button says « Confirmer la réservation » and a stay confirmed without a link goes to the confirmation view', () => {
  assert.match(view, /prepaid\.dueTodayCents === 0\) return GF\.t\('confirmBooking'\)/);
  assert.match(view, /res\.body\.data\.confirmed === true\) \{\s*window\.location\.href = returnPath;/);
});

test('the QR’s #bon=<code> fragment fills the field and is applied once', () => {
  assert.match(view, /\/\[#&\]bon=\(\[\^&\]\+\)\//);
  assert.match(view, /voucherFromUrl = '';\s*applyVoucher\(\);/);
});

test('every sentence of the field is declared, in French, for the plugin’s translation', () => {
  ['voucherApply', 'voucherRemove', 'voucherLength', 'voucherMistyped', 'voucherUnknown', 'voucherExpired', 'voucherExhausted', 'voucherTooMany', 'payToday', 'confirmBooking']
    .forEach((key) => {
      assert.match(blocks, new RegExp(`'${key}'\\s*=>`), key);
      assert.match(view, new RegExp(`'${key}'`), key);
    });
  assert.match(blocks, /'voucherUnknown'\s*=> __\('Code inconnu\. Encore %d essais\./);
  assert.match(blocks, /'payToday'\s*=> __\('À payer aujourd’hui'/);
});

test('the 1.20.0 changelog says it, and the version is not bumped again', () => {
  const readme = read('readme.txt');
  assert.match(readme, /Stable tag: 1\.20\.0/);
  assert.match(readme, /Moteur de réservation : un champ « Bon cadeau »/);
  assert.equal((readme.match(/^= 1\.20\.0 =/gm) || []).length, 1);
});
