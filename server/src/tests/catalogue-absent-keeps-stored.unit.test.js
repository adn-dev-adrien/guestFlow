// specs/options-resources-ux.md rule 33 and specs/settings-input-guards.md rules 61-62 (audit R25-DB-1, R25-I1, 2026-11-06) —
// through the real application: a key a catalogue save does not send keeps the stored value (options, resources,
// properties), and a property's option list names only real options of a real property.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('./inputShapeApp');

const dayAt = (n) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

let app;
let admin;
let property;

test.before(async () => {
  app = await startApp();
  admin = await app.login('admin@shape.test');
  const created = await app.call(admin, 'POST', '/api/properties', { name: 'Cabane', maxGuests: 2, maxBabies: 1, doubleBeds: 1, singleBeds: 0, pricePerNight: 80 });
  assert.equal(created.status, 200, created.text);
  property = created.json.id;
  const [season] = app.readDb('SELECT id FROM pricing_rules WHERE propertyId = ?', property);
  const priced = await app.call(admin, 'PUT', `/api/properties/${property}/pricing/${season.id}`, {
    label: 'Tarif', pricePerNight: 80, startDate: dayAt(1), endDate: dayAt(90), minNights: 1, color: '#112233', pricingMode: 'fixed',
  });
  assert.equal(priced.status, 200, priced.text);
});
test.after(async () => { if (app) await app.stop(); });

// The body client/src/pages/options/optionForm.js `optionPayload(formFromOption(GET /api/options/:id))` sends: every
// field of the side panel, and none of autoOptionType / autoEnabled / autoPricingMode / autoFullNightThreshold.
function panelPayload(item, edit = {}) {
  const toText = (v) => (v === null || v === undefined ? '' : String(v).replace('.', ','));
  const form = { ...item, price: toText(item.price ?? 0), propertyIds: (item.propertyIds || []).map(Number), ...edit };
  const prices = {};
  if (!['free', 'per_participant_progressive'].includes(form.priceType)) {
    Object.entries(form.propertyPrices || {}).forEach(([pid, v]) => { if (String(v ?? '').trim() !== '') prices[pid] = Number(String(v).replace(',', '.')); });
  }
  return {
    title: form.title,
    description: form.description || '',
    price: form.priceType === 'free' ? 0 : Number(String(form.price).replace(',', '.')),
    priceType: form.priceType || 'per_stay',
    optionProgressiveTiers: form.optionProgressiveTiers || [],
    propertyIds: form.propertyIds,
    propertyPrices: prices,
    propertyDefaults: {},
    countsAsBedLinen: Boolean(form.countsAsBedLinen),
    countsAsBathroomLinen: Boolean(form.countsAsBathroomLinen),
    linenIncludesSingle: Boolean(form.linenIncludesSingle),
    linenIncludesDouble: Boolean(form.linenIncludesDouble),
    linenIncludesBaby: Boolean(form.linenIncludesBaby),
    towelLargePerPerson: Number(form.towelLargePerPerson),
    towelMediumPerPerson: Number(form.towelMediumPerPerson),
    towelSmallPerPerson: Number(form.towelSmallPerPerson),
    countsAsBathMat: Boolean(form.countsAsBathMat),
    propertyBathMats: {},
    displayToClient: Boolean(form.displayToClient),
    breakfastTime: form.breakfastTime || '09:00',
    breakfastNotifyLeadMinutes: form.breakfastNotifyLeadMinutes,
    showsPlanningCard: Boolean(form.showsPlanningCard),
    cardRepeat: form.cardRepeat === 'multiple_per_day' ? 'multiple_per_day' : 'once_per_day',
    planningCardTimes: ['09:00'],
    category: form.category || '',
    alwaysVisible: Boolean(form.alwaysVisible),
    isCancellationInsurance: Boolean(form.isCancellationInsurance),
  };
}

const optionRow = (id) => app.readDb('SELECT autoOptionType, autoEnabled, autoPricingMode, autoFullNightThreshold, price FROM options WHERE id = ?', id)[0];
const savePanel = async (id, edit) => {
  const stored = await app.call(admin, 'GET', `/api/options/${id}`);
  const res = await app.call(admin, 'PUT', `/api/options/${id}`, panelPayload(stored.json, edit));
  assert.equal(res.status, 200, res.text);
};
const cotLines = async () => {
  const res = await app.call(admin, 'POST', '/api/reservations/calculate-price', {
    propertyId: property, startDate: dayAt(20), endDate: dayAt(23), checkInTime: '16:00', checkOutTime: '10:00', platform: 'direct',
    adults: 2, children: 0, teens: 0, babies: 1, babyBeds: 1, selectedOptions: [], customOptions: [], selectedResources: [], discountPercent: 0, customPrice: '',
  });
  assert.equal(res.status, 200, res.text);
  return (res.json.optionLines || []).filter((l) => l.title === 'Lit bébé').map((l) => l.totalPrice);
};

