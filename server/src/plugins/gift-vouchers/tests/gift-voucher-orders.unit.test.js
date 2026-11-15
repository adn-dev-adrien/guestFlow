// specs/gift-vouchers.md rules 13, 15-21, 23 — buying on the website: the order and what the server judges again, the payment link
// without a reservation, the voucher issued by the paid link only (and once), the page and the PDF behind the token, the pending
// orders purged, the receipt mailed once and retried. The core's side of the paid link is `src/tests/gift-voucher-sale-link.unit.test.js`.
const test = require('node:test');
const assert = require('node:assert/strict');

const code = require('../code');
const fx = require('./giftVoucherFixtures');

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const IP = '10.0.0.1';

/** A payment stand-in: records what the plugin asks, and answers like the core's link of a sale with no stay. */
function paymentsStub(over = {}) {
  const asked = [];
  const refreshed = [];
  return {
    asked,
    refreshed,
    saleLink: async (sale, options) => {
      asked.push({ sale, options });
      if (over.fail) throw over.fail;
      return { linkId: 40 + asked.length, url: `https://pay.example.test/${asked.length}`, amountCents: sale.amountCents };
    },
    refreshLink: async (linkId) => { refreshed.push(linkId); return 'open'; },
  };
}

async function withShop(fn, over = {}) {
  const payments = paymentsStub(over.payments);
  const state = { available: true, terms: 4, ...over.state };
  const mail = { fail: Boolean(over.mailFails) };
  const fixture = fx.buildApi(undefined, {
    ...over,
    deps: {
      payments,
      onlineSaleAvailable: () => state.available,
      termsVersionId: () => state.terms,
      siteOrigin: () => 'https://site.example.test',
      sendMail: async (m) => {
        if (mail.fail) throw new Error('SMTP down');
        fixture.sent.push(m);
        return { messageId: 'm' };
      },
      ...over.deps,
    },
  });
  const server = await fx.start(fixture);
  const order = (body = {}, { ip = IP, proof = fx.solvedProof({ ip }) } = {}) => server.call('POST', '/public/v1/gift-vouchers/orders', {
    amountCents: 15000, recipientName: 'Marie', senderName: 'Paul', message: 'Joyeux anniversaire', email: 'paul@example.test', termsVersionId: 4, language: 'fr', ...body, ...proof,
  }, { 'x-test-ip': ip });
  const placed = async (body) => { const res = await order(body); assert.equal(res.status, 201, JSON.stringify(res.body)); return res.body.data; };
  const pay = (id, body) => server.call('POST', `/public/v1/gift-vouchers/orders/${id}/pay`, body, { 'x-test-ip': IP });
  const view = (id, token) => server.call('GET', `/public/v1/gift-vouchers/orders/${id}?token=${token}`, undefined, { 'x-test-ip': IP });
  const pdf = (id, token) => server.call('GET', `/public/v1/gift-vouchers/orders/${id}/pdf?token=${token}`, undefined, { 'x-test-ip': IP });
  /** The core's paid-link path, reduced to what it calls on the plugin. */
  const paid = (orderId, linkId, amountCents = 15000) => fixture.api.orderPaid({ ref: String(orderId), linkId, amountCents });
  try {
    await fn({
      ...fixture, server, payments, state, mail, order, placed, pay, view, pdf, paid,
    });
  } finally {
    await server.close();
  }
}

const rows = (db, table) => db.prepare(`SELECT * FROM ${table}`).all();

