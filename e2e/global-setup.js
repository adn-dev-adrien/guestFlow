// @ts-check
// Playwright globalSetup — runs once before the suite (specs/e2e-playwright-smoke-suite.md §3.1
// rules 5-8). Five phases:
//
//   1. Wipe the ephemeral SQLite DB at DB_PATH so every run starts from a clean schema.
//   2. Wait for the backend to be ready (the webServer block in playwright.config.js spawned it).
//   3. Spawn `server/scripts/seed-e2e.js` to create the deterministic admin user.
//   4. Log in via the /api/auth/login endpoint to capture a session cookie.
//   5. Persist the cookie to e2e/.auth/admin.json via Playwright's request.storageState().
//
// Every spec inherits the storageState via `use.storageState` in playwright.config.js, so no
// per-spec login overhead. The storageState file is gitignored.

const { request } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const E2E_DB_PATH = process.env.GUESTFLOW_E2E_DB_PATH || '/tmp/guestflow-e2e.db';
const E2E_ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || 'e2e@guestflow.test';
const E2E_ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD || 'e2e-secret-1234';
// « Accueil » account for the reception specs (specs/reception-sas-today-only.md §7). They opt into
// this session with their own `test.use({ storageState })` — the default stays the admin.
const E2E_RECEPTION_EMAIL = process.env.E2E_RECEPTION_EMAIL || 'e2e-reception@guestflow.test';
const E2E_RECEPTION_PASSWORD = process.env.E2E_RECEPTION_PASSWORD || 'e2e-reception-1234';
const BACKEND_URL = 'http://127.0.0.1:4000';     // direct probe for readiness check
const FRONTEND_URL = 'http://localhost:3000';     // CRA dev — proxies /api/* to the backend.
// We log in through the FRONTEND so the session cookie is scoped to `localhost:3000`, the
// same origin the browser navigates to in every spec. Logging in directly against
// :4000 binds the cookie to `127.0.0.1:4000` and the browser drops it on every nav.
const AUTH_DIR = path.join(__dirname, '.auth');
const STORAGE_STATE = path.join(AUTH_DIR, 'admin.json');
const RECEPTION_STORAGE_STATE = path.join(AUTH_DIR, 'reception.json');

async function waitFor(url, label, timeoutMs = 90_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const probe = await request.newContext();
      const res = await probe.get(url);
      await probe.dispose();
      if (res.ok() || res.status() === 404 /* root html may return 404 on /api routes */) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`[global-setup] ${label} at ${url} never became ready`);
}

module.exports = async () => {
  // (1) DB wipe runs in `playwright.config.js` BEFORE the webServer block boots — see the
  // comment there for the race-condition rationale. Here we only prepare the auth dir.
  fs.mkdirSync(AUTH_DIR, { recursive: true });

  // (2) Wait for the backend the webServer block in playwright.config.js spawned (direct
  // probe), then the CRA dev server (the proxy host we'll log in through).
  await waitFor(`${BACKEND_URL}/api/version`, 'backend');
  await waitFor(`${FRONTEND_URL}/`, 'CRA dev', 120_000);

  // (3) Seed the deterministic admin. The seed script reads DB_PATH from env — the webServer
  // command already exported it, so we replicate the same value here.
  const seed = spawnSync('node', ['server/scripts/seed-e2e.js'], {
    env: {
      ...process.env,
      DB_PATH: E2E_DB_PATH,
      E2E_ADMIN_EMAIL,
      E2E_ADMIN_PASSWORD,
      E2E_RECEPTION_EMAIL,
      E2E_RECEPTION_PASSWORD,
    },
    encoding: 'utf8',
    cwd: path.join(__dirname, '..'),
  });
  if (seed.status !== 0) {
    throw new Error(`[global-setup] seed-e2e.js failed (exit ${seed.status})\nstdout: ${seed.stdout}\nstderr: ${seed.stderr}`);
  }
  // (4) Log in THROUGH the CRA proxy so the cookie binds to `localhost:3000` — the same
  // origin every spec navigates to. Logging in directly against :4000 binds to
  // `127.0.0.1:4000` and the browser silently drops the cookie on every nav.
  const ctx = await request.newContext({ baseURL: FRONTEND_URL });
  const loginRes = await ctx.post('/api/auth/login', {
    data: { email: E2E_ADMIN_EMAIL, password: E2E_ADMIN_PASSWORD },
  });
  if (!loginRes.ok()) {
    const body = await loginRes.text().catch(() => '');
    throw new Error(`[global-setup] /api/auth/login returned ${loginRes.status()}: ${body.slice(0, 200)}`);
  }
  // (5) Persist Playwright's storageState (cookies + localStorage). All specs inherit this.
  await ctx.storageState({ path: STORAGE_STATE });
  await ctx.dispose();

  // (6) Same round-trip for the « Accueil » account → e2e/.auth/reception.json. Only the reception
  // specs opt into it; every other spec keeps the admin session.
  const receptionCtx = await request.newContext({ baseURL: FRONTEND_URL });
  const receptionLogin = await receptionCtx.post('/api/auth/login', {
    data: { email: E2E_RECEPTION_EMAIL, password: E2E_RECEPTION_PASSWORD },
  });
  if (!receptionLogin.ok()) {
    const body = await receptionLogin.text().catch(() => '');
    throw new Error(`[global-setup] reception /api/auth/login returned ${receptionLogin.status()}: ${body.slice(0, 200)}`);
  }
  await receptionCtx.storageState({ path: RECEPTION_STORAGE_STATE });
  await receptionCtx.dispose();
};
