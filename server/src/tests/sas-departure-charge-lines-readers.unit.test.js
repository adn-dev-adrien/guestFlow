// specs/pricing-components.md §3 rule 90.2 — a departure charge line is outside the stay's sale, so every statement of the server that
// reads `reservation_custom_options` either leaves the departure lines out (`notDepartureCharge`) or reads only rows a departure line
// can never be (the arrival SAS's rows, rows routed to the arrival complement, one row named by its key or id). A new reader that does
// neither fails here: it would count a departure charge a second time, beside the end-of-stay detail that already bills it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const GUARDS = [
  /notDepartureCharge\(/, /\$\{own\}/, /sasArrivalOrigin, 0\) = 1/, /sasArrivalOrigin = 1/, /inComplement, 0\) = 1/, /sasLineKey = \?/, /lineId = \?/,
  /sasLineKey LIKE '\$\{DEPARTURE_LINE_PREFIX\}%'/,
];
// Statements that read no line of the sale, each with its reason.
const ALLOWED = new Map([
  ['models/reservationsModel.js|SELECT COALESCE(MAX(sortOrder), -1) AS m FROM reservation_custom_options', 'the next sort position: an order, no amount'],
  ['models/reservationsModel.js|DELETE FROM reservation_custom_options WHERE id = ?', 'deletes a row the arrival SAS rewrite read with sasArrivalOrigin = 1'],
  ['utils/departureChargeLines.js|SELECT COALESCE(MAX(sortOrder), -1) AS m FROM reservation_custom_options', 'the departure lines\' own writer'],
  ['utils/departureChargeLines.js|DELETE FROM reservation_custom_options WHERE id = ?', 'the departure lines\' own writer'],
  ['utils/sasUpsellOptionMigration.js|DELETE FROM reservation_custom_options WHERE id = ?', 'deletes a row the migration read with sasArrivalOrigin = 1'],
]);

const sources = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const full = path.join(dir, entry.name);
  if (entry.isDirectory()) return ['tests', 'node_modules'].includes(entry.name) ? [] : sources(full);
  return entry.name.endsWith('.js') ? [full] : [];
});

test('rule 90.2 — every read of reservation_custom_options leaves the departure lines out or cannot meet one', () => {
  const unguarded = [];
  for (const file of sources(ROOT)) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, index) => {
      if (!/FROM\s+reservation_custom_options\b/.test(line)) return;
      const statement = lines.slice(Math.max(0, index - 2), index + 4).join('\n');
      if (GUARDS.some((guard) => guard.test(statement))) return;
      const name = path.relative(ROOT, file);
      if ([...ALLOWED.keys()].some((key) => key.startsWith(`${name}|`) && line.includes(key.split('|')[1]))) return;
      unguarded.push(`${name}:${index + 1}: ${line.trim().slice(0, 160)}`);
    });
  }
  assert.deepEqual(unguarded, [], 'add notDepartureCharge(db) to these statements, or list them in ALLOWED with the reason');
});
