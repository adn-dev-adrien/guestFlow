// The tables the price gate's loader leaves in a fresh database for the synthetic set, as it is or dressed as a capture
// (`as-capture` gives it the capture's `meta`); read by price-gate-loader.unit.test.js, one process per load. Wall-clock
// audit columns (written by SQLite when a row is inserted) are left out: they say when the load ran, not what it loaded.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const fs = require('node:fs');
const path = require('node:path');

const inputs = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'price-gate', 'inputs.json'), 'utf8'));
const { freezeClock } = require('../vatRegimeGoldenFixture');
freezeClock(new Date(inputs.meta.capturedAt));
const db = require('../../database');
const { loadInputs } = require('../../../../scripts/price-gate/recompute');

const set = process.argv[2] === 'as-capture' ? { ...inputs.synthetic, meta: inputs.meta } : inputs.synthetic;
loadInputs(db, set);
const WALL_CLOCK = /^(created|updated|installed)(At|_at)$/;
const tables = Object.fromEntries(Object.keys(set.tables).map((table) => [
  table,
  db.prepare(`SELECT * FROM ${table}`).all()
    .map((row) => JSON.stringify(Object.fromEntries(Object.entries(row).filter(([column]) => !WALL_CLOCK.test(column)))))
    .sort(),
]));
process.stdout.write(`\nPRICE_GATE_TABLES ${JSON.stringify(tables)}\n`);
