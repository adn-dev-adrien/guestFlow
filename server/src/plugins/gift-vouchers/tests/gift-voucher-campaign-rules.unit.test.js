// specs/gift-voucher-campaigns.md rules 2-4, 6, 9, 46 — what a campaign may be: the one judgement shared by the campaign form, « Sur mesure » and the recipe import.
// A composition holds exactly one hourly resource (band, minutes) and any options; only elements sellable outside a stay; the extra time and the add-ons;
// the validity; the permanent link (format, uniqueness, locked once a card is printed); the lodging bounds, VAT rate and ideas. Each refusal names its field in French.
const test = require('node:test');
const assert = require('node:assert/strict');

const rules = require('../campaignRules');
const createCampaignsModel = require('../models/campaignsModel');
const fx = require('./giftVoucherFixtures');

// A catalogue stand-in: the sellability and the session sentences come from the real catalogue view and the engine (gift-voucher-catalogue-view, -pricing).
const ELEMENTS = {
  'resource:1': {
    articleRef: 'resource:1', kind: 'resource', id: 1, label: 'Bain nordique', hourly: true, sellable: true, reason: null, modes: [],
  },
  'resource:2': {
    articleRef: 'resource:2', kind: 'resource', id: 2, label: 'Vélo', hourly: false, sellable: false, reason: 'Seule une ressource à l’heure se compose dans un bon.', modes: [],
  },
  'option:1': { articleRef: 'option:1', kind: 'option', id: 1, label: 'Planche apéro', sellable: true, reason: null },
  'option:2': { articleRef: 'option:2', kind: 'option', id: 2, label: 'Boisson', sellable: true, reason: null },
  'option:3': {
    articleRef: 'option:3', kind: 'option', id: 3, label: 'Bougie', sellable: false, reason: 'Pas marqué « vendable hors séjour » dans le catalogue.',
  },
};
const sessionCalls = [];
const catalogue = {
  element: (ref) => ELEMENTS[ref] || null,
  sessionRefusal: (session) => {
    sessionCalls.push(session);
    if (session.minutes % 60 !== 0) return `« Bain nordique » se réserve par tranches de 60 min : ${session.minutes} min ne convient pas.`;
    return session.minutes + (session.rankOffsetMinutes || 0) > 540 ? '« Bain nordique » : 10 h ne tiennent pas dans la journée (10:00–19:00).' : null;
  },
};

const db = fx.freshDb();
const campaigns = createCampaignsModel(db);
const deps = (extra = {}) => ({ catalogue, campaigns, ...extra });
const bath = (over = {}) => ({
  name: 'Bain journée', title: 'Un bain nordique', kind: 'resource', validityMonths: 12, slug: 'bain-jour',
  composition: { resourceId: 1, band: 'day', minutes: 120, options: [{ articleRef: 'option:1', qty: 1 }] }, addOns: ['option:2'], extraTimeMaxMinutes: 120, ...over,
});
const lodging = (over = {}) => ({
  name: 'Séjour', title: 'Bon cadeau', kind: 'lodging', validityMonths: 18, minAmountCents: 2000, maxAmountCents: 200000, vatRatePercent: 10, ideas: [], ...over,
});
const errorsOf = (input, extra) => {
  const out = rules.validateCampaign(input, deps(extra));
  return out.ok ? [] : out.errors.map((e) => [e.field, e.message]);
};

test('rule 4: a valid composition — one hourly resource with its band and included minutes, options with a quantity — is accepted and normalised', () => {
  const out = rules.validateCampaign(bath({ name: '  Bain journée  ' }), deps());
  assert.equal(out.ok, true, JSON.stringify(out.errors));
  assert.deepEqual(out.value, {
    name: 'Bain journée',
    title: 'Un bain nordique',
    kind: 'resource',
    state: 'draft',
    oneShot: false,
    slug: 'bain-jour',
    validityMonths: 12,
    composition: { resourceId: 1, band: 'day', minutes: 120, options: [{ articleRef: 'option:1', qty: 1 }] },
    addOns: ['option:2'],
    extraTimeMaxMinutes: 120,
    minAmountCents: null,
    maxAmountCents: null,
    ideas: [],
    vatRatePercent: null,
  });
});

test('rule 4: exactly one hourly resource — none, an unknown one, an option in its place, one that is not hourly are each refused on the resource field', () => {
  assert.deepEqual(errorsOf(bath({ composition: undefined })), [['composition', 'Composition : une ressource à l’heure est à choisir.']]);
  assert.deepEqual(errorsOf(bath({ composition: { band: 'day', minutes: 60 } })).map(([field]) => field), ['composition.resourceId']);
  assert.deepEqual(errorsOf(bath({ composition: { resourceId: 9, band: 'day', minutes: 60 } }))[0], ['composition.resourceId', 'Ressource : « resource:9 » n’est pas dans le catalogue.']);
  assert.deepEqual(errorsOf(bath({ composition: { resourceId: 2, band: 'day', minutes: 60 } }))[0], [
    'composition.resourceId', 'Ressource : « Vélo » ne peut pas être vendu : Seule une ressource à l’heure se compose dans un bon.',
  ]);
  assert.equal(errorsOf(bath({ composition: [{ resourceId: 1 }, { resourceId: 1 }] }))[0][0], 'composition', 'several sessions on one voucher are out of scope');
});