test('R25-DB-1: pricing « Lit bébé » from the side panel keeps it engine-billed, at every later save', async () => {
  const [cot] = app.readDb("SELECT id FROM options WHERE autoOptionType = 'baby_bed'");
  await savePanel(cot.id, { propertyIds: [property], price: '5' });
  assert.deepEqual(optionRow(cot.id), { autoOptionType: 'baby_bed', autoEnabled: 1, autoPricingMode: 'fixed', autoFullNightThreshold: null, price: 5 });
  assert.deepEqual(await cotLines(), [5]);
  await savePanel(cot.id, { price: '8' });
  assert.deepEqual(optionRow(cot.id), { autoOptionType: 'baby_bed', autoEnabled: 1, autoPricingMode: 'fixed', autoFullNightThreshold: null, price: 8 });
  assert.deepEqual(await cotLines(), [8]);
});

test('R25-DB-1: the side panel\'s payload on the early-arrival option keeps its mode and threshold', async () => {
  const [early] = app.readDb(`SELECT o.id FROM options o JOIN property_options po ON po.optionId = o.id
    WHERE o.autoOptionType = 'early_check_in' AND po.propertyId = ?`, property);
  const before = optionRow(early.id);
  assert.deepEqual([before.autoEnabled, before.autoPricingMode, before.autoFullNightThreshold], [1, 'proportional', '10:00']);
  await savePanel(early.id, {});
  assert.deepEqual(optionRow(early.id), before);
});

test('R25-DB-1: the property page still switches an early arrival off and back, mode and threshold included', async () => {
  const [early] = app.readDb(`SELECT o.id, o.title, o.description FROM options o JOIN property_options po ON po.optionId = o.id
    WHERE o.autoOptionType = 'early_check_in' AND po.propertyId = ?`, property);
  const put = (over) => app.call(admin, 'PUT', `/api/options/${early.id}`, {
    title: early.title, description: early.description, priceType: 'per_stay', price: 20, propertyIds: [property], autoOptionType: 'early_check_in', ...over,
  });
  assert.equal((await put({ autoEnabled: false, autoPricingMode: 'fixed', autoFullNightThreshold: '09:00' })).status, 200);
  assert.deepEqual(optionRow(early.id), { autoOptionType: 'early_check_in', autoEnabled: 0, autoPricingMode: 'fixed', autoFullNightThreshold: '09:00', price: 20 });
  assert.equal((await put({ autoEnabled: true, autoPricingMode: 'proportional', autoFullNightThreshold: '10:00' })).status, 200);
  assert.deepEqual(optionRow(early.id), { autoOptionType: 'early_check_in', autoEnabled: 1, autoPricingMode: 'proportional', autoFullNightThreshold: '10:00', price: 20 });
});

test('R25-DB-1 sweep: an option save naming only its title keeps every other column and its logements', async () => {
  const created = await app.call(admin, 'POST', '/api/options', {
    title: 'Panier', description: 'Fruits', priceType: 'percent_of_stay', price: 12.5, propertyIds: [property],
    optionProgressiveTiers: [], countsAsBedLinen: true, countsAsBathroomLinen: true, linenIncludesSingle: false, linenIncludesDouble: false,
    linenIncludesBaby: false, towelLargePerPerson: 2, towelMediumPerPerson: 3, towelSmallPerPerson: 0, propertyPrices: { [property]: 9 },
  });
  assert.equal(created.status, 200, created.text);
  const id = created.json.id;
  const columns = 'title, description, priceType, price, optionProgressiveTiers, autoOptionType, autoEnabled, autoPricingMode, autoFullNightThreshold, countsAsBedLinen, countsAsBathroomLinen, linenIncludesSingle, linenIncludesDouble, linenIncludesBaby, towelLargePerPerson, towelMediumPerPerson, towelSmallPerPerson';
  const snapshot = () => ({
    row: app.readDb(`SELECT ${columns} FROM options WHERE id = ?`, id)[0],
    links: app.readDb('SELECT propertyId FROM property_options WHERE optionId = ?', id),
    prices: app.readDb('SELECT propertyId, price FROM property_option_prices WHERE optionId = ?', id),
  });
  const before = snapshot();
  const res = await app.call(admin, 'PUT', `/api/options/${id}`, { title: 'Panier' });
  assert.equal(res.status, 200, res.text);
  assert.deepEqual(snapshot(), before);
  const refused = await app.call(admin, 'PUT', `/api/options/${id}`, { title: 'Panier', price: 150 });
  assert.equal(refused.status, 422, 'a percentage stays bounded when its type is not sent');
  assert.deepEqual(snapshot(), before);
});

