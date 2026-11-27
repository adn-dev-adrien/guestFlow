// specs/gift-vouchers/gift-voucher-week-weekend-and-print.md rule 29 (K3, K9, D6) — nothing changes for a booking that carries a lodging. Every lodging and guest booking (a stay with its lodging
// or without one, a lodging with no stay, free minutes, offered minutes) is priced to the cent as origin/master priced it (the frozen oracle), on the rows the migration leaves, on a resource
// created since and not sold outside, and — for a lodging with no stay — after a later change of the guests' rates.
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { requirePlugins } = require('../../sdk/testing');

if (!requirePlugins(['hourly-resources'])) return;

const head = require('../bookingPricing');
const master = require('./masterBookingPricing.oracle');
const { explicitHourlyRates } = require('../migrations');

const COLUMNS = ['id', 'name', 'price', 'priceType', 'showsPlanningCard', 'sellableExternally', 'slotDuration', 'openTime', 'closeTime', 'minimumUsageMinutes', 'hourlyEveningStart', 'hourlyEveningRate',
  'hourlyNextDayRate', 'hourlyNextEveningRate', 'hourlyExternalDayRate', 'hourlyExternalEveningRate', 'hourlyExternalNextDayRate', 'hourlyExternalNextEveningRate',
  'hourlyExternalWeekendDayRate', 'hourlyExternalWeekendEveningRate', 'hourlyExternalWeekendNextDayRate', 'hourlyExternalWeekendNextEveningRate'];
const INTEGERS = ['id', 'showsPlanningCard', 'sellableExternally', 'slotDuration', 'minimumUsageMinutes'];
const TEXTS = ['name', 'priceType', 'openTime', 'closeTime', 'hourlyEveningStart'];
const base = { priceType: 'per_hour', showsPlanningCard: 1, sellableExternally: 1, minimumUsageMinutes: 60, openTime: '08:00', closeTime: '23:00' };
const ROWS = [
  { ...base, id: 1, name: 'production bath', price: 30, slotDuration: 60, openTime: '11:00', closeTime: '22:00', hourlyEveningStart: '20:00', hourlyEveningRate: 50, hourlyExternalDayRate: 50, hourlyExternalEveningRate: 70 },
  { ...base, id: 2, name: 'synthetic', price: 22.5, slotDuration: 60, hourlyEveningStart: '18:00', hourlyEveningRate: 31.5, hourlyExternalDayRate: 27.3, hourlyExternalEveningRate: 38.9 },
  { ...base, id: 3, name: 'with following hours', price: 25, slotDuration: 60, hourlyEveningStart: '19:00', hourlyEveningRate: 35, hourlyExternalDayRate: 50, hourlyExternalEveningRate: 70, hourlyExternalNextDayRate: 45, hourlyExternalNextEveningRate: 63, hourlyNextDayRate: 20, hourlyNextEveningRate: 30 },
  { ...base, id: 4, name: 'outside unset, sold', price: 30, slotDuration: 30, hourlyEveningStart: '20:00', hourlyEveningRate: 50, hourlyExternalDayRate: 0, hourlyExternalEveningRate: 0 },
  { ...base, id: 5, name: 'guest evening 0, outside unset', price: 30, slotDuration: 30, hourlyEveningStart: '20:00', hourlyEveningRate: 0, hourlyExternalDayRate: 0, hourlyExternalEveningRate: 0 },
  { ...base, id: 6, name: 'no evening', price: 40, slotDuration: 30, hourlyEveningStart: null, hourlyEveningRate: 0, hourlyExternalDayRate: 60, hourlyExternalEveningRate: 0 },
  { ...base, id: 7, name: 'outside evening unset', price: 30, slotDuration: 30, hourlyEveningStart: '20:00', hourlyEveningRate: 45, hourlyExternalDayRate: 55, hourlyExternalEveningRate: 0 },
  { ...base, id: 8, name: 'not sold outside, outside unset', sellableExternally: 0, price: 30, slotDuration: 30, hourlyEveningStart: '20:00', hourlyEveningRate: 50, hourlyNextDayRate: 30, hourlyNextEveningRate: 50, hourlyExternalDayRate: 0, hourlyExternalEveningRate: 0 },
  { ...base, id: 9, name: 'not sold outside, outside set', sellableExternally: 0, price: 30, slotDuration: 60, hourlyEveningStart: '20:00', hourlyEveningRate: 50, hourlyExternalDayRate: 50, hourlyExternalEveningRate: 70 },
];
const db = new Database(':memory:');
db.exec(`CREATE TABLE resources (${COLUMNS.map((c) => `${c} ${INTEGERS.includes(c) ? 'INTEGER' : (TEXTS.includes(c) ? 'TEXT' : 'REAL')}`).join(', ')})`);
const insert = db.prepare(`INSERT INTO resources (${COLUMNS.join(',')}) VALUES (${COLUMNS.map((c) => `@${c}`).join(',')})`);
ROWS.forEach((row) => insert.run(Object.fromEntries(COLUMNS.map((c) => [c, row[c] === undefined ? null : row[c]]))));
explicitHourlyRates(db);
const MIGRATED = Object.fromEntries(db.prepare('SELECT * FROM resources').all().map((row) => [row.id, row]));

