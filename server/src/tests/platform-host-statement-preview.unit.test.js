// specs/platform-host-statement-and-commission-vat.md rules 2, 5, 10-12 — what the fiche's quote and save say of a typed statement: the box by mode,
// the server's lines, the option lines it adjusts (shown by the preview, stored by the save), its one refusal.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  db, controller, respond, ADMIN, stayBody, inDays, seed, rowOf,
} = require('./ledgerFixture');

seed();
db.prepare("INSERT INTO options (id, title, priceType, price) VALUES (60, 'Ménage', 'per_stay', 80)").run();
db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, 60)').run();
db.prepare(`INSERT INTO platforms (name, collectsTouristTax, touristTaxRemittedByPlatform, commissionPercent) VALUES
  ('Airbnb', 1, 0, 15.5), ('GitesDeFrance', 1, 1, 10), ('Abracadaroom', 0, 0, 20)`).run();

const GDF = {
  platform: 'GitesDeFrance', startDate: inDays(200), endDate: inDays(202), platformGrossAmount: 864, platformOptionsAmount: 80,
  platformTouristTaxAmount: 36, platformPayoutAmount: 786, platformCommissionAmount: 78,
  selectedOptions: [{ optionId: 60, quantity: 1, inComplement: 0 }], options: [{ optionId: 60, quantity: 1, inComplement: 0 }], offeredOptionIds: [60],
};
const quote = async (over) => {
  const res = respond();
  await controller.calculatePrice({ body: stayBody({ ...GDF, ...over }), user: ADMIN }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  return res.body;
};

test('rule 2 — the preview shows the option line the save will store, and says so', async () => {
  const q = await quote();
  assert.equal(q.optionsTotal, 80);
  assert.equal(q.platformStatement.optionAdjustment.sentence, 'Ménage passé en payant (80,00 €) pour suivre le relevé.');
  assert.ok(q.platformStatement.lines.some((l) => /Ménage passé en payant/.test(l.label)));
});

test('rule 5 — the box is named by the platform\'s mode: kept, paid with the transfer, none when we collect it', async () => {
  assert.deepEqual((await quote()).platformStatement.box, {
    mode: 'platform', label: 'Taxe de séjour retenue par la plateforme',
    helper: 'Informatif : la plateforme la reverse à la commune, elle n’entre dans aucun prix.',
  });
  const reversed = await quote({ platform: 'Airbnb' });
  assert.equal(reversed.platformStatement.box.label, 'Taxe de séjour versée avec le virement');
  assert.equal((await quote({ platform: 'Abracadaroom' })).platformStatement.box, null);
  assert.equal((await quote({ platform: 'direct' })).platformStatement, null);
});

test('rule 10 — the closing line, and the box of an empty statement is still named', async () => {
  const q = await quote();
  assert.match(q.platformStatement.lines.find((l) => /identique au virement/.test(l.label)).label, /Montant hôte 864,00\s€ − commission 78,00\s€ = 786,00\s€/);
  const empty = await quote({
    platformGrossAmount: '', platformOptionsAmount: '', platformTouristTaxAmount: '', platformPayoutAmount: '', platformCommissionAmount: '', offeredOptionIds: [],
  });
  assert.deepEqual(empty.platformStatement.lines, []);
  assert.equal(empty.platformStatement.box.mode, 'platform');
});

test('rule 2 — the one refusal is on the field: answered by the preview, refused by the save', async () => {
  const q = await quote({ platformOptionsAmount: 30, offeredOptionIds: [] });
  assert.equal(q.platformStatement.refusals.platformOptionsAmount, 'Le relevé compte 30,00 € d’options, la fiche 80,00 € : retirer une option.');
  const res = respond();
  controller.create({ body: stayBody({ ...GDF, platformOptionsAmount: 30, offeredOptionIds: [], clientId: 1 }), user: ADMIN }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.field, 'platformOptionsAmount');
  assert.equal(res.body.code, 'PLATFORM_OPTIONS_UNSETTLED');
});

test('rules 1, 2 — the save stores the statement\'s options and the adjusted lines', () => {
  const res = respond();
  controller.create({ body: stayBody({ ...GDF, clientId: 1 }), user: ADMIN }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const row = rowOf(res.body.id);
  assert.equal(row.platformOptionsAmount, 80);
  assert.equal(row.platformGrossAmount, 864);
  const line = db.prepare('SELECT offered, totalPrice FROM reservation_options WHERE reservationId = ? AND optionId = 60').get(row.id);
  assert.equal(Number(line.offered || 0), 0);
  assert.equal(line.totalPrice, 80);
});
