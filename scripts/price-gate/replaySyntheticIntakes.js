#!/usr/bin/env node
/**
 * The crafted platform intakes of the price gate, replayed on the synthetic stays (specs/pricing-components.md §3
 * rules 68 and 71).
 *
 *   DB_PATH=:memory: node scripts/price-gate/replaySyntheticIntakes.js <capturedAt ISO> <inputs.json> <intakes.json> <out.json>
 *
 * Loads the anonymised rows of the `synthetic` section of `inputs.json` into a fresh database, then replays each intake of
 * `intakes.json` (`synthetic.tables`) on its stay through the plugin's own plan -> patch -> save, like `replayIntakes`
 * does for the stored ones. A process of its own, because the synthetic stays and the production copy are two databases.
 * The capture runs it on the baseline code and the gate runs it on the branch; it prints the number of intakes only.
 */
const fs = require('node:fs');
const path = require('node:path');

const [capturedAt, inputsFile, intakesFile, outFile] = process.argv.slice(2);
if (!capturedAt || !inputsFile || !intakesFile || !outFile || process.env.DB_PATH !== ':memory:') {
  console.error('usage: DB_PATH=:memory: replaySyntheticIntakes.js <capturedAt ISO> <inputs.json> <intakes.json> <out.json>');
  process.exit(2);
}
process.env.TZ = 'Europe/Paris';
const root = path.resolve(__dirname, '..', '..');
const { mock } = require('node:test');
mock.timers.enable({ apis: ['Date'], now: new Date(capturedAt).getTime() });
const pinClock = (instant) => { mock.timers.setTime(new Date(instant).getTime()); return () => mock.timers.setTime(new Date(capturedAt).getTime()); };

const print = console.log;
console.log = () => {};
const inputs = JSON.parse(fs.readFileSync(inputsFile, 'utf8'));
const intakes = JSON.parse(fs.readFileSync(intakesFile, 'utf8'));
const db = require(path.join(root, 'server/src/database.js'));
const { loadInputs, replayIntakes } = require('./recompute.js');
loadInputs(db, { tables: inputs.synthetic.tables });
const results = replayIntakes(db, { tables: intakes.synthetic.tables }, pinClock);
mock.timers.reset();
fs.writeFileSync(outFile, `${JSON.stringify(results, null, 1)}\n`);
console.log = print;
print(`synthetic intakes replayed: ${results.length}`);
