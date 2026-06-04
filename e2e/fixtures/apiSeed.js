// @ts-check
// API seed helpers (specs/e2e-playwright-smoke-suite.md §4.3). Each helper wraps a Playwright
// `request` context call against the real /api/* surface so the helper exercises the same
// validation + serialisation path the UI hits. Use this when the spec depends on the API
// contract being correct end-to-end. For pure UI surfacing of pre-existing state, prefer
// `e2e/fixtures/dbSeed.js` (direct SQLite writes).

const { request } = require('@playwright/test');
const path = require('path');

// Hit the API through the CRA proxy host (`localhost:3000`) so the cached storageState
// cookie — bound to that origin by globalSetup — gets sent. Hitting the backend directly
// at `127.0.0.1:4000` would silently drop the cookie and every call would 401.
const SERVER_URL = 'http://localhost:3000';
const STORAGE_STATE = path.join(__dirname, '..', '.auth', 'admin.json');

async function withRequest(fn) {
  const ctx = await request.newContext({ baseURL: SERVER_URL, storageState: STORAGE_STATE });
  try {
    return await fn(ctx);
  } finally {
    await ctx.dispose();
  }
}

async function createClient({ firstName = 'Jean', lastName = 'Dupont', email = '', phone = '' } = {}) {
  return withRequest(async (ctx) => {
    const res = await ctx.post('/api/clients', { data: { firstName, lastName, email, phone } });
    if (!res.ok()) throw new Error(`createClient failed: ${res.status()} ${await res.text()}`);
    return res.json();
  });
}

async function createProperty({
  name = 'Test Property',
  address = '1 rue de test',
  city = 'Cassis',
  postalCode = '13260',
  defaultCheckIn = '15:00',
  defaultCheckOut = '10:00',
  defaultCautionAmount = 500,
  basePrice = 100,
  capacityAdults = 4,
  capacityChildren = 2,
} = {}) {
  return withRequest(async (ctx) => {
    const res = await ctx.post('/api/properties', {
      data: { name, address, city, postalCode, defaultCheckIn, defaultCheckOut,
        defaultCautionAmount, basePrice, capacityAdults, capacityChildren },
    });
    if (!res.ok()) throw new Error(`createProperty failed: ${res.status()} ${await res.text()}`);
    return res.json();
  });
}

async function createReservation({
  propertyId, clientId,
  startDate, endDate,
  adults = 2, children = 0, teens = 0, babies = 0,
  singleBeds = 0, doubleBeds = 0, babyBeds = 0,
  checkInTime = '15:00', checkOutTime = '10:00',
  platform = 'direct',
  customPrice = null,
  notes = '',
  kind = 'reservation',
} = {}) {
  if (!propertyId || !clientId || !startDate || !endDate) {
    throw new Error('createReservation requires propertyId + clientId + startDate + endDate');
  }
  return withRequest(async (ctx) => {
    const res = await ctx.post('/api/reservations', {
      data: { propertyId, clientId, startDate, endDate, adults, children, teens, babies,
        singleBeds, doubleBeds, babyBeds, checkInTime, checkOutTime, platform, customPrice,
        notes, kind, reservationOptions: [], reservationResources: [], reservationCustomOptions: [],
        reservationNights: [] },
    });
    if (!res.ok()) throw new Error(`createReservation failed: ${res.status()} ${await res.text()}`);
    return res.json();
  });
}

async function createIcalSource({
  propertyId, name = 'Test feed', url = 'https://example.test/feed.ics',
  platformKey = 'direct', platformLabel = 'Test',
} = {}) {
  if (!propertyId) throw new Error('createIcalSource requires propertyId');
  return withRequest(async (ctx) => {
    const res = await ctx.post(`/api/properties/${propertyId}/ical-sources`, {
      data: { name, url, platformKey, platformLabel },
    });
    if (!res.ok()) throw new Error(`createIcalSource failed: ${res.status()} ${await res.text()}`);
    return res.json();
  });
}

module.exports = {
  createClient,
  createProperty,
  createReservation,
  createIcalSource,
};
