// specs/gift-vouchers.md rules 24-29 — the operator's API: the list, a voucher sold by hand, extend, cancel, adjust, the code
// masked and revealed with an audit row, the mail again, the PDF, the shapes refused, the reception kept out.
const test = require('node:test');
const assert = require('node:assert/strict');

const enforceRoleAccess = require('../../../middleware/enforceRoleAccess');
const code = require('../code');
const fx = require('./giftVoucherFixtures');

async function withAdmin(fn, over) {
  const fixture = fx.buildApi(undefined, over);
  const server = await fx.start(fixture);
  try {
    await fn({ ...fixture, server });
  } finally {
    await server.close();
  }
}

const url = (id, action = '') => `/api/gift-vouchers/${id}${action}`;

test('rule 24: a voucher sold by hand is issued at once — amount, names, message, how it was paid, today’s date', () => withAdmin(async ({ server }) => {
  const created = await server.call('POST', '/api/gift-vouchers', {
    amountCents: 15000, recipientName: 'Marie', senderName: 'Paul', message: 'Joyeux anniversaire', email: 'paul@example.test', paymentMethod: 'cheque',
  });
  assert.equal(created.status, 201);
  const v = created.body;
  assert.deepEqual([v.number, v.state, v.amountCents, v.balanceCents, v.expiresOn, v.source, v.paymentMethod], ['BC-2026-0001', 'active', 15000, 15000, '2028-05-15', 'manual', 'cheque']);
  assert.deepEqual([v.recipientName, v.senderName, v.message, v.buyerEmail], ['Marie', 'Paul', 'Joyeux anniversaire', 'paul@example.test']);
  assert.deepEqual(v.movements.map((m) => [m.kind, m.amountCents, m.actor]), [['issue', 15000, 'user:7']]);
}));

test('rule 24: the date of a sale outside the site sets the expiry; a date in the future is refused', () => withAdmin(async ({ server }) => {
  const past = await server.call('POST', '/api/gift-vouchers', { amountCents: 5000, paymentMethod: 'cash', date: '2026-01-31' });
  assert.equal(past.status, 201);
  assert.equal(past.body.expiresOn, '2027-07-31');
  assert.equal(past.body.issuedAt.slice(0, 10), '2026-01-31');
  const future = await server.call('POST', '/api/gift-vouchers', { amountCents: 5000, paymentMethod: 'cash', date: '2026-11-16' });
  assert.deepEqual([future.status, future.body.code], [400, 'DATE_IN_FUTURE']);
  assert.equal((await server.call('POST', '/api/gift-vouchers', { amountCents: 5000, paymentMethod: 'cash', date: '2026-02-30' })).body.code, 'DATE_INVALID');
}));

test('rule 24: the way it was paid is one of the core payment methods, read from the core', () => withAdmin(async ({ server }) => {
  const core = fx.sdk.coreModule('paymentTenders').METHODS.map((m) => m.value);
  assert.deepEqual(fx.METHODS, core);
  for (const method of core) assert.equal((await server.call('POST', '/api/gift-vouchers', { amountCents: 2000, paymentMethod: method })).status, 201, method);
  for (const method of ['bitcoin', '', null, undefined, ['card'], { a: 1 }]) {
    assert.equal((await server.call('POST', '/api/gift-vouchers', { amountCents: 2000, paymentMethod: method })).body.code, 'PAYMENT_METHOD_INVALID', JSON.stringify(method));
  }
}));

test('rule 6: amounts out of bounds or not whole cents are refused, each with its own code', () => withAdmin(async ({ server }) => {
  const refused = async (amountCents) => (await server.call('POST', '/api/gift-vouchers', { amountCents, paymentMethod: 'cash' })).body.code;
  assert.equal(await refused(1999), 'VOUCHER_AMOUNT_OUT_OF_BOUNDS');
  assert.equal(await refused(200001), 'VOUCHER_AMOUNT_OUT_OF_BOUNDS');
  for (const bad of ['2000', 20.5, null, undefined, [2000], { v: 1 }, 'abc']) assert.equal(await refused(bad), 'AMOUNT_INVALID', JSON.stringify(bad));
}));

