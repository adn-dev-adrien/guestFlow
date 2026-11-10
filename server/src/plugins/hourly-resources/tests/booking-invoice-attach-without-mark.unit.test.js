// specs/resource-booking-pricing-and-invoicing.md rule 47 (audit R36-EXT-1) — the hourly job joins the PDF to the card
// credit whatever happens to « marquer payée »: a mark Qonto keeps refusing (403, 422, 5xx) no longer stops the
// attachment, and it is retried for 7 days after the issue only, then left « à payer » in Qonto. A fake issuer: no socket.
const test = require('node:test');
const assert = require('node:assert/strict');
const { seed, book, card, DAY } = require('./standaloneBookingFixture');
const { createInvoicing } = require('../invoicing');

const quiet = { error() {}, warn() {} };
const dayMs = 86400000;

function fakeIssuer({ markError }) {
  const state = { marks: 0, batch: null, attached: [] };
  const issuer = {
    isReady: () => true,
    async issue() { return { invoiceId: 'inv_1', number: 'F-1', clientId: 'cl_1', markedPaid: false, markPending: true }; },
    async invoiceStatus() { return 'unpaid'; },
    async markPaid() {
      state.marks += 1;
      const err = new Error(`Qonto ${markError}`);
      err.status = markError;
      throw err;
    },
    async findCardBatch() { return state.batch; },
    async attach({ transactionId }) { state.attached.push(transactionId); return { attachmentId: 'att_1' }; },
  };
  return { issuer, state };
}

async function invoicedByCard({ markError, now }) {
  const { model, resourceId } = seed();
  const { issuer, state } = fakeIssuer({ markError });
  const invoicing = createInvoicing({ bookings: () => model, issuers: () => issuer, logger: quiet, ...(now ? { now } : {}) });
  const id = book(model, resourceId);
  assert.equal(model.recordPayment(id, { tenders: card(12000), paidAt: DAY }).ok, true);
  assert.equal((await invoicing.issue(id)).ok, true);
  assert.equal(model.findById(id).invoice.attachment.state, 'pending', 'no card batch at issue time');
  return { model, invoicing, state, id };
}

for (const markError of [403, 422, 500]) {
  test(`rule 47 — « marquer payée » refused ${markError} on every pass: the batch lands, the PDF is joined`, async () => {
    const { model, invoicing, state, id } = await invoicedByCard({ markError });
    state.batch = { transactionId: 'tx9' };
    await invoicing.watch();
    assert.equal(model.findById(id).invoice.attachment.state, 'attached');
    assert.deepEqual(state.attached, ['tx9']);
    assert.equal(model.rawById(id).invoiceMarkPending, 1, 'the mark is still to retry within its window');
    assert.equal(state.marks, 1);
  });
}

test('rule 47 — the mark is retried for 7 days after the issue, then left « à payer »: Qonto is no longer asked', async () => {
  let offset = 0;
  const { model, invoicing, state, id } = await invoicedByCard({ markError: 403, now: () => new Date(Date.now() + offset) });
  offset = 6 * dayMs;
  await invoicing.watch();
  assert.equal(model.rawById(id).invoiceMarkPending, 1);
  offset = 8 * dayMs;
  await invoicing.watch();
  assert.equal(model.rawById(id).invoiceMarkPending, 0);
  assert.equal(model.findById(id).invoice.markedPaid, false);
  const asked = state.marks;
  await invoicing.watch();
  assert.equal(state.marks, asked, 'given up: no further call');
});
