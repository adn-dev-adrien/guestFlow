// specs/hosting-h1-fleet-runtime.md rule 24 — a lost invitation is never a dead end: « Reprendre » on
// a failed invitation gives the never-used account a new provisional password and sends it again,
// and the customer's page offers « Renvoyer l’invitation » (an account nobody signed in to) and
// « Réinitialiser l’accès » (any account, second step off), each journaled.

const test = require('node:test');
const assert = require('node:assert/strict');
const { makeContext, NEW_CUSTOMER } = require('./helpers');

// The instance's script, as the console sees it: an account that exists, used or not.
function fakeScript() {
  const state = { exists: false, used: false, n: 0 };
  const run = ({ reissue }) => {
    state.n += 1;
    if (!state.exists) {
      state.exists = true;
      return { created: true, temporaryPassword: `Tmp-${state.n}`, removedBootstrap: true };
    }
    if (!reissue || (reissue === 'unused' && state.used)) return { created: false, temporaryPassword: null, removedBootstrap: false, used: state.used };
    return { created: false, temporaryPassword: `Tmp-${state.n}`, removedBootstrap: false, reissued: true, used: state.used, secondStepOff: reissue === 'always' && state.used };
  };
  return { state, run };
}

test('rule 24 — « Reprendre » after a failed send issues a new provisional password and sends it', async () => {
  const script = fakeScript();
  const h = makeContext({ firstAdmin: script.run });
  try {
    const { customers } = h.ctx.controllers;
    const send = h.mailer.send;
    h.mailer.send = async () => { throw new Error('connect ECONNREFUSED'); };
    const v = await customers.create(NEW_CUSTOMER, 'op');
    assert.equal(v.steps.find((s) => s.step === 'admin').status, 'failed');
    assert.equal(v.actions.resendInvitation, false, 'no access action while the creation is not done');
    h.mailer.send = send;
    await customers.stepAction(v.id, 'admin', 'resume', 'op');
    const after = customers.view(v.id);
    const step = after.steps.find((s) => s.step === 'admin');
    assert.equal(step.status, 'ok');
    assert.equal(step.detail, 'Nouvelle invitation envoyée à claire@aulnes.fr.');
    assert.equal(h.firstAdminCalls[1].reissue, 'unused');
    const [invite] = h.mailer.sent.filter((m) => m.to === 'claire@aulnes.fr');
    assert.match(invite.text, /Mot de passe provisoire : Tmp-2/);
  } finally {
    h.cleanup();
  }
});

test('rule 24 — « Reprendre » on an account already used sends nothing and says so', async () => {
  const script = fakeScript();
  const h = makeContext({ firstAdmin: script.run });
  try {
    const { customers } = h.ctx.controllers;
    const v = await customers.create(NEW_CUSTOMER, 'op');
    script.state.used = true;
    assert.equal(await customers.adminStep(v.id), 'Le compte claire@aulnes.fr a déjà servi : aucune invitation renvoyée.');
  } finally {
    h.cleanup();
  }
});

test('rule 24 — « Renvoyer l’invitation » for a never-used account; refused once it served', async () => {
  const script = fakeScript();
  const h = makeContext({ firstAdmin: script.run });
  try {
    const { customers } = h.ctx.controllers;
    const v = await customers.create(NEW_CUSTOMER, 'op');
    assert.equal(v.actions.resendInvitation, true);
    assert.equal(v.actions.resetAccess, true);
    const r = await customers.resendInvitation(v.id, 'adrien@adn-dev.fr');
    assert.equal(r.notice, 'Invitation renvoyée à claire@aulnes.fr.');
    assert.equal(h.mailer.sent.at(-1).subject, 'Votre espace GuestFlow Gîte des Aulnes est prêt');
    assert.match(h.mailer.sent.at(-1).text, /Mot de passe provisoire : Tmp-2/);
    assert.equal(r.history[0].text, 'Invitation renvoyée à claire@aulnes.fr (nouveau mot de passe provisoire)');
    script.state.used = true;
    await assert.rejects(customers.resendInvitation(v.id, 'op'), (e) => e.status === 409 && e.body.error === 'ALREADY_USED');
  } finally {
    h.cleanup();
  }
});

test('rule 24 — « Réinitialiser l’accès » resets a used account, second step off, and journals it', async () => {
  const script = fakeScript();
  const h = makeContext({ firstAdmin: script.run });
  try {
    const { customers } = h.ctx.controllers;
    const v = await customers.create(NEW_CUSTOMER, 'op');
    script.state.used = true;
    const r = await customers.resetAccess(v.id, 'op');
    assert.equal(h.firstAdminCalls.at(-1).reissue, 'always');
    assert.equal(r.notice, 'Nouveau mot de passe provisoire envoyé à claire@aulnes.fr.');
    const mail = h.mailer.sent.at(-1);
    assert.equal(mail.subject, 'Accès réinitialisé à votre espace GuestFlow Gîte des Aulnes');
    assert.match(mail.text, /a été réinitialisé/);
    assert.equal(r.history[0].text, 'Accès réinitialisé : nouveau mot de passe provisoire envoyé à claire@aulnes.fr, second facteur désactivé');
  } finally {
    h.cleanup();
  }
});

test('rule 24 — a mail that fails is reported, and an archived customer has no access action', async () => {
  const script = fakeScript();
  const h = makeContext({ firstAdmin: script.run });
  try {
    const { customers } = h.ctx.controllers;
    const v = await customers.create(NEW_CUSTOMER, 'op');
    h.mailer.send = async () => { throw new Error('SMTP indisponible'); };
    await assert.rejects(customers.resendInvitation(v.id, 'op'), (e) => e.status === 502 && /Invitation non envoyée : SMTP indisponible/.test(e.message));
    await customers.deprovision(v.id, { confirmSlug: 'aulnes' }, 'op');
    assert.equal(customers.view(v.id).actions.resendInvitation, false);
    await assert.rejects(customers.resetAccess(v.id, 'op'), (e) => e.status === 409 && e.body.error === 'NOT_READY');
  } finally {
    h.cleanup();
  }
});