test('R25-DB-1 sweep: a resource save naming only its name and stock keeps every other column and its logements', async () => {
  const created = await app.call(admin, 'POST', '/api/resources', {
    name: 'Velo', quantity: 3, price: 7, priceType: 'per_night', propertyIds: [property], propertyPricing: { [property]: { price: 4, freeMinutes: 0 } },
    note: 'Casque fourni', emailBookedText: 'Vélo prêt', emailBookedTextEn: 'Bike ready', openTime: '09:00', closeTime: '19:00', openDays: '[1,2,3]',
    slotDuration: 30, minimumUsageMinutes: 60, turnoverMinutes: 15,
  });
  assert.equal(created.status, 200, created.text);
  const id = created.json.id;
  const snapshot = () => ({
    row: app.readDb('SELECT * FROM resources WHERE id = ?', id).map(({ updatedAt, ...rest }) => rest)[0],
    links: app.readDb('SELECT propertyId FROM resource_properties WHERE resourceId = ?', id),
    prices: app.readDb('SELECT propertyId, price, freeMinutes FROM property_resource_prices WHERE resourceId = ?', id),
  });
  const before = snapshot();
  const res = await app.call(admin, 'PUT', `/api/resources/${id}`, { name: 'Velo', quantity: 3 });
  assert.equal(res.status, 200, res.text);
  assert.deepEqual(snapshot(), before);
});

test('R25-DB-1 sweep: a property save naming only its name keeps every other column', async () => {
  const columns = 'name, maxGuests, maxBabies, basePriceIncludedGuests, extraGuestPrice, singleBeds, doubleBeds, depositPercent, depositEnabled, defaultCheckIn, defaultCheckOut, cleaningHours, touristTaxPerDayPerPerson, touristTaxMode, touristTaxPercentage, touristTaxDepartmentPercentage, touristTaxFixedAmount';
  const set = await app.call(admin, 'PUT', `/api/properties/${property}`, {
    name: 'Cabane', maxGuests: 2, maxBabies: 1, doubleBeds: 1, singleBeds: 0, basePriceIncludedGuests: 1, extraGuestPrice: 6,
    depositEnabled: true, depositPercent: 40, defaultCheckIn: '17:00', defaultCheckOut: '11:00', cleaningHours: 2,
    touristTaxMode: 'per_day_per_person', touristTaxPerDayPerPerson: 1.2,
  });
  assert.equal(set.status, 200, set.text);
  const snapshot = () => app.readDb(`SELECT ${columns} FROM properties WHERE id = ?`, property)[0];
  const before = snapshot();
  const res = await app.call(admin, 'PUT', `/api/properties/${property}`, { name: 'Cabane' });
  assert.equal(res.status, 200, res.text);
  assert.deepEqual(snapshot(), before);
  const noName = await app.call(admin, 'PUT', `/api/properties/${property}`, { cleaningHours: 4 });
  assert.equal(noName.status, 200, noName.text);
  assert.deepEqual(snapshot(), { ...before, cleaningHours: 4 });
});

test('R25-I1: a property\'s option list naming an unknown option, or an unknown property, is refused 400, nothing written', async () => {
  const [option] = app.readDb("SELECT id FROM options WHERE autoOptionType = 'baby_bed'");
  const links = () => app.readDb('SELECT optionId FROM property_options WHERE propertyId = ? ORDER BY optionId', property);
  const before = links();
  assert.ok(before.length > 0);
  for (const [url, body] of [
    [`/api/properties/${property}/options`, { optionIds: [option.id, 999999] }],
    ['/api/properties/999999/options', { optionIds: [] }],
    ['/api/properties/999999/options', { optionIds: [option.id] }],
  ]) {
    const mark = app.logMark();
    const res = await app.call(admin, 'PUT', url, body);
    assert.equal(res.status, 400, `${url} ${JSON.stringify(body)} → ${res.status}`);
    assert.equal(res.json.error, 'Liste d’options invalide.');
    assert.doesNotMatch(app.logSince(mark), /\[unhandled\]/);
    assert.deepEqual(links(), before);
  }
  const ok = await app.call(admin, 'PUT', `/api/properties/${property}/options`, { optionIds: before.map((r) => r.optionId) });
  assert.equal(ok.status, 200, ok.text);
  assert.deepEqual(links(), before);
});

