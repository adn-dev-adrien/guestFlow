#!/usr/bin/env node
// specs/pricing-components.md §3 rule 34 — hashes every money reader for every reservation, devis and month of a COPY of
// a real database, so a refactor can be proved to change nothing. It extends `scripts/vat-regime-golden-prod.mjs`
// (which keeps working unchanged: its artefacts — quotes, fiche, devis PDF, payment-link baskets of every bucket and
// installment, accounting journal and CSV rows of every month, finance views, tourist-tax report, cancellation of
// every direct stay — are all captured here too) with, per reservation:
//
//   live-quote/<id>        the quote of the stored stay (`quoteStoredReservation`)
//   noop-save/<id>         the columns a save of the stay as stored would write (dry run, rolled back)
//   sas/<id>/<mode>        the SAS arrival and departure read, and the plan of an empty draft (nothing written)
//   cancel-preview/<id>    what cancelling now would keep and write off, or its refusal
//   fiche-money/<id>       arrival-payment detail, collected amount, operational collection, ledger, installment plan
//   splits/<id>            the collected splits: complement split, per-line data, stored-money buckets
//   tourist-tax-figure/<id> the tourist-tax figures of the live quote
//   figures/<id>           the price gate's figure set (rule 68), each figure at the capture instant
//   resource-booking/<id>  every standalone resource booking: the stored row, the price breakdown and the sale row the journal reads
//   synthesis/<year>       the accounting synthesis of the year (`/api/accounting/synthesis`, accounting-export live)
//
//   node scripts/pricing-replay.mjs <copy.db> --out before.json
//   node scripts/pricing-replay.mjs <copy.db> --compare before.json
//
// Prints ids, months and hashes only — never a name. The database is opened by the application's own boot, which
// migrates it: pass a copy, never the original.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2);
const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const dbPath = args[0] && !args[0].startsWith('--') ? args[0] : null;
if (!dbPath || !fs.existsSync(dbPath)) {
  console.error('usage: pricing-replay.mjs <copy.db> [--out file] [--compare file]   (pass a COPY of the database)');
  process.exit(2);
}
if (path.resolve(dbPath).split(path.sep).includes('shadows') && !args.includes('--i-am-a-copy')) {
  console.error('refused: that path is under shadows/ — copy the snapshot to a temporary folder and pass the copy (or --i-am-a-copy)');
  process.exit(2);
}

process.env.DB_PATH = path.resolve(dbPath);
process.env.TZ = 'Europe/Paris';
const { freezeClock } = require(path.join(root, 'server/src/tests/vatRegimeGoldenFixture.js'));
freezeClock(new Date('2026-11-11T12:00:00+01:00'));

const silent = console.log;
console.log = () => {};
const server = (relative) => require(path.join(root, 'server/src', relative));
const db = server('database.js');
const { capture, canonical, sha } = server('tests/vatRegimeGoldenCapture.js');
const { optionalPlugin } = server('plugins/sdk/testing.js');
const { figuresOfStay, fakeRes, recomputeResourceBookings } = require(path.join(root, 'scripts/price-gate/recompute.js'));

const captured = await capture(db, { years: [2025, 2026, 2027] });

const ADMIN = { id: 1, roles: ['admin'], role: 'admin' };
const put = async (key, fn) => {
  try { captured[key] = canonical(await fn()); } catch (err) { captured[key] = `ERROR ${err.message}`; }
};

const { quoteStoredReservation } = server('utils/storedReservationQuote.js');
const reservationsController = server('controllers/reservationsController.js');
const { previewFor } = server('controllers/reservationCancellationController.js');
const { reservations: sdkReservations } = server('plugins/sdk/coreServices.js');
const { computeComplementPaidSplit } = server('utils/complementPaidSplit.js');
const { buildPerLineData, storedMoneyBuckets } = server('utils/storedMoneySplit.js');
const vatRegimeModel = server('models/vatRegimeModel.js');
const sas = optionalPlugin(() => server('plugins/sas/controller.js'));

const rows = db.prepare('SELECT id, kind FROM reservations ORDER BY id').all();
const stays = rows.filter((r) => r.kind === 'reservation' || r.kind === 'cancelled');

const TOURIST_TAX_KEYS = ['touristTaxMode', 'touristTaxRate', 'touristTaxUnitAmount', 'touristTaxPercentage', 'touristTaxDepartmentPercentage', 'touristTaxFixedAmount',
  'touristTaxPricePerNight', 'touristTaxPricePerNightHt', 'touristTaxBaseHt', 'touristTaxPerOccupantNightPriceHt', 'touristTaxMunicipalUnitAmount',
  'touristTaxDepartmentUnitAmount', 'touristTaxAdultsCount', 'touristTaxOccupantsCount', 'touristTaxNights', 'touristTaxLabel', 'touristTaxTotal',
  'touristTaxOriginalTotal', 'touristTaxBaseAccommodation', 'touristTaxBaseBeforeDeduction', 'touristTaxIncludedInRateDeduction', 'touristTaxAccommodationPaid',
  'touristTaxFrozen', 'touristTaxFrozenAt', 'touristTaxOfferedByPlatform', 'touristTaxRemittedByOwner', 'touristTaxCollectedOnArrival',
  'touristTaxReversedByPlatform', 'touristTaxInComplement', 'touristTaxAddedGuestsAmount', 'touristTaxAddedGuestsAdults', 'platformTouristTaxWithheld'];

