#!/usr/bin/env node
// Before a plugin is removed (specs/plugin-removal-resilience.md rule 12): boots the server with every
// plugin on the seeded database, saves each seeded stay once — which settles it with the pricing
// engine — and writes what its money is to `reference.json`. The removal run must find the same.
//
//   DB_PATH=… REMOVAL_WORK=… node e2e/removal/snapshot.js
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { money } = require('./money');

const ROOT = path.resolve(__dirname, '..', '..');
const WORK = process.env.REMOVAL_WORK;
const PORT = Number(process.env.SNAPSHOT_PORT || 4480);
const BASE = `http://127.0.0.1:${PORT}`;
const seed = JSON.parse(fs.readFileSync(path.join(WORK, 'seed.json'), 'utf8'));

const server = spawn(process.execPath, ['src/index.js'], {
  cwd: path.join(ROOT, 'server'),
  stdio: 'ignore',
  env: {
    ...process.env,
    PORT: String(PORT),
    NODE_ENV: 'test',
    GUESTFLOW_PLUGINS: 'sources',
    GUESTFLOW_DEV: '1',
    GUESTFLOW_SMTP_DETECT: 'off',
    QONTO_API_BASE: 'http://127.0.0.1:9',
    QONTO_OAUTH_BASE: 'http://127.0.0.1:9',
    NEAT_API_BASE: 'http://127.0.0.1:9',
    GUESTFLOW_SESSION_SECRET: 'e2e-removal-fixed-session-secret-not-for-prod-32b',
    GUESTFLOW_ENCRYPTION_KEY: 'ZTJlZml4ZWRlbmNyeXB0aW9ua2V5MTIzNDU2Nzg5MGE=',
  },
});

async function waitUp() {
  for (let i = 0; i < 240; i += 1) {
    try { if ((await fetch(`${BASE}/api/version`)).ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('[snapshot] the server never came up');
}

async function main() {
  await waitUp();
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'e2e@guestflow.test', password: 'e2e-secret-1234' }),
  });
  if (!login.ok) throw new Error(`[snapshot] login ${login.status}`);
  const cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const call = (method, url, body) => fetch(`${BASE}${url}`, {
    method, headers: { cookie, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
  });
  const reference = {};
  for (const [name, stay] of Object.entries(seed.stays)) {
    const fiche = await (await call('GET', `/api/reservations/${stay.id}`)).json();
    const saved = await call('PUT', `/api/reservations/${stay.id}`, fiche);
    if (!saved.ok) throw new Error(`[snapshot] saving the ${name} stay: ${saved.status} ${await saved.text()}`);
    reference[name] = money(await (await call('GET', `/api/reservations/${stay.id}`)).json());
  }
  // With every plugin present the deposit reminder of the quote offers its open link: what the removal run
  // must see disappear with `online-payment` (rule 6).
  const templates = await (await call('GET', '/api/email-templates')).json();
  const reminder = templates.find((t) => t.stableKey === 'deposit_reminder');
  const mail = await (await call('GET', `/api/emails/preview?reservationId=${seed.quote.id}&templateId=${reminder.id}`)).json();
  reference.quoteReminder = { templateId: reminder.id, offersLink: /pay\.example\.test\/pl_removal_open/.test(`${mail.subject}\n${mail.body}`) };
  if (!reference.quoteReminder.offersLink) throw new Error('[snapshot] the quote reminder does not offer its open link with every plugin present');
  fs.writeFileSync(path.join(WORK, 'reference.json'), JSON.stringify(reference, null, 2));
}

main()
  .then(() => { server.kill('SIGTERM'); })
  .catch((err) => { console.error(err.message || err); server.kill('SIGTERM'); process.exitCode = 1; });
