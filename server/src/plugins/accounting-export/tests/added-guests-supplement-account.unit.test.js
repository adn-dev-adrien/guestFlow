// specs/platform-extra-guest-complement.md, reading of 2026-11-05 (audit R22-5) — the added guests' supplement is stay
// revenue from its first entry: on the accommodation account in every order and every mode, whatever a later party
// change does. Replays of the auditor's items125 and p7 probes.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  NO_ACOMPTE, PLATFORM, S, C, fiche, put, pay, journal, entry,
} = require('./journalFixture');

const ACCOMMODATION = '70600000';
const PRESTATION = '70600010';
const TAX = '46710000';

for (const mode of ['reversed', 'remitted', 'owner', 'ownReversed']) {
  test(`${mode}: complement before solde, 36,36 € on the accommodation from the first entry, unchanged when the solde comes`, async () => {
    const stay = fiche(NO_ACOMPTE, PLATFORM[mode], { platformGrossAmount: 600, depositDisabled: 1 });
    await put(stay, { adults: 3 });
    pay(stay.id, C);
    const first = entry(stay.id, 'complement');
    assert.equal(first[ACCOMMODATION], 36.36);
    assert.equal(first[PRESTATION], undefined);
    pay(stay.id, S);
    assert.deepEqual(entry(stay.id, 'complement'), first);
  });

  test(`${mode}: solde then complement books the same entry, and a later party change leaves it byte-identical`, async () => {
    const stay = fiche(NO_ACOMPTE, PLATFORM[mode], { platformGrossAmount: 600, depositDisabled: 1 });
    await put(stay, { adults: 3 });
    pay(stay.id, S, C);
    assert.equal(entry(stay.id, 'complement')[ACCOMMODATION], 36.36);
    // Accounts and amounts: the CSV's « Prix payé client » column reads the stay's total as it stands.
    const before = journal(stay.id);
    await put(stay, { adults: 4 });
    assert.deepEqual(journal(stay.id), before);
    await put(stay, { adults: 2 });
    assert.deepEqual(journal(stay.id), before);
  });
}

test('a complement row with no stored split (paid before the column) reads the supplement on the accommodation too', async () => {
  const { db } = require('./journalFixture');
  const stay = fiche(NO_ACOMPTE, PLATFORM.reversed, { platformGrossAmount: 600, depositDisabled: 1 });
  await put(stay, { adults: 3 });
  pay(stay.id, C);
  db.prepare('UPDATE reservations SET complementPaidSplit = NULL WHERE id = ?').run(stay.id);
  const legacy = entry(stay.id, 'complement');
  assert.equal(legacy[ACCOMMODATION], 36.36);
  assert.equal(legacy[TAX], 2.4);
});