test('rule 13: the shapes are checked — a non-object body, a list or an object where text is expected, texts too long, a bad e-mail → 400', () => withAdmin(async ({ server }) => {
  const post = (body) => server.call('POST', '/api/gift-vouchers', body);
  assert.equal((await post([])).body.code, 'BODY_INVALID');
  const base = { amountCents: 5000, paymentMethod: 'cash' };
  for (const field of ['recipientName', 'senderName', 'message', 'email']) {
    for (const bad of [['a'], { a: 1 }, 12, true]) {
      const res = await post({ ...base, [field]: bad });
      assert.equal(res.status, 400, `${field} ${JSON.stringify(bad)}`);
    }
  }
  assert.equal((await post({ ...base, recipientName: 'W'.repeat(41) })).status, 400);
  assert.equal((await post({ ...base, senderName: 'W'.repeat(41) })).status, 400);
  assert.equal((await post({ ...base, message: 'x'.repeat(201) })).status, 400);
  assert.equal((await post({ ...base, email: 'not-an-email' })).body.code, 'EMAIL_INVALID');
  assert.equal((await post({ ...base, recipientName: 'W'.repeat(40), message: 'x'.repeat(200) })).status, 201, 'the limits themselves pass');
  assert.equal((await server.call('GET', '/api/gift-vouchers/abc')).status, 404);
  assert.equal((await server.call('POST', '/api/gift-vouchers/1/adjust', [])).body.code, 'BODY_INVALID');
  assert.equal((await server.call('POST', '/api/gift-vouchers/999/adjust', {})).body.code, 'VOUCHER_NOT_FOUND');
}));

test('rule 24: the list — searchable by number, e-mail or name, filtered by state, with the total outstanding balance', () => withAdmin(async ({ server, api }) => {
  const a = await fx.issueManual(server, { amountCents: 10000, senderName: 'Jean Dupont', email: 'jean@example.test' });
  const b = await fx.issueManual(server, { amountCents: 20000, recipientName: 'Zoé' });
  const c = await fx.issueManual(server, { amountCents: 5000 });
  api.movements.append({
    voucherId: c.id, kind: 'redeem', amountCents: -5000, actor: 'system', idempotencyKey: 'x',
  });
  await server.call('POST', url(b.id, '/cancel'), {});
  const all = (await server.call('GET', '/api/gift-vouchers')).body;
  assert.equal(all.items.length, 3);
  assert.equal(all.outstandingCents, 10000, 'cancelled and used-up vouchers owe nothing');
  const ids = async (query) => (await server.call('GET', `/api/gift-vouchers?${query}`)).body.items.map((i) => i.id);
  assert.deepEqual(await ids('q=dupont'), [a.id]);
  assert.deepEqual(await ids('q=JEAN@EXAMPLE'), [a.id]);
  assert.deepEqual(await ids(`q=${b.number}`), [b.id]);
  assert.deepEqual(await ids('q=zo%C3%A9'), [b.id]);
  assert.deepEqual(await ids('state=cancelled'), [b.id]);
  assert.deepEqual(await ids('state=exhausted'), [c.id]);
  assert.deepEqual(await ids('state=active'), [a.id]);
  assert.equal((await server.call('GET', '/api/gift-vouchers?state=bogus')).status, 400);
  assert.deepEqual(Object.keys(all.items[0]).filter((k) => /code/i.test(k)), [], 'the list carries no code');
}));

test('rule 26: the detail shows the code masked to its last four characters, with the movements', () => withAdmin(async ({ server }) => {
  const v = await fx.issueManual(server);
  const plain = await fx.revealedCode(server, v.id);
  const detail = (await server.call('GET', url(v.id))).body;
  assert.equal(detail.codeMasked, `····${plain.slice(-4)}`);
  assert.equal(JSON.stringify(detail).includes(plain), false);
  assert.equal(detail.canCancel, true);
  assert.ok(Array.isArray(detail.movements));
}));

