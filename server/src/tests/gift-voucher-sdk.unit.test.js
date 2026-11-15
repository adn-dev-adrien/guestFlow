// specs/gift-vouchers.md §4.1 — what the plugin needed from the core, generic and without the word « voucher »: the public API guard
// chain and the proof of work shared through the SDK, an e-mail outside a stay, the embedded PDF faces, the payment methods.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const sdk = require('../plugins/sdk');
const { createContext } = require('../plugins/sdk/createContext');
const { SDK_VERSION } = require('../plugins/sdk/version');
const HISTORY = require('../plugins/sdk/coreModuleHistory.json');
const { skipWithout } = require('../plugins/sdk/testing');

const SRC = path.join(__dirname, '..');

test('SDK 2.31.0: the version is bumped by a minor and the history records what it added', () => {
  assert.equal(SDK_VERSION, '2.31.0');
  const entry = HISTORY.added.find((a) => a.version === '2.31.0');
  assert.deepEqual(entry, { version: '2.31.0', modules: ['pdfFonts'], names: { paymentTenders: ['METHODS'] } });
});

test('SDK 2.31.0: middleware.publicApi is the key guard, the visitor context and the per-visitor limiter, in that order', () => {
  const { middleware } = sdk;
  assert.deepEqual([...middleware.publicApi], [middleware.requirePublicApiKey, middleware.visitorContext, middleware.publicApiLimiter]);
  assert.equal(middleware.requirePublicApiKey, require('../middleware/requirePublicApiKey'));
  assert.equal(typeof middleware.requirePublicApiKey.roostviewMayCall, 'function');
  assert.equal(typeof middleware.visitorContext.readVisitor, 'function');
  assert.ok(Object.isFrozen(middleware.publicApi));
});

test('SDK 2.31.0: the guard chain keeps the visitor behind the key — an unknown key never reaches the visitor context', () => {
  const req = { get: () => '', publicApiCaller: undefined };
  let reached = false;
  const res = { status() { return this; }, json() { return this; } };
  const prior = { site: process.env.PUBLIC_API_KEY };
  process.env.PUBLIC_API_KEY = 'k'.repeat(40);
  try {
    sdk.middleware.requirePublicApiKey(req, res, () => { reached = true; });
    assert.equal(reached, false);
    assert.equal(req.visitor, undefined);
  } finally {
    if (prior.site === undefined) delete process.env.PUBLIC_API_KEY; else process.env.PUBLIC_API_KEY = prior.site;
  }
});

test('SDK 2.31.0: website-booking reads the guard, the visitor context and the proof of work from the SDK — the same functions', { skip: skipWithout(['website-booking']) }, () => {
  assert.equal(require('../plugins/website-booking/requirePublicApiKey'), sdk.middleware.requirePublicApiKey);
  assert.equal(require('../plugins/website-booking/visitorContext'), sdk.middleware.visitorContext);
  assert.equal(require('../plugins/website-booking/challenge'), sdk.proofOfWork);
  assert.equal(sdk.proofOfWork, require('../utils/proofOfWork'));
});

test('SDK 2.31.0: the proof of work a visitor solves for the booking is the one the code check asks for', () => {
  const pow = sdk.proofOfWork;
  assert.equal(pow.BASE_BITS, 12);
  const challenge = pow.issue({ secret: 's', ipKey: pow.ipKeyOf('203.0.113.9'), difficulty: 12, now: Date.now() - 5000 });
  const nonce = pow.solve(challenge);
  assert.equal(pow.verify({ secret: 's', challenge, nonce, ipKey: pow.ipKeyOf('203.0.113.9') }).ok, true);
  assert.equal(pow.verify({ secret: 's', challenge, nonce, ipKey: pow.ipKeyOf('203.0.113.10') }).ok, false);
});

