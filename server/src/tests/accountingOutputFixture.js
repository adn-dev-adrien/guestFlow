// Shared fixture: the accounting output of a database as the replay of specs/pricing-components.md §3 rules 63-65 hashes it — every
// month CSV (latin-1 bytes as the route writes them), sales JSON and platforms preview of 2025-2028, and the synthesis windows.
// Its callers skip without the accounting-export plugin (`skipWithout`).
const crypto = require('crypto');
const { optionalPlugin } = require('../plugins/sdk/testing');

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

/** `{ actual, nonEmptyMonths }`: the hash of every output of `db`, keyed as the replay's baseline. */
function accountingOutputHashes(db) {
  const { create: createModel } = optionalPlugin(() => require('../plugins/accounting-export/accountingModel'));
  const { create: createController } = optionalPlugin(() => require('../plugins/accounting-export/controller'));
  const { create: createSynthesisModel } = optionalPlugin(() => require('../plugins/accounting-export/synthesisModel'));
  const { create: createSynthesisController } = optionalPlugin(() => require('../plugins/accounting-export/synthesisController'));
  const { createAccountSettings, readTtcSplitFrom } = optionalPlugin(() => require('../plugins/accounting-export/settings'));

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

  return { actual, nonEmptyMonths };
}

module.exports = { accountingOutputHashes };
