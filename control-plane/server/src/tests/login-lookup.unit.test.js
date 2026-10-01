// specs/control-plane-plans-and-access.md rules 24 and 25 — the lookup: none, one, several spaces; a
// suspended space still a match; case and spaces ignored; the answer carries names and addresses.

const test = require('node:test');
const assert = require('node:assert/strict');
const { makeContext, makeInstance, NEW_CUSTOMER } = require('./helpers');

async function fleet() {
  const h = makeContext({ at: '2026-10-01T08:00:00Z' });
  makeInstance(h.root, 'aulnes', { users: [{ email: 'claire@aulnes.fr' }, { email: 'compta@lamy.fr' }] });
  makeInstance(h.root, 'moulin', { users: [{ email: 'compta@lamy.fr' }] });
  await h.ctx.controllers.customers.create(NEW_CUSTOMER, 'op');
  const m = await h.ctx.controllers.customers.create({ ...NEW_CUSTOMER, slug: 'moulin', companyName: 'Le Moulin', contactEmail: 'jo@moulin.fr', billing: 'monthly', length: 1, startsAt: '2026-06-01' }, 'op');
  h.ctx.controllers.login.readDirectory();
  return { ...h, moulin: m, login: h.ctx.controllers.login };
}

test('rule 24 — none, one, several; the answer holds names and addresses only', async () => {
  const h = await fleet();
  try {
    assert.deepEqual(h.login.lookup('personne@nulle.part'), { kind: 'none', spaces: [] });
    assert.deepEqual(h.login.lookup('pas un email'), { kind: 'invalid', spaces: [] });
    assert.deepEqual(h.login.lookup('  Claire@AULNES.fr '), { kind: 'one', spaces: [{ slug: 'aulnes', name: 'Gîte des Aulnes', address: 'aulnes.guestflow.test' }] });
    const several = h.login.lookup('compta@lamy.fr');
    assert.equal(several.kind, 'several');
    assert.deepEqual(several.spaces.map((s) => s.name), ['Gîte des Aulnes', 'Le Moulin']);
    assert.deepEqual(Object.keys(several.spaces[0]).sort(), ['address', 'name', 'slug']);
  } finally {
    h.cleanup();
  }
});

test('rule 24 — a suspended space is still a match, and the redirect carries the email as a hint', async () => {
  const h = await fleet();
  try {
    h.now.set('2026-09-01T08:00:00Z');
    h.ctx.controllers.customers.reissueAll('op');
    assert.equal(h.ctx.controllers.customers.view(h.moulin.id).state, 'suspended');
    assert.deepEqual(h.login.lookup('compta@lamy.fr').spaces.map((s) => s.slug), ['aulnes', 'moulin']);
    assert.equal(h.login.loginUrl('moulin', ' Compta@Lamy.fr'), 'https://moulin.guestflow.test/login?login_hint=compta%40lamy.fr');
    assert.equal(h.login.loginUrl('moulin'), 'https://moulin.guestflow.test/login');
  } finally {
    h.cleanup();
  }
});