for (const { id, kind } of rows) {
  const row = () => db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);
  await put(`live-quote/${id}`, () => quoteStoredReservation(db, row()));
  await put(`tourist-tax-figure/${id}`, () => {
    const quote = quoteStoredReservation(db, row());
    return Object.fromEntries(TOURIST_TAX_KEYS.map((key) => [key, quote[key]]));
  });
  await put(`figures/${id}`, () => figuresOfStay(db, id));
  if (kind === 'devis') continue;

  await put(`noop-save/${id}`, () => {
    const body = sdkReservations.updateBody(id);
    if (!body) return { skipped: kind };
    const result = reservationsController.performUpdate(id, body, { dryRun: true });
    return { status: result.status, row: result.row, error: result.status === 200 ? null : result.body };
  });
  await put(`cancel-preview/${id}`, () => previewFor(id));
  await put(`fiche-money/${id}`, () => {
    const res = fakeRes();
    reservationsController.getById({ params: { id }, user: ADMIN }, res);
    const b = res.body || {};
    return {
      status: res.statusCode,
      arrivalPayment: b.arrivalPayment, collectedTtc: b.collectedTtc, operationalCollection: b.operationalCollection, ledger: b.ledger,
      installmentPlan: b.installmentPlan, remainingDue: b.remainingDue, paymentComplete: b.paymentComplete, refundTotals: b.refundTotals,
      complementAdjustment: b.complementAdjustment, checkoutComplement: b.checkoutComplement,
    };
  });
  await put(`splits/${id}`, () => {
    const stay = row();
    const vatRate = vatRegimeModel.rateForRow(db, { id });
    const perLine = buildPerLineData(db, stay);
    return {
      complementSplit: computeComplementPaidSplit(db, id),
      perLine,
      deposit: storedMoneyBuckets(db, stay, { kind: 'deposit', revenueTtc: Number(stay.depositAmount || 0), vatRate }),
      balance: storedMoneyBuckets(db, stay, { kind: 'balance', revenueTtc: Number(stay.balanceAmount || 0), vatRate }),
    };
  });

  if (sas.getSas) {
    const request = (mode, body) => ({ params: { id }, query: { mode }, body: body || {}, user: ADMIN });
    for (const mode of ['arrival', 'departure']) {
      await put(`sas/${id}/${mode}`, () => {
        const res = fakeRes();
        sas.getSas(request(mode), res);
        return { status: res.statusCode, body: res.body };
      });
      await put(`sas/${id}/${mode}-plan`, () => {
        const res = fakeRes();
        (mode === 'arrival' ? sas.previewArrival : sas.previewDeparture)(request(mode), res);
        return { status: res.statusCode, body: res.body };
      });
    }
  }
}

await put('resource-bookings/all', async () => recomputeResourceBookings(db));
const present = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'resource_bookings'").get();
for (const { id } of present ? db.prepare('SELECT id FROM resource_bookings ORDER BY id').all() : []) {
  await put(`resource-booking/${id}`, () => ({ row: db.prepare('SELECT * FROM resource_bookings WHERE id = ?').get(id), figures: recomputeResourceBookings(db)[id] }));
}

// The synthesis of every year that holds money: the stays' start years and the years the replay already reads.
const synthesisPlugin = optionalPlugin(() => ({ model: server('plugins/accounting-export/synthesisModel.js'), controller: server('plugins/accounting-export/synthesisController.js') }));
if (synthesisPlugin.model) {
  const controller = synthesisPlugin.controller.create(() => synthesisPlugin.model.create(db));
  const years = new Set([2025, 2026, 2027, ...db.prepare("SELECT DISTINCT substr(startDate, 1, 4) AS y FROM reservations WHERE startDate IS NOT NULL").all().map((r) => Number(r.y))]);
  for (const year of [...years].filter(Number.isInteger).sort()) {
    await put(`synthesis/${year}`, () => {
      const res = fakeRes();
      controller.synthesis({ query: { period: 'custom', from: `${year}-01-01`, to: `${year}-12-31` }, user: ADMIN }, res);
      return { status: res.statusCode, body: res.body };
    });
  }
}
console.log = silent;

const hashes = Object.fromEntries(Object.entries(captured).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, sha(v)]));
const out = flag('--out');
if (out) fs.writeFileSync(out, `${JSON.stringify(hashes, null, 1)}\n`);

const against = flag('--compare');
if (!against) {
  const families = {};
  for (const k of Object.keys(hashes)) families[k.split('/')[0]] = (families[k.split('/')[0]] || 0) + 1;
  console.log(`captured ${Object.keys(hashes).length} artefacts`, JSON.stringify(families));
  console.log(`errors: ${Object.entries(captured).filter(([, v]) => v.startsWith('ERROR')).map(([k]) => k).join(', ') || 'none'}`);
  process.exit(0);
}

const before = JSON.parse(fs.readFileSync(against, 'utf8'));
const keys = new Set([...Object.keys(before), ...Object.keys(hashes)]);
const diffs = [...keys].filter((k) => before[k] !== hashes[k]);
console.log(`compared ${keys.size} artefacts: ${diffs.length} difference(s)`);
for (const k of diffs) console.log(`  DIFF ${k}`);
process.exit(diffs.length ? 1 : 0);
