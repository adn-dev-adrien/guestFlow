// The round-22 money suites read the books through the export itself: the month's journal as the controller answers it,
// and the CSV for the byte-identical controls.

const money = require('../../../tests/moneyLedgerFixture');
const { create: createAccountingModel } = require('../accountingModel');
const { create: createAccountingController } = require('../controller');

const { db, TODAY } = money;
const period = { year: Number(TODAY.slice(0, 4)), month: Number(TODAY.slice(5, 7)) };

function month() {
  let answer = null;
  const res = { setHeader() {}, status() { return res; }, json(body) { answer = body; return res; } };
  createAccountingController(createAccountingModel(db)).salesJson({ query: period }, res);
  return answer;
}

function csv() {
  let sent = '';
  const res = { setHeader() {}, status() { return res; }, send(body) { sent = Buffer.from(body).toString('latin1'); return res; } };
  createAccountingController(createAccountingModel(db)).salesCsv({ query: period }, res);
  return sent;
}

const entriesOf = (id) => month().entries.filter((entry) => entry.reservationId === id);
const signedByAccount = (entries) => {
  const out = {};
  for (const entry of entries) {
    for (const line of entry.lines) {
      const account = String(line.compte);
      out[account] = Math.round(((out[account] || 0) + Number(line.credit || 0) - Number(line.debit || 0)) * 100) / 100;
    }
  }
  return out;
};
/** `[kind, { account → signed amount }]` per entry, in order. */
const journal = (id) => entriesOf(id).map((entry) => [entry.kind + (entry.isRefund ? 'R' : ''), signedByAccount([entry])]);
/** Every account of the stay across its entries, the clients' auxiliary left out: all 0 once everything went back. */
function net(id) {
  const out = signedByAccount(entriesOf(id));
  return Object.fromEntries(Object.entries(out).filter(([account, value]) => /^\d/.test(account) && Math.abs(value) > 0.021));
}
const entry = (id, kind) => {
  const found = entriesOf(id).find((e) => e.kind === kind);
  return found ? signedByAccount([found]) : null;
};

module.exports = { ...money, month, csv, entriesOf, journal, net, entry };
