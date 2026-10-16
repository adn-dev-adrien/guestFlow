// specs/guest-email-texts-made-simple.md §3.F rules 19–20 — « Traduire les textes manquants » fills
// every empty English from its French through the platform's key, with the variables protected; each
// filled text is marked « à relire » until edited or confirmed; a failure leaves nothing half-done; no
// key, no button.

const test = require('node:test');
const assert = require('node:assert/strict');

const { setup, call } = require('./emailTextsFixture');
const { buildController } = require('../controllers/emailTextsController');
const textTranslator = require('../utils/textTranslator');

function withKey(fn) {
  return async () => {
    const before = process.env.GUESTFLOW_TRANSLATE_API_KEY;
    process.env.GUESTFLOW_TRANSLATE_API_KEY = 'test-key';
    try { await fn(); } finally {
      if (before === undefined) delete process.env.GUESTFLOW_TRANSLATE_API_KEY;
      else process.env.GUESTFLOW_TRANSLATE_API_KEY = before;
    }
  };
}

/** A stub of the Messages API: answers each masked text with `EN:` in front, markers kept. */
function fakeApi({ mangle = false, status = 200 } = {}) {
  const requests = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    requests.push({ url, headers: init.headers, body });
    const texts = JSON.parse(body.messages[0].content);
    const translations = texts.map((t) => (mangle ? t.replace(/\[\[0\]\]/, '') : `EN: ${t}`));
    return {
      ok: status === 200,
      status,
      json: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ translations }) }] }),
    };
  };
  return { requests, fetchImpl };
}

test('rule 19: the variables never reach the service, and come back in place', withKey(async () => {
  const api = fakeApi();
  const [out] = await textTranslator.translate(['Bonjour {{clientFirstName}}, {{#if hasPrice}}{{price}}{{/if}}.'], { fetchImpl: api.fetchImpl });
  const sent = api.requests[0].body.messages[0].content;
  assert.doesNotMatch(sent, /\{\{/);
  assert.match(sent, /\[\[0\]\].*\[\[3\]\]/);
  assert.equal(out, 'EN: Bonjour {{clientFirstName}}, {{#if hasPrice}}{{price}}{{/if}}.');
  assert.equal(api.requests[0].url, 'https://api.anthropic.com/v1/messages');
  assert.equal(api.requests[0].headers['x-api-key'], 'test-key');
  assert.equal(api.requests[0].body.model, 'claude-sonnet-5-5');
}));

test('rule 19: every empty English is filled and marked « à relire » until edited or confirmed', withKey(async () => {
  const { db } = setup();
  db.prepare("INSERT INTO stay_texts (key, propertyId, fr, en) VALUES ('house', 0, 'Café offert, {{x}}', NULL)").run();
  db.prepare("UPDATE stay_texts SET fr = 'Café offert.', en = '' WHERE key = 'house'").run();
  db.prepare("UPDATE properties SET emailHook = 'Le jardin est à vous.' WHERE id = 1").run();
  const api = fakeApi();
  const controller = buildController({ database: db, translator: { isAvailable: () => true, translate: (t) => textTranslator.translate(t, { fetchImpl: api.fetchImpl }) } });
  const res = await call(controller.translate);
  assert.equal(res.status, 200);
  assert.ok(res.body.translated >= 2);
  assert.equal(db.prepare("SELECT en FROM stay_texts WHERE key = 'house' AND propertyId = 0").get().en, 'EN: Café offert.');
  assert.equal(db.prepare('SELECT emailHookEn FROM properties WHERE id = 1').get().emailHookEn, 'EN: Le jardin est à vous.');
  const list = await call(controller.list);
  const house = list.body.sections.find((s) => s.id === 'j2').items.find((i) => i.key === 'text:house');
  assert.equal(house.autoTranslated, true);

  await call(controller.confirm, { body: { key: 'text:house' } });
  await call(controller.save, { body: { changes: { 'hook:1': { en: 'The garden is yours.' } } } });
  const after = (await call(controller.list)).body.sections.flatMap((s) => s.items);
  assert.equal(after.find((i) => i.key === 'text:house').autoTranslated, false);
  assert.equal(after.find((i) => i.key === 'hook:1').autoTranslated, false);
}));

test('rule 19: a lost variable or a failed call changes nothing at all', withKey(async () => {
  for (const api of [fakeApi({ mangle: true }), fakeApi({ status: 529 })]) {
    const { db } = setup();
    db.prepare("INSERT INTO stay_texts (key, propertyId, fr, en) VALUES ('house', 0, 'Café, {{x}}', '')").run();
    db.prepare("UPDATE properties SET emailHook = 'Le jardin.' WHERE id = 1").run();
    const controller = buildController({ database: db, translator: { isAvailable: () => true, translate: (t) => textTranslator.translate(t, { fetchImpl: api.fetchImpl }) } });
    const res = await call(controller.translate);
    assert.equal(res.status, 502);
    assert.equal(res.body.message, 'Traduction impossible, rien n’a été modifié.');
    assert.equal(db.prepare('SELECT emailHookEn FROM properties WHERE id = 1').get().emailHookEn, '');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM stay_text_flags').get().n, 0);
  }
}));

test('rule 20: without the platform key there is no translation and the page says so', async () => {
  const before = process.env.GUESTFLOW_TRANSLATE_API_KEY;
  delete process.env.GUESTFLOW_TRANSLATE_API_KEY;
  try {
    assert.equal(textTranslator.isAvailable(), false);
    const { db } = setup();
    const controller = buildController({ database: db });
    assert.equal((await call(controller.list)).body.canTranslate, false);
    assert.equal((await call(controller.translate)).status, 404);
    await assert.rejects(textTranslator.translate(['x']), /Service non configuré/);
  } finally {
    if (before !== undefined) process.env.GUESTFLOW_TRANSLATE_API_KEY = before;
  }
});
