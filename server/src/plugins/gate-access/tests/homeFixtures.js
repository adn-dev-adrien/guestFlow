// Shared fixtures for the « Domotique » suites of the Sowel connector (specs/guest-app/guest-app-home-automation.md). Not a
// test file: a suite imports it without re-running another suite.

const crypto = require('crypto');
const http = require('http');
const express = require('express');
const Database = require('better-sqlite3');

const { createHomeModel, HOME_TABLES_SQL } = require('../homeModel');
const { buildHomeController } = require('../homeController');
const { buildHomeRouter } = require('../homeRoutes');
const { buildRequireGateConnector, canonicalString } = require('../requireConnector');
const { buildSignGateResponse, responseSignature } = require('../signResponse');

const KEY = 'la-clef-du-connecteur';
const SECRET = 'le-secret-qui-ne-circule-jamais';
const ENV = Object.freeze({ GATE_API_KEY: KEY, GATE_SIGNING_SECRET: SECRET });

function freshHome() {
  const db = new Database(':memory:');
  db.exec(HOME_TABLES_SQL);
  return { db, model: createHomeModel(db) };
}

const CATALOG = Object.freeze([
  { id: 'wx', name: 'Station Netatmo', zonePath: 'Extérieur', type: 'weather', readings: [
    { alias: 'temperature', category: 'temperature_outdoor', unit: '°C' },
    { alias: 'rain_1h', category: 'rain', unit: 'mm' },
  ] },
  { id: 't-sejour', name: 'Thermomètre séjour', zonePath: 'La Granja › Séjour', type: 'sensor', readings: [
    { alias: 'temperature', category: 'temperature', unit: '°C' },
  ] },
  { id: 'l-chene', name: 'Éclairage du chêne', zonePath: 'Extérieur › Jardin', type: 'light_onoff', guestSwitchable: true, readings: [
    { alias: 'state', category: 'light_state', unit: null },
  ] },
]);

/** The real router on an ephemeral port, the way index.js mounts it (raw body kept for the signature). */
async function startHome({ selection = () => [], clock = () => new Date(), env = ENV } = {}) {
  const home = freshHome();
  const controller = buildHomeController({ model: () => home.model, selection, clock });
  const app = express();
  app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));
  app.use('/public/v1/home', buildHomeRouter({
    controller,
    limiter: (_req, _res, next) => next(),
    requireConnector: buildRequireGateConnector({ env }),
    signResponse: buildSignGateResponse({ env }),
  }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  async function call(method, path, body, { secret = SECRET, key = KEY, timestamp = Date.now(), signedBody } = {}) {
    const raw = body === undefined ? '' : JSON.stringify(body);
    const signed = signedBody === undefined ? raw : JSON.stringify(signedBody);
    const signature = crypto.createHmac('sha256', secret).update(canonicalString(method, path, timestamp, signed)).digest('hex');
    const res = await fetch(base + path, {
      method,
      headers: {
        authorization: `Bearer ${key}`,
        'x-gate-timestamp': String(timestamp),
        'x-gate-signature': signature,
        ...(raw ? { 'content-type': 'application/json' } : {}),
      },
      body: raw || undefined,
    });
    const text = await res.text();
    return {
      status: res.status,
      body: text ? JSON.parse(text) : null,
      signatureOk: res.headers.get('x-gate-response-signature') === responseSignature(SECRET, signature, Buffer.from(text, 'utf8')),
    };
  }

  return {
    ...home,
    controller,
    call,
    close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }),
  };
}

module.exports = { freshHome, startHome, CATALOG, KEY, SECRET, ENV };
