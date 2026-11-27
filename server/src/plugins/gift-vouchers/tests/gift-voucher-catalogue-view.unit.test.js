// specs/gift-vouchers/gift-voucher-campaigns.md rule 4 — the catalogue as a composition sees it: every resource and option of the database with its tariff modes and whether it can be sold
// to a customer with no stay; when it cannot, the French reason. Built from the engine's articles: the hourly modes, rates and following-hours rates are the family's reading of the resource.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { requirePlugins } = require('../../sdk/testing');

if (!requirePlugins(['hourly-resources'])) return;

const fx = require('./campaignFixtures');
const { withdrawHourlyResources, liveHourlyResources } = require('../../../tests/hourlyResourcesFixture');

const ids = fx.seedCatalogue();
const archived = fx.option({ title: 'Ancienne option' });
fx.db.prepare("UPDATE options SET archivedAt = '2026-01-01' WHERE id = ?").run(archived); // date-literal-ok: the suite runs on its own clock, never the real today
const insurance = fx.option({ title: 'Assurance annulation', isCancellationInsurance: 1 });
const percent = fx.option({ title: 'Majoration', priceType: 'percent_of_stay' });
const card = fx.option({ title: 'Massage', showsPlanningCard: 1, price: 40 });
const progressive = fx.option({ title: 'Atelier', priceType: 'per_participant_progressive', optionProgressiveTiers: JSON.stringify([{ from: 1, price: 20 }]) });
const noRate = fx.resource({ name: 'Bain gratuit', price: 0, hourlyEveningRate: 0, hourlyExternalDayRate: 0, hourlyExternalEveningRate: 0, hourlyExternalWeekendDayRate: 0, hourlyExternalWeekendEveningRate: 0 });
const { api } = fx.openShop();
const view = api.catalogue;
const byRef = (ref) => view.element(ref);

test('the catalogue lists every resource and every option of the database, resources first', () => {
  const all = view.list();
  const count = (table) => fx.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
  assert.equal(all.length, count('resources') + count('options'));
  assert.deepEqual(all.filter((e) => e.kind === 'resource').map((e) => e.label), ['Bain gratuit', 'Bain nordique', 'Lit bébé', 'Sauna sans carte', 'Vélo'], 'the resources the database seeds come with the suite’s');
  assert.deepEqual(all.slice(0, count('resources')).map((e) => e.kind), Array(count('resources')).fill('resource'));
  assert.ok(all.every((e) => typeof e.sellable === 'boolean' && (e.sellable ? e.reason === null : typeof e.reason === 'string')));
  assert.deepEqual(view.element(`option:${ids.board}`), view.list().find((e) => e.articleRef === `option:${ids.board}`));
  assert.equal(view.element('option:9999'), null);
  assert.equal(view.element('nonsense'), null);
});

test('an hourly resource with a planning card offers two outside modes — rate, band hours, following-hours rate, slot, minimum — read from the engine’s family', () => {
  const bath = byRef(`resource:${ids.bath}`);
  assert.deepEqual([bath.hourly, bath.sellable, bath.reason, bath.priceType, bath.priceTypeLabel], [true, true, null, 'per_hour', 'Par heure']);
  assert.deepEqual(bath.modes.map(({ byPeriod, ...mode }) => mode), [
    {
      key: 'outside-day', band: 'day', label: 'Extérieur · journée', rateCents: 5000, from: '10:00', to: '19:00', lengthMinutes: 540, followingRateCents: 4500, followingText: 'puis 45 €/h', slotMinutes: 60, minimumMinutes: 60, sellable: true,
    },
    {
      key: 'outside-evening', band: 'evening', label: 'Extérieur · soirée', rateCents: 7000, from: '19:00', to: '22:00', lengthMinutes: 180, followingRateCents: 6300, followingText: 'puis 63 €/h', slotMinutes: 60, minimumMinutes: 60, sellable: true,
    },
  ]);
  // Each band's own figures per period (a screen that sells the weekend shows the weekend's): the fixture's weekend grid copies the week's.
  assert.deepEqual(bath.modes[0].byPeriod, {
    week: { rateCents: 5000, followingRateCents: 4500, followingText: 'puis 45 €/h', sellable: true },
    weekend: { rateCents: 5000, followingRateCents: 4500, followingText: 'puis 45 €/h', sellable: true },
  });
});

test('a resource with no evening has the day band only, to its closing time; a band with no external rate is a greyed mode with its reason', () => {
  const day = fx.resource({ name: 'Bain de jour', hourlyEveningStart: null, hourlyEveningRate: 0, hourlyExternalEveningRate: 0 });
  assert.deepEqual(byRef(`resource:${day}`).modes.map((m) => [m.band, m.from, m.to, m.rateCents]), [['day', '10:00', '22:00', 5000]]);
  const half = fx.resource({ name: 'Bain sans tarif', price: 0, hourlyExternalDayRate: 0, hourlyExternalWeekendDayRate: 0, hourlyExternalEveningRate: 80, hourlyEveningRate: 0 });
  const element = byRef(`resource:${half}`);
  assert.deepEqual(element.modes.map((m) => [m.band, m.sellable, m.reason || null]), [
    ['day', false, '« Bain sans tarif » n’a pas de tarif extérieur pour la journée.'], ['evening', true, null],
  ]);
  assert.equal(element.sellable, true, 'one band is enough');
  const none = byRef(`resource:${noRate}`);
  assert.deepEqual([none.sellable, none.reason], [false, '« Bain gratuit » n’a pas de tarif extérieur pour la journée.']);
});

