// specs/mollie-rolling-reserve-and-incoming-payments.md rules 28-31 — the Mollie journal of the accounting export: a paid link
// debits the clearing account (what Mollie owes) and credits the client; a reconciled credit debits the bank and credits the
// clearing account; the settlement's costs go to the fee account. Every entry is two lines of one amount. The export page
// gets the clearing balance at month end and the credits no payment explains, which book nothing. Fictional data only.
const test = require('node:test');
const assert = require('node:assert/strict');

const registry = require('../../sdk/registry');
const { createContext } = require('../../sdk/createContext');
const { entryToRows, buildRows, buildStructuredEntries, CSV_HEADERS } = require('../accountingExport');
const { create: createController, __test: { mollieEntries } } = require('../controller');
const { DECLARED, DEFAULTS, createAccountSettings } = require('../settings');
const { list: listJournal } = require('../../../utils/pluginJournalEntries');
const { FAR_YEAR: Y } = require('../../../tests/farYearFixture');

const PLAN = { ...DEFAULTS };
const link = (over = {}) => ({ kind: 'link', date: `${Y}-12-18`, amountCents: 19680, reservationId: 7, client: { firstName: 'Claire', lastName: 'Martin' }, libelle: 'Claire Martin', ...over });
const credit = (over = {}) => ({ kind: 'credit', date: `${Y}-12-23`, amountCents: 15744, settlementReference: 'T19274230.2512.01', qontoReference: 'solio-6791-1-transaction-019d1b2f-0001', libelle: 'VERSEMENT MOLLIE', ...over });
const cost = (over = {}) => ({ kind: 'cost', date: `${Y}-12-23`, amountCents: 45, settlementReference: 'T19274230.2512.01', qontoReference: 'q', libelle: 'FRAIS MOLLIE', ...over });
const stub = (found, extra = {}) => ({
  encaissementsByMonth: () => [], mollieByMonth: () => ({ entries: [], unattached: [], clearing: null, ...found }), ...extra,
});
const cols = (rows) => rows.map((r) => [r[3], r[5], r[6], r[7], r[8]]);

test('rule 28 — settings: the journal MO, the clearing account 46720000, the bank 51200000, the fees 62780000, the bank lines on', () => {
  assert.deepEqual([DEFAULTS.mollieJournalCode, DEFAULTS.mollieClearingAccount, DEFAULTS.mollieBankAccount, DEFAULTS.mollieFeeAccount, DEFAULTS.mollieExportBank],
    ['MO', '46720000', '51200000', '62780000', '1']);
  const validate = (key, value) => DECLARED.find((d) => d.key === key).validate(value);
  assert.equal(validate('mollieJournalCode', 'MO'), null);
  assert.ok(validate('mollieJournalCode', 'mollie-long'));
  assert.equal(validate('mollieClearingAccount', '46720000'), null);
  assert.ok(validate('mollieClearingAccount', '467'.concat('x')));
  assert.equal(validate('mollieExportBank', '0'), null);
  assert.ok(validate('mollieExportBank', 'oui'));
});

test('rule 28 — a paid link: D clearing account / C the client\'s account, the gross, on its payment day', () => {
  const [entry] = mollieEntries(stub({ entries: [link()] }), { month: 12, year: Y }, PLAN).entries;
  const rows = entryToRows(entry, PLAN);
  assert.deepEqual(cols(rows), [
    ['MO', 'CLAIRE MARTIN', '46720000', 196.8, 0],
    ['MO', 'CLAIRE MARTIN', 'CMARTIN', 0, 196.8],
  ]);
  assert.deepEqual([rows[0][0], rows[0][1], rows[0][2]], [18, 12, Y]);
});

test('rule 28 — a reconciled credit: D bank / C clearing account, the libellé carrying the settlement and the Qonto reference', () => {
  const [entry] = mollieEntries(stub({ entries: [credit()] }), { month: 12, year: Y }, PLAN).entries;
  assert.deepEqual(cols(entryToRows(entry, PLAN)), [
    ['MO', 'VERSEMENT MOLLIE T19274230.2512.01 f-0001', '51200000', 157.44, 0],
    ['MO', 'VERSEMENT MOLLIE T19274230.2512.01 f-0001', '46720000', 0, 157.44],
  ]);
});

test('rule 28 — a settlement cost: D fees / C clearing account', () => {
  const [entry] = mollieEntries(stub({ entries: [cost()] }), { month: 12, year: Y }, PLAN).entries;
  const rows = entryToRows(entry, PLAN);
  assert.deepEqual(rows.map((r) => [r[6], r[7], r[8]]), [['62780000', 0.45, 0], ['46720000', 0, 0.45]]);
});

test('rule 28 — every entry balances to the cent, in the CSV and in the preview; the accounts follow the plan', () => {
  const plan = { ...PLAN, mollieClearingAccount: '467200', mollieBankAccount: '512100', mollieJournalCode: 'BQ' };
  const found = mollieEntries(stub({ entries: [link({ amountCents: 10001 }), credit({ amountCents: 3333 }), cost({ amountCents: 7 })] }), { month: 12, year: Y }, plan);
  const rows = buildRows(found.entries, plan);
  assert.equal(rows.length, 6);
  assert.ok(rows.every((r) => r[3] === 'BQ'));
  const debits = rows.reduce((s, r) => s + r[7], 0);
  const credits = rows.reduce((s, r) => s + r[8], 0);
  assert.equal(Math.round(debits * 100), Math.round(credits * 100));
  assert.ok(rows.some((r) => r[6] === '467200'));
  const structured = buildStructuredEntries(found.entries, plan);
  assert.ok(structured.every((e) => e.balanced && e.direction === 'mollie'));
  assert.equal(structured[1].lines[0].accountLabel, 'Banque');
  assert.equal(structured[1].lines[1].accountLabel, 'Compte d\'attente Mollie');
  assert.equal(CSV_HEADERS.length, rows[0].length);
});

