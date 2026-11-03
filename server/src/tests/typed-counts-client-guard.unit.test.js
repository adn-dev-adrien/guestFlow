// specs/non-card-option-served-persons.md rules 11 and 25 — the decimals were born in the browser, which
// divided what the operator typed by the party. These files must never convert a typed value again.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const clientFile = (relative) => fs.readFileSync(path.join(__dirname, '..', '..', '..', 'client', 'src', relative), 'utf8');

for (const file of ['components/reservation/OptionRow.jsx', 'components/reservation/MidStayNoteDialog.jsx']) {
  test(`rule 25 — ${file} converts no typed value with a multiplier`, () => {
    assert.doesNotMatch(clientFile(file), /toBaseQuantity|toDisplayedQuantity|getQuantityMultiplier/);
  });
}

test('rule 11 — the typed count helper does no arithmetic', () => {
  const code = clientFile('utils/optionTypedCount.js').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(code, /[^=!<>]\s[*/+-]\s/);
});

test('rule 22 — the fiche answers the save guard through the existing confirm dialog', () => {
  const page = clientFile('pages/ReservationPage.jsx');
  assert.match(page, /quote\.typedCountAlerts\?\.length > 0 && !forceTypedCounts/);
  assert.match(page, /title: 'Quantités saisies à vérifier'/);
});