test('rule 26: « Afficher le code » decrypts it, answers it grouped, and writes a reveal movement with the author', () => withAdmin(async ({ server, api }) => {
  const v = await fx.issueManual(server);
  const res = await server.call('POST', url(v.id, '/reveal'), {});
  assert.equal(res.status, 200);
  assert.match(res.body.code, /^[0-9A-Z]{4}(-[0-9A-Z]{4}){3}$/);
  assert.ok(code.hasValidCheck(code.normalise(res.body.code)));
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const reveal = api.movements.list(v.id).filter((m) => m.kind === 'reveal');
  assert.deepEqual(reveal.map((m) => [m.amountCents, m.actor]), [[0, 'user:7']]);
  await server.call('POST', url(v.id, '/reveal'), {});
  assert.equal(api.movements.list(v.id).filter((m) => m.kind === 'reveal').length, 2, 'each reveal is its own row');
}));

test('rule 25: extend moves the expiry to a future date, writes a movement, and revives an expired voucher', () => withAdmin(async ({ server, clock, api }) => {
  const v = await fx.issueManual(server);
  const refused = await server.call('POST', url(v.id, '/extend'), { expiresOn: '2026-11-15' });
  assert.deepEqual([refused.status, refused.body.code], [400, 'DATE_NOT_IN_FUTURE']);
  assert.equal((await server.call('POST', url(v.id, '/extend'), { expiresOn: 'demain' })).body.code, 'DATE_INVALID');
  assert.equal((await server.call('POST', url(v.id, '/extend'), {})).body.code, 'DATE_INVALID');
  clock.at = new Date('2028-06-01T10:00:00Z');
  assert.equal((await server.call('GET', url(v.id))).body.state, 'expired');
  const extended = await server.call('POST', url(v.id, '/extend'), { expiresOn: '2028-12-31' });
  assert.equal(extended.status, 200);
  assert.deepEqual([extended.body.state, extended.body.expiresOn], ['active', '2028-12-31']);
  const row = api.movements.list(v.id).find((m) => m.kind === 'extend');
  assert.deepEqual([row.amountCents, row.actor, row.note], [0, 'user:7', '2028-05-15 → 2028-12-31']);
}));

test('rule 27: cancel sets the state, writes a cancel movement of minus the balance, and cannot be done twice', () => withAdmin(async ({ server, api }) => {
  const v = await fx.issueManual(server, { amountCents: 12000 });
  api.movements.append({
    voucherId: v.id, kind: 'adjust', amountCents: -2000, actor: 'user:1', note: 'geste', idempotencyKey: 'adj',
  });
  const res = await server.call('POST', url(v.id, '/cancel'), {});
  assert.equal(res.status, 200);
  assert.deepEqual([res.body.state, res.body.balanceCents, res.body.canCancel], ['cancelled', 0, false]);
  const cancel = res.body.movements.find((m) => m.kind === 'cancel');
  assert.deepEqual([cancel.amountCents, cancel.actor], [-10000, 'user:7']);
  assert.deepEqual((await server.call('POST', url(v.id, '/cancel'), {})).body.code, 'VOUCHER_CANCELLED');
}));

test('rule 27: a voucher that already paid something cannot be cancelled', () => withAdmin(async ({ server, api }) => {
  const v = await fx.issueManual(server);
  api.movements.append({
    voucherId: v.id, kind: 'redeem', amountCents: -1000, actor: 'system', reservationId: 5, idempotencyKey: 'r',
  });
  const res = await server.call('POST', url(v.id, '/cancel'), {});
  assert.deepEqual([res.status, res.body.code], [409, 'VOUCHER_ALREADY_REDEEMED']);
  assert.equal((await server.call('GET', url(v.id))).body.canCancel, false);
}));

