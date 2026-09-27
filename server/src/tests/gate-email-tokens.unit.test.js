// The gate-key tokens in the emails — specs/gate-access-sowel-connector.md §3.5 rule 23.
//
// Composing an email NEVER reaches the house. The tokens come from the stored result, so an email
// leaves with its paragraph or without it, but it never sits waiting.

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildContext } = require('../utils/emailContextBuilder');

const base = {
  reservation: { reservationNumber: '202609042', startDate: '2026-09-04', endDate: '2026-09-11' },
  client: { firstName: 'Camille', lastName: 'Dupont', email: 'camille@example.com' },
  property: { name: 'Le Gîte' },
  settings: { companyName: 'Domaine' },
};

test('with an invitation, the code and the link are there and the paragraph shows', () => {
  const { vars, flags } = buildContext({
    ...base,
    gateInvitation: { code: '4K7M-9QT2', url: 'https://acces.domainesolio.com/#i=4K7M9QT2' },
  });
  assert.equal(vars.gateAccessCode, '4K7M-9QT2');
  assert.equal(vars.gateAccessUrl, 'https://acces.domainesolio.com/#i=4K7M9QT2');
  assert.equal(flags.hasGateAccess, true);
});

test('with no invitation, the tokens are empty and the paragraph is skipped', () => {
  const { vars, flags } = buildContext(base);
  assert.equal(vars.gateAccessCode, '');
  assert.equal(vars.gateAccessUrl, '');
  assert.equal(flags.hasGateAccess, false);
});

test('a code with no link is still useful — it can be dictated over the phone', () => {
  const { vars, flags } = buildContext({ ...base, gateInvitation: { code: '4K7M-9QT2', url: null } });
  assert.equal(flags.hasGateAccess, true);
  assert.equal(vars.gateAccessUrl, '');
});

test('a link with no code is enough too — a profile without a code installs by its link', () => {
  const { vars, flags } = buildContext({ ...base, gateInvitation: { code: null, url: 'https://x/#i=y' } });
  assert.equal(flags.hasGateAccess, true);
  assert.equal(vars.gateAccessCode, '');
  assert.equal(vars.gateAccessUrl, 'https://x/#i=y');
});
