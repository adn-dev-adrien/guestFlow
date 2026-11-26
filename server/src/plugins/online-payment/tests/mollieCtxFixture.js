// A capturing `ctx` for `mountReconciliation` (specs/payments/mollie-rolling-reserve-and-incoming-payments.md): what the plugin
// declares to the core, on the app's own test database, with settings kept in a Map. No Qonto, no Mollie.
const { db } = require('./reconciliationFixture');

function capturingCtx(values = {}) {
  const store = new Map(Object.entries(values));
  const declared = {};
  const ctx = {
    id: 'online-payment', db,
    settings: { get: (k) => store.get(k) || '', set: (k, v) => store.set(k, v), raw: (k) => store.get(k) || '' },
    log: { info() {}, warn() {}, error() {} },
    mounts: [], attentions: [], jobs: [], migrationList: [],
    migrations(list) { ctx.migrationList.push(...list); },
    mount(path, router) { ctx.mounts.push({ path, router }); },
    reservationBlock() {}, paymentDeadlineDecorator() {},
    events: { on(name, fn) { ctx.handlers[name] = fn; } },
    handlers: {},
    attention(subject) { ctx.attentions.push(subject); },
    jobs_: [],
    ledgerBankTranches(fn) { declared.ledgerBankTranches = fn; },
    incomingPayments(fn) { declared.incomingPayments = fn; },
    journalEntries(fn) { declared.journalEntries = fn; },
  };
  ctx.jobs = { every(job) { ctx.jobs_.push(job); } };
  return { ctx, store, declared };
}

module.exports = { capturingCtx };
