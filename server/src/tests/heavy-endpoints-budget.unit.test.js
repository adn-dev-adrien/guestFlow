// specs/inte-performance.md rule 5 — the heavy endpoints do not grow with the data: the same number of
// SQL statements on 20 reservations as on 2 000, and each answers within its time budget.
const { listenLocal } = require('./listenLocal');
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'heavy-endpoints-'));
process.env.DB_PATH = path.join(DIR, 'guestflow.db');
process.env.GUESTFLOW_LOCAL_ENV = path.join(DIR, '.env.local');

const express = require('express');
const db = require('../database');
const { installStatementCounter } = require('./helpers/statementCounter');

const counter = installStatementCounter(db);

const TIME_BUDGET_MS = 250;
const PLATFORMS = ['direct', 'booking', 'airbnb', 'gites-de-france', 'abritel'];
const isoDay = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { id: 1, email: 'admin@example.fr', roles: ['admin'] };
    req.session = { user: req.user };
    next();
  });
  app.use('/api/platforms', require('../routes/platforms'));
  app.use('/api/dashboard', require('../routes/dashboard'));
  app.use('/api/email-templates', require('../routes/emailTemplates'));
  app.use('/api/emails', require('../routes/emails'));
  app.use('/api/email-texts', require('../routes/emailTexts'));
  app.use((err, req, res, next) => res.status(500).json({ error: err.message })); // eslint-disable-line no-unused-vars
  return app;
}

function seed({ reservations, clients }) {
  const { seedProperty, seedClient, seedReservation } = require('./guestEmailSequenceFixtures');
  db.exec('DELETE FROM reservations; DELETE FROM clients;');
  const existing = db.prepare('SELECT COUNT(*) AS n FROM properties').get().n;
  if (!existing) {
    for (const [id, name] of [[1, 'Le Gîte'], [2, 'L’Estiva'], [3, 'La Granja']]) seedProperty(db, { id, name, nameArticle: 'à', nameArticleConfirmed: 1 });
  }
  db.prepare('UPDATE users SET mustChangePassword = 0').run();
  if (!db.prepare('SELECT 1 FROM app_settings WHERE id = 1').get()) db.prepare('INSERT INTO app_settings (id) VALUES (1)').run();
  db.prepare("UPDATE app_settings SET guestSequenceStartDate = '2026-01-01'").run();
  db.transaction(() => {
    for (let i = 1; i <= clients; i += 1) seedClient(db, { id: i, firstName: `Prénom${i}`, lastName: `Nom${i}`, email: `client${i}@example.fr` });
    for (let i = 0; i < reservations; i += 1) {
      // Starts spread from 10 days back to 30 days ahead, so every email moment has stays in it.
      const start = (i % 40) - 10;
      seedReservation(db, {
        propertyId: (i % 3) + 1, clientId: (i % clients) + 1, platform: PLATFORMS[i % PLATFORMS.length],
        startDate: isoDay(start), endDate: isoDay(start + 3 + (i % 5)), createdAt: `${isoDay(start - 20)} 10:00:00`, finalPrice: 400 + (i % 700),
      });
    }
  })();
}

const LABELS = [
  'GET /api/email-texts', 'POST /api/emails/preview', 'GET /api/dashboard/attention',
  'GET /api/platforms/settings', 'GET /api/email-templates?view=timeline', 'GET /api/emails/pending',
];

function endpoints() {
  const timeline = db.prepare("SELECT id FROM email_templates WHERE stableKey = 'arrival_reminder_1d'").get().id;
  const reservationId = db.prepare('SELECT id FROM reservations ORDER BY id DESC LIMIT 1').get().id;
  return [
    ['GET /api/email-texts', 'GET', '/api/email-texts'],
    ['POST /api/emails/preview', 'POST', '/api/emails/preview', { templateId: timeline, propertyId: 1, reservationId, language: 'fr', draft: { texts: {} } }],
    ['GET /api/dashboard/attention', 'GET', '/api/dashboard/attention'],
    ['GET /api/platforms/settings', 'GET', '/api/platforms/settings'],
    ['GET /api/email-templates?view=timeline', 'GET', '/api/email-templates?view=timeline'],
    ['GET /api/emails/pending', 'GET', '/api/emails/pending'],
  ];
}

async function measure(base, [, method, url, body]) {
  const started = process.hrtime.bigint();
  let response;
  const statements = await counter.during(async () => {
    response = await fetch(`${base}${url}`, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    await response.arrayBuffer();
  });
  return { status: response.status, statements, ms: Number(process.hrtime.bigint() - started) / 1e6 };
}

let measured = null;
function measureBoth() {
  if (!measured) {
    measured = (async () => {
      const server = await listenLocal(buildApp());
      const base = `http://127.0.0.1:${server.address().port}`;
      try {
        seed({ reservations: 20, clients: 15 });
        // A first call warms what is prepared lazily and cached: only the steady state is compared.
        for (const endpoint of endpoints()) await measure(base, endpoint);
        const small = [];
        for (const endpoint of endpoints()) small.push(await measure(base, endpoint));
        seed({ reservations: 2000, clients: 1500 });
        const large = [];
        for (const endpoint of endpoints()) large.push(await measure(base, endpoint));
        return { small, large };
      } finally {
        server.closeAllConnections();
        server.close();
      }
    })();
  }
  return measured;
}

after(() => fs.rmSync(DIR, { recursive: true, force: true }));

for (const label of LABELS) {
  test(`rule 5: ${label} runs the same statements on 2 000 reservations as on 20`, async () => {
    const { small, large } = await measureBoth();
    const i = LABELS.indexOf(label);
    assert.equal(small[i].status, 200);
    assert.equal(large[i].status, 200);
    assert.ok(small[i].statements > 0, 'the counter sees the endpoint');
    assert.equal(large[i].statements, small[i].statements, `${small[i].statements} statements on 20 reservations, ${large[i].statements} on 2 000`);
  });

  test(`rule 5: ${label} answers under ${TIME_BUDGET_MS} ms on 2 000 reservations`, async () => {
    const { large } = await measureBoth();
    const i = LABELS.indexOf(label);
    assert.ok(large[i].ms < TIME_BUDGET_MS, `took ${large[i].ms.toFixed(0)} ms`);
  });
}

test('rule 5: the counter does see a statement per reservation (a control, so the comparison above can fail)', async () => {
  await measureBoth();
  const perReservation = () => db.prepare('SELECT id FROM reservations').all().map((r) => db.prepare('SELECT 1 FROM reservations WHERE id = ?').get(r.id));
  const first = counter.count();
  perReservation();
  const many = counter.count() - first;
  assert.ok(many > 1000, `counted ${many} statements for 2 000 reservations`);
});
