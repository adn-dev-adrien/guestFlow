const test = require('node:test');
const assert = require('node:assert/strict');

const { buildContext } = require('../utils/emailContextBuilder');
const { renderTemplate } = require('../utils/emailTemplateRenderer');
const {
  ARRIVAL_REMINDER_7D_BODY,
  ARRIVAL_REMINDER_1D_BODY,
  ARRIVAL_REMINDER_7D_BODY_EN,
  ARRIVAL_REMINDER_1D_BODY_EN,
} = require('../utils/defaultEmailTemplatesRegistry');

// specs/guest-gate-access.md §3.6 rule 23 — the J-7 and J-2 passes are what put the code in the
// guest's hands. These pin the three tokens and, above all, that a stay WITHOUT an access renders
// no orphan paragraph: the emails go out for devis and cancellations too.

const CARD = {
  code: '4K7M-9QT2',
  url: 'https://guest.domainesolio.com/?c=4K7M9QT2',
  permanentUrl: 'https://guest.domainesolio.com',
};

function context(gateAccess) {
  return buildContext({
    reservation: {
      id: 1, startDate: '2026-09-12', endDate: '2026-09-14', checkInTime: '16:00', checkOutTime: '10:00',
      reservationNumber: '202609042', adults: 2, finalPrice: 600,
    },
    client: { firstName: 'Camille', lastName: 'Roux' },
    property: { name: 'Le Gîte' },
    settings: { companyPhone: '06.15.73.93.37', senderName: 'Domaine Solio' },
    gateAccess,
  });
}

test('the three tokens carry the code, the personal link and the permanent address', () => {
  const { vars, flags } = context(CARD);
  assert.equal(flags.hasGateAccess, true);
  assert.equal(vars.gateAccessCode, '4K7M-9QT2');
  assert.equal(vars.gateAccessUrl, 'https://guest.domainesolio.com/?c=4K7M9QT2');
  assert.equal(vars.gateAccessBaseUrl, 'https://guest.domainesolio.com');
});

test('a stay with no access sets the flag false and leaves the tokens empty', () => {
  for (const missing of [null, undefined, {}, { code: '4K7M-9QT2' }, { url: 'https://x' }]) {
    const { vars, flags } = context(missing);
    assert.equal(flags.hasGateAccess, false, `no paragraph for ${JSON.stringify(missing)}`);
    assert.equal(vars.gateAccessCode, '');
    assert.equal(vars.gateAccessUrl, '');
  }
});

test('both arrival reminders render the paragraph, in both languages', () => {
  const built = context(CARD);
  for (const [name, body] of [
    ['J-7 FR', ARRIVAL_REMINDER_7D_BODY],
    ['J-2 FR', ARRIVAL_REMINDER_1D_BODY],
    ['J-7 EN', ARRIVAL_REMINDER_7D_BODY_EN],
    ['J-2 EN', ARRIVAL_REMINDER_1D_BODY_EN],
  ]) {
    const rendered = renderTemplate({ subject: 'Votre séjour', body }, built).body;
    assert.match(rendered, /guest\.domainesolio\.com\/\?c=4K7M9QT2/, `${name}: the link`);
    assert.match(rendered, /4K7M-9QT2/, `${name}: the code`);
    assert.doesNotMatch(rendered, /\{\{/, `${name}: no token left unrendered`);
  }
});

test('without an access, the paragraph disappears entirely — no empty line, no stray label', () => {
  const built = context(null);
  for (const [name, body] of [
    ['J-7 FR', ARRIVAL_REMINDER_7D_BODY],
    ['J-2 FR', ARRIVAL_REMINDER_1D_BODY],
    ['J-7 EN', ARRIVAL_REMINDER_7D_BODY_EN],
    ['J-2 EN', ARRIVAL_REMINDER_1D_BODY_EN],
  ]) {
    const rendered = renderTemplate({ subject: 'Votre séjour', body }, built).body;
    assert.doesNotMatch(rendered, /portail depuis votre téléphone/i, `${name}`);
    assert.doesNotMatch(rendered, /Opening the gate/i, `${name}`);
    assert.doesNotMatch(rendered, /gateAccess/i, `${name}: no token name leaked`);
    assert.doesNotMatch(rendered, /\{\{/, `${name}: no token left unrendered`);
  }
});
