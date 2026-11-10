// specs/plugins-phase-1-sdk.md rule 48, reading of 2026-11-10 (audit R36 A36-2 / R36-CON-M1 / R36-P1) — a host-bound web
// app never claims GuestFlow's own public host: set to the admin's address, the guest app took `/`, `/login`, the
// settings and `/studio` over, with nothing left on that host to undo it. The core keeps its own host whatever a
// plugin's `host()` answers; the app still answers on its own host.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const express = require('express');

const registry = require('../plugins/sdk/registry');
const { createContext } = require('../plugins/sdk/createContext');
const { mountWebApps } = require('../plugins/loader');
const settingsModel = require('../models/settingsModel');

test('rule 48 reading: a web app whose host is GuestFlow’s own public host claims nothing on it', async () => {
  settingsModel.upsert({ publicUrl: 'https://Admin.example.test' });
  registry.reset();
  registry.configure({ isActive: () => true, allows: () => true });
  const host = { value: 'admin.example.test' };
  createContext('demo', {}).webApp({ key: 'guest', host: () => host.value, handler: (req, res) => res.send(`guest ${req.path}`) });
  const app = express();
  mountWebApps(app);
  app.use((req, res) => res.send(`core ${req.path}`));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const get = (p, hostHeader) => new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: server.address().port, path: p, headers: { host: hostHeader } }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve(body));
    }).on('error', reject);
  });
  try {
    for (const p of ['/', '/login', '/settings/integrations', '/studio']) {
      // eslint-disable-next-line no-await-in-loop
      assert.equal(await get(p, 'admin.example.test:443'), `core ${p}`, p);
    }
    host.value = 'sejour.example.test';
    assert.equal(await get('/', 'sejour.example.test'), 'guest /', 'its own host still serves the app');
  } finally {
    await new Promise((resolve) => { server.close(resolve); });
    registry.reset();
    settingsModel.upsert({ publicUrl: '' });
  }
});