test('SDK 2.31.0: ctx.mail.send sends one e-mail through the operator’s SMTP service and answers its id; the address never reaches the log', async () => {
  const sent = [];
  const logs = [];
  const original = console.log;
  console.log = (...args) => logs.push(args.join(' '));
  try {
    const ctx = createContext('probe', { mailService: () => ({ send: async (m) => { sent.push(m); return { messageId: '<abc@x>' }; } }) });
    const result = await ctx.mail.send({
      to: 'paul@example.test', subject: 'Sujet', text: 'Texte', html: '<p>Texte</p>', key: 'receipt:1',
    });
    assert.deepEqual(result, { messageId: '<abc@x>' });
    assert.deepEqual(sent, [{ to: 'paul@example.test', subject: 'Sujet', text: 'Texte', html: '<p>Texte</p>' }]);
    await ctx.mail.send({ to: 'a@b.test', subject: 'S', text: 'T' });
    assert.equal('html' in sent[1], false, 'plain text when no html is given');
  } finally {
    console.log = original;
  }
  assert.ok(logs.some((l) => l.includes('mail sent (receipt:1)')));
  assert.equal(logs.join('\n').includes('paul@example.test'), false);
});

test('SDK 2.31.0: ctx.mail.send refuses an e-mail with no recipient, subject or text, and lets a transport failure through', async () => {
  const ctx = createContext('probe', { mailService: () => ({ send: async () => { throw Object.assign(new Error('EMAIL_NOT_CONFIGURED'), { code: 'EMAIL_NOT_CONFIGURED' }); } }) });
  for (const bad of [{}, { to: '', subject: 'S', text: 'T' }, { to: 'a@b.test', subject: '', text: 'T' }, { to: 'a@b.test', subject: 'S', text: ' ' }, { to: ['a@b.test'], subject: 'S', text: 'T' }]) {
    await assert.rejects(() => ctx.mail.send(bad), /needs to, subject and text/);
  }
  await assert.rejects(() => ctx.mail.send({ to: 'a@b.test', subject: 'S', text: 'T' }), { code: 'EMAIL_NOT_CONFIGURED' });
  await assert.rejects(() => ctx.mail.send(), /needs to, subject and text/);
});

test('SDK 2.31.0: the devis and the plugins draw with the same embedded faces — one module, the devis still reads it', () => {
  const fonts = sdk.coreModule('pdfFonts');
  assert.deepEqual(Object.keys(fonts.FACES).sort(), ['bold', 'italic', 'regular', 'serif']);
  Object.values(fonts.FACES).forEach((face) => assert.ok(fs.existsSync(face.file), face.file));
  assert.equal(require('../utils/devisPdf').__test.FACES, fonts.FACES);
  assert.equal(require('../utils/devisPdf').__test.registerFaces, fonts.registerFaces);
});

test('SDK 2.31.0: the payment methods come from the core list, never copied by a plugin', () => {
  const methods = sdk.coreModule('paymentTenders').METHODS.map((m) => m.value);
  assert.ok(methods.includes('card') && methods.includes('holidayVoucher'));
});

test('SDK 2.31.0: nothing the core gained for the plugin names it — no « voucher » in the SDK, the guards, the mail or the fonts', () => {
  ['plugins/sdk/index.js', 'plugins/sdk/createContext.js', 'middleware/requirePublicApiKey.js', 'middleware/visitorContext.js', 'utils/proofOfWork.js', 'utils/pdfFonts.js']
    .forEach((file) => assert.equal(/voucher|bon cadeau/i.test(fs.readFileSync(path.join(SRC, file), 'utf8')), false, file));
  const controller = fs.readFileSync(path.join(SRC, 'controllers/pluginsController.js'), 'utf8');
  assert.equal(/voucher/i.test(controller), false);
});

test('SDK 2.31.0: ctx.data accepts a refuse(db) and the core answers 409 ERASE_REFUSED with its sentence; a plugin without one is never blocked', () => {
  const registry = require('../plugins/sdk/registry');
  registry.reset();
  const ctx = createContext('probe-erase', {});
  ctx.data({ tables: [], refuse: () => 'Encore des soldes.' });
  assert.equal(registry.get('probe-erase').data.refuse(null), 'Encore des soldes.');
  registry.reset();
});
