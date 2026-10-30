// Shared fixture of the « Sans acompte » + paid acompte link suites (specs/disable-deposit-per-reservation.md
// rules 12-13, specs/plugins-phase-3a-online-payment.md rules 48-49): a direct stay whose acompte link was
// minted, then « Sans acompte » saved, and the two ways that link gets paid anyway.
//
// Requires `process.env.DB_PATH = ':memory:'` to be set by the test file BEFORE requiring this module.

const assert = require('node:assert/strict');
const f = require('./reservationSaveFixture');
const { optionalPlugin } = require('../plugins/sdk/testing');
const paymentLinksModel = require('../models/paymentLinksModel');
const devisModel = require('../models/devisModel');
const { processPaidLink, retryPendingCancellations } = require('../utils/paymentPollRunner');
const { create: createAccountingModel } = optionalPlugin(() => require('../plugins/accounting-export/accountingModel'));

const PAID_AT = '2027-03-01T09:00:00Z';
let nextWeek = 1;

/**
 * A direct stay with its acompte link, then « Sans acompte » saved: acompte 0, the whole pre-arrival total on
 * the solde. The link is still open (`live`) or retired as stale with its Qonto deactivation pending (`retry`).
 * `soldePaid` ticks the solde first. Returns { id, link, links, deposit, preArrival }.
 */
function stayWithDisabledAcompte(path, { soldePaid = false } = {}) {
  const week = nextWeek++;
  const day = (offset) => new Date(Date.UTC(2027, 5, 1 + week * 7 + offset)).toISOString().slice(0, 10);
  const id = f.createStay({ startDate: day(0), endDate: day(3) });
  const before = f.rowOf(id);
  assert.ok(before.depositAmount > 0, 'a split stay to start with');
  const links = paymentLinksModel.buildModel(f.db);
  const link = links.create({
    reservationId: id, type: 'deposit', amountCents: Math.round(before.depositAmount * 100),
    provider: 'qonto', providerLinkId: `L-r7m1-${week}`, url: 'https://pay.example/x', status: 'open',
  });
  f.db.prepare('UPDATE reservations SET depositDisabled = 1, depositAmount = 0, depositAmountOverride = NULL, balanceAmount = ?, depositDueDate = NULL WHERE id = ?')
    .run(Math.round((before.depositAmount + before.balanceAmount) * 100) / 100, id);
  if (soldePaid) f.db.prepare("UPDATE reservations SET balancePaid = 1, balancePaidDate = '2027-02-20' WHERE id = ?").run(id);
  if (path === 'retry') {
    f.db.prepare("UPDATE payment_links SET status = 'cancelled', cancelReason = 'amount-changed', remoteCancelPendingAt = datetime('now') WHERE id = ?").run(link.id);
  }
  return { id, link, links, deposit: before.depositAmount, preArrival: Math.round((before.depositAmount + before.balanceAmount) * 100) / 100 };
}

/** The link paid on `path`: the webhook/poll of an open link (`live`) or the rule-8 retry (`retry`). */
async function pay(path, s) {
  const calls = [];
  const notifyPaidAfterCancel = async (l, o) => { calls.push(['alert', o]); };
  if (path === 'retry') {
    const provider = { id: 'qonto', async getPayment() { return { paid: true, paymentId: 'p', paidAt: PAID_AT }; }, async cancelLink() {} };
    const out = await retryPendingCancellations({
      database: f.db, devisModel: devisModel.buildModel(f.db), paymentLinksModel: s.links, provider, only: s.link.id,
      notifyPaidAfterCancel, emitPluginEvent: () => {}, logger: { warn() {}, error() {}, log() {} },
    });
    return { out: out.results[0], calls };
  }
  const out = await processPaidLink({
    database: f.db, devisModel: devisModel.buildModel(f.db),
    paymentLinksModel: Object.assign(Object.create(s.links), { retireSettled: () => [] }),
    link: s.links.findById(s.link.id), paidPayment: { paid: true, paymentId: 'p', paidAt: PAID_AT },
    sendConfirmation: async (x) => { calls.push(['confirm', x]); }, notifyPaidAfterCancel, emitPluginEvent: () => {},
  });
  return { out, calls };
}

/** The March 2027 journal entries of `kind` for the stay (needs the accounting-export plugin). */
const journalEntries = (id, kind) => createAccountingModel(f.db).encaissementsByMonth({ month: 3, year: 2027 })
  .filter((e) => Number(e.reservationId) === Number(id) && e.kind === kind);

const ledgerRow = (id, key) => f.getFiche(id).ledger.rows.find((r) => r.key === key);

module.exports = { PAID_AT, stayWithDisabledAcompte, pay, journalEntries, ledgerRow };
