const test = require('node:test');
const assert = require('node:assert/strict');

// specs/mobile-dashboard-exercise-cash.md §3.C — « Encaissé » / « Reste à encaisser » on the window's stays,
// their month-grouped details and the cash projection. The clock is pinned on 2026-11-05.
test.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 10, 5, 11) });
const { freshDb, insert, sum } = require('./financeDashboardFixture');

const Y = 2026;

function seed(db) {
  // Direct, acompte in, solde due next month.
  insert(db, {
    startDate: `${Y}-12-10`, endDate: `${Y}-12-14`, createdAt: `${Y}-09-01 10:00:00`,
    depositAmount: 100, depositPaid: 1, depositPaidDate: `${Y}-09-02`, depositDueDate: `${Y}-09-02`,
    balanceAmount: 400, balanceDueDate: `${Y}-11-26`,
  });
  // Platform stay over, payout never received: late (departure + 10 days < today).
  insert(db, { propertyId: 2, platform: 'Airbnb', startDate: `${Y}-09-01`, endDate: `${Y}-09-05`, balanceAmount: 500, platformCommissionAmount: 75 });
  // Platform stay still ahead: payout expected after the exercise ends.
  insert(db, { propertyId: 2, platform: 'Airbnb', startDate: `${Y}-12-27`, endDate: `${Y}-12-31`, balanceAmount: 300, platformCommissionAmount: 30 });
  // Fully collected stay, one complement still to come on arrival.
  insert(db, {
    propertyId: 3, startDate: `${Y}-12-20`, endDate: `${Y}-12-22`, createdAt: `${Y}-06-01 10:00:00`,
    depositAmount: 50, depositPaid: 1, depositPaidDate: `${Y}-06-02`, balanceAmount: 150, balancePaid: 1, balancePaidDate: `${Y}-11-01`,
    complementAmount: 20,
  });
}

test('rules 10-12 — « Encaissé » + « Reste à encaisser » = the window\'s revenue, to the cent', () => {
  const { db, dashboard } = freshDb();
  seed(db);
  const d = dashboard.getDashboard({ fiscalYear: Y }).data;
  assert.equal(d.hero.revenue, 100 + 400 + 425 + 270 + 200 + 20 - 0);
  assert.equal(Math.round((d.tiles.collected.amount + d.tiles.toCollect.amount) * 100), Math.round(d.hero.revenue * 100));
  assert.equal(d.tiles.collected.amount, 100 + 150 + 50);
});

test('rule 11 — « Reste à encaisser » counts the window\'s stays, past and future, with the next date and the late part', () => {
  const { db, dashboard } = freshDb();
  seed(db);
  const t = dashboard.getDashboard({ fiscalYear: Y }).data.tiles.toCollect;
  assert.equal(t.amount, 400 + 425 + 270 + 20);
  assert.equal(t.payments, 4);
  assert.deepEqual(t.late, { amount: 425, payments: 1 });
  assert.equal(t.nextDate, `${Y}-11-26`);
  assert.equal(t.nextDateLabel, '26 nov. 2026');
});

test('rule 11 — an older exercise\'s unpaid stay is not counted in this exercise', () => {
  const { db, dashboard } = freshDb();
  seed(db);
  insert(db, { startDate: `${Y - 2}-05-01`, endDate: `${Y - 2}-05-03`, balanceAmount: 200, balanceDueDate: `${Y - 2}-04-01` });
  assert.equal(dashboard.getDashboard({ fiscalYear: Y }).data.tiles.toCollect.amount, 1115);
  assert.equal(dashboard.getDashboard({ fiscalYear: Y - 2 }).data.tiles.toCollect.amount, 200);
});

test('rule 12 — the invariant holds on a platform penalty, a caisse-interne bucket and a refund', () => {
  const { db, dashboard } = freshDb();
  seed(db);
  insert(db, { startDate: `${Y}-10-01`, endDate: `${Y}-10-03`, balanceAmount: 300, balancePaid: 1, balancePaidDate: `${Y}-10-04`, balancePaidCash: 1, complementAmount: 40 });
  const id = insert(db, { startDate: `${Y}-10-10`, endDate: `${Y}-10-12`, balanceAmount: 250, balancePaid: 1, balancePaidDate: `${Y}-10-13` });
  db.prepare("INSERT INTO reservation_refunds (reservationId, refundDate, method, totalTtc) VALUES (?, ?, 'transfer', 60)").run(id, `${Y}-10-20`);
  const d = dashboard.getDashboard({ fiscalYear: Y }).data;
  assert.equal(Math.round((d.tiles.collected.amount + d.tiles.toCollect.amount) * 100), Math.round(d.hero.revenue * 100));
});

test('rule 20 — the logement filter applies to the tiles, the details and the projection', () => {
  const { db, dashboard } = freshDb();
  seed(db);
  const d = dashboard.getDashboard({ fiscalYear: Y, propertyId: 2 }).data;
  assert.equal(d.tiles.toCollect.amount, 425 + 270);
  assert.equal(d.tiles.collected.amount, 0);
  assert.equal(d.cashProjection.total, 695);
  assert.deepEqual(dashboard.getDashboardDetail('toCollect', { fiscalYear: Y, propertyId: 2 }).data.rows.map((r) => r.propertyName), ['Tente', 'Tente']);
});

