// @ts-check
// Global setup of the removal suite: the admin the seed created logs in, once.
const { request } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const PORT = process.env.E2E_REMOVAL_PORT || '4400';
const ADMIN = { email: 'e2e@guestflow.test', password: 'e2e-secret-1234' };

module.exports = async () => {
  const dir = path.join(__dirname, '..', '.auth');
  fs.mkdirSync(dir, { recursive: true });
  const ctx = await request.newContext({ baseURL: `http://localhost:${PORT}` });
  const login = await ctx.post('/api/auth/login', { data: ADMIN });
  if (!login.ok()) throw new Error(`[removal-setup] login ${login.status()}`);
  await ctx.storageState({ path: path.join(dir, `removal-admin-${PORT}.json`) });
  await ctx.dispose();
};
