// specs/pricing-components.md §3 rule 45 and §7 (`stay-clock-single-source`) — no module but the stay clock decides a stay phase
// or a collection moment by comparing dates. The scan is the `dates` guard of `no-duplicate-formulas` (`helpers/formulaGuards.js`):
// today's call sites wait in its allow-list, each with the PR that moves it behind `stayClock*`. Here the list is held to the
// table of the rule: every listed file is a row of that table. PR C moved every site behind the stay clock but the guest app's
// (stock and sellable days), which move with the J-7 rebuild (pass 4): the list empties there.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { GUARDS, plugin } = require('./helpers/formulaGuards');

const SRC = path.join(__dirname, '..');
const allowed = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'no-duplicate-formulas', 'dates.json'), 'utf8'));
const spec = fs.readFileSync(path.join(SRC, '..', '..', 'specs', 'pricing-components.md'), 'utf8');
const table = spec.slice(spec.indexOf('45. **No other module compares dates'), spec.indexOf('46. **The clock decides the default'));

test('rule 45: the stay clock files are the only home of the date guard', () => {
  const dates = GUARDS.find((guard) => guard.name === 'dates');
  assert.ok(dates.isHome('utils/pricing/stayClock.js'));
  assert.ok(dates.isHome('models/stayClockModel.js'));
});

test('rule 45: every call site still waiting is a row of the rule\'s table', () => {
  const unknown = [];
  for (const file of new Set(allowed.map((entry) => entry.file))) {
    const base = path.basename(file, '.js');
    const [top, owner] = file.split('/');
    const named = table.includes(base) || (top === 'plugins' && table.includes(plugin(owner)));
    if (!named) unknown.push(file);
  }
  assert.deepEqual(unknown, [], 'a date comparison that decides a phase is not in the table of rule 45');
});

test('rule 45: every site of the table is behind the stay clock but the guest app\'s, which wait for the J-7 rebuild', () => {
  assert.ok(allowed.every((entry) => entry.removedBy === 'PR C'), 'no site waits for PR B');
  const waiting = [...new Set(allowed.map((entry) => entry.file))];
  assert.deepEqual(waiting.filter((file) => !file.startsWith(plugin('guest-app') + '/')), [], 'only the guest app\'s sites are left');
  const behind = ['utils/paymentDeadlines.js', 'utils/platformPriceCheck.js', 'models/clientsModel.js', 'utils/platformIntakePort.js', 'controllers/reservationsController.js',
    plugin('website-booking', 'publicInputValidation.js'), ...['airbnb-intake', 'booking-intake', 'gites-de-france-intake'].map((id) => plugin(id, 'intakeService.js')),
    'utils/midStayExtrasWindow.js', 'models/reservationsModel.js', 'utils/endOfStayCheckout.js', 'utils/sasEditWindow.js', 'utils/receptionView.js', plugin('sas', 'controller.js')];
  for (const file of behind) assert.ok(!waiting.includes(file), `${file} reads the stay clock`);
});