test('rule 28: adjust needs a reason, writes a signed movement, and never takes the balance below 0 or above the amount', () => withAdmin(async ({ server }) => {
  const v = await fx.issueManual(server, { amountCents: 10000 });
  const adjust = (body) => server.call('POST', url(v.id, '/adjust'), body);
  assert.equal((await adjust({ amountCents: -1000 })).body.code, 'REASON_REQUIRED');
  assert.equal((await adjust({ amountCents: -1000, reason: '   ' })).body.code, 'REASON_REQUIRED');
  assert.equal((await adjust({ amountCents: -1000, reason: ['x'] })).status, 400);
  assert.equal((await adjust({ amountCents: 0, reason: 'rien' })).body.code, 'AMOUNT_INVALID');
  assert.equal((await adjust({ amountCents: '5', reason: 'texte' })).body.code, 'AMOUNT_INVALID');
  assert.equal((await adjust({ amountCents: 100.5, reason: 'décimale' })).body.code, 'AMOUNT_INVALID');
  assert.equal((await adjust({ amountCents: 1, reason: 'au-dessus' })).body.code, 'BALANCE_ABOVE_ISSUED');
  const down = await adjust({ amountCents: -4000, reason: 'Erreur de saisie' });
  assert.equal(down.status, 200);
  assert.equal(down.body.balanceCents, 6000);
  assert.deepEqual(down.body.movements.filter((m) => m.kind === 'adjust').map((m) => [m.amountCents, m.note, m.actor]), [[-4000, 'Erreur de saisie', 'user:7']]);
  assert.equal((await adjust({ amountCents: -6001, reason: 'trop' })).body.code, 'BALANCE_BELOW_ZERO');
  assert.equal((await adjust({ amountCents: 4001, reason: 'trop haut' })).body.code, 'BALANCE_ABOVE_ISSUED');
  assert.equal((await adjust({ amountCents: 4000, reason: 'retour' })).body.balanceCents, 10000);
  assert.equal((await adjust({ amountCents: -10000, reason: 'à zéro' })).body.state, 'exhausted');
}));

test('rule 25: nothing is done to a cancelled voucher', () => withAdmin(async ({ server }) => {
  const v = await fx.issueManual(server);
  await server.call('POST', url(v.id, '/cancel'), {});
  for (const [action, body] of [['extend', { expiresOn: '2030-01-01' }], ['adjust', { amountCents: -1, reason: 'x' }], ['resend', {}]]) {
    assert.equal((await server.call('POST', url(v.id, `/${action}`), body)).body.code, 'VOUCHER_CANCELLED', action);
  }
}));

test('rule 25: « Renvoyer le mail » sends the operator’s template to the buyer — amount, expiry, link, never the code — and records it', () => withAdmin(async ({ server, sent, api }) => {
  const v = await fx.issueManual(server, { amountCents: 15000, email: 'paul@example.test', senderName: 'Paul <b>' });
  const plain = await fx.revealedCode(server, v.id);
  const res = await server.call('POST', url(v.id, '/resend'), {});
  assert.equal(res.status, 200);
  assert.ok(res.body.mailSentAt);
  assert.equal(sent.length, 1);
  const mail = sent[0];
  assert.equal(mail.to, 'paul@example.test');
  assert.equal(mail.subject, 'Le bon cadeau de 150,00 € est prêt');
  assert.match(mail.text, /BC-2026-0001/);
  assert.match(mail.text, /15\/05\/2028/);
  assert.match(mail.text, /https:\/\/site\.example\.test\/bon-cadeau\?gf_voucher=\d+&gf_token=[\w-]{32}/);
  [mail.text, mail.html, mail.subject].forEach((part) => [plain, code.format(plain)].forEach((c) => assert.equal(part.includes(c), false)));
  assert.equal(Object.keys(mail).includes('attachments'), false);
  assert.equal(api.movements.list(v.id).filter((m) => m.kind === 'mail').length, 1);
  assert.equal(api.movements.list(v.id).filter((m) => m.kind === 'mail')[0].actor, 'user:7');
}));

