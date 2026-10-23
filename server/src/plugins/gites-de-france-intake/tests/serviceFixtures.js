// The intake service wired to an in-memory intakes table and recording doubles of the core, shared by
// the service suites. The stay of BOOKING_MAIL is 13 → 15/11/2026; « today » is pinned before it.
const Database = require('better-sqlite3');

const { buildModel, TABLE_SQL } = require('../intakesModel');
const { createIntakeService } = require('../intakeService');
const { BOOKING_MAIL } = require('./fixtures');

const PLACEHOLDER = {
  id: 22308, propertyId: 1, platform: 'GitesDeFrance', kind: 'reservation', sourceType: 'ical', icalSyncLocked: 0, platformGrossAmount: null,
};
const CATALOGUE = [
  { id: 7, title: 'Ménage', autoOptionType: 'cleaning', price: 80, autoEnabled: 0 },
  { id: 8, title: 'Linge de lit', autoOptionType: 'bed_linen', price: 7, autoEnabled: 0 },
  { id: 12, title: 'Lit bébé', autoOptionType: 'baby_bed', price: 5, autoEnabled: 1 },
];

function setup({
  reservations = [PLACEHOLDER],
  mails = [{ messageId: '<m1@gdf07>', receivedAt: '2026-10-14T16:32:00.000Z', text: BOOKING_MAIL }],
  rate = 10, autoApply = true, updateStatus = 200, today = '2026-10-15', findReservations = null,
} = {}) {
  const db = new Database(':memory:');
  db.exec(TABLE_SQL);
  const intakes = buildModel(db);
  const calls = { updates: [], clients: [], mailsSent: 0 };
  const service = createIntakeService({
    intakes,
    settings: {
      mailbox: () => ({ host: 'imap.test', port: 993, user: 'contact@test', password: 'x' }),
      sender: () => 'resa@gdf07.com',
      giteNumbers: () => ({ 1: '309700' }),
      autoApply: () => autoApply,
    },
    readMails: async (cfg) => { calls.readWith = cfg; return mails; },
    findReservations: findReservations || (({ propertyIds, startDate, endDate }) => reservations
      .filter((r) => propertyIds.includes(r.propertyId) && startDate === '2026-11-13' && endDate === '2026-11-15')),
    commissionPercent: () => rate,
    propertyOptions: () => CATALOGUE,
    getReservation: (id) => ({ ...reservations.find((r) => r.id === id), options: [
      { optionId: 8, quantity: 1, offered: 1, inComplement: 0 },
      { optionId: 12, quantity: 1, offered: 0, inComplement: 1 },
    ] }),
    today: () => today,
    core: {
      updateReservation: (id, patch, opts) => { calls.updates.push({ id, patch, opts }); return { status: updateStatus, body: updateStatus === 200 ? { ok: true } : { error: 'Refusé' } }; },
      suggestBeds: () => ({ singleBeds: 2, doubleBeds: 4 }),
      findOrCreateClient: (c) => { calls.clients.push(c); return { id: 141, ...c }; },
    },
  });
  return { service, intakes, calls, db };
}

module.exports = { PLACEHOLDER, CATALOGUE, setup };