test('rule 29 — « Exporter les versements Mollie reçus » off: the bank lines are left out, the rest stays', () => {
  const found = { entries: [link(), credit(), cost()] };
  const on = mollieEntries(stub(found), { month: 12, year: Y }, PLAN).entries.map((e) => e.mollieKind);
  assert.deepEqual(on, ['link', 'credit', 'cost']);
  const off = mollieEntries(stub(found), { month: 12, year: Y }, { ...PLAN, mollieExportBank: '0' }).entries.map((e) => e.mollieKind);
  assert.deepEqual(off, ['link', 'cost']);
});

test('rule 30 — the export page gets the clearing account\'s balance at month end and which clients\' reserves are still held', () => {
  const clearing = { asOf: `${Y}-12-31`, balanceCents: 3936, clients: [{ reservationId: 7, clientName: 'Claire Martin', balanceCents: 3936 }] };
  const found = mollieEntries(stub({ clearing }), { month: 12, year: Y }, PLAN);
  assert.deepEqual(found.clearing, { account: '46720000', asOf: `${Y}-12-31`, balance: 39.36, clients: [{ reservationId: 7, clientName: 'Claire Martin', balanceCents: 3936, balance: 39.36 }] });
  let body;
  const controller = createController(stub({ entries: [link()], clearing }), { plan: () => PLAN });
  controller.salesJson({ query: { month: '12', year: String(Y) } }, { json: (b) => { body = b; } });
  assert.deepEqual(body.mollie.clearing, found.clearing);
  assert.equal(body.totals.allBalanced, true);
  assert.equal(body.entries.length, 1);
  let none;
  createController(stub({}), { plan: () => PLAN }).salesJson({ query: { month: '12', year: String(Y) } }, { json: (b) => { none = b; } });
  assert.equal(none.mollie, null, 'no Mollie journal, nothing to show');
});

test('rule 31 — a Mollie credit not reconciled at export time is listed apart and produces no line', () => {
  const unattached = [{ date: `${Y}-12-23`, amountCents: 1120, qontoReference: 'solio-x', settlementReference: 'T19274230.2611.01', counterparty: 'Stichting Mollie Payments' }];
  const found = mollieEntries(stub({ unattached, clearing: { asOf: `${Y}-12-31`, balanceCents: 0, clients: [] } }), { month: 12, year: Y }, PLAN);
  assert.deepEqual(found.entries, []);
  assert.deepEqual(found.unattached, [{ ...unattached[0], amount: 11.2 }]);
  let body;
  createController(stub({ unattached, clearing: { asOf: `${Y}-12-31`, balanceCents: 0, clients: [] } }), { plan: () => PLAN })
    .salesJson({ query: { month: '12', year: String(Y) } }, { json: (b) => { body = b; } });
  assert.equal(body.mollie.unattached.length, 1);
  assert.equal(body.entries.length, 0);
});

test('rules 28-31 — the CSV carries the Mollie rows in the month\'s chronological stream; settings are stored like the others', () => {
  let sent;
  const res = { setHeader() {}, send(b) { sent = b; }, status() { return this; }, json() { return this; } };
  createController(stub({ entries: [link(), credit()] }), { plan: () => PLAN }).salesCsv({ query: { month: '12', year: String(Y) }, headers: {} }, res);
  const text = sent.toString('latin1');
  assert.match(text, /46720000/);
  assert.match(text, /51200000/);
  assert.match(text, /CMARTIN/);
});

test('rules 28-31 — the core hands a plugin\'s journal over from every live provider; a provider that throws is skipped', () => {
  registry.reset();
  registry.configure({ isActive: () => true, allows: () => true });
  createContext('online-payment', {}).journalEntries(({ from, to }) => ({
    entries: [{ kind: 'link', date: from, amountCents: 100 }], unattached: [{ date: to, amountCents: 5 }], clearing: { asOf: to, balanceCents: 100, clients: [] },
  }));
  createContext('flaky', {}).journalEntries(() => { throw new Error('boom'); });
  const logged = [];
  const found = listJournal({ from: `${Y}-12-01`, to: `${Y}-12-31` }, { error: (...a) => logged.push(a) });
  assert.equal(found.entries.length, 1);
  assert.equal(found.entries[0].pluginId, 'online-payment');
  assert.equal(found.clearing.asOf, `${Y}-12-31`);
  assert.equal(logged.length, 1);
  assert.deepEqual(listJournal({ from: 'x', to: 'y' }), { entries: [], unattached: [], clearing: null });
  registry.reset();
});

test('rule 28 — the settings store reads the Mollie defaults and counts a changed one as customised', () => {
  const rows = new Map();
  const database = {
    prepare: (sql) => ({
      all: () => (sql.startsWith('SELECT') ? [...rows].map(([key, value]) => ({ key, value })) : []),
      run: (...args) => { if (sql.includes('INSERT')) rows.set(args[1], args[2]); },
    }),
  };
  const settings = createAccountSettings(database);
  assert.equal(settings.read().mollieClearingAccount, '46720000');
  assert.equal(settings.customisedCount(), 0);
  settings.write({ mollieClearingAccount: '467300' });
  assert.equal(settings.read().mollieClearingAccount, '467300');
  assert.equal(settings.customisedCount(), 1);
});