test('rules 13, 15, 19: a valid order answers 201 { orderId, token }; the terms, the date and the visitor hash are recorded; the token is stored hashed', () => withShop(async ({ order, db }) => {
  const res = await order();
  assert.equal(res.status, 201);
  assert.deepEqual(Object.keys(res.body.data).sort(), ['orderId', 'token']);
  const stored = rows(db, 'gift_voucher_orders');
  assert.equal(stored.length, 1);
  const [row] = stored;
  assert.deepEqual([row.id, row.state, row.source, row.createdBy, row.amountCents, row.language], [res.body.data.orderId, 'pending', 'site', 'public', 15000, 'fr']);
  assert.deepEqual([row.recipientName, row.senderName, row.message, row.email], ['Marie', 'Paul', 'Joyeux anniversaire', 'paul@example.test']);
  assert.deepEqual([row.termsVersionId, row.termsAcceptedAt], [4, '2026-11-15T10:00:00.000Z']);
  assert.match(row.visitorHash, /^[0-9a-f]{64}$/);
  assert.equal(row.visitorHash.includes(IP), false);
  assert.match(res.body.data.token, /^[\w-]{32}$/);
  assert.notEqual(row.publicTokenHash, res.body.data.token);
  assert.match(row.publicTokenHash, /^[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(row).includes(res.body.data.token), false, 'the token appears in no column in clear');
  assert.equal(rows(db, 'gift_vouchers').length, 0, 'an order is not a voucher');
}));

test('rule 15: every field is judged again — amount, texts, e-mail, terms, language; nothing is stored for a refused order', () => withShop(async ({ order, db }) => {
  const refused = [
    [{ amountCents: 1999 }, 400, 'VOUCHER_AMOUNT_OUT_OF_BOUNDS'],
    [{ amountCents: 200001 }, 400, 'VOUCHER_AMOUNT_OUT_OF_BOUNDS'],
    [{ amountCents: 150.5 }, 400, 'AMOUNT_INVALID'],
    [{ amountCents: '15000' }, 400, 'AMOUNT_INVALID'],
    [{ amountCents: undefined }, 400, 'AMOUNT_INVALID'],
    [{ email: '' }, 400, 'EMAIL_INVALID'],
    [{ email: 'not-an-email' }, 400, 'EMAIL_INVALID'],
    [{ email: `${'a'.repeat(250)}@b.test` }, 400, 'EMAIL_INVALID'],
    [{ email: ['a@b.test'] }, 400, 'EMAIL_INVALID'],
    [{ termsVersionId: 3 }, 400, 'TERMS_REQUIRED'],
    [{ termsVersionId: 0 }, 400, 'TERMS_REQUIRED'],
    [{ termsVersionId: undefined }, 400, 'TERMS_REQUIRED'],
    [{ recipientName: 'x'.repeat(41) }, 400, 'FIELD_INVALID'],
    [{ senderName: 'x'.repeat(41) }, 400, 'FIELD_INVALID'],
    [{ message: 'x'.repeat(201) }, 400, 'FIELD_INVALID'],
    [{ recipientName: 42 }, 400, 'FIELD_INVALID'],
    [{ message: { a: 1 } }, 400, 'FIELD_INVALID'],
    [{ language: 'de' }, 400, 'FIELD_INVALID'],
  ];
  for (const [body, status, errorCode] of refused) {
    const res = await order(body);
    assert.deepEqual([res.status, res.body.error.code], [status, errorCode], JSON.stringify(body));
  }
  const edge = await order({ amountCents: 2000, recipientName: 'x'.repeat(40), message: 'x'.repeat(200) });
  assert.equal(edge.status, 201, 'the bounds themselves are accepted');
  assert.equal(rows(db, 'gift_voucher_orders').length, 1);
}));

test('rule 15: the settings bounds are the ones in force, and an English visitor reads the refusal in English', () => withShop(async ({ order }) => {
  assert.equal((await order({ amountCents: 4999 })).body.error.code, 'VOUCHER_AMOUNT_OUT_OF_BOUNDS');
  const en = await order({ amountCents: 4999, language: 'en' });
  assert.match(en.body.error.message, /out of bounds/);
  assert.equal((await order({ amountCents: 5000 })).status, 201);
}, { settings: { minAmountCents: '5000' } }));

test('rule 15: a non-object body is refused 400, and the texts are stored as typed, never executed or cut', () => withShop(async ({ server, order, db }) => {
  const res = await server.call('POST', '/public/v1/gift-vouchers/orders', [1, 2], { 'x-test-ip': IP });
  assert.deepEqual([res.status, res.body.error.code], [400, 'BODY_INVALID']);
  assert.equal((await order({ senderName: 'Tom <b>&"\'', message: '<script>alert(1)</script>' })).status, 201);
  const [row] = rows(db, 'gift_voucher_orders');
  assert.deepEqual([row.senderName, row.message], ['Tom <b>&"\'', '<script>alert(1)</script>']);
}));

test('rule 15: without a solved proof-of-work the order is refused 403 CHALLENGE_INVALID, a replayed proof too; nothing is stored', () => withShop(async ({ order, db }) => {
  const real = fx.solvedProof({ ip: IP });
  assert.equal((await order({}, { proof: {} })).status, 403);
  assert.equal((await order({}, { proof: { challenge: real.challenge, nonce: 'wrong' } })).status, 403);
  assert.equal((await order({}, { proof: fx.solvedProof({ difficulty: 4, ip: IP }) })).status, 403, 'below the base difficulty');
  assert.equal((await order({}, { proof: fx.solvedProof({ ip: '10.0.0.2' }) })).status, 403, 'bound to the visitor’s address');
  const first = await order({}, { proof: real });
  assert.equal(first.status, 201);
  const replay = await order({}, { proof: real });
  assert.deepEqual([replay.status, replay.body.error.code], [403, 'CHALLENGE_INVALID']);
  assert.equal(rows(db, 'gift_voucher_orders').length, 1);
}));

test('rule 15: 5 orders per visitor per hour — the sixth is refused 429 with Retry-After, another visitor and the next hour are not', () => withShop(async ({ order, clock, db }) => {
  for (let i = 0; i < 5; i += 1) assert.equal((await order()).status, 201);
  const sixth = await order();
  assert.deepEqual([sixth.status, sixth.body.error.code, sixth.headers.get('retry-after')], [429, 'TOO_MANY_ORDERS', '3600']);
  assert.equal(rows(db, 'gift_voucher_orders').length, 5, 'a refused order is not stored');
  assert.equal((await order({}, { ip: '10.0.0.2' })).status, 201, 'the limit is per visitor');
  clock.at = new Date(clock.at.getTime() + HOUR + 1000);
  assert.equal((await order()).status, 201, 'a visitor is let back in after the hour');
}));

test('rule 15: an order refused for its content does not use the visitor’s hourly budget', () => withShop(async ({ order }) => {
  for (let i = 0; i < 8; i += 1) assert.equal((await order({ email: 'nope' })).status, 400);
  for (let i = 0; i < 5; i += 1) assert.equal((await order()).status, 201);
}));

test('rule 16: paying mints a link with no reservation for the exact amount, labelled « Bon cadeau », and answers the hosted page URL', () => withShop(async ({ placed, pay, payments, db }) => {
  const { orderId, token } = await placed({ amountCents: 15050 });
  const res = await pay(orderId, { token, returnPath: '/bon-cadeau/' });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.data, { paymentUrl: 'https://pay.example.test/1' });
  assert.equal(payments.asked.length, 1);
  const { sale, options } = payments.asked[0];
  assert.deepEqual(sale, { ref: orderId, title: 'Bon cadeau de 150,50 €', amountCents: 15050 });
  assert.equal('reservationId' in sale, false);
  assert.equal(options.redirectUrl, `https://site.example.test/bon-cadeau/?gf_voucher=${orderId}&gf_token=${token}`);
  assert.equal(db.prepare('SELECT linkId FROM gift_voucher_orders WHERE id = ?').get(orderId).linkId, 41);
  assert.equal(rows(db, 'gift_vouchers').length, 0, 'paying issues nothing');
}));