test('rule 25: the mail is in the buyer’s language and the operator’s words; HTML-escaped around the template', () => withAdmin(async ({ server, sent, settingsStore }) => {
  settingsStore.set('mailSubjectEn', 'Your voucher {number}');
  settingsStore.set('mailBodyEn', 'Hi {senderName} <3\n\nOpen {link} before {expiry}');
  const v = await fx.issueManual(server, { email: 'a@b.test', language: 'en', senderName: 'Tom & Jerry' });
  await server.call('POST', url(v.id, '/resend'), {});
  assert.equal(sent[0].subject, 'Your voucher BC-2026-0001');
  assert.match(sent[0].text, /before 2028-05-15/);
  assert.match(sent[0].html, /Hi Tom &amp; Jerry &lt;3/);
  assert.match(sent[0].html, /<a href="https:\/\/site\.example\.test\/bon-cadeau\?gf_voucher=/);
}));

test('rule 23: a failed send is shown on the voucher (« Mail non parti »), writes no mail movement, and a later resend works', async () => {
  const fixture = fx.buildApi(undefined, { mailFails: true });
  const server = await fx.start(fixture);
  try {
    const v = await fx.issueManual(server, { email: 'a@b.test' });
    const failed = await server.call('POST', url(v.id, '/resend'), {});
    assert.deepEqual([failed.status, failed.body.code], [502, 'MAIL_FAILED']);
    const detail = (await server.call('GET', url(v.id))).body;
    assert.deepEqual([detail.mailSentAt, detail.mailError], [null, 'SMTP down']);
    assert.equal(detail.movements.filter((m) => m.kind === 'mail').length, 0);
  } finally {
    await server.close();
  }
  const working = fx.buildApi(fixture.db);
  const again = await fx.start(working);
  try {
    const v = (await again.call('GET', '/api/gift-vouchers')).body.items[0];
    const ok = await again.call('POST', url(v.id, '/resend'), {});
    assert.deepEqual([ok.status, ok.body.mailError, Boolean(ok.body.mailSentAt)], [200, null, true]);
  } finally {
    await again.close();
  }
});

test('rule 25: resend without an e-mail address on the voucher is refused', () => withAdmin(async ({ server }) => {
  const v = await fx.issueManual(server);
  assert.deepEqual((await server.call('POST', url(v.id, '/resend'), {})).body.code, 'NO_EMAIL');
}));

test('rule 25: the PDF is served as application/pdf, one page, named after the voucher', () => withAdmin(async ({ server }) => {
  const v = await fx.issueManual(server);
  const res = await server.call('GET', url(v.id, '/pdf'));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/pdf');
  assert.match(res.headers.get('content-disposition'), /BC-2026-0001\.pdf/);
  assert.equal(res.body.subarray(0, 5).toString(), '%PDF-');
  assert.equal((res.body.toString('latin1').match(/\/Type \/Page(?!s)/g) || []).length, 1);
}));

test('rule 29: the reception sees nothing of the plugin — no role entry is declared and the role guard answers 403', async () => {
  const gv = require('..');
  const declared = [];
  const noop = new Proxy(function noop() {}, { get: () => noop, apply: () => noop });
  const ctx = new Proxy({}, {
    get(_, key) {
      if (key === 'reception' || key === 'roleAccess') return (...args) => declared.push(args);
      return noop;
    },
  });
  gv.register(ctx);
  assert.deepEqual(declared, []);
  const answer = (user, method, path) => {
    let status = 200;
    const res = { status(code) { status = code; return res; }, json() { return res; } };
    enforceRoleAccess({ user, method, path }, res, () => {});
    return status;
  };
  const reception = { id: 2, roles: ['reception'] };
  assert.equal(answer(reception, 'GET', '/gift-vouchers'), 403);
  assert.equal(answer(reception, 'POST', '/gift-vouchers/1/reveal'), 403);
  assert.equal(answer({ id: 3, roles: ['accountant'] }, 'GET', '/gift-vouchers'), 403);
  assert.equal(answer({ id: 1, roles: ['admin'] }, 'GET', '/gift-vouchers'), 200);
});
