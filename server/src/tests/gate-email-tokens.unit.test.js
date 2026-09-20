// The gate-access tokens in the emails — specs/gate-access-sowel-connector.md §3.4, rule 17.
//
// The point of v3: composing an email NEVER reaches the house. The tokens come from the local copy,
// so an email leaves with its paragraph or without it, but it never sits waiting.

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
    gateInvitation: { code: '4K7M-9QT2', url: 'https://sowel.example.com/p/guest-access/#i=4K7M9QT2' },
  });
  assert.equal(vars.gateAccessCode, '4K7M-9QT2');
  assert.equal(vars.gateAccessUrl, 'https://sowel.example.com/p/guest-access/#i=4K7M9QT2');
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

test('a link with no code is not', () => {
  const { flags } = buildContext({ ...base, gateInvitation: { code: null, url: 'https://x/#i=y' } });
  assert.equal(flags.hasGateAccess, false);
});