test('rule 16: the return address is a path of the site — a full address, a protocol-relative one or a path with spaces is dropped, never followed', () => withShop(async ({ placed, pay, payments }) => {
  const { orderId, token } = await placed();
  for (const returnPath of ['https://evil.test/x', '//evil.test/x', 'bon-cadeau', '/a b', '/a\\b', 42, undefined, `/${'x'.repeat(200)}`]) {
    assert.equal((await pay(orderId, { token, returnPath })).status, 200);
  }
  assert.deepEqual(payments.asked.map((a) => a.options.redirectUrl), Array(8).fill(null));
  await pay(orderId, { token, returnPath: '/page?lang=en#bon' });
  assert.equal(payments.asked[8].options.redirectUrl, `https://site.example.test/page?lang=en&gf_voucher=${orderId}&gf_token=${token}`);
}));

test('rule 21: a wrong token and an unknown order are the same 404, for the payment, the page and the PDF', () => withShop(async ({ placed, pay, view, pdf, payments }) => {
  const { orderId, token } = await placed();
  const wrong = `${token.slice(0, -1)}${token.endsWith('a') ? 'b' : 'a'}`;
  const answers = [
    await pay(orderId, { token: wrong }), await pay(orderId, {}), await pay(orderId + 1, { token }), await pay(orderId, { token: ['x'] }),
    await view(orderId, wrong), await view(orderId + 1, token), await view(orderId, ''), await pdf(orderId, wrong), await pdf(999, token),
  ];
  answers.forEach((res) => assert.deepEqual([res.status, res.body.error.code], [404, 'VOUCHER_ORDER_NOT_FOUND']));
  assert.equal(new Set(answers.map((r) => JSON.stringify(r.body))).size, 1, 'one single answer: no oracle on the id');
  assert.equal(payments.asked.length, 0);
}));

