// @ts-check
// Global setup of the production-build suite (specs/plugins-phase-4-registry.md rule 19): seed the
// admin and every plugin but linen and neat (left for the install test), restart the server so it
// loads the seeded packages, publish the registry versions the specs use, and log in.
const { request } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { next } = require('./registryVersions');

const PORT = process.env.E2E_PROD_PORT || '4300';
const REGISTRY_PORT = process.env.E2E_REGISTRY_PORT || '4301';
const BASE = `http://localhost:${PORT}`;
const REGISTRY = `http://127.0.0.1:${REGISTRY_PORT}`;
const DB_PATH = path.join(os.tmpdir(), `gf-e2e-prod-${PORT}`, 'guestflow.db');
const ROOT = path.join(__dirname, '..', '..');
const ADMIN = { email: 'e2e@guestflow.test', password: 'e2e-secret-1234' };
const SEEDED = ['hourly-resources', 'website-booking', 'gate-access', 'online-payment', 'google-calendar',
  'accounting-export', 'sas', 'tariff-recipes', 'school-holidays', 'weather-alerts'];

async function startedAt(ctx) {
  try { return (await (await ctx.get(`${BASE}/api/version`)).json()).startedAt; } catch { return null; }
}

async function waitForRestart(ctx, before) {
  for (let i = 0; i < 240; i += 1) {
    const now = await startedAt(ctx);
    if (now && now !== before) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('[prod-setup] the server did not come back');
}

module.exports = async () => {
  const ctx = await request.newContext();
  const seed = spawnSync('node', ['server/scripts/seed-e2e.js'], {
    cwd: ROOT, encoding: 'utf8',
    env: { ...process.env, DB_PATH, E2E_ADMIN_EMAIL: ADMIN.email, E2E_ADMIN_PASSWORD: ADMIN.password, E2E_SEED_PLUGINS: SEEDED.join(',') },
  });
  if (seed.status !== 0) throw new Error(`[prod-setup] seed failed\n${seed.stdout}\n${seed.stderr}`);
  const before = await startedAt(ctx);
  await ctx.post(`${REGISTRY}/__control/restart`);
  await waitForRestart(ctx, before);

  const publish = (body) => ctx.post(`${REGISTRY}/__control/publish`, { data: body });
  await publish({ id: 'linen', version: next('linen'), lines: ['Le stock des serviettes se lit sur la bonne semaine.'] });
  await publish({ id: 'weather-alerts', version: next('weather-alerts'), lines: ['L’alerte orange est rappelée la veille de l’arrivée.'] });
  await publish({ id: 'school-holidays', version: next('school-holidays'), badHash: true });

  fs.mkdirSync(path.join(ROOT, 'e2e', '.auth'), { recursive: true });
  const auth = await request.newContext({ baseURL: BASE });
  const login = await auth.post('/api/auth/login', { data: ADMIN });
  if (!login.ok()) throw new Error(`[prod-setup] login ${login.status()}`);
  const refresh = await auth.post('/api/plugins/refresh');
  if (!refresh.ok()) throw new Error(`[prod-setup] registry refresh ${refresh.status()}`);
  await auth.storageState({ path: path.join(ROOT, 'e2e', '.auth', 'prod-admin.json') });
  await auth.dispose();
  await ctx.dispose();
};