test('rule 4: the band is the day or the evening; the minutes are judged by the engine’s own sentence — step, minimum and band hours', () => {
  assert.deepEqual(errorsOf(bath({ composition: { resourceId: 1, band: 'night', minutes: 60 } })), [['composition.band', 'Tranche : « journée » ou « soirée » est attendu.']]);
  assert.deepEqual(errorsOf(bath({ composition: { resourceId: 1, band: 'day', minutes: 90 } })), [[
    'composition.minutes', 'Durée incluse : « Bain nordique » se réserve par tranches de 60 min : 90 min ne convient pas.',
  ]]);
  assert.deepEqual(errorsOf(bath({ composition: { resourceId: 1, band: 'day', minutes: 600 } })), [[
    'composition.minutes', 'Durée incluse : « Bain nordique » : 10 h ne tiennent pas dans la journée (10:00–19:00).',
  ]]);
  assert.equal(sessionCalls.at(-1).resourceId, 1);
});

test('rule 4: options must be sellable outside a stay, each once, with a quantity from 1 to 20 — the refusal carries the catalogue’s reason', () => {
  assert.deepEqual(errorsOf(bath({ composition: { resourceId: 1, band: 'day', minutes: 120, options: [{ articleRef: 'option:3', qty: 1 }] } })), [[
    'composition.options[0].articleRef', 'Compris dans le bon : « Bougie » ne peut pas être vendu : Pas marqué « vendable hors séjour » dans le catalogue.',
  ]]);
  const twice = { resourceId: 1, band: 'day', minutes: 120, options: [{ articleRef: 'option:1', qty: 1 }, { articleRef: 'option:1', qty: 2 }] };
  assert.deepEqual(errorsOf(bath({ composition: twice })), [['composition.options[1].articleRef', 'Compris dans le bon : « Planche apéro » figure deux fois.']]);
  [0, 21, 1.5, 'x'].forEach((qty) => {
    const field = errorsOf(bath({ composition: { resourceId: 1, band: 'day', minutes: 120, options: [{ articleRef: 'option:1', qty }] } }))[0];
    assert.equal(field[0], 'composition.options[0].qty', String(qty));
  });
  assert.deepEqual(errorsOf(bath({ composition: { resourceId: 1, band: 'day', minutes: 120, options: [{ articleRef: 'resource:1', qty: 1 }] } }))[0][0], 'composition.options[0].articleRef', 'a resource is not an option');
});

test('rule 4: add-ons are sellable options, none repeated, none already included; extra time is a multiple of the slot that still fits the band', () => {
  assert.deepEqual(errorsOf(bath({ addOns: ['option:3'] })).map(([field]) => field), ['addOns[0]']);
  assert.deepEqual(errorsOf(bath({ addOns: ['option:2', 'option:2'] })), [['addOns[1]', 'Options proposées : « Boisson » figure deux fois.']]);
  assert.deepEqual(errorsOf(bath({ addOns: ['option:1'] })), [['addOns[0]', 'Options proposées : « Planche apéro » est déjà comprise dans le bon.']]);
  assert.deepEqual(errorsOf(bath({ addOns: 'x' })).map(([field]) => field), ['addOns']);
  assert.deepEqual(errorsOf(bath({ extraTimeMaxMinutes: 90 })), [[
    'extraTimeMaxMinutes', 'Temps supplémentaire : « Bain nordique » se réserve par tranches de 60 min : 90 min ne convient pas.',
  ]]);
  assert.deepEqual(errorsOf(bath({ extraTimeMaxMinutes: 480 }))[0][0], 'extraTimeMaxMinutes', '2 h included + 8 h does not fit the day');
  assert.deepEqual(sessionCalls.at(-1), {
    resourceId: 1, band: 'day', minutes: 480, rankOffsetMinutes: 120,
  }, 'the extra time is judged after the included minutes');
  assert.equal(errorsOf(bath({ extraTimeMaxMinutes: 0 })).length, 0);
  assert.equal(errorsOf(bath({ extraTimeMaxMinutes: -60 }))[0][0], 'extraTimeMaxMinutes');
});

test('rule 2: the name and the public title are texts, the validity whole months from 1 to 120, the state one of three, the kind one of two', () => {
  assert.deepEqual(errorsOf(bath({ name: '' }))[0][0], 'name');
  assert.deepEqual(errorsOf(bath({ title: ' ' }))[0][0], 'title');
  assert.deepEqual(errorsOf(bath({ name: 'x'.repeat(81) }))[0][0], 'name');
  assert.deepEqual(errorsOf(bath({ name: 42 }))[0][0], 'name');
  ['1', '18', 120, '120'].forEach((v) => assert.deepEqual(errorsOf(bath({ validityMonths: v })), [], String(v)));
  ['0', '121', '-1', '1.5', 'abc', '', [], {}, null].forEach((v) => assert.equal(errorsOf(bath({ validityMonths: v }))[0][0], 'validityMonths', JSON.stringify(v)));
  assert.deepEqual(errorsOf(bath({ state: 'sold' }))[0][0], 'state');
  assert.deepEqual(errorsOf(bath({ kind: 'bath' }))[0][0], 'kind');
  assert.deepEqual(errorsOf(null), [['body', 'Corps de requête invalide.']]);
  assert.deepEqual(errorsOf(bath({ name: '', title: '', validityMonths: 0 })).map(([field]) => field), ['name', 'title', 'validityMonths'], 'every field that fails is named, not only the first');
});