test('rule 16: without an online payment the order cannot be paid (409); an issued order cannot be paid again; a provider failure is a 502 that keeps the order', () => withShop(async ({
  placed, pay, state, paid, payments,
}) => {
  const { orderId, token } = await placed();
  state.available = false;
  assert.deepEqual([(await pay(orderId, { token })).status, (await pay(orderId, { token })).body.error.code], [409, 'ONLINE_SALE_UNAVAILABLE']);
  state.available = true;
  await pay(orderId, { token });
  paid(orderId, 41);
  const again = await pay(orderId, { token });
  assert.deepEqual([again.status, again.body.error.code], [409, 'VOUCHER_ALREADY_ISSUED']);
  assert.equal(payments.asked.length, 1);
}));

test('rule 16: a link paid meanwhile answers 409 PAYMENT_PENDING; no provider answers 409; any other failure 502', async () => {
  const cases = [
    [{ httpStatus: 409, error: 'LINK_ALREADY_PAID' }, 409, 'PAYMENT_PENDING'],
    [{ httpStatus: 409, error: 'NO_PAYMENT_PROVIDER' }, 409, 'ONLINE_SALE_UNAVAILABLE'],
    [new Error('boom'), 502, 'PAYMENT_PROVIDER_ERROR'],
  ];
  for (const [fail, status, errorCode] of cases) {
    // eslint-disable-next-line no-await-in-loop
    await withShop(async ({ placed, pay, db }) => {
      const { orderId, token } = await placed();
      const res = await pay(orderId, { token });
      assert.deepEqual([res.status, res.body.error.code], [status, errorCode]);
      assert.equal(db.prepare('SELECT linkId FROM gift_voucher_orders WHERE id = ?').get(orderId).linkId, null);
      assert.equal(JSON.stringify(res.body).includes('boom'), false, 'a provider’s words never reach the visitor');
    }, { payments: { fail } });
  }
});

test('rule 17: a link the bank confirmed issues the voucher in one step — active, the issue movement, the expiry frozen — and the browser’s return alone issues nothing', () => withShop(async ({
  placed, pay, view, paid, db, api, payments,
}) => {
  const { orderId, token } = await placed({ amountCents: 15000 });
  await pay(orderId, { token });
  const before = await view(orderId, token);
  assert.deepEqual(before.body.data, { state: 'pending' });
  assert.deepEqual(payments.refreshed, [41], 'reading the page asks the bank again');
  assert.equal(rows(db, 'gift_vouchers').length, 0, 'the browser’s return, however often it reads, issues nothing');

  assert.deepEqual(paid(orderId, 41), { effect: 'voucher-issued' });
  const [voucher] = rows(db, 'gift_vouchers');
  assert.deepEqual([voucher.number, voucher.amountCents, voucher.expiresOn], ['BC-2026-0001', 15000, '2028-05-15']);
  const ledger = api.movements.list(voucher.id);
  assert.deepEqual(ledger.filter((m) => m.kind === 'issue').map((m) => [m.amountCents, m.actor, m.idempotencyKey]), [[15000, 'public', 'issue:link:41']]);
  assert.equal(db.prepare('SELECT state FROM gift_voucher_orders WHERE id = ?').get(orderId).state, 'issued');
  assert.equal(api.vouchers.find(voucher.id).balanceCents, 15000);
}));

