// Fixtures of the complement-excess suites (specs/pricing-components.md §3 rules 74 and 76): a stay whose money was collected
// on lines that the stay no longer holds, built the way a payment flip leaves it — the frozen split of the arrival complement,
// the contribs of removed paid lines — so the payment allocations name the lines and the poste split reads no audit log.
const OPTION = (id) => `opt:${id}`;
const RESOURCE = (id) => `res:${id}`;

function seedStay(db) {
  if (!db.prepare('SELECT 1 FROM properties WHERE id = 1').get()) {
    db.prepare("INSERT INTO properties (id, name, maxGuests, depositEnabled) VALUES (1, 'Gîte', 8, 0)").run();
    db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Camille', 'Revue')").run();
  }
}

/**
 * @param {object} spec
 * @param {Array<{key:string,bucket:'options'|'resources',cents:number}>} [spec.complement]  the lines the collected complement named
 * @param {Array<{key:string,bucket:'options'|'resources',solde:number}>} [spec.removed]       paid lines since removed (euros on the solde)
 * @param {boolean} [spec.balancePaid]
 * @param {string} [spec.startDate]
 * @returns {number} the stay id
 */
function stayWithCollectedLines(db, { complement = [], removed = [], balancePaid = true, startDate = '2099-06-01' } = {}) {
  seedStay(db);
  const cents = complement.reduce((sum, line) => sum + line.cents, 0);
  const split = complement.length ? JSON.stringify({
    taxCents: 0,
    accommodationCents: 0,
    optionsCents: complement.filter((l) => l.bucket === 'options').reduce((s, l) => s + l.cents, 0),
    resourcesCents: complement.filter((l) => l.bucket === 'resources').reduce((s, l) => s + l.cents, 0),
    lines: complement.map((l) => ({ key: l.key, label: 'Ligne', bucket: l.bucket, cents: l.cents })),
  }) : null;
  const removedJson = removed.length ? JSON.stringify(removed.map((l) => ({
    key: l.key, label: 'Ligne', bucket: l.bucket, acompteContribTtc: 0, soldeContribTtc: l.solde,
  }))) : null;
  const onSolde = removed.reduce((sum, line) => sum + line.solde, 0);
  const id = db.prepare(`INSERT INTO reservations (propertyId, clientId, startDate, endDate, platform, adults, finalPrice, balancePaid, balancePaidDate,
      balanceAmount, accommodationAcompteContribTtc, accommodationSoldeContribTtc, touristTaxAcompteContribTtc, touristTaxSoldeContribTtc,
      complementPaid, complementPaidDate, complementAmount, complementPaidSplit, removedLineContribs)
    VALUES (1, 1, ?, date(?, '+3 day'), 'direct', 2, 300, ?, ?, ?, 0, ?, 0, 0, ?, ?, ?, ?, ?)`)
    .run(startDate, startDate, balancePaid ? 1 : 0, balancePaid ? '2099-01-15' : null, balancePaid ? 300 + onSolde : 0, balancePaid ? 300 : null,
      complement.length ? 1 : 0, complement.length ? '2099-02-01' : null, cents / 100, split, removedJson).lastInsertRowid;
  return Number(id);
}

module.exports = { stayWithCollectedLines, OPTION, RESOURCE };
