// specs/payment-link-lifecycle.md rules 43 and 66 — the dashboard card « Dates prises »: one row per stay told (or
// not) that its dates were taken, shaped by the server (client, logement, dates, the stay that took them, notice
// sent or not and why), « Vu » acknowledges it; a stay over, gone or acknowledged leaves the card. Made-up stays.

const test = require('node:test');
const assert = require('node:assert/strict');

const { db, inDays, freshProperty, addStay } = require('./datesTakenFixture');
const { buildController } = require('../controllers/dashboardController');
const { CORE_SUMMARIES } = require('../utils/dashboardAttention');
const { coreAttentionSources } = require('../routes/dashboard');

function res() {
  return { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(p) { this.body = p; return this; } };
}

const ctl = buildController();
const list = () => { const r = res(); ctl.datesTaken({ query: {} }, r); return r.body; };

function told(stayId, takenById, { status = 'sent', reason = null, ago = 0 } = {}) {
  db.prepare(`INSERT INTO dates_taken_notices (reservationId, takenByReservationId, noticeStatus, noticeReason, createdAt)
              VALUES (?, ?, ?, ?, datetime('now', ?))`).run(stayId, takenById, status, reason, `-${ago} minutes`);
  return Number(db.prepare('SELECT id FROM dates_taken_notices WHERE reservationId = ?').get(stayId).id);
}

test('rule 43 — one row per stay, ready to render: who, where, when, taken by whom, told or not', () => {
  const propertyId = freshProperty();
  const devis = addStay({ propertyId, kind: 'devis', start: inDays(20), end: inDays(24) });
  const unpaid = addStay({ propertyId, start: inDays(30), end: inDays(33) });
  const taker = addStay({ propertyId, platform: 'Booking', start: inDays(21), end: inDays(23) });
  told(devis, taker, { ago: 5 });
  told(unpaid, taker, { status: 'not-sent', reason: 'no-email', ago: 1 });
  const { alerts } = list();
  const mine = alerts.filter((a) => [devis, unpaid].includes(a.reservationId));
  assert.deepEqual(mine.map((a) => a.reservationId), [unpaid, devis], 'newest first');
  const [notTold, sent] = mine;
  assert.equal(sent.url, `/reservations/${devis}`);
  assert.match(sent.title, new RegExp(`^Lina Exemple · Logement ${propertyId} · \\d\\d/\\d\\d → \\d\\d/\\d\\d$`));
  assert.deepEqual(sent.notice, { sent: true, label: 'client prévenu' });
  assert.equal(sent.detail, null);
  assert.deepEqual(sent.takenBy, { id: taker, url: `/reservations/${taker}`, label: `Prises par la réservation T${taker} · Lina Exemple` });
  assert.deepEqual(notTold.notice, { sent: false, label: 'client non prévenu' });
  assert.equal(notTold.detail, 'Raison : pas d’adresse e-mail.', 'review of #912 (n1) — « non prévenu » said once, by the badge');
});

test('rule 66 (review of #912) — a send left `sending` reads « envoi incertain »; a taker gone reads « une autre réservation »', () => {
  const propertyId = freshProperty();
  const stay = addStay({ propertyId, kind: 'devis', start: inDays(25), end: inDays(27) });
  const orphan = addStay({ propertyId, kind: 'devis', start: inDays(35), end: inDays(37) });
  told(stay, null, { status: 'sending' });
  told(orphan, 999999, { status: 'not-sent', reason: 'no-email' });
  const rows = list().alerts;
  const uncertain = rows.find((a) => a.reservationId === stay);
  assert.deepEqual(uncertain.notice, { sent: false, label: 'envoi incertain' });
  assert.equal(uncertain.detail, 'Envoi interrompu : vérifier l’historique des e-mails.');
  assert.deepEqual(rows.find((a) => a.reservationId === orphan).takenBy, { id: null, url: null, label: 'Prises par une autre réservation' });
});

test('rule 61 — a stay withdrawn at the upgrade reads « client non prévenu » with its reason', () => {
  const propertyId = freshProperty();
  const devis = addStay({ propertyId, kind: 'devis', start: inDays(40), end: inDays(42) });
  const taker = addStay({ propertyId, platform: 'Booking', start: inDays(40), end: inDays(42) });
  told(devis, taker, { status: 'not-sent', reason: 'upgrade' });
  const row = list().alerts.find((a) => a.reservationId === devis);
  assert.equal(row.detail, 'Raison : lien retiré à la mise à jour.');
});

test('rule 66 — « Vu » takes a row off the card; a stay over, cancelled or deleted is not listed; 404 on an unknown row', () => {
  const propertyId = freshProperty();
  const seen = addStay({ propertyId, kind: 'devis', start: inDays(50), end: inDays(52) });
  const over = addStay({ propertyId, kind: 'devis', start: inDays(-5), end: inDays(-1) });
  const cancelled = addStay({ propertyId, start: inDays(60), end: inDays(62) });
  const taker = addStay({ propertyId, platform: 'Booking', start: inDays(50), end: inDays(52) });
  const seenId = told(seen, taker);
  told(over, taker);
  told(cancelled, taker);
  db.prepare("UPDATE reservations SET kind = 'cancelled' WHERE id = ?").run(cancelled);
  const ids = () => list().alerts.map((a) => a.reservationId);
  assert.ok(ids().includes(seen));
  assert.ok(!ids().includes(over));
  assert.ok(!ids().includes(cancelled));

  const ack = res();
  ctl.acknowledgeDatesTaken({ params: { id: String(seenId) } }, ack);
  assert.equal(ack.statusCode, 200);
  assert.ok(!ids().includes(seen));
  assert.ok(db.prepare('SELECT acknowledgedAt FROM dates_taken_notices WHERE id = ?').get(seenId).acknowledgedAt);

  const again = res();
  ctl.acknowledgeDatesTaken({ params: { id: String(seenId) } }, again);
  assert.equal(again.statusCode, 404);
  const bad = res();
  ctl.acknowledgeDatesTaken({ params: { id: 'x' } }, bad);
  assert.equal(bad.statusCode, 400);
});

test('rule 43 — the home names the subject: a count, « Dates prises », how many guests were not told', () => {
  assert.ok(coreAttentionSources().some((s) => s.key === 'dates-taken'));
  const summary = CORE_SUMMARIES['dates-taken']({ alerts: [{ notice: { sent: true } }, { notice: { sent: false } }, { notice: { sent: false } }] });
  assert.deepEqual(summary, { count: 3, title: 'Dates prises', detail: '3 séjours · 2 clients non prévenus', severity: 'todo' });
  assert.equal(CORE_SUMMARIES['dates-taken']({ alerts: [{ notice: { sent: true } }] }).detail, '1 séjour · client prévenu');
  assert.equal(CORE_SUMMARIES['dates-taken']({ alerts: [] }), null);
});