test('rule 17: a link paid twice or a replayed webhook issues nothing more; a second link for the same order is money to refund', () => withShop(async ({
  placed, paid, db, api,
}) => {
  const { orderId } = await placed();
  assert.equal(paid(orderId, 41).effect, 'voucher-issued');
  assert.equal(paid(orderId, 41).effect, 'voucher-already-issued');
  assert.equal(paid(orderId, 41).effect, 'voucher-already-issued');
  const second = paid(orderId, 42);
  assert.deepEqual(second, { refundOwed: true, reason: 'bon cadeau déjà émis par un autre paiement' });
  assert.equal(rows(db, 'gift_vouchers').length, 1);
  assert.equal(api.movements.list(1).filter((m) => m.kind === 'issue').length, 1);
  assert.equal(api.movements.balanceOf(1), 15000);
}));

test('rule 17: money the order cannot honour is flagged to refund, never issued — a different amount, an order that is gone', () => withShop(async ({ placed, paid, db }) => {
  const { orderId } = await placed({ amountCents: 15000 });
  assert.equal(paid(orderId, 41, 14999).refundOwed, true);
  assert.equal(paid(orderId, 42, 15001).refundOwed, true);
  assert.equal(paid(orderId + 7, 43).refundOwed, true);
  assert.equal(rows(db, 'gift_vouchers').length, 0);
  assert.equal(paid(orderId, 44).effect, 'voucher-issued', 'the right amount still issues it');
}));

test('rules 20, 21: once confirmed, the page shows the voucher — amount, names, message, code, expiry, brand — and only through the token', () => withShop(async ({
  placed, paid, view, api,
}) => {
  const { orderId, token } = await placed();
  paid(orderId, 41);
  const res = await view(orderId, token);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const { state, voucher } = res.body.data;
  assert.equal(state, 'active');
  assert.deepEqual(
    { ...voucher, code: undefined },
    {
      number: 'BC-2026-0001', brand: 'Domaine Solio', amountCents: 15000, balanceCents: 15000, expiresOn: '2028-05-15', recipientName: 'Marie', senderName: 'Paul', message: 'Joyeux anniversaire', code: undefined,
    },
  );
  assert.match(voucher.code, /^[0-9A-Z]{16}$/);
  assert.equal(code.hasValidCheck(voucher.code), true);
  assert.equal(code.hashCode('test-pepper', voucher.code), api.vouchers.find(1).codeHash);
}));

test('rule 21: the voucher link shows and prints the voucher, it never spends it — no route of the public tree moves a balance', () => withShop(async ({
  placed, paid, view, api, server,
}) => {
  const { orderId, token } = await placed();
  paid(orderId, 41);
  for (let i = 0; i < 3; i += 1) await view(orderId, token);
  for (const path of [`/orders/${orderId}/redeem`, `/orders/${orderId}/hold`]) {
    assert.equal((await server.call('POST', `/public/v1/gift-vouchers${path}`, { token })).status, 404);
  }
  assert.deepEqual(api.movements.list(1).filter((m) => m.kind !== 'mail').map((m) => m.kind), ['issue']);
  assert.equal(api.movements.balanceOf(1), 15000);
}));

