// specs/plugins-phase-1-sdk.md rule 10 — a plugin's e-mail variable or condition may name the e-mails it belongs to
// (`in`, like the core catalogue's), so it is offered only there; without `in` it is offered in every e-mail. A
// template that already uses it keeps its chip anywhere. First used by specs/guest-app.md rule 9bis (b).
const test = require('node:test');
const assert = require('node:assert/strict');

const registry = require('../plugins/sdk/registry');
const { createContext } = require('../plugins/sdk/createContext');
const { chipsForTemplate } = require('../utils/templateTokens');

const J7 = { stableKey: 'arrival_reminder_7d', subject: '', body: '' };
const THANKS = { stableKey: 'guest_thanks_j1', subject: '', body: '' };

test('rule 10: a scoped plugin variable shows in its e-mails only, an unscoped one everywhere, a used one where it is used', () => {
  registry.reset();
  registry.configure({ isActive: () => true, allows: () => true });
  try {
    createContext('shop', {}).emailContext({
      tokens: [{ name: 'shopLink', label: 'Lien boutique', in: ['j7', 'j2'] }, { name: 'shopName', label: 'Nom boutique' }],
      flags: [{ name: 'hasShop', label: 'Si boutique', in: ['j7'] }],
      build: () => ({ tokens: {}, flags: {} }),
    });
    const names = (template) => chipsForTemplate(template).variables.map((v) => v.name);
    assert.ok(names(J7).includes('shopLink'));
    assert.ok(names(J7).includes('shopName'));
    assert.ok(!names(THANKS).includes('shopLink'), 'scoped to the J-7 and J-2');
    assert.ok(names(THANKS).includes('shopName'), 'unscoped: every e-mail');
    assert.ok(names({ ...THANKS, body: 'Voir {{shopLink}}' }).includes('shopLink'), 'a template using it keeps its chip');
    assert.ok(chipsForTemplate(J7).conditions.some((c) => c.name === 'hasShop'));
    assert.ok(!chipsForTemplate(THANKS).conditions.some((c) => c.name === 'hasShop'));
  } finally {
    registry.reset();
  }
});