test('R25 N2: a property\'s option list naming an option twice is refused 400, nothing written', async () => {
  const [option] = app.readDb("SELECT id FROM options WHERE autoOptionType = 'baby_bed'");
  const links = () => app.readDb('SELECT optionId FROM property_options WHERE propertyId = ? ORDER BY optionId', property);
  const before = links();
  for (const optionIds of [[option.id, option.id], [option.id, String(option.id)]]) {
    const mark = app.logMark();
    const res = await app.call(admin, 'PUT', `/api/properties/${property}/options`, { optionIds });
    assert.equal(res.status, 400, `${JSON.stringify(optionIds)} → ${res.status} ${res.text}`);
    assert.equal(res.json.error, 'Liste d’options invalide.');
    assert.doesNotMatch(app.logSince(mark), /\[unhandled\]/);
    assert.deepEqual(links(), before);
  }
});

test('R25 N4: a panel save naming « Inclus » on « Lit bébé » leaves no default row (the stored autoEnabled decides)', async () => {
  const [cot] = app.readDb("SELECT id FROM options WHERE autoOptionType = 'baby_bed'");
  const stored = await app.call(admin, 'GET', `/api/options/${cot.id}`);
  const body = { ...panelPayload(stored.json, { propertyIds: [property] }), propertyDefaults: { [property]: { default: true, offered: false } } };
  assert.equal(body.autoEnabled, undefined);
  const res = await app.call(admin, 'PUT', `/api/options/${cot.id}`, body);
  assert.equal(res.status, 200, res.text);
  assert.equal(optionRow(cot.id).autoEnabled, 1);
  assert.deepEqual(app.readDb('SELECT propertyId FROM property_option_defaults WHERE optionId = ?', cot.id), []);
});

test('R25 N1 (options-resources-ux rule 34): a price type sent without its price judges the stored price under that type', async () => {
  const created = await app.call(admin, 'POST', '/api/options', {
    title: 'Navette', description: '', priceType: 'per_stay', price: 115, propertyIds: [property], propertyPrices: {},
  });
  assert.equal(created.status, 200, created.text);
  const id = created.json.id;
  const row = () => app.readDb('SELECT priceType, price FROM options WHERE id = ?', id)[0];
  const refused = await app.call(admin, 'PUT', `/api/options/${id}`, { title: 'Navette', priceType: 'percent_of_stay' });
  assert.equal(refused.status, 422, refused.text);
  assert.deepEqual(refused.json.details, [{ field: 'price', message: '100 % max' }]);
  assert.deepEqual(row(), { priceType: 'per_stay', price: 115 });
  const perNight = await app.call(admin, 'PUT', `/api/options/${id}`, { title: 'Navette', priceType: 'per_night' });
  assert.equal(perNight.status, 200, perNight.text);
  assert.deepEqual(row(), { priceType: 'per_night', price: 115 });

  const scoped = await app.call(admin, 'POST', '/api/options', {
    title: 'Ménage', description: '', priceType: 'per_stay', price: 10, propertyIds: [property], propertyPrices: { [property]: 140 },
  });
  assert.equal(scoped.status, 200, scoped.text);
  const rowPrice = await app.call(admin, 'PUT', `/api/options/${scoped.json.id}`, { title: 'Ménage', priceType: 'percent_of_stay' });
  assert.equal(rowPrice.status, 422, rowPrice.text);
  assert.deepEqual(rowPrice.json.details, [{ field: `propertyPrices.${property}`, message: '100 % max' }]);
  const sentBack = await app.call(admin, 'PUT', `/api/options/${scoped.json.id}`, { title: 'Ménage', priceType: 'percent_of_stay', price: 10, propertyPrices: { [property]: 20 } });
  assert.equal(sentBack.status, 200, sentBack.text);
});
