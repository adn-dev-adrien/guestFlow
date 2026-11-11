// specs/pricing-components.md §3 rule 45 and §7 (`stay-clock-single-source`) — no module but the stay clock decides a stay phase
// or a collection moment by comparing dates. The scan is the `dates` guard of `no-duplicate-formulas` (`helpers/formulaGuards.js`):
// today's call sites wait in its allow-list, each with the PR that moves it behind `stayClock*`. Here the list is held to the
// table of the rule: every listed file is a row of that table, but four that the pattern also meets and the table does not name
// (a date-window check of an entered date, the intake port's started-stay refusal, the SAS lock reason's own files), listed below.
// The list empties in PR C.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { GUARDS, plugin } = require('./helpers/formulaGuards');

const SRC = path.join(__dirname, '..');
const allowed = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'no-duplicate-formulas', 'dates.json'), 'utf8'));
const spec = fs.readFileSync(path.join(SRC, '..', '..', 'specs', 'pricing-components.md'), 'utf8');
const table = spec.slice(spec.indexOf('45. **No other module compares dates'), spec.indexOf('46. **The clock decides the default'));

const NOT_IN_THE_TABLE = {
  [plugin('website-booking', 'publicInputValidation.js')]: { pr: 'PR C', why: 'the public form refuses a start date in the past: a date window, not a phase' },
  'utils/platformIntakePort.js': { pr: 'PR C', why: 'the started-stay refusal of the intakes, moved here from the SDK core service; the intake rows of the table move it in C' },
  'utils/sasEditWindow.js': { pr: 'PR B', why: 'the SAS lock reason that the SAS row of the table calls' },
  'utils/receptionView.js': { pr: 'PR B', why: 'the reception view reads that same lock reason' },
};

test('rule 45: the stay clock files are the only home of the date guard', () => {
  const dates = GUARDS.find((guard) => guard.name === 'dates');
  assert.ok(dates.isHome('utils/pricing/stayClock.js'));
  assert.ok(dates.isHome('models/stayClockModel.js'));
  assert.ok(!dates.isHome('utils/arrivalMoment.js'));
});

test('rule 45: every call site still waiting is a row of the rule\'s table, or one of the named exceptions', () => {
  const unknown = [];
  for (const file of new Set(allowed.map((entry) => entry.file))) {
    const base = path.basename(file, '.js');
    const [top, owner] = file.split('/');
    const named = table.includes(base) || (top === 'plugins' && table.includes(plugin(owner)));
    if (!named && !(file in NOT_IN_THE_TABLE)) unknown.push(file);
  }
  assert.deepEqual(unknown, [], 'a date comparison that decides a phase is not in the table of rule 45');
  for (const [file, { pr }] of Object.entries(NOT_IN_THE_TABLE)) {
    assert.ok(allowed.some((entry) => entry.file === file && entry.removedBy === pr), `${file} is listed with ${pr}`);
  }
});

test('rule 45: the PR that moves each site is the one the table gives (B for the fiche, the mid-stay window, the checkout and the SAS; C for the rest)', () => {
  const byFile = (file) => allowed.filter((entry) => entry.file === file).map((entry) => entry.removedBy);
  for (const file of ['utils/midStayExtrasWindow.js', 'models/reservationsModel.js']) assert.ok(byFile(file).every((pr) => pr === 'PR B'), file);
  for (const file of ['utils/paymentDeadlines.js', 'utils/platformPriceCheck.js', 'models/clientsModel.js', 'utils/arrivalMoment.js']) assert.ok(byFile(file).every((pr) => pr === 'PR C'), file);
  const controller = allowed.filter((entry) => entry.file === 'controllers/reservationsController.js');
  assert.ok(controller.some((entry) => entry.removedBy === 'PR B') && controller.some((entry) => entry.removedBy === 'PR C'));
  for (const intake of ['airbnb-intake', 'booking-intake', 'gites-de-france-intake']) assert.deepEqual(byFile(plugin(intake, 'intakeService.js')), ['PR C']);
});
