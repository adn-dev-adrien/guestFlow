// specs/hosting-h1-fleet-runtime.md rules 15–17 and 20 — the fleet view shows real values; the probe
// raises console alerts at its thresholds (down 3 minutes, backup older than 1 h, disk above 85 %,
// certificate within 14 days, memory above 90 %, the platform's daily email limit), each emailed
// once, repeated every 24 h while open, and closed by itself when the condition clears.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { makeContext, NEW_CUSTOMER } = require('./helpers');
const { createProbe } = require('../tasks/probe');

async function oneCustomer(opts = {}) {
  const h = makeContext({ at: '2026-10-08T08:00:00Z', ...opts });
  await h.ctx.models.operators.create({ email: 'adrien@adn-dev.fr', name: 'Adrien', passwordHash: 'x' });
  const c = await h.ctx.controllers.customers.create(NEW_CUSTOMER, 'op');
  h.mailer.sent.length = 0;
  return { ...h, c };
}

const alertTexts = (h) => h.ctx.controllers.alerts.list().alerts.map((a) => a.text);
const alertMails = (h) => h.mailer.sent.filter((m) => /alerte\(s\) d’hébergement/.test(m.subject));

test('rule 15 — the fleet row carries the version, the process, the last backup and verified restore, the disk and the certificate', async () => {
  const h = await oneCustomer();
  try {
    h.host.certs.aulnes = '2027-01-02T10:00:00.000Z';
    fs.writeFileSync(path.join(h.root, 'aulnes', 'uploads', 'photo.jpg'), Buffer.alloc(3 * 1048576));
    h.ctx.models.hosting.set(h.c.id, { last_backup_verified_at: '2026-10-04T03:00:00.000Z' });
    h.host.replicas.get(`c${h.c.id}`).stalled = true;
    h.now.set('2026-10-08T08:02:00Z');
    await h.ctx.probe.runOnce();
    const row = h.ctx.controllers.customers.fleet().rows[0];
    assert.equal(row.version, '3.9.0');
    assert.equal(row.process, 'En marche');
    assert.equal(row.processSeverity, 'success');
    assert.match(row.lastBackup, /^il y a 2 min$/);
    assert.equal(row.verified, '04/10');
    assert.match(row.disk, /^3,\d Mo$/);
    assert.equal(row.cert, '02/01/2027');
    assert.equal(row.certSeverity, null);
    const card = h.ctx.controllers.customers.view(h.c.id).hosting;
    assert.deepEqual(card.lines.map((l) => l.label), ['Version', 'Port', 'Processus', 'Dernière sauvegarde', 'Restauration vérifiée', 'Disque', 'Certificat', 'Emails par la plateforme']);
  } finally {
    h.cleanup();
  }
});

test('rule 16 — an instance down for 3 minutes in a row raises an alert, emailed once; it closes when the instance answers', async () => {
  const h = await oneCustomer();
  try {
    h.host.procs.get('aulnes').running = false;
    await h.ctx.probe.runOnce();
    h.now.set('2026-10-08T08:02:00Z');
    await h.ctx.probe.runOnce();
    assert.equal(alertTexts(h).filter((t) => /ne répond plus/.test(t)).length, 0, 'two minutes: not yet');
    assert.equal(h.ctx.controllers.customers.fleet().rows[0].process, 'Arrêté');
    h.now.set('2026-10-08T08:03:00Z');
    await h.ctx.probe.runOnce();
    assert.ok(alertTexts(h).includes('Gîte des Aulnes ne répond plus depuis 3 minutes.'));
    assert.equal(alertMails(h).length, 1);
    assert.equal(alertMails(h)[0].to, 'adrien@adn-dev.fr');
    h.now.set('2026-10-08T08:04:00Z');
    await h.ctx.probe.runOnce();
    assert.equal(alertMails(h).length, 1, 'never every minute');
    h.host.procs.get('aulnes').running = true;
    h.now.set('2026-10-08T08:05:00Z');
    await h.ctx.probe.runOnce();
    assert.ok(!alertTexts(h).some((t) => /ne répond plus/.test(t)), 'closed by itself');
  } finally {
    h.cleanup();
  }
});

