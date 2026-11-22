// Shared fixture of the campaign suites (specs/gift-voucher-campaigns.md): the plugin on the real core database, where the pricing engine and the catalogue live —
// a bath with its degressive tiers, a few options of each price type, the outside VAT rates — with a fake payment provider and a movable clock. Not a test file.
// A suite sets `process.env.DB_PATH = ':memory:'` before requiring it: every suite is a process of its own, so each one has a database of its own.

process.env.GUESTFLOW_ENCRYPTION_KEY = process.env.GUESTFLOW_ENCRYPTION_KEY || Buffer.alloc(32, 7).toString('base64');

const fs = require('fs');
const path = require('path');
const express = require('express');
const db = require('../../../database');
const sdk = require('../../sdk');
const sales = require('../../../models/standaloneSalesModel');
const { applyPluginSchema } = require('../../sdk/testing');
const { liveHourlyResources } = require('../../../tests/hourlyResourcesFixture');
const { buildGiftVouchersApi, memorySettings } = require('..');
const { SOURCE } = require('../orderPaid');
const { filesDir } = require('./visualFilesFixture');
const { termsStub } = require('./termsFixture');

const encryption = sdk.coreModule('encryption');
// The smallest JPEG pdfkit reads: the bytes of the visual every on-sale campaign of the suites carries.
const FRONT_JPEG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');
const FRONT_FILE = 'front-test.jpg';
const front = { id: null };
const TIERS = [{ fromHour: 2, percent: 10 }, { fromHour: 3, percent: 20 }];
const METHODS = [{ value: 'card', label: 'CB' }, { value: 'cash', label: 'Espèces' }, { value: 'transfer', label: 'Virement' }];

const insert = (table, row) => {
  const keys = Object.keys(row);
  return Number(db.prepare(`INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map((k) => `@${k}`).join(', ')})`).run(row).lastInsertRowid);
};

const resource = (over = {}) => insert('resources', {
  name: 'Bain nordique', quantity: 1, price: 25, priceType: 'per_hour', showsPlanningCard: 1, slotDuration: 60, minimumUsageMinutes: 60, openTime: '10:00', closeTime: '22:00',
  hourlyEveningStart: '19:00', hourlyEveningRate: 35, hourlyExternalDayRate: 50, hourlyExternalEveningRate: 70, hourlyDegressiveTiers: JSON.stringify(TIERS), sellableExternally: 1, ...over,
});

const option = (over = {}) => insert('options', {
  title: 'Planche apéro', price: 14, priceType: 'per_stay', vatClass: 'catering', sellableExternally: 1, ...over,
});

/** The catalogue of a suite: a bath, a few sellable options and what cannot be sold outside a stay. → their ids. */
function seedCatalogue() {
  sales.setExternalRate('resources', 20);
  sales.setExternalRate('catering', 10);
  sales.setExternalRate('drinks', 20);
  sales.setExternalRate('options', 10);
  return {
    bath: resource(),
    board: option(),
    drink: option({ title: 'Boisson', price: 6.5, vatClass: 'drinks' }),
    perPerson: option({ title: 'Peignoir', price: 5, priceType: 'per_person', vatClass: 'options' }),
    perNight: option({ title: 'Petit-déjeuner', price: 9, priceType: 'per_night', vatClass: 'catering' }),
    hidden: option({ title: 'Bougie', price: 3, sellableExternally: 0 }),
    sauna: resource({ name: 'Sauna sans carte', showsPlanningCard: 0 }),
    lodgingResource: resource({ name: 'Vélo', priceType: 'per_stay', showsPlanningCard: 0 }),
  };
}

/** A plugin API over the core database, its lodging campaign on sale, a fake payment provider, a clock. */
function openShop(over = {}) {
  liveHourlyResources();
  applyPluginSchema(db, 'gift-vouchers');
  const clock = { at: new Date('2026-11-15T10:00:00Z') }; // date-literal-ok: the suite runs on its own clock, never the real today
  const sent = [];
  const links = [];
  const state = { providerDown: false };
  const terms = termsStub({ lodging: 4, resource: 9 });
  const api = buildGiftVouchersApi({
    db,
    pepper: () => 'test-pepper',
    encrypt: encryption.encrypt,
    decrypt: encryption.safeDecrypt,
    settingsStore: () => memorySettings(),
    now: () => clock.at,
    quote: () => null,
    pow: sdk.proofOfWork,
    powSecret: () => 'test-pow-secret',
    guard: (req, res, next) => { req.visitor = { ip: req.get('x-test-ip') || '' }; next(); },
    sendMail: async (mail) => { sent.push(mail); return { messageId: 'm1' }; },
    paymentMethods: () => METHODS,
    userName: () => 'Adrien Test',
    companyName: () => 'Domaine Solio',
    pageUrl: () => 'https://site.example.test/bon-cadeau',
    company: async () => ({
      name: 'Domaine Solio', town: 'Saint-Cirq-Lapopie', website: 'https://site.example.test', logo: null,
    }),
    filesDir,
    terms,
    onlineSaleAvailable: () => true,
    siteOrigin: () => 'https://site.example.test',
    payments: {
      saleLink: async (sale, options) => {
        if (state.providerDown) throw new Error('down');
        links.push({ sale, options });
        return { linkId: links.length, url: `https://pay.example.test/${links.length}` };
      },
      refreshLink: async () => 'open',
    },
    ...over,
  });
  const lodging = api.campaigns.firstLodging();
  api.campaigns.update(lodging.id, { ...lodging, state: 'on_sale' });
  // Rule 7 — a campaign goes on sale with a voucher front: the suites' campaigns pick this one.
  fs.writeFileSync(path.join(filesDir(), FRONT_FILE), FRONT_JPEG);
  front.id = api.visuals.insert({ name: 'Recto de test', use: 'both', file: { path: FRONT_FILE, width: 1240, height: 1748 } });
  return {
    api, db, clock, sent, links, state, terms,
  };
}

/** A campaign of the bath: 2 h in the day, a board included, a drink offered, 1 h of extra time at most. */
function bathCampaign(ids, over = {}) {
  return {
    name: 'Bain journée', title: 'Un bain nordique', kind: 'resource', state: 'on_sale', slug: 'bain-jour', validityMonths: 12,
    composition: { resourceId: ids.bath, band: 'day', minutes: 120, options: [{ articleRef: `option:${ids.board}`, qty: 1 }] },
    addOns: [`option:${ids.drink}`], extraTimeMaxMinutes: 120, voucherVisualId: front.id, ...over,
  };
}

/** What `campaignRules.validateCampaign` reads to judge a campaign of the suite. */
const rulesContext = (api) => ({ catalogue: api.catalogue, campaigns: api.campaigns, visuals: api.visuals });

/** Both routers of the API on an ephemeral port, as the site and the operator's session reach them. */
async function serve(api, { user = { id: 7, roles: ['admin'] } } = {}) {
  const app = express();
  app.use(express.json());
  app.use('/public/v1/gift-vouchers', api.publicRouter);
  app.use('/api/gift-vouchers', (req, res, next) => { req.user = user; next(); }, api.adminRouter);
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body, headers = {}) => {
    const res = await fetch(`${base}${path}`, {
      method, headers: { 'Content-Type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const type = res.headers.get('content-type') || '';
    return { status: res.status, body: type.includes('json') ? await res.json() : null };
  };
  return { base, call, close: () => new Promise((resolve) => { server.close(resolve); }) };
}

module.exports = {
  db, seedCatalogue, openShop, bathCampaign, rulesContext, serve, resource, option, SOURCE, TIERS,
};
