// specs/pricing-components.md §3 rules 63, 64 and 65 — the accounting output is a MOVE: every month of the golden database
// leaves the same CSV bytes (latin-1, as the route writes them), the same sales JSON and the same synthesis (month windows and
// whole years) as before the entry builders became `AccountingOutput` and the writers became exporters. The expected hashes
// were captured on the code before the move; `ACCOUNTING_OUTPUT_UPDATE=1` rewrites them, which is only ever legitimate on
// code that is known to answer as before.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { skipWithout } = require('../plugins/sdk/testing');
const { buildVatGoldenDb } = require('./vatRegimeGoldenFixture');

const BASELINE = path.join(__dirname, 'fixtures', 'accounting-output', 'baseline.json');
const sha = (value) => crypto.createHash('sha256').update(Buffer.isBuffer(value) ? value : String(value)).digest('hex');

function fakeRes() {
  const res = { statusCode: 200, body: undefined, headers: {} };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  res.setHeader = (name, value) => { res.headers[name] = value; return res; };
  res.send = (body) => { res.body = body; return res; };
  return res;
}

const MONTHS = [];
for (let year = 2025; year <= 2028; year += 1) for (let month = 1; month <= 12; month += 1) MONTHS.push({ year, month });

test('rules 63-65: every month CSV, sales JSON and synthesis of the golden database is byte-identical', { skip: skipWithout(['accounting-export']) }, async () => {
  const db = buildVatGoldenDb();
  const { create: createModel } = require('../plugins/accounting-export/accountingModel');
  const { create: createController } = require('../plugins/accounting-export/controller');
  const { create: createSynthesisModel } = require('../plugins/accounting-export/synthesisModel');
  const { create: createSynthesisController } = require('../plugins/accounting-export/synthesisController');
  const { createAccountSettings, readTtcSplitFrom } = require('../plugins/accounting-export/settings');

  const plan = () => ({ ...createAccountSettings(db).read(), ttcSplitFrom: readTtcSplitFrom(db) });
  const controller = createController(createModel(db), { plan });
  const synthesis = createSynthesisController(() => createSynthesisModel(db), { plan });

  const actual = {};
  let nonEmptyMonths = 0;
  for (const { year, month } of MONTHS) {
    const key = `${year}-${String(month).padStart(2, '0')}`;
    const csv = fakeRes();
    controller.salesCsv({ query: { month, year } }, csv);
    actual[`csv/${key}`] = `${csv.statusCode} ${csv.headers['Content-Disposition'] || ''} ${sha(csv.body)}`;
    const json = fakeRes();
    controller.salesJson({ query: { month, year } }, json);
    actual[`sales/${key}`] = sha(JSON.stringify(json.body));
    if (json.body.entries.length > 0) nonEmptyMonths += 1;
    const platforms = fakeRes();
    controller.platformsPreview({ query: { month, year } }, platforms);
    actual[`platforms/${key}`] = sha(JSON.stringify(platforms.body));
  }
  const windows = [];
  for (let year = 2025; year <= 2028; year += 1) windows.push({ period: 'custom', from: `${year}-01-01`, to: `${year}-12-31` });
  for (const month of ['2027-04', '2027-05', '2027-06', '2027-08', '2027-09']) {
    const last = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
    windows.push({ period: 'custom', from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` });
  }
  for (const query of windows) {
    const res = fakeRes();
    synthesis.synthesis({ query }, res);
    actual[`synthesis/${query.from}..${query.to}`] = `${res.statusCode} ${sha(JSON.stringify(res.body))}`;
  }

  if (process.env.ACCOUNTING_OUTPUT_UPDATE === '1') {
    fs.mkdirSync(path.dirname(BASELINE), { recursive: true });
    fs.writeFileSync(BASELINE, `${JSON.stringify(actual, null, 1)}\n`);
    return;
  }
  const expected = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
  assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort());
  for (const key of Object.keys(expected)) assert.equal(actual[key], expected[key], key);
  assert.ok(nonEmptyMonths >= 5, `the golden database must feed the journal (${nonEmptyMonths} months)`);
});