test('rule 16 — the detail lists one line per payment, late first, then by month and date, totals equal the tile', () => {
  const { db, dashboard } = freshDb();
  seed(db);
  const tile = dashboard.getDashboard({ fiscalYear: Y }).data.tiles.toCollect;
  const d = dashboard.getDashboardDetail('toCollect', { fiscalYear: Y }).data;
  assert.deepEqual(d.groups.map((g) => [g.key, g.label, g.total]), [
    ['late', 'En retard', 425], [`${Y}-11`, 'Novembre 2026', 400], [`${Y}-12`, 'Décembre 2026', 20], [`${Y + 1}-01`, 'Janvier 2027', 270],
  ]);
  assert.deepEqual(d.rows.map((r) => [r.date, r.label, r.amount, r.late]), [
    [`${Y}-09-15`, 'Versement Airbnb', 425, true], [`${Y}-11-26`, 'Solde', 400, false],
    [`${Y}-12-20`, 'Complément d\'arrivée', 20, false], [`${Y + 1}-01-10`, 'Versement Airbnb', 270, false],
  ]);
  assert.deepEqual(d.totals, { amount: tile.amount, payments: tile.payments });
  assert.equal(sum(d.groups, 'total'), tile.amount);
  assert.ok(d.rows.every((r) => r.reservationId && r.clientName === 'Jean Dupont'));
});

test('rule 17 — the « Encaissé » detail is grouped by month, most recent first, and adds up to the tile', () => {
  const { db, dashboard } = freshDb();
  seed(db);
  const tile = dashboard.getDashboard({ fiscalYear: Y }).data.tiles.collected.amount;
  const d = dashboard.getDashboardDetail('collected', { fiscalYear: Y }).data;
  assert.deepEqual(d.groups.map((g) => [g.key, g.total]), [[`${Y}-11`, 150], [`${Y}-09`, 100], [`${Y}-06`, 50]]);
  assert.equal(d.totals.amount, tile);
  assert.equal(sum(d.groups, 'total'), tile);
  assert.ok(d.rows.every((r) => typeof r.dateLabel === 'string'));
});

test('rule 18 — the projection ends on the revenue, with the late part on today and the payout after the end', () => {
  const { db, dashboard } = freshDb();
  seed(db);
  const d = dashboard.getDashboard({ fiscalYear: Y }).data;
  const p = d.cashProjection;
  assert.equal(p.total, d.hero.revenue);
  assert.equal(p.today, `${Y}-11-05`);
  assert.equal(p.lateAmount, 425);
  assert.equal(p.months.find((m) => m.key === 'after').expected, 270);
  assert.equal(p.months.find((m) => m.key === `${Y}-11`).expected, 425 + 400);
  assert.equal(p.months.find((m) => m.key === `${Y}-09`).received, 100);
});

test('edge — an exercise with no stay has empty tiles and an empty projection', () => {
  const { dashboard } = freshDb();
  const d = dashboard.getDashboard({ fiscalYear: Y }).data;
  assert.equal(d.tiles.toCollect.amount, 0);
  assert.equal(d.tiles.toCollect.payments, 0);
  assert.equal(d.tiles.toCollect.nextDate, null);
  assert.equal(d.cashProjection.empty, true);
});

test('edge — a platform stay with nothing entered has no expected payment', () => {
  const { db, dashboard } = freshDb();
  insert(db, { platform: 'Booking', startDate: `${Y}-08-01`, endDate: `${Y}-08-03` });
  assert.equal(dashboard.getDashboard({ fiscalYear: Y }).data.tiles.toCollect.payments, 0);
});

test('rules 15-16 — money whose date is past but not late goes in « À recevoir maintenant », after « En retard », and is counted on today', () => {
  const { db, dashboard } = freshDb();
  seed(db);
  insert(db, { startDate: `${Y}-12-01`, endDate: `${Y}-12-03`, createdAt: `${Y}-08-01 10:00:00`, depositAmount: 90 });
  const d = dashboard.getDashboardDetail('toCollect', { fiscalYear: Y }).data;
  assert.deepEqual(d.groups.map((g) => g.key).slice(0, 3), ['late', 'dueNow', `${Y}-11`]);
  const dueNow = d.groups[1];
  assert.deepEqual([dueNow.label, dueNow.total, dueNow.rows[0].label, dueNow.rows[0].late], ['À recevoir maintenant', 90, 'Acompte', false]);
  const tile = dashboard.getDashboard({ fiscalYear: Y }).data.tiles.toCollect;
  assert.deepEqual(tile.late, { amount: 425, payments: 1 });
  assert.equal(tile.amount, 400 + 425 + 270 + 20 + 90);
  const today = dashboard.getDashboard({ fiscalYear: Y }).data.cashProjection.daily.find((p) => p.date === `${Y}-11-05`);
  assert.equal(today.expected, 425 + 90);
});

test('a past exercise still owed: the end answer is the revenue, the marker is not drawn', () => {
  const { db, dashboard } = freshDb();
  insert(db, { startDate: `${Y - 2}-05-01`, endDate: `${Y - 2}-05-03`, balanceAmount: 200, balanceDueDate: `${Y - 2}-04-01` });
  const p = dashboard.getDashboard({ fiscalYear: Y - 2 }).data.cashProjection;
  assert.equal(p.todayMonth, null);
  const last = p.daily[p.daily.length - 1];
  assert.deepEqual([last.date, last.cumulative, last.expectedCumulative], [`${Y - 2}-12-31`, 200, 200]);
});
