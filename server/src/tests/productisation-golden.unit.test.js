// specs/plugins-phase-p-productisation.md rule 26 — Solio sees no difference. The six sequence emails,
// French and English, for six Solio stays, rendered through the real preview path. The expected
// output was captured on the code before phase P; `GOLDEN_UPDATE=1` rewrites it, which is only ever
// legitimate on that code.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { buildSolioDb, STAYS, FIXTURES } = require('./productisationGoldenFixture');

const GOLDEN = path.join(FIXTURES, 'golden.json');

const db = buildSolioDb();
const registry = require('../plugins/sdk/registry');
const { loadReservationGraph } = require('../utils/reservationEmailGraph');
const { buildContext } = require('../utils/emailContextBuilder');
const { renderTemplate } = require('../utils/emailTemplateRenderer');
const { SEQUENCE_STABLE_KEYS, MAIL } = require('../utils/guestEmailSequence');

registry.configure({ isActive: (id) => id === 'hourly-resources', allows: () => true });

const SEASON = {
  [MAIL.NOVEMBER]: { sendDate: '2027-11-15', giftDeadline: '2027-12-15', unsubscribeUrl: 'https://guestflow.example/preferences/emails?t=abc' },
  [MAIL.JANUARY]: { sendDate: '2028-01-06', giftDeadline: '2028-02-29', unsubscribeUrl: 'https://guestflow.example/preferences/emails?t=abc' },
};

function renderAll() {
  const settings = db.prepare('SELECT * FROM app_settings LIMIT 1').get();
  const templates = db.prepare('SELECT * FROM email_templates').all();
  const out = {};
  for (const stay of STAYS) {
    const graph = loadReservationGraph(db, stay.id);
    for (const key of SEQUENCE_STABLE_KEYS) {
      const template = templates.find((t) => t.stableKey === key);
      for (const lang of ['fr', 'en']) {
        const context = buildContext({
          ...graph, settings, lang, sequence: SEASON[key] || { lastMinute: false },
        });
        const side = lang === 'en'
          ? { subject: template.subjectEn, body: template.bodyEn }
          : { subject: template.subject, body: template.body };
        const { subject, body } = renderTemplate(side, context);
        out[`${stay.id}/${key}/${lang}`] = `${subject}\n\n${body}`;
      }
    }
  }
  return out;
}

test('rule 26: the six sequence emails render byte for byte as before phase P', () => {
  const actual = renderAll();
  if (process.env.GOLDEN_UPDATE === '1') {
    fs.writeFileSync(GOLDEN, `${JSON.stringify(actual, null, 2)}\n`);
    return;
  }
  const expected = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
  assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort());
  for (const key of Object.keys(expected)) assert.equal(actual[key], expected[key], key);
});
