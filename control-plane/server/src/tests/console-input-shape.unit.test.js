// specs/control-plane-plans-and-access.md rules 48 and 49 (audit R21, console C2 and C3) — what the console reads
// from a JSON body: a free-text field takes a string only, anything else is that field's refusal (never a 500
// thrown by String({"toString":1}), never a template stored as « null » or a company named « [object Object] »);
// a body the parser refuses is the caller's 4xx, not an internal fault in the log.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const session = require('express-session');
const Database = require('better-sqlite3');
const { passwordHash, supportAccess } = require('../utils/gf');
const { createApp } = require('../app');
const { makeContext, makeFakeQonto, makeInstance, NEW_CUSTOMER } = require('./helpers');
const { customerWithSpace, writeSpace, lineOf, writtenAt, licenceOf } = require('./moduleFixture');
const { listenLocal, closeServer, fetchLocal } = require('./listenLocal');
const { text, fieldText, numeric } = require('../utils/bodyText');
const { addDays } = require('../utils/days');

const AT = `${new Date().toISOString().slice(0, 10)}T10:00:00Z`;
const TODAY = AT.slice(0, 10);
const EVIL = JSON.parse('{"toString":1}');
const NOT_TEXT = [EVIL, {}, [], ['a'], true, false, 0, 1.5];

