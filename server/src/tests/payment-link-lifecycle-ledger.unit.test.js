// specs/payment-link-lifecycle.md rule 24 — the ledger row says when its link stops: until when an open link
// is valid, when a lapsed one expired (or that the stay began), that its deactivation is still owed at the
// provider, and why a withdrawn one was withdrawn. « Renvoyer la demande » stays on a lapsed link, never on
// dates taken (rule 11 would refuse it). Day and hour are the operator's, in Paris.

process.env.TZ = 'Europe/Paris';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildLedger, formatEuros } = require('../utils/reservationLedger');

const TODAY = '2026-10-20';

function row(over = {}) {
  return {
    id: 7, kind: 'reservation', platform: 'direct', startDate: '2026-11-20', endDate: '2026-11-23',
    createdAt: '2026-10-01 10:00:00',
    depositAmount: 90, balanceAmount: 210, complementAmount: 0, endOfStayComplementAmount: 0,
    depositDueDate: '2026-10-25', balanceDueDate: '2026-11-10',
    depositPaid: 0, balancePaid: 0, complementPaid: 0, endOfStayComplementPaid: 0, cautionReceived: 0, cautionReturned: 0,
    ...over,
  };
}

// Minted 20/10 at 12:30 Paris; valid until 22/10 at 00:30 Paris — UTC still says the 21st.
const link = (over = {}) => ({
  id: 3, type: 'deposit', status: 'open', amountCents: 9000, createdAt: '2026-10-20 10:30:00',
  expiresAt: '2026-10-21T22:30:00.000Z', cancelReason: null, remoteCancelPendingAt: null, ...over,
});

const depositLink = (l, extra = {}) => buildLedger({ row: row(), links: [l], canRequest: true, today: TODAY, providerLabel: 'Qonto', ...extra })
  .rows.find((r) => r.key === 'deposit').detail.link;

test('rule 24 — open: « Lien envoyé le … · montant · valable jusqu’au {jour} à {hh:mm} », in Paris time', () => {
  const l = depositLink(link());
  assert.equal(l.label, `Lien envoyé le 20/10 · ${formatEuros(90)} · valable jusqu'au 22/10 à 00:30`);
  assert.equal(l.resend, undefined);
});

test('rule 24 — open without a known end (Qonto’s sentinel) keeps the former wording', () => {
  assert.equal(depositLink(link({ expiresAt: '0001-01-01T00:00:00Z' })).label, `Lien envoyé le 20/10 · ${formatEuros(90)}`);
});

test('rule 24 — lapsed for validity: « Lien expiré le {jour} à {hh:mm} », with « Renvoyer la demande »', () => {
  const l = depositLink(link({ status: 'expired', cancelReason: 'validity' }));
  assert.equal(l.label, 'Lien expiré le 22/10 à 00:30');
  assert.deepEqual(l.resend, { type: 'deposit', label: 'Renvoyer la demande' });
});

test('rule 24 — lapsed at the arrival: « Lien expiré · séjour commencé »', () => {
  assert.equal(depositLink(link({ status: 'expired', cancelReason: 'stay-started' })).label, 'Lien expiré · séjour commencé');
});

test('rule 24 — a deactivation still owed reads « · désactivation en attente chez {Prestataire} »', () => {
  const pending = link({ status: 'expired', cancelReason: 'validity', remoteCancelPendingAt: '2026-10-21T22:31:00.000Z' });
  assert.equal(depositLink(pending).label, 'Lien expiré le 22/10 à 00:30 · désactivation en attente chez Qonto');
  assert.equal(depositLink(pending, { providerLabel: null }).label, 'Lien expiré le 22/10 à 00:30 · désactivation en attente chez le prestataire de paiement');
});

test('rule 24 — a lapsed link from before this version (no reason) still reads « Lien expiré »', () => {
  assert.equal(depositLink(link({ status: 'expired' })).label, 'Lien expiré');
});

test('rule 24 — withdrawn: dates taken and duplicate set aside have their words; dates taken offers no resend', () => {
  const taken = depositLink(link({ status: 'cancelled', cancelReason: 'dates-taken' }));
  assert.equal(taken.label, 'Lien retiré · dates prises');
  assert.equal(taken.resend, undefined);
  assert.equal(depositLink(link({ status: 'cancelled', cancelReason: 'superseded' })).label, 'Lien retiré · doublon écarté');
  assert.equal(depositLink(link({ status: 'cancelled', cancelReason: 'orphan' })).label, 'Lien retiré');
  assert.deepEqual(depositLink(link({ status: 'cancelled' })).resend, { type: 'deposit', label: 'Renvoyer la demande' });
});

test('rule 24 — the solde row reads the same words, the year shown when it differs from the stay’s', () => {
  const ledger = buildLedger({
    row: row({ startDate: '2027-01-10', endDate: '2027-01-12' }),
    links: [link({ type: 'balance', status: 'expired', cancelReason: 'validity' })],
    canRequest: true, today: TODAY, providerLabel: 'Qonto',
  });
  assert.equal(ledger.rows.find((r) => r.key === 'balance').detail.link.label, 'Lien expiré le 22/10/2026 à 00:30');
});
