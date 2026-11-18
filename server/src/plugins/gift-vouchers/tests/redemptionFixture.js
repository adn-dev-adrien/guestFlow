// Shared fixture of the redemption suites (specs/gift-vouchers.md rules 36-42): the plugin's API on the REAL core database
// (in memory), registered as a live prepaid source, with a payment provider that mints no real link. Not a test file.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
process.env.GUESTFLOW_ENCRYPTION_KEY = process.env.GUESTFLOW_ENCRYPTION_KEY || Buffer.alloc(32, 7).toString('base64');

const db = require('../../../database');
const sdk = require('../../sdk');
const registry = require('../../sdk/registry');
const { createContext } = require('../../sdk/createContext');
const { applyPluginSchema } = require('../../sdk/testing');
const { buildGiftVouchersApi, memorySettings } = require('..');
const { SOURCE, LABEL } = require('../redemption');

applyPluginSchema(db, 'gift-vouchers');

const PEPPER = 'test-pepper';
const clock = { at: new Date('2026-11-15T10:00:00Z') };
const created = [];
const provider = {
  id: 'qonto',
  label: 'Qonto',
  errorCode: 'QONTO_API_ERROR',
  isReady: () => true,
  createLink: async (args) => { created.push(args); return { id: `rem-${created.length}`, url: `https://pay.example.test/${created.length}`, status: 'open' }; },
  getPayment: async () => ({ paid: false }),
  getLinkStatus: async () => 'open',
  cancelLink: async () => {},
};

const prepaidReceipts = sdk.coreModule('prepaidReceipts');
const api = buildGiftVouchersApi({
  db,
  pepper: () => PEPPER,
  encrypt: sdk.coreModule('encryption').encrypt,
  decrypt: sdk.coreModule('encryption').safeDecrypt,
  settingsStore: () => memorySettings(),
  now: () => clock.at,
  quote: () => null,
  pow: sdk.proofOfWork,
  powSecret: () => 's',
  guard: (req, res, next) => next(),
  sendMail: async () => ({}),
  paymentMethods: () => [],
  companyName: () => 'Domaine',
  pageUrl: () => 'https://site.example.test/bon',
  onlineSaleAvailable: () => true,
  siteOrigin: () => 'https://site.example.test',
  isConverted: (devisId) => {
    const quote = sdk.coreModule('reservationsModel').getRow(Number(devisId));
    return Boolean(quote && (quote.kind !== 'devis' || quote.convertedReservationId));
  },
  stayOf: (id) => sdk.coreModule('reservationsModel').getRow(Number(id)) || null,
  collectedCents: (stay) => Math.round(sdk.coreModule('reservationSettlement').comptaCollected(stay) * 100),
  receipts: {
    receivedOn: (stayId) => prepaidReceipts.receivedOn(db, stayId, SOURCE),
    owedCentsOn: (stayId) => prepaidReceipts.owedCentsOn(db, stayId),
    recordOnStay: (args) => prepaidReceipts.recordOnStay({ database: db, ...args }),
    undoOnStay: (args) => prepaidReceipts.undoOnStay({ database: db, ...args }),
  },
});

/** The plugin live, with the source it declares and a payment provider — what `register(ctx)` does, without the secrets file. */
function goLive() {
  registry.reset();
  registry.configure({ isActive: () => true, allows: () => true });
  createContext('online-payment', {}).paymentProvider(provider);
  createContext('gift-vouchers', {}).prepaid({
    source: SOURCE,
    label: LABEL,
    apply: (args) => api.redemption.apply(args),
    held: (devisId) => api.redemption.held(devisId),
    settle: (args) => api.redemption.settle(args),
    release: (args) => api.redemption.release(args),
  });
}

/** A voucher of `amountCents`, issued by hand → `{ voucherId, code }`. */
function issueVoucher(amountCents) {
  const order = api.orders.create({
    amountCents, email: '', source: 'manual', paymentMethod: 'transfer', termsAcceptedAt: clock.at.toISOString(),
  });
  const issued = api.issuance.issue({ orderId: order.id, actor: 'user:1' });
  return { voucherId: issued.voucherId, code: issued.code };
}

let propertySeeded = false;
/** A public quote (`devis`) of the given acompte and solde, in euros; `depositEnabled` makes it a `deposit`-mode property. */
let seeded = 0;
const dayAfter = (n) => new Date(Date.UTC(2027, 0, 1) + n * 24 * 3600 * 1000).toISOString().slice(0, 10);
function seedQuote({
  deposit = 80.4, balance = 187.6, depositEnabled = 1, start = null, end = null,
} = {}) {
  if (!propertySeeded) {
    db.prepare("INSERT INTO properties (id, name, depositEnabled) VALUES (1, 'Gite', ?)").run(depositEnabled);
    db.prepare("INSERT INTO clients (id, firstName, lastName, email) VALUES (1, 'Jean', 'Dupont', 'jean@x.fr')").run();
    propertySeeded = true;
  }
  db.prepare('UPDATE properties SET depositEnabled = ? WHERE id = 1').run(depositEnabled);
  // Each quote has nights of its own: a stay already booked would take them from the next one.
  seeded += 1;
  const from = start || dayAfter(seeded * 5);
  const to = end || dayAfter(seeded * 5 + 3);
  const result = db.prepare(`INSERT INTO reservations (kind, propertyId, clientId, startDate, endDate, adults, finalPrice, depositAmount, balanceAmount,
      devisStatus, requestOrigin, publicToken)
    VALUES ('devis', 1, 1, ?, ?, 2, ?, ?, ?, 'draft', 'public', ?)`)
    .run(from, to, deposit + balance, deposit, balance, `tok-${Math.random().toString(36).slice(2)}`);
  const id = Number(result.lastInsertRowid);
  return { id, token: db.prepare('SELECT publicToken FROM reservations WHERE id = ?').get(id).publicToken };
}

const VISITOR = Object.freeze({ ip: '203.0.113.9' });

/** `redemption.apply` as the booking request calls it. */
const hold = (devisId, code, capCents) => api.redemption.apply({
  devisId, input: { kind: SOURCE, code }, capCents, visitor: VISITOR,
});

module.exports = {
  db, api, clock, created, provider, goLive, issueVoucher, seedQuote, hold, VISITOR, SOURCE, LABEL, PEPPER,
};
