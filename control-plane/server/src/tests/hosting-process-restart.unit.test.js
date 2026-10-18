// specs/hosting-h1-fleet-runtime.md rule 29 — a process that failed (or runs without answering) is
// restarted from the customer's page with « Redémarrer », then health-checked; the host alert links
// to that page, on the home page and in the operators' email. The systemd driver clears the unit's
// failure first, so a unit past its start limit restarts too.

const test = require('node:test');
const assert = require('node:assert/strict');
const { makeContext, NEW_CUSTOMER } = require('./helpers');
const { createSystemdProcessDriver } = require('../utils/drivers/process-systemd');

test('rule 29 — « Redémarrer » is offered on a failed process only; it restarts and checks the instance', async () => {
  const h = makeContext();
  try {
    const { customers } = h.ctx.controllers;
    const v = await customers.create(NEW_CUSTOMER, 'op');
    assert.equal(v.actions.restartProcess, false, 'a process that answers');
    await assert.rejects(customers.restartProcess(v.id, 'op'), (e) => e.status === 409 && e.body.error === 'NOT_DOWN');

    h.host.procs.get('aulnes').running = false;
    h.ctx.models.hosting.set(v.id, { unit_state: 'failed', down_since: '2026-09-29T09:50:00.000Z' });
    assert.equal(customers.view(v.id).actions.restartProcess, true);
    const r = await customers.restartProcess(v.id, 'adrien@adn-dev.fr');
    assert.equal(r.notice, 'Processus redémarré ; l’instance répond.');
    assert.deepEqual(h.host.named('process.restart').map((c) => c.slug), ['aulnes']);
    const step = r.steps.find((s) => s.step === 'process-restart');
    assert.equal(step.status, 'ok');
    assert.equal(step.detail, '3.9.0 répond.');
    const row = h.ctx.models.hosting.get(v.id);
    assert.equal(row.unit_state, 'running');
    assert.equal(row.down_since, null);
    assert.equal(r.actions.restartProcess, false);
    assert.ok(r.history.some((x) => x.text === 'Redémarrage du processus demandé'));
  } finally {
    h.cleanup();
  }
});

test('rule 29 — a restart that does not answer fails its step, which « Réessayer » runs again', async () => {
  const h = makeContext();
  try {
    const { customers } = h.ctx.controllers;
    const v = await customers.create(NEW_CUSTOMER, 'op');
    h.ctx.models.hosting.set(v.id, { unit_state: 'failed' });
    h.host.unhealthy.add('3.9.0');
    const r = await customers.restartProcess(v.id, 'op');
    assert.equal(r.notice, 'Redémarrage en échec : voir l’étape.');
    const step = r.steps.find((s) => s.step === 'process-restart');
    assert.equal(step.status, 'failed');
    assert.equal(step.action, 'retry');
    assert.ok(h.ctx.controllers.alerts.list().alerts.some((a) => a.text === 'Gîte des Aulnes : étape « Processus redémarré » en échec.'));
    h.host.unhealthy.delete('3.9.0');
    const again = await customers.stepAction(v.id, 'process-restart', 'retry', 'op');
    assert.equal(again.steps.find((s) => s.step === 'process-restart').status, 'ok');
  } finally {
    h.cleanup();
  }
});

test('rule 29 — a host alert links to the customer’s page, on the home page and in the email', async () => {
  const h = makeContext();
  try {
    const v = await h.ctx.controllers.customers.create(NEW_CUSTOMER, 'op');
    h.ctx.models.operators.create({ email: 'ops@guestflow.test', name: 'Ops', passwordHash: 'x' });
    h.ctx.hostAlerts.open({ key: `down:${v.id}`, customerId: v.id, kind: 'down', text: 'Gîte des Aulnes ne répond plus depuis 3 minutes.' });
    const alert = h.ctx.controllers.alerts.list().alerts.find((a) => a.text.startsWith('Gîte des Aulnes ne répond plus'));
    assert.equal(alert.link, `/clients/${v.id}`);
    await h.ctx.hostAlerts.sendDue();
    const mail = h.mailer.sent.find((m) => m.to === 'ops@guestflow.test');
    assert.ok(mail.text.includes(`• Gîte des Aulnes ne répond plus depuis 3 minutes. https://console.guestflow.test/clients/${v.id}`));
  } finally {
    h.cleanup();
  }
});

test('rule 29 — the systemd driver resets the unit’s failure before restarting it', async () => {
  const calls = [];
  const d = createSystemdProcessDriver({ exec: async (bin, args) => { calls.push([bin, ...args].join(' ')); return { stdout: '' }; } });
  await d.restart({ slug: 'aulnes' });
  assert.deepEqual(calls.slice(-2).map((c) => c.replace(/^.*systemctl /, '')), ['reset-failed guestflow@aulnes.service', 'restart guestflow@aulnes.service']);
});