test('rule 9: the permanent link is lowercase letters, digits and dashes; unique among campaigns; locked once a card was printed', () => {
  ['bain-nordique', 'bain2', 'a'].forEach((slug) => assert.deepEqual(errorsOf(bath({ slug })), [], slug));
  ['Bain', 'bain nordique', 'bain--x', '-bain', 'bain-', 'bàin', 'x'.repeat(61)].forEach((slug) => assert.equal(errorsOf(bath({ slug }))[0][0], 'slug', slug));
  const taken = campaigns.insert(rules.validateCampaign(bath({ slug: 'deja-pris' }), deps()).value);
  assert.deepEqual(errorsOf(bath({ slug: 'deja-pris' })), [['slug', 'Lien permanent : « deja-pris » est déjà pris par la campagne « Bain journée ».']]);
  const existing = campaigns.find(taken);
  assert.deepEqual(errorsOf(bath({ slug: 'deja-pris' }), { existing }), [], 'a campaign keeps its own link');
  campaigns.lockSlug(taken);
  const locked = campaigns.find(taken);
  assert.ok(locked.slugLockedAt);
  assert.deepEqual(errorsOf(bath({ slug: 'autre' }), { existing: locked }), [['slug', 'Lien permanent : verrouillé, une carte du commerçant a été imprimée avec ce lien.']]);
  assert.deepEqual(errorsOf(bath({ slug: 'deja-pris' }), { existing: locked }), [], 'the same link is not a change');
  assert.deepEqual(errorsOf(bath({ slug: undefined })), [], 'a draft may have no link yet');
});

test('rule 3: a lodging campaign carries the bounds, the VAT rate and the ideas of the settings it replaces — each judged as the settings were', () => {
  const ok = rules.validateCampaign(lodging({ vatRatePercent: '5,5' }), deps());
  assert.equal(ok.ok, true);
  assert.deepEqual([ok.value.minAmountCents, ok.value.maxAmountCents, ok.value.vatRatePercent, ok.value.composition, ok.value.addOns], [2000, 200000, 5.5, null, []]);
  ['50', 'abc', '1.5', [], {}, -5, 99, 10000001].forEach((v) => assert.equal(errorsOf(lodging({ minAmountCents: v }))[0][0], 'minAmountCents', JSON.stringify(v)));
  assert.equal(errorsOf(lodging({ minAmountCents: '2000' })).length, 0);
  assert.deepEqual(errorsOf(lodging({ minAmountCents: 9000, maxAmountCents: 1000 })), [['minAmountCents', 'Montant minimal : au plus le montant maximal.']]);
  assert.deepEqual(errorsOf(lodging({ vatRatePercent: 'abc' })), [['vatRatePercent', 'Taux de TVA : Saisir un nombre, par exemple 10 ou 5,5.']]);
  assert.deepEqual(errorsOf(lodging({ vatRatePercent: '' }))[0][0], 'vatRatePercent');
  assert.equal(errorsOf(lodging({ vatRatePercent: 101 }))[0][0], 'vatRatePercent');
  assert.deepEqual(errorsOf(lodging({ ideas: [{ label: 'Un cadeau', amountCents: 15000 }] })), [['ideas', 'Une idée est un séjour à chiffrer, jamais un montant : libellé, logement, nuits, personnes.']]);
  assert.deepEqual(errorsOf(lodging({ composition: { resourceId: 1 } }))[0][0], 'composition');
});

test('rule 46: a one-shot is a resource composition with no link, held closed — a lodging or a linked one is refused', () => {
  const out = rules.validateCampaign(bath({ slug: undefined, state: 'on_sale' }), deps({ oneShot: true }));
  assert.equal(out.ok, true);
  assert.deepEqual([out.value.oneShot, out.value.state, out.value.slug], [true, 'closed', null], 'never on sale, whatever was asked');
  assert.deepEqual(errorsOf(bath({ slug: 'x' }), { oneShot: true })[0][0], 'slug');
  assert.deepEqual(errorsOf(lodging(), { oneShot: true })[0][0], 'kind');
});

test('rule 4: a composition is judged alone for « Sur mesure » and the price preview', () => {
  assert.equal(rules.validateComposition({ resourceId: 1, band: 'evening', minutes: 120, options: [] }, { catalogue }).ok, true);
  const bad = rules.validateComposition({ resourceId: 1, band: 'evening', minutes: 90 }, { catalogue }, 'composition');
  assert.deepEqual(bad.errors.map((e) => e.field), ['composition.minutes']);
  assert.deepEqual(rules.validateComposition(null, { catalogue }, 'composition').errors.map((e) => e.field), ['composition']);
});