test('rule 20: a cancelled voucher shows its state and no code; an exhausted or expired one is reported as such', () => withShop(async ({
  placed, paid, view, pdf, api, clock,
}) => {
  const { orderId, token } = await placed();
  paid(orderId, 41);
  clock.at = new Date('2028-06-01T10:00:00Z');
  assert.equal((await view(orderId, token)).body.data.state, 'expired');
  clock.at = new Date('2026-11-15T10:00:00Z');
  api.movements.append({
    voucherId: 1, kind: 'cancel', amountCents: -15000, actor: 'user:7', idempotencyKey: 'cancel:1',
  });
  api.vouchers.setCancelled(1, clock.at.toISOString());
  const res = await view(orderId, token);
  assert.equal(res.body.data.state, 'cancelled');
  assert.equal(res.body.data.voucher.code, null);
  assert.equal((await pdf(orderId, token)).status, 404, 'no printable voucher for a cancelled one');
}));

test('rule 21: the PDF of the voucher is served behind the token — one page, named after the voucher — and a pending order has none', () => withShop(async ({
  placed, paid, pdf,
}) => {
  const { orderId, token } = await placed();
  assert.equal((await pdf(orderId, token)).status, 404, 'nothing to print before the payment is confirmed');
  paid(orderId, 41);
  const res = await pdf(orderId, token);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/pdf');
  assert.match(res.headers.get('content-disposition'), /BC-2026-0001\.pdf/);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.body.subarray(0, 5).toString(), '%PDF-');
  assert.equal((res.body.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length, 1);
}));

test('rule 18: a pending order is deleted after 7 days, an issued one never; a pending order is never in the operator’s list', () => withShop(async ({
  placed, paid, clock, api, db, server,
}) => {
  const old = await placed();
  const issued = await placed();
  paid(issued.orderId, 41);
  clock.at = new Date(clock.at.getTime() + 6 * DAY);
  const recent = await placed();
  const list = await server.call('GET', '/api/gift-vouchers');
  assert.deepEqual(list.body.items.map((i) => i.state), ['active'], 'the two pending orders are not vouchers');
  assert.equal(api.purgeStaleOrders(), 0, 'six days: nothing yet');
  clock.at = new Date(clock.at.getTime() + 1 * DAY + 1000);
  assert.equal(api.purgeStaleOrders(), 1, 'the first pending order is past 7 days; the recent one and the issued one stay');
  assert.deepEqual(rows(db, 'gift_voucher_orders').map((r) => r.id).sort(), [issued.orderId, recent.orderId].sort());
  assert.equal(rows(db, 'gift_voucher_orders').some((r) => r.id === old.orderId), false);
}));

test('rule 23: the receipt leaves once, at issuance — amount, expiry, voucher link, never the code, no attachment — and is logged as a mail movement', () => withShop(async ({
  placed, paid, sent, api, db,
}) => {
  const { orderId, token } = await placed({ senderName: 'Paul <b>', email: 'paul@example.test' });
  paid(orderId, 41);
  await api.receipt.idle();
  assert.equal(sent.length, 1);
  const [mail] = sent;
  assert.equal(mail.to, 'paul@example.test');
  assert.equal(mail.subject, 'Le bon cadeau de 150,00 € est prêt');
  assert.match(mail.text, /150,00 €/);
  assert.match(mail.text, /15\/05\/2028/);
  assert.ok(mail.text.includes(`https://site.example.test/bon-cadeau?gf_voucher=${orderId}&gf_token=${token}`));
  const plain = (() => { const read = require('../../sdk').coreModule('encryption').safeDecrypt(api.vouchers.find(1).codeEncrypted); return read.value; })();
  [mail.text, mail.html, mail.subject].forEach((part) => [plain, code.format(plain)].forEach((c) => assert.equal(part.includes(c), false)));
  assert.equal(Object.keys(mail).includes('attachments'), false);
  const voucher = api.vouchers.find(1);
  assert.deepEqual([Boolean(voucher.mailSentAt), voucher.mailError], [true, null]);
  assert.deepEqual(api.movements.list(1).filter((m) => m.kind === 'mail').map((m) => m.actor), ['system']);
  paid(orderId, 41);
  await api.receipt.idle();
  assert.equal(await api.retryReceipts(), 0, 'nothing waits');
  assert.equal(sent.length, 1, 'a replay mails nothing more');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM gift_voucher_movements WHERE kind = 'mail'").get().n, 1);
}));