test('rule 17 — an alert still open is sent again every 24 h; a reopened alert is sent at once', async () => {
  const h = await oneCustomer();
  try {
    h.host.certs.aulnes = '2026-10-15T00:00:00.000Z';
    await h.ctx.probe.runOnce();
    assert.ok(alertTexts(h).includes('Gîte des Aulnes : certificat expirant le 15/10/2026.'));
    assert.equal(alertMails(h).length, 1);
    h.now.set('2026-10-09T07:59:00Z');
    await h.ctx.probe.runOnce();
    assert.equal(alertMails(h).length, 1);
    h.now.set('2026-10-09T08:00:00Z');
    await h.ctx.probe.runOnce();
    assert.equal(alertMails(h).length, 2, 'repeated after 24 h');
    h.host.certs.aulnes = '2027-01-15T00:00:00.000Z';
    h.now.set('2026-10-09T08:01:00Z');
    await h.ctx.probe.runOnce();
    assert.ok(!alertTexts(h).some((t) => /certificat/.test(t)));
    h.host.certs.aulnes = '2026-10-20T00:00:00.000Z';
    h.now.set('2026-10-09T08:02:00Z');
    await h.ctx.probe.runOnce();
    assert.equal(alertMails(h).length, 3, 'a new opening is news');
  } finally {
    h.cleanup();
  }
});

test('rule 16 — a backup older than 1 h, memory above 90 %, the host disk above 85 %', async () => {
  const h = await oneCustomer();
  try {
    const probe = createProbe({
      models: h.ctx.models, drivers: h.host.drivers, provisioner: h.ctx.provisioner, alerts: h.ctx.hostAlerts, now: h.now,
      fetchImpl: h.host.fetchImpl, root: h.root, today: () => '2026-10-08', diskRatio: () => 0.88,
    });
    h.host.memory.aulnes = { current: 470 * 1048576, max: 512 * 1048576 };
    h.host.replicas.get(`c${h.c.id}`).stalled = true;
    h.now.set('2026-10-08T09:30:00Z');
    await probe.runOnce();
    const texts = alertTexts(h);
    assert.ok(texts.some((t) => /^Gîte des Aulnes : dernière sauvegarde répliquée le 08\/10\/2026 10:00\.$/.test(t)), JSON.stringify(texts));
    assert.ok(texts.includes('Gîte des Aulnes utilise plus de 90 % de sa mémoire.'));
    assert.ok(texts.includes('Disque de l’hôte rempli à 88 %.'));
    assert.equal(h.ctx.controllers.customers.fleet().rows[0].lastBackupSeverity, 'error');
    assert.equal(alertMails(h).length, 1, 'one email for the three');
    assert.equal(alertMails(h)[0].text.split('\n').filter((l) => l.startsWith('• ')).length, 3);
  } finally {
    h.cleanup();
  }
});

test('edge case — unreachable object storage: the instance keeps running and the « backup older than 1 h » alert fires', async () => {
  const h = await oneCustomer();
  try {
    h.host.drivers.backup.lastReplicatedAt = async () => { throw new Error('dial tcp: i/o timeout'); };
    h.now.set('2026-10-08T09:01:00Z');
    await h.ctx.probe.runOnce();
    assert.ok(alertTexts(h).includes('Gîte des Aulnes : dernière sauvegarde répliquée jamais.'));
    assert.equal(h.host.procs.get('aulnes').running, true);
  } finally {
    h.cleanup();
  }
});

test('rule 20 — the platform’s emails are counted per instance per day; the limit raises an operator alert', async () => {
  const h = await oneCustomer();
  try {
    const file = path.join(h.root, 'aulnes', 'data', 'platform-mail.json');
    fs.writeFileSync(file, JSON.stringify({ day: '2026-10-08', count: 120 }));
    await h.ctx.probe.runOnce();
    assert.equal(h.ctx.models.hosting.mailCount(h.c.id, '2026-10-08'), 120);
    assert.equal(h.ctx.controllers.customers.view(h.c.id).hosting.lines.at(-1).value, '120 / 300 aujourd’hui');
    fs.writeFileSync(file, JSON.stringify({ day: '2026-10-08', count: 300 }));
    await h.ctx.probe.runOnce();
    assert.ok(alertTexts(h).includes('Gîte des Aulnes : limite de 300 emails par jour atteinte, envois refusés.'));
    h.now.set('2026-10-09T08:00:00Z');
    await h.ctx.probe.runOnce();
    assert.ok(!alertTexts(h).some((t) => /limite de 300/.test(t)), 'a new day, a new quota');
  } finally {
    h.cleanup();
  }
});

test('rule 16 — a deprovisioned customer is stopped on purpose: no « down » alert', async () => {
  const h = await oneCustomer();
  try {
    await h.ctx.controllers.customers.deprovision(h.c.id, { confirmSlug: 'aulnes' }, 'op');
    h.now.set('2026-10-08T09:00:00Z');
    await h.ctx.probe.runOnce();
    h.now.set('2026-10-08T10:00:00Z');
    await h.ctx.probe.runOnce();
    assert.deepEqual(alertTexts(h).filter((t) => /Gîte des Aulnes (ne répond|: dernière)/.test(t)), []);
  } finally {
    h.cleanup();
  }
});
