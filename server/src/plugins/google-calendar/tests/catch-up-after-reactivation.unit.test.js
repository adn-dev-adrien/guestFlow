// specs/plugin-removal-resilience.md rule 17 — a stay changed while the plugin was off sent no event the
// plugin could hear (the bus drops them while it is not live); its next reconcile pass pushes it.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

process.env.GUESTFLOW_ENCRYPTION_KEY = process.env.GUESTFLOW_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64');

const { create } = require('../sync');
const { buildGoogleEventPayload, getGoogleEventIdForReservation } = require('../events');

const stay = (over = {}) => ({
  id: 1, propertyId: 1, propertyName: 'Villa', clientLastName: 'Doe', clientFirstName: 'Jane', startDate: '2026-06-01', endDate: '2026-06-03',
  checkInTime: '15:00', checkOutTime: '10:00', adults: 2, children: 0, teens: 0, babies: 0, singleBeds: 0, doubleBeds: 1, babyBeds: 0, options: [], ...over,
});

function remoteOf(r) {
  const p = buildGoogleEventPayload(r, r.options);
  return {
    id: getGoogleEventIdForReservation(r.id), summary: p.summary, description: p.description, colorId: p.colorId, status: 'confirmed',
    reminders: { useDefault: false }, start: { dateTime: `${p.start.dateTime}+02:00` }, end: { dateTime: `${p.end.dateTime}+02:00` },
    extendedProperties: { private: { guestflowSource: 'guestflow', guestflowReservationId: String(r.id) } },
  };
}

test('rule 17 — a stay changed and a stay added while the plugin was off are pushed by its next reconcile', async () => {
  const calls = { update: [], insert: [] };
  const calendar = {
    events: {
      list: async () => ({ data: { items: [remoteOf(stay())] } }),
      update: async (args) => { calls.update.push(args.eventId); return {}; },
      insert: async (args) => { calls.insert.push(args); return {}; },
      delete: async () => ({}),
    },
  };
  const settings = {
    googleConnected: () => true, googleCalendarSelection: () => ({ calendarId: 'cal-1', summary: 'Agenda' }), recordGoogleSyncResult: () => {},
  };
  // Google still holds stay 1 as it was; the database now holds it with another name, and a second stay.
  const reservations = [stay({ clientLastName: 'Nouveau' }), stay({ id: 2 })];
  const sync = create({ settings, model: { listReservationsForSync: () => reservations, getReservationForSync: (id) => reservations.find((r) => Number(r.id) === Number(id)) || null }, getCalendar: () => calendar, log: () => {} });
  const out = await sync.reconcile();
  assert.equal(out.ok, true);
  assert.equal(out.pushed, 2, 'the change and the addition both reach Google');
});
