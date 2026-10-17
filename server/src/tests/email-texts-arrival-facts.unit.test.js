// specs/guest-email-texts-made-simple.md §3.A rules 1–5 — the arrival facts of a property: stored with
// their secrets encrypted, composed into three J-2 paragraphs that disappear while empty, placed by
// the neutral J-2 only, and the key-box code left out when the gate key already says how to get in.

const test = require('node:test');
const assert = require('node:assert/strict');

const { setup } = require('./emailTextsFixture');
const arrivalFactsModel = require('../models/propertyArrivalFactsModel');
const { buildStayContent } = require('../utils/stayContentContext');
const { buildContext } = require('../utils/emailContextBuilder');
const { loadReservationGraph } = require('../utils/reservationEmailGraph');

const FACTS = {
  address: '12 chemin des Prés, 42410 Pélussin',
  accessFr: 'La clé est dans la boîte à côté de la porte.',
  accessEn: 'The key is in the box by the door.',
  accessCode: '4521',
  wifiName: 'Gite-Invites',
  wifiPassword: 'pres2026',
};

test('rule 1: every arrival fact is stored; an absent field is kept, an empty one cleared', () => {
  const { db } = setup();
  const model = arrivalFactsModel.buildModel(db);
  model.save(1, FACTS);
  model.save(1, { wifiName: '' });
  const form = model.forForm(1);
  assert.equal(form.address, FACTS.address);
  assert.equal(form.accessFr, FACTS.accessFr);
  assert.equal(form.wifiName, '');
  assert.equal(form.hasAccessCode, true);
  assert.equal(model.forEmail(1).accessCode, '4521');
});

test('rule 2: the code and the Wi-Fi password are encrypted at rest and never sent to the form', () => {
  const { db } = setup();
  arrivalFactsModel.buildModel(db).save(1, FACTS);
  const row = db.prepare('SELECT * FROM property_arrival_facts WHERE propertyId = 1').get();
  assert.ok(row.accessCodeEncrypted.startsWith('enc:'), 'code encrypted');
  assert.ok(!row.accessCodeEncrypted.includes('4521'));
  assert.ok(!row.wifiPasswordEncrypted.includes('pres2026'));
  const form = arrivalFactsModel.buildModel(db).forForm(1);
  assert.equal(form.accessCode, undefined);
  assert.equal(form.wifiPassword, undefined);
  assert.equal(form.hasWifiPassword, true);
});

test('rule 3: three paragraphs composed from the facts, each omitted while its facts are empty', () => {
  const base = { reservation: { startDate: '2027-05-14', endDate: '2027-05-16' }, property: { name: 'Le Gîte' } };
  const full = buildStayContent({ ...base, facts: { arrival: FACTS } });
  assert.match(full.vars.addressParagraph, /^- Adresse : 12 chemin des Prés, 42410 Pélussin\n {2}Itinéraire : https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=12%20chemin/);
  assert.equal(full.vars.accessParagraph, '- La clé est dans la boîte à côté de la porte.\n- Code de la boîte à clés : 4521');
  assert.equal(full.vars.arrivalWifiParagraph, '- Wi-Fi : Gite-Invites, mot de passe : pres2026');
  const en = buildStayContent({ ...base, facts: { arrival: FACTS }, lang: 'en' });
  assert.equal(en.vars.accessParagraph, '- The key is in the box by the door.\n- Key box code: 4521');

  const empty = buildStayContent({ ...base, facts: { arrival: null } });
  for (const name of ['addressParagraph', 'accessParagraph', 'arrivalWifiParagraph']) assert.equal(empty.vars[name], '');
  assert.equal(empty.flags.hasAddressParagraph, false);
  const codeOnly = buildStayContent({ ...base, facts: { arrival: { accessCode: '12' } } });
  assert.equal(codeOnly.vars.accessParagraph, '- Code de la boîte à clés : 12');
  const typedMap = buildStayContent({ ...base, facts: { arrival: { address: 'Ici', mapUrl: 'https://maps.example/x' } } });
  assert.match(typedMap.vars.addressParagraph, /Itinéraire : https:\/\/maps\.example\/x$/);
  // An empty English « accès » sends the French (rule 14).
  const noEn = buildStayContent({ ...base, facts: { arrival: { accessFr: 'Porte bleue.' } }, lang: 'en' });
  assert.equal(noEn.vars.accessParagraph, '- Porte bleue.');
});

test('rule 4: the neutral J-2 places the paragraphs; a template that does not name them is unchanged', () => {
  const { db, reservationId } = setup();
  const render = (key) => {
    const graph = loadReservationGraph(db, reservationId);
    const ctx = buildContext({ ...graph, settings: { companyPhone: '06 12 34 56 78' }, lang: 'fr' });
    const t = db.prepare('SELECT * FROM email_templates WHERE stableKey = ?').get(key);
    return require('../utils/emailTemplateRenderer').renderTemplate(t, ctx).body;
  };
  const before = render('arrival_reminder_1d');
  assert.doesNotMatch(before, /Adresse|Wi-Fi|\n\n\n/);
  arrivalFactsModel.buildModel(db).save(1, FACTS);
  const after = render('arrival_reminder_1d');
  assert.match(after, /- Adresse : 12 chemin des Prés/);
  assert.match(after, /- Code de la boîte à clés : 4521\n- Wi-Fi : Gite-Invites, mot de passe : pres2026\n- Pouvez-vous/);
  // A stored template written before (Solio's) knows nothing of them: same output with or without facts.
  db.prepare("UPDATE email_templates SET body = 'Bonjour {{clientFirstName}}.' WHERE stableKey = 'arrival_reminder_1d'").run();
  assert.equal(render('arrival_reminder_1d'), 'Bonjour Camille.');
});

test('rule 5: a gate key given by the gate-access plugin is not repeated by the key-box code', () => {
  const base = { reservation: { startDate: '2027-05-14' }, property: { name: 'Le Gîte' }, facts: { arrival: FACTS } };
  const withGate = buildStayContent({ ...base, gateAccess: true });
  assert.equal(withGate.vars.accessParagraph, '- La clé est dans la boîte à côté de la porte.');
  const ctx = buildContext({
    reservation: base.reservation, property: base.property, stayFacts: base.facts,
    pluginContext: { tokens: { gateAccessCode: '4K7M' }, flags: { hasGateAccess: true } },
  });
  assert.doesNotMatch(ctx.vars.accessParagraph, /4521/);
});

test('rule 3: without an address of its own, the property takes the company\'s — in the paragraph and {{propertyAddress}}', () => {
  const base = { reservation: { startDate: '2027-05-14' }, property: { name: 'Le Gîte' }, settings: { companyAddress: '1 place du Village, Pélussin' } };
  const derived = buildStayContent({ ...base, facts: { arrival: null } });
  assert.match(derived.vars.addressParagraph, /^- Adresse : 1 place du Village, Pélussin/);
  assert.equal(derived.vars.propertyAddress, '1 place du Village, Pélussin');
  const own = buildStayContent({ ...base, facts: { arrival: { address: '12 chemin des Prés' } } });
  assert.equal(own.vars.propertyAddress, '12 chemin des Prés');
  const ctx = buildContext({ reservation: base.reservation, property: base.property, settings: base.settings, stayFacts: {} });
  assert.equal(ctx.vars.propertyAddress, '1 place du Village, Pélussin');
  assert.equal(buildContext({ reservation: base.reservation, property: base.property, settings: {}, stayFacts: {} }).vars.propertyAddress, '');
});