test('the reasons an element is greyed, one by one: not sellable outside a stay, archived, a price that needs a stay, an insurance, no planning card, a resource that is not hourly', () => {
  const reason = (ref) => { const e = byRef(ref); return [e.sellable, e.reason]; };
  assert.deepEqual(reason(`option:${ids.hidden}`), [false, 'Pas marqué « vendable hors séjour » dans le catalogue.']);
  assert.deepEqual(reason(`option:${archived}`), [false, 'Archivée : retirée du catalogue.']);
  assert.deepEqual(reason(`option:${ids.perNight}`), [false, 'Le prix « par jour » a besoin d’un séjour : il ne se vend pas seul.']);
  assert.deepEqual(reason(`option:${percent}`), [false, 'Le prix « % du montant du séjour » a besoin d’un séjour : il ne se vend pas seul.']);
  assert.deepEqual(reason(`option:${insurance}`), [false, 'L’assurance annulation ne se vend qu’avec un séjour.']);
  assert.deepEqual(reason(`resource:${ids.sauna}`), [false, 'Ressource à l’heure sans carte de planning : une séance se réserve au planning.']);
  assert.deepEqual(reason(`resource:${ids.lodgingResource}`), [false, 'Seule une ressource à l’heure se compose dans un bon.']);
  fx.db.prepare('UPDATE resources SET sellableExternally = 0 WHERE id = ?').run(ids.sauna);
  assert.deepEqual(reason(`resource:${ids.sauna}`), [false, 'Pas marqué « vendable hors séjour » dans le catalogue.']);
});

test('the options sellable outside a stay keep their price type — a unit, a planning card (a per-person or progressive option reads the stay: rule 65)', () => {
  const ok = (ref) => { const e = byRef(ref); return [e.sellable, e.priceType, e.priceTypeLabel, e.hourly, e.modes]; };
  assert.deepEqual(ok(`option:${ids.board}`), [true, 'per_stay', 'Prix fixe', false, []]);
  assert.deepEqual(ok(`option:${ids.perPerson}`), [false, 'per_person', 'Par personne', false, []]);
  assert.deepEqual(ok(`option:${card}`), [true, 'per_stay', 'Prix fixe', false, []]);
  assert.deepEqual(ok(`option:${progressive}`), [false, 'per_participant_progressive', 'Dégressif participants', false, []]);
});

test('the hourly family is the only source of the modes: with its plugin withdrawn the bath is greyed, and a session cannot be judged', () => {
  withdrawHourlyResources();
  try {
    const bath = byRef(`resource:${ids.bath}`);
    assert.deepEqual([bath.sellable, bath.reason, bath.modes], [false, 'Les ressources à l’heure ne sont pas disponibles pour le moment.', []]);
    assert.equal(view.sessionRefusal({ resourceId: ids.bath, band: 'day', minutes: 60 }), 'Les ressources à l’heure ne sont pas disponibles pour le moment.');
  } finally {
    liveHourlyResources();
  }
  assert.equal(byRef(`resource:${ids.bath}`).sellable, true);
});

test('a session is judged by the engine’s own sentence — null when it can be sold', () => {
  assert.equal(view.sessionRefusal({ resourceId: ids.bath, band: 'day', minutes: 120 }), null);
  assert.equal(view.sessionRefusal({
    resourceId: ids.bath, band: 'day', minutes: 60, rankOffsetMinutes: 120,
  }), null);
  assert.equal(view.sessionRefusal({ resourceId: ids.bath, band: 'day', minutes: 30 }), '« Bain nordique » se réserve par tranches de 60 min : 30 min ne convient pas.');
  assert.equal(view.sessionRefusal({ resourceId: ids.bath, band: 'evening', minutes: 240 }), '« Bain nordique » : 4 h ne tiennent pas dans la soirée (19:00–22:00).');
  assert.equal(view.sessionRefusal({ resourceId: 99999, band: 'day', minutes: 60 }), 'Ressource inconnue.');
});

test('the operator’s route serves the same view', async () => {
  const server = await fx.serve(api);
  try {
    const res = await server.call('GET', '/api/gift-vouchers/catalogue');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.elements, JSON.parse(JSON.stringify(view.list())));
    const bath = res.body.elements.find((e) => e.id === ids.bath && e.kind === 'resource');
    assert.deepEqual(bath.modes.map((m) => m.followingText), ['puis 45 €/h', 'puis 63 €/h'], 'the operator’s sentence for the following hours');
  } finally {
    await server.close();
  }
});