// date-literal-ok: calendar days of 2026 compared with a frozen oracle, never with today
const DATES = ['2026-11-25', '2026-11-27', '2026-11-28', '2026-11-29', '2026-12-24', '2026-12-25', '2026-05-13', '2026-05-14'];
const RANGES = [['11:00', '12:00'], ['11:00', '13:00'], ['19:00', '20:00'], ['19:00', '21:00'], ['20:00', '21:00'], ['21:00', '22:00'], ['11:15', '12:15'], ['19:30', '21:00'], ['13:00', '14:30'], ['17:30', '19:30']];
const PARTIES = [
  { name: 'stay with a lodging, free 60', reservationId: 25, free: 60 },
  { name: 'stay with a lodging, free 0', reservationId: 25, free: 0 },
  { name: 'stay with no lodging', reservationId: 25, free: null },
  { name: 'lodging with no stay, free 60', reservationId: null, free: 60 },
  { name: 'lodging with no stay, free 30', reservationId: null, free: 30 },
  { name: 'lodging with no stay, free 0', reservationId: null, free: 0 },
];

function compare(masterRow, headRow, parties) {
  let compared = 0;
  const differences = [];
  for (const date of DATES) {
    for (const [startTime, endTime] of RANGES) {
      for (const party of parties) {
        for (const offered of [0, 30]) {
          if (offered && party.free === null) continue;
          const override = party.free === null ? null : { price: null, freeMinutes: party.free };
          const lodging = Boolean(party.reservationId) || party.free !== null;
          const wanted = master.priceBookingLines({ resource: masterRow, startTime, endTime, override, external: !party.reservationId, offeredMinutes: offered, freeHourAtDayRate: true });
          const got = head.priceBookingLines({
            resource: headRow, startTime, endTime, override, external: !party.reservationId, offeredMinutes: offered, freeHourAtDayRate: true, date: lodging ? null : date, lodging, judgeBands: true,
          });
          compared += 1;
          if (got.refusal || Math.round(wanted.total * 100) !== Math.round(got.total * 100)) differences.push(`${masterRow.name} | ${date} ${startTime}-${endTime} | ${party.name} offered ${offered}: master ${wanted.total}, now ${got.refusal || got.total}`);
        }
      }
    }
  }
  return { compared, differences };
}

for (const row of ROWS) {
  test(`${row.name}: every lodging and guest booking is priced as origin/master prices it, on the migrated row`, () => {
    const { compared, differences } = compare(row, MIGRATED[row.id], PARTIES);
    assert.ok(compared > 800);
    assert.deepEqual(differences.slice(0, 5), []);
  });
}

test('a resource created since and not sold outside (outside columns empty) is priced as master prices it', () => {
  const created = { ...base, id: 20, name: 'created since', sellableExternally: 0, price: 30, slotDuration: 30, hourlyEveningStart: '20:00', hourlyEveningRate: 50, hourlyNextDayRate: 30, hourlyNextEveningRate: 50 };
  const masterRow = { ...created, hourlyExternalDayRate: 0, hourlyExternalEveningRate: 0 };
  const { differences } = compare(masterRow, created, PARTIES);
  assert.deepEqual(differences.slice(0, 5), []);
});

test('a migrated resource not sold outside keeps following the guests\' rates for a lodging with no stay', () => {
  const lodgingNoStay = PARTIES.filter((party) => party.reservationId === null);
  for (const id of [8, 9]) {
    const later = { price: 36, hourlyEveningRate: 58 };
    const masterRow = { ...ROWS.find((r) => r.id === id), ...later };
    const headRow = { ...MIGRATED[id], ...later };
    const { differences } = compare(masterRow, headRow, lodgingNoStay);
    assert.deepEqual(differences.slice(0, 5), [], `resource ${id}`);
  }
});

test('the migration fills an outside first hour only for a resource sold outside, and copies the week grid to the weekend grid only where it is empty', () => {
  assert.equal(MIGRATED[8].hourlyExternalDayRate, 0);
  assert.equal(MIGRATED[4].hourlyExternalDayRate, 30);
  assert.equal(MIGRATED[1].hourlyExternalWeekendDayRate, 50);
  const again = new Database(':memory:');
  again.exec(`CREATE TABLE resources (${COLUMNS.map((c) => `${c} ${INTEGERS.includes(c) ? 'INTEGER' : (TEXTS.includes(c) ? 'TEXT' : 'REAL')}`).join(', ')})`);
  again.prepare(`INSERT INTO resources (${COLUMNS.join(',')}) VALUES (${COLUMNS.map((c) => `@${c}`).join(',')})`)
    .run(Object.fromEntries(COLUMNS.map((c) => [c, { ...ROWS[0], hourlyExternalWeekendDayRate: 99 }[c] ?? null])));
  explicitHourlyRates(again);
  assert.equal(again.prepare('SELECT hourlyExternalWeekendDayRate AS d FROM resources').get().d, 99, 'a captured weekend value is never overwritten');
});