async function start() {
  const h = makeContext({ at: AT });
  h.ctx.models.operators.create({ email: 'op@example.test', name: 'Op', passwordHash: passwordHash.hashPassword('correct horse battery') });
  const app = createApp(h.ctx, { sessionSecret: 'test', sessionStore: new session.MemoryStore() });
  const server = await listenLocal(app);
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  async function raw(method, url, body, headers = {}) {
    const res = await fetchLocal(base + url, {
      method, body, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...headers },
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    const out = await res.text();
    let json = null;
    try { json = JSON.parse(out); } catch { json = null; }
    return { status: res.status, json, text: out };
  }
  const call = (method, url, body) => raw(method, url, body === undefined ? undefined : JSON.stringify(body));
  const signIn = async () => {
    await call('POST', '/api/auth/login', { email: 'op@example.test', password: 'correct horse battery' });
    const { 1: code } = /Votre code : (\d{6})/.exec(h.mailer.sent.at(-1).text);
    await call('POST', '/api/auth/verify', { code });
  };
  return { h, call, raw, signIn, close: () => closeServer(server) };
}

// The stack the handler would log for an internal fault; a 4xx must never leave one.
function captureConsole(t) {
  const logs = [];
  t.mock.method(console, 'error', (...args) => logs.push(args.join(' ')));
  return logs;
}

test('rule 48 — the helpers: a string passes, absent is empty, anything else is the field\'s refusal', () => {
  assert.equal(text({ a: ' x ' }, 'a'), ' x ');
  assert.equal(text({}, 'a'), '');
  assert.equal(text({ a: null }, 'a'), '');
  for (const value of NOT_TEXT) {
    assert.throws(() => text({ a: value }, 'a'), (e) => e.status === 400 && e.body.error === 'INVALID' && Boolean(e.body.errors.a), JSON.stringify(value));
    const errors = {};
    assert.equal(fieldText({ a: value }, 'a', errors), '');
    assert.equal(errors.a, 'Texte attendu.');
  }
  const errors = {};
  assert.equal(fieldText({ a: `  ${'x'.repeat(5)} ` }, 'a', errors, { max: 5 }), 'xxxxx');
  assert.deepEqual(errors, {});
  fieldText({ a: 'x'.repeat(6) }, 'a', errors, { max: 5 });
  assert.equal(errors.a, '5 caractères au plus.');
  for (const value of [EVIL, {}, [], [1], true, null]) assert.ok(Number.isNaN(numeric(value)), JSON.stringify(value));
  assert.equal(numeric(12), 12);
  assert.equal(numeric('12'), 12);
});

test('rule 48 — a new customer: a field that is not text is refused under the field, nothing is created', async () => {
  const { ctx } = makeContext({ at: AT });
  const { customers } = ctx.controllers;
  const base = { ...NEW_CUSTOMER, startsAt: TODAY };
  for (const key of ['companyName', 'contactName', 'contactEmail', 'slug', 'billingStreet', 'billingPostcode', 'billingCity', 'billingCountry', 'vatNumber']) {
    for (const value of NOT_TEXT) {
      if (value === 0 || value === false) continue;
      const { errors } = customers.preview({ ...base, [key]: value });
      assert.ok(errors[key], `${key}=${JSON.stringify(value)}`);
      await assert.rejects(customers.create({ ...base, [key]: value }, 'op'), (e) => e.status === 400 && Boolean(e.body.errors[key]));
    }
  }
  assert.equal(customers.preview({ ...base, length: EVIL }).errors.length, 'Durée : 1 mois, 12 mois ou une date de fin.');
  assert.equal(customers.preview({ ...base, length: true }).errors.length, 'Durée : 1 mois, 12 mois ou une date de fin.');
  assert.deepEqual(customers.preview({ ...base, length: '12' }).errors, {});
  assert.deepEqual(customers.preview({ ...base, contactName: null, vatNumber: null }).errors, {}, 'an optional field left empty stays fine');
});

test('rule 48 — the identity fields are capped: 200 characters, 254 for the address', async () => {
  const { ctx } = makeContext({ at: AT });
  const { customers } = ctx.controllers;
  const base = { ...NEW_CUSTOMER, startsAt: TODAY };
  for (const key of ['companyName', 'contactName', 'billingStreet', 'billingCity']) {
    assert.equal(customers.preview({ ...base, [key]: 'x'.repeat(200) }).errors[key], undefined, key);
    assert.equal(customers.preview({ ...base, [key]: 'x'.repeat(201) }).errors[key], '200 caractères au plus.', key);
  }
  assert.equal(customers.preview({ ...base, contactEmail: `${'x'.repeat(250)}@b.fr` }).errors.contactEmail, '254 caractères au plus.');
  const c = await customers.create(base, 'op');
  assert.throws(() => customers.setBilling(c.id, { ...base, billingStreet: 'x'.repeat(201) }, 'op'), (e) => e.status === 400 && Boolean(e.body.errors.billingStreet));
});

test('rule 48 — add-ons must be a list: a mistyped request no longer strips the plan', async () => {
  const { ctx } = makeContext({ at: AT });
  const { customers } = ctx.controllers;
  const c = await customers.create({ ...NEW_CUSTOMER, startsAt: TODAY }, 'op');
  customers.changePlan(c.id, { planCode: 'pro', billing: 'monthly', addons: ['gate-access'] }, 'op');
  for (const addons of [undefined, null, {}, 'gate-access', 1, true, EVIL]) {
    assert.throws(() => customers.changePlan(c.id, { planCode: 'pro', billing: 'monthly', addons }, 'op'), (e) => e.status === 400 && e.body.error === 'INVALID', JSON.stringify(addons));
  }
  assert.deepEqual(customers.view(c.id).addons.map((a) => a.id), ['gate-access']);
  customers.changePlan(c.id, { planCode: 'pro', billing: 'monthly', addons: [] }, 'op');
  assert.deepEqual(customers.view(c.id).addons, []);

  const create = { ...NEW_CUSTOMER, startsAt: TODAY };
  for (const addons of [null, {}, 'gate-access', 1, true, EVIL]) {
    assert.equal(customers.preview({ ...create, addons }).errors.addons, 'Liste attendue.', JSON.stringify(addons));
  }
  const { addons: _absent, ...withoutAddons } = create;
  assert.equal(customers.preview(withoutAddons).errors.addons, undefined);
});

test('rule 48 — a motive, a reference, a confirmation that is not a string answers its 4xx, never 500', async (t) => {
  const logs = captureConsole(t);
  const s = await start();
  try {
    await s.signIn();
    const c = (await s.call('POST', '/api/customers', { ...NEW_CUSTOMER, startsAt: TODAY })).json;
    const id = c.id;
    const until = addDays(c.endsAt, 30);
    const before = s.h.ctx.controllers.customers.view(id);
    for (const value of [EVIL, {}, [1], true, 5]) {
      const cases = [
        ['POST', `/api/customers/${id}/extend`, { endsAt: until, expectedEndsAt: c.endsAt, reason: value }],
        ['POST', `/api/customers/${id}/force-active`, { until, reason: value }],
        ['POST', `/api/customers/${id}/extend`, { endsAt: until, expectedEndsAt: value, reason: 'r' }],
        ['POST', `/api/customers/${id}/payment`, { months: 1, expectedEndsAt: c.endsAt, reference: value }],
        ['POST', `/api/customers/${id}/payment`, { months: value, expectedEndsAt: c.endsAt }],
        ['POST', `/api/customers/${id}/billing`, { ...NEW_CUSTOMER, billingStreet: value }],
        ['POST', `/api/customers/${id}/rename/preview`, { slug: value }],
        ['POST', `/api/customers/${id}/rename`, { slug: value }],
        ['POST', `/api/customers/${id}/deprovision`, { confirmSlug: value }],
        ['POST', `/api/customers/${id}/erase`, { confirmSlug: value }],
        ['POST', `/api/customers/${id}/modules/gate-access/erase`, { confirmSlug: value }],
        ['POST', `/api/customers/${id}/support/request`, { reason: value }],
        ['POST', `/api/customers/${id}/restore`, { at: value, confirmSlug: c.slug }],
        ['PUT', '/api/catalogue', { reason: value }],
        ['PUT', '/api/templates/invoice', { subject: value }],
        ['PUT', '/api/templates/invoice', { body: value }],
        ['POST', '/api/templates/invoice/preview', { subject: value, body: 'b' }],
        ['POST', '/api/fleet/updates', { targetVersion: value }],
        ['POST', '/api/fleet/updates', { targetVersion: '1.0.0', customerIds: [value] }],
        ['POST', '/api/fleet/plugins/push', { pluginId: value, version: '1.0.0' }],
        ['POST', '/api/fleet/plugins/push', { pluginId: 'gate-access', version: value }],
        ['POST', '/api/fleet/plugins/push', { pluginId: 'gate-access', version: '1.0.0', customerIds: [value] }],
      ];
      for (const [method, url, body] of cases) {
        const r = await s.call(method, url, body);
        assert.ok(r.status >= 400 && r.status < 500, `${method} ${url} ${JSON.stringify(body)} → ${r.status} ${r.text.slice(0, 120)}`);
      }
    }
    for (const value of [null, EVIL, {}, 5, true]) {
      assert.equal((await s.call('PUT', '/api/templates/invoice', { subject: value })).status, 400, JSON.stringify(value));
    }
    for (const value of [EVIL, {}, [1], true]) {
      for (const body of [
        { reason: 'r', plans: [{ code: 'pro', monthly: value }] },
        { reason: 'r', plans: [{ code: 'pro', units: value }] },
        { reason: 'r', addons: [{ pluginId: 'gate-access', price: value }] },
      ]) {
        assert.equal((await s.call('PUT', '/api/catalogue', body)).status, 400, JSON.stringify(body));
      }
    }
    for (const body of [{ plans: [null], reason: 'r' }, { addons: [null], reason: 'r' }]) {
      assert.equal((await s.call('PUT', '/api/catalogue', body)).status, 400, JSON.stringify(body));
    }
    const after = s.h.ctx.controllers.customers.view(id);
    assert.equal(after.endsAt, before.endsAt);
    assert.equal(after.companyName, before.companyName);
    assert.equal(s.h.ctx.models.audit.overrides(id).length, 0);
    assert.deepEqual(logs, [], 'no internal fault in the log');
  } finally { await s.close(); }
});

test('rule 48 — a reference that is not text stops before Qonto: the link stays, the invoice stays open, nothing renews', async () => {
  const qonto = makeFakeQonto();
  const h = makeContext({ at: AT, qonto });
  try {
    const { customers, billing } = h.ctx.controllers;
    const c = await customers.create({ ...NEW_CUSTOMER, billing: 'monthly', length: 1, startsAt: TODAY }, 'op');
    h.now.set(`${addDays(c.endsAt, -7)}T08:00:00Z`);
    await billing.runDaily(() => {});
    const before = customers.view(c.id);
    assert.ok(before.invoices.length, 'an invoice is open');
    for (const reference of [EVIL, {}, [1], ['virement'], true, 5]) {
      await assert.rejects(
        billing.recordPayment(c.id, { months: 1, reference, expectedEndsAt: before.endsAt }, 'op'),
        (e) => e.status === 400 && e.body.errors.reference === 'Texte attendu.',
        JSON.stringify(reference),
      );
    }
    assert.equal(qonto.named('deactivateLink').length, 0);
    const after = customers.view(c.id);
    assert.equal(after.endsAt, before.endsAt);
    assert.equal(after.invoices[0].statusLabel, before.invoices[0].statusLabel);

    const paid = await billing.recordPayment(c.id, { months: 1, reference: 'virement', expectedEndsAt: before.endsAt }, 'op');
    assert.equal(qonto.named('deactivateLink').length, 1, 'a real reference reaches Qonto');
    assert.notEqual(paid.endsAt, before.endsAt);
  } finally { h.cleanup(); }
});

test('rule 48 — a support motive that is not text is « Motif obligatoire. » on a space that can answer, nothing is written', async () => {
  const h = makeContext({ at: AT });
  try {
    const dataDir = makeInstance(h.root, NEW_CUSTOMER.slug, { users: [{ email: 'claire@example.test' }] });
    const { customers, support } = h.ctx.controllers;
    const c = await customers.create(NEW_CUSTOMER, 'op');
    const db = new Database(path.join(dataDir, 'guestflow.db'));
    db.exec(`CREATE TABLE support_access (id INTEGER PRIMARY KEY AUTOINCREMENT, requestId TEXT NOT NULL UNIQUE, reason TEXT NOT NULL,
      requestedAt TEXT NOT NULL, decision TEXT, decidedBy INTEGER, decidedAt TEXT, expiresAt TEXT, revokedAt TEXT, revokedBy INTEGER)`);
    db.close();
    assert.equal(support.state(c.id).available, true, 'past the 409 UNAVAILABLE');
    const journal = () => customers.view(c.id).history.length;
    const entries = journal();
    for (const reason of [EVIL, {}, [1], ['Vérifier'], true, 5]) {
      assert.throws(
        () => support.request(c.id, { reason }, 'op'),
        (e) => e.status === 400 && e.body.errors.reason === 'Motif obligatoire.',
        JSON.stringify(reason),
      );
    }
    assert.equal(support.state(c.id).state, 'none');
    const requestFile = path.join(dataDir, supportAccess.REQUEST_FILE);
    assert.equal(fs.existsSync(requestFile), false);
    assert.equal(journal(), entries);
    assert.equal(support.request(c.id, { reason: 'Vérifier' }, 'op').state, 'pending');
    assert.equal(fs.existsSync(requestFile), true, 'a real motive is written');
  } finally { h.cleanup(); }
});

test('rule 48 — a module erase confirmed by anything but the slug as a string is SLUG_MISMATCH, no order leaves', async () => {
  const env = await customerWithSpace({ at: AT, startsAt: TODAY });
  try {
    const { modules } = env.ctx.controllers;
    modules.toggle(env.id, 'linen', false, 'op');
    const facts = { linen: { setup: null, erasable: true, data: [{ label: '3 pièces de stock', count: 3 }] } };
    writeSpace(env, { inactive: ['linen'], applied: writtenAt(env), facts });
    assert.equal(lineOf(modules.view(env.id), 'linen').canErase, true, 'past NOT_SEEDED and MODULE_ACTIVE');
    for (const confirmSlug of [EVIL, {}, [1], [env.slug], true, 5]) {
      assert.throws(
        () => modules.erase(env.id, 'linen', confirmSlug, 'op', 'erase'),
        (e) => e.status === 400 && e.body.error === 'SLUG_MISMATCH',
        JSON.stringify(confirmSlug),
      );
    }
    assert.deepEqual(licenceOf(env).eraseOrders, []);
    modules.erase(env.id, 'linen', env.slug, 'op', 'erase');
    assert.equal(licenceOf(env).eraseOrders.length, 1, 'the slug itself still confirms');
  } finally { env.cleanup(); }
});

test('rule 48 — the password asked to switch MFA method: anything but a string is BAD_PASSWORD, nothing starts', async () => {
  const h = makeContext({ at: AT });
  try {
    const password = 'correct horse battery';
    const id = h.ctx.models.operators.create({ email: 'op@example.test', name: 'Op', passwordHash: passwordHash.hashPassword(password) });
    const { auth } = h.ctx.controllers;
    for (const value of [EVIL, {}, [password], true]) {
      await assert.rejects(
        auth.startMethod(id, { method: 'totp', password: value }),
        (e) => e.status === 400 && e.body.error === 'BAD_PASSWORD',
        JSON.stringify(value),
      );
    }
    assert.equal(h.ctx.models.operators.byId(id).pendingMethod, null);
    assert.equal((await auth.startMethod(id, { method: 'totp', password })).method, 'totp');
    assert.equal(h.ctx.models.operators.byId(id).pendingMethod, 'totp');
  } finally { h.cleanup(); }
});

test('rule 48 — the template kept its text: `null` never lands as « null »', async () => {
  const { ctx } = makeContext({ at: AT });
  const { templates } = ctx.controllers;
  const before = templates.list().templates.find((x) => x.key === 'invoice');
  for (const subject of [null, {}, 5]) assert.throws(() => templates.save('invoice', { subject }, 'op'), (e) => e.status === 400);
  for (const body of [null, {}, 5]) assert.throws(() => templates.save('invoice', { body }, 'op'), (e) => e.status === 400);
  const after = templates.list().templates.find((x) => x.key === 'invoice');
  assert.equal(after.subject, before.subject);
  assert.equal(after.body, before.body);
  assert.equal(templates.save('invoice', { subject: 'Objet' }, 'op').template.subject, 'Objet');
});

test('rule 48 — the console login: an email, a password or a code that is not a string is a refusal, anonymous', async (t) => {
  const logs = captureConsole(t);
  const s = await start();
  try {
    for (const value of [EVIL, {}, [], true, 5]) {
      assert.equal((await s.call('POST', '/api/auth/login', { email: value, password: 'x' })).status, 401, JSON.stringify(value));
      assert.equal((await s.call('POST', '/api/auth/login', { email: 'op@example.test', password: value })).status, 401, JSON.stringify(value));
    }
    await s.call('POST', '/api/auth/login', { email: 'op@example.test', password: 'correct horse battery' });
    assert.equal((await s.call('POST', '/api/auth/verify', { code: EVIL })).status, 401);
    assert.deepEqual(logs, []);
  } finally { await s.close(); }
});

test('rule 49 — an oversized JSON body answers 413 TOO_LARGE on login, anonymous, and logs no fault', async (t) => {
  const logs = captureConsole(t);
  const s = await start();
  try {
    const r = await s.raw('POST', '/api/auth/login', JSON.stringify({ a: 'x'.repeat(300 * 1024) }));
    assert.equal(r.status, 413);
    assert.deepEqual(r.json, { error: 'TOO_LARGE', message: 'Envoi trop volumineux.' });
    assert.deepEqual(logs, []);
  } finally { await s.close(); }
});

test('rule 49 — malformed JSON is a 400 BAD_REQUEST: the raw text is no longer echoed back', async (t) => {
  const logs = captureConsole(t);
  const s = await start();
  try {
    const r = await s.raw('POST', '/api/auth/login', '{bad');
    assert.equal(r.status, 400);
    assert.deepEqual(r.json, { error: 'BAD_REQUEST', message: 'Requête illisible.' });
    assert.deepEqual(logs, []);
  } finally { await s.close(); }
});

test('rule 49 — an oversized plugin package answers the size message; httpError keeps its body', async (t) => {
  const logs = captureConsole(t);
  const s = await start();
  try {
    await s.signIn();
    const big = await s.raw('POST', '/api/registry/packages', Buffer.alloc(51 * 1024 * 1024), { 'content-type': 'application/octet-stream', 'x-file-name': 'p-1.0.0.tgz' });
    assert.equal(big.status, 413);
    assert.equal(big.json.message, 'Envoi trop volumineux.');
    const missing = await s.call('GET', '/api/customers/999999');
    assert.equal(missing.status, 404);
    assert.equal(missing.json.error, 'NOT_FOUND');
    assert.deepEqual(logs, []);
  } finally { await s.close(); }
});
