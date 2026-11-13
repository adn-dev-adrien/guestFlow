// specs/pricing-components.md §3 rule 90.2 — the books never see a departure charge twice: on the golden database, every stay given
// the same departure charges leaves the same accounting output (each month's CSV bytes, sales JSON, platforms preview, synthesis)
// whether its charges are only in the stored end-of-stay detail (every stay before rule 90.2) or also its departure lines.
//
// Each reading runs in a process of its own: the golden builder reuses one database per process, and a second build in the same
// process books some instalments of 2027 differently from the first (measured 2026-11-13, before rule 90.2), so readings built in
// one process are not comparable.
const { execFileSync } = require('child_process');
const { syncDepartureChargeLines } = require('../utils/departureChargeLines');

const DETAIL = [
  { label: 'Ménage de fin de séjour', qty: 1, unitPrice: 70, amount: 70 },
  { label: 'Plomb manquant', repairKey: 'extinguisher_seal', qty: 1, amount: 30 },
];
const READING = 'DEPARTURE_CHARGE_BOOKS_READING';

function reading(mode) {
  const { buildVatGoldenDb } = require('./vatRegimeGoldenFixture');
  const { accountingOutputHashes } = require('./accountingOutputFixture');
  const db = buildVatGoldenDb();
  const stays = db.prepare("SELECT id, endDate FROM reservations WHERE kind = 'reservation'").all();
  if (mode !== 'untouched') {
    for (const s of stays) {
      db.prepare(`UPDATE reservations SET endOfStayComplementAmount = 100, endOfStayComplementDetail = ?, endOfStayComplementPaid = 1,
        endOfStayComplementPaidDate = ? WHERE id = ?`).run(JSON.stringify(DETAIL), s.endDate, s.id);
      if (mode === 'lined') syncDepartureChargeLines(db, s.id, DETAIL, { create: true });
    }
  }
  const lines = db.prepare("SELECT COUNT(*) AS n FROM reservation_custom_options WHERE sasLineKey LIKE 'departure:%'").get().n;
  return { stays: stays.length, lines, hashes: accountingOutputHashes(db).actual };
}

if (process.env[READING]) {
  const silent = console.log;
  console.log = () => {};
  const out = reading(process.env[READING]);
  console.log = silent;
  process.stdout.write(`\n${JSON.stringify(out)}\n`);
} else {
  const test = require('node:test');
  const assert = require('node:assert/strict');
  const { skipWithout } = require('../plugins/sdk/testing');

  const read = (mode) => {
    const out = execFileSync(process.execPath, [...process.execArgv, __filename], {
      env: { ...process.env, [READING]: mode }, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    });
    return JSON.parse(out.trim().split('\n').pop());
  };

  test('rule 90.2 — the golden books are byte-identical whether the departure charges are lines or not', { skip: skipWithout(['accounting-export']) }, () => {
    const untouched = read('untouched');
    const detailOnly = read('detail');
    const lined = read('lined');
    assert.ok(lined.stays >= 5);
    assert.equal(detailOnly.lines, 0);
    assert.equal(lined.lines, lined.stays * DETAIL.length, 'every stay holds its two departure lines');
    assert.ok(Object.keys(detailOnly.hashes).some((k) => detailOnly.hashes[k] !== untouched.hashes[k]), 'the charges reach the books: the comparison is not vacuous');
    assert.deepEqual(lined.hashes, detailOnly.hashes);
  });
}