test('rule 23: the receipt follows the buyer’s language and the operator’s words', () => withShop(async ({ placed, paid, sent, api }) => {
  const { orderId } = await placed({ language: 'en' });
  paid(orderId, 41);
  await api.receipt.idle();
  assert.equal(sent[0].subject, 'The 150,00 € gift voucher is ready');
}));

test('rule 23: a failed send flags the voucher « Mail non parti » in the list and the detail, and the job retries it until it leaves — once', () => withShop(async ({
  placed, paid, sent, api, mail, clock, server,
}) => {
  mail.fail = true;
  const { orderId } = await placed();
  paid(orderId, 41);
  await api.receipt.idle();
  const failed = (await server.call('GET', '/api/gift-vouchers')).body.items[0];
  assert.deepEqual([failed.mailSentAt, failed.mailError], [null, 'SMTP down']);
  assert.equal((await server.call('GET', '/api/gift-vouchers/1')).body.mailError, 'SMTP down');
  assert.equal(api.movements.list(1).filter((m) => m.kind === 'mail').length, 0, 'a mail that did not leave leaves no trace in the ledger');

  assert.equal(await api.retryReceipts(), 0, 'less than a minute after issuance the first attempt is still the one in charge');
  clock.at = new Date(clock.at.getTime() + 15 * 60 * 1000);
  assert.equal(await api.retryReceipts(), 1);
  assert.equal(sent.length, 0, 'the retry fails while the server is down');

  mail.fail = false;
  clock.at = new Date(clock.at.getTime() + 15 * 60 * 1000);
  assert.equal(await api.retryReceipts(), 1);
  assert.equal(sent.length, 1);
  const sentOk = (await server.call('GET', '/api/gift-vouchers/1')).body;
  assert.deepEqual([Boolean(sentOk.mailSentAt), sentOk.mailError], [true, null]);
  clock.at = new Date(clock.at.getTime() + 15 * 60 * 1000);
  assert.equal(await api.retryReceipts(), 0);
  assert.equal(sent.length, 1);
  assert.equal(api.movements.list(1).filter((m) => m.kind === 'mail').length, 1);
}));

test('rule 23: the retry gives up three days after issuance, and never mails a voucher sold by hand', () => withShop(async ({
  placed, paid, api, mail, clock, sent, server,
}) => {
  mail.fail = true;
  const { orderId } = await placed();
  paid(orderId, 41);
  await api.receipt.idle();
  await fx.issueManual(server, { email: 'hand@example.test' });
  mail.fail = false;
  clock.at = new Date(clock.at.getTime() + 3 * DAY + 60 * 1000);
  assert.equal(await api.retryReceipts(), 0);
  assert.equal(sent.length, 0);
  const [byHand] = (await server.call('GET', '/api/gift-vouchers?q=hand@')).body.items;
  assert.equal(byHand.mailSentAt, null, 'the operator’s « Renvoyer » is the only mail of a voucher sold by hand');
}));

test('rule 23: an order without a voucher page address cannot link the buyer — the voucher is flagged, not lost', () => withShop(async ({
  placed, paid, api, sent, server,
}) => {
  const { orderId } = await placed();
  paid(orderId, 41);
  await api.receipt.idle();
  assert.equal(sent.length, 0);
  assert.equal((await server.call('GET', '/api/gift-vouchers/1')).body.mailError, 'NO_PAGE_URL');
}, { deps: { pageUrl: () => '' } }));

test('rule 2: the offer says the online sale is available only when a payment can be taken, and carries the brand', () => withShop(async ({ server, state }) => {
  const on = (await server.call('GET', '/public/v1/gift-vouchers/offer')).body.data;
  assert.deepEqual([on.available, on.brand, on.termsVersionId], [true, 'Domaine Solio', 4]);
  state.available = false;
  assert.equal((await server.call('GET', '/public/v1/gift-vouchers/offer')).body.data.available, false);
}));
