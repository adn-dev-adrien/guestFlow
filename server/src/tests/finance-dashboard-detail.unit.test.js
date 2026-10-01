const test = require('node:test');
const assert = require('node:assert/strict');

// specs/finance-dashboard-redesign.md rules 13-14 — the table behind each tile: every total equals its
// tile, « Encaissé » is a dated ledger that adds up to Σ comptaCollected, « À encaisser » carries the
// « Arrivées d'ici le » projection, channels show what each one cost.
const { freshDb, insert, sum, THIS_YEAR } = require('./financeDashboardFixture');

const Y = THIS_YEAR - 1;

function seed(db) {
  // Direct: acompte paid by bank, solde paid in caisse interne (off the books), a mid-stay note.
  const a = insert(db, {
    startDate: `${Y}-03-10`, endDate: `${Y}-03-13`,
    depositAmount: 100, depositPaid: 1, depositPaidDate: `${Y}-02-01`,
    balanceAmount: 200, balancePaid: 1, balancePaidDate: `${Y}-03-10`, balancePaidCash: 1,
    midStaySettledNotes: JSON.stringify([{ id: 'n1', paidDate: `${Y}-03-11`, paidCash: 0, total: 30, lines: [] }]),
  });
  // Platform: solde paid by the platform, net of its commission; later partly refunded.
  const b = insert(db, {
    propertyId: 2, platform: 'Airbnb', startDate: `${Y}-07-01`, endDate: `${Y}-07-05`,
    balanceAmount: 500, balancePaid: 1, balancePaidDate: `${Y}-07-02`, platformCommissionAmount: 75,
  });
  db.prepare("INSERT INTO reservation_refunds (reservationId, refundDate, method, totalTtc) VALUES (?, ?, 'transfer', 40), (?, ?, 'internal', 999)").run(b, `${Y}-07-10`, b, `${Y}-07-11`);
  // Website booking with its requests.
  insert(db, { requestOrigin: 'public', attributionChannel: 'social', startDate: `${Y}-08-01`, endDate: `${Y}-08-03`, balanceAmount: 400 });
  insert(db, { kind: 'devis', requestOrigin: 'public', attributionChannel: 'social', devisStatus: 'converted', createdAt: `${Y}-06-01 10:00:00` });
  insert(db, { kind: 'devis', requestOrigin: 'public', attributionChannel: 'social', devisStatus: 'draft', createdAt: `${Y}-06-02 10:00:00` });
  return { a, b };
}

test('rule 13 — « Encaissé » lists each payment, dated, and adds up to the tile', () => {
  const { db, dashboard } = freshDb();
  seed(db);
  const tile = dashboard.getDashboard({ fiscalYear: Y }).data.tiles.collected.amount;
  const { rows, totals } = dashboard.getDashboardDetail('collected', { fiscalYear: Y }).data;
  assert.equal(totals.amount, tile);
  assert.equal(sum(rows, 'amount'), tile);
  assert.deepEqual(rows.map((r) => [r.date, r.label, r.amount]), [
    [`${Y}-07-10`, 'Remboursement', -40],
    [`${Y}-07-02`, 'Versement plateforme', 425],
    [`${Y}-03-11`, 'Note en séjour', 30],
    [`${Y}-02-01`, 'Acompte', 100],
  ]);
});

test('rule 13 — « À encaisser » is today\'s pending list with the « Arrivées d\'ici le » projection', () => {
  const { db, dashboard } = freshDb();
  seed(db);
  insert(db, { startDate: `${Y}-05-01`, endDate: `${Y}-05-03`, balanceAmount: 250 });
  const d = dashboard.getDashboardDetail('toCollect', { fiscalYear: Y, until: `${Y}-12-31` }).data;
  assert.ok(d.rows.some((r) => r.balanceAmount === 250));
  assert.equal(d.totals.remainingToPay, dashboard.getDashboard({ fiscalYear: Y }).data.tiles.toCollect.amount);
  assert.equal(d.projection.until, `${Y}-12-31`);
  assert.equal(d.projection.pending, Math.round((d.projection.total - d.projection.collected) * 100) / 100);
});

test('rule 13 — « Réservations »: the window\'s stays, or every upcoming one', () => {
  const { db, dashboard } = freshDb();
  seed(db);
  const w = dashboard.getDashboardDetail('stays', { fiscalYear: Y }).data;
  assert.equal(w.scope, 'window');
  assert.equal(w.rows.length, 3);
  assert.equal(w.totals.totalSejour, dashboard.getDashboard({ fiscalYear: Y }).data.hero.revenue);
  const up = dashboard.getDashboardDetail('stays', { fiscalYear: Y, scope: 'upcoming' }).data;
  assert.equal(up.scope, 'upcoming');
  assert.equal(up.rows.length, 0);
});

test('rule 13 — « Logements »: nights, occupancy, revenue per night, RevPAR, TTC and HT per logement', () => {
  const { db, dashboard } = freshDb();
  seed(db);
  const d = dashboard.getDashboardDetail('properties', { fiscalYear: Y }).data;
  assert.equal(sum(d.rows, 'revenue'), d.totals.revenue);
  const lodge = d.rows.find((r) => r.propertyId === 2);
  assert.equal(lodge.nights, 4);
  assert.equal(lodge.revenuePerNight, 96.25);
  assert.equal(d.rows.find((r) => r.propertyId === 3).occupancy, null);
});

test('rule 13 — « Canaux »: website by source with requests, platforms with their commission, empty ones hidden', () => {
  const { db, dashboard } = freshDb();
  seed(db);
  const d = dashboard.getDashboardDetail('channels', { fiscalYear: Y }).data;
  const social = d.site.rows.find((r) => r.key === 'site:social');
  assert.equal(social.requests, 2);
  assert.equal(social.conversionRate, 50);
  const airbnb = d.others.find((r) => r.label === 'Airbnb');
  assert.equal(airbnb.commission, 75);
  assert.equal(airbnb.gross, airbnb.revenue + 75);
  assert.ok(d.others.every((r) => r.reservations > 0));
  assert.equal(d.total.commission, 75);
  assert.equal(d.total.commission, dashboard.getDashboard({ fiscalYear: Y }).data.tiles.channels.commission);
});

test('rule 13 — an unknown tile is a 404, an invalid window a 400', () => {
  const { dashboard } = freshDb();
  assert.equal(dashboard.getDashboardDetail('nope', {}).status, 404);
  assert.equal(dashboard.getDashboardDetail('stays', { period: 'custom', from: 'x' }).status, 400);
});
