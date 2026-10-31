// Shared fixture of the held-dates suites (specs/payment-link-lifecycle.md rules 10-12, 31-33, 37-39, 46, 48): the
// app's database in memory (the callers of rule 32 write through it), made-up stays and links, an iCal feed stub.
// Nothing leaves the process: no provider is connected, so a withdrawn link keeps its deactivation marker.

process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';

const db = require('../database');
const paymentLinksModel = require('../models/paymentLinksModel');
const { localIsoDate } = require('../utils/localDate');

const inDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return localIsoDate(d); };
const compact = (iso) => iso.replace(/-/g, '');

let propertySeq = 100;
function freshProperty() {
  propertySeq += 1;
  db.prepare("INSERT INTO properties (id, name, defaultCheckIn, defaultCheckOut) VALUES (?, ?, '16:00', '10:00')").run(propertySeq, `Logement ${propertySeq}`);
  if (!db.prepare('SELECT 1 FROM clients WHERE id = 1').get()) {
    db.prepare("INSERT INTO clients (id, firstName, lastName, email) VALUES (1, 'Lina', 'Exemple', 'lina@example.test')").run();
  }
  return propertySeq;
}

function addStay({ propertyId, kind = 'reservation', platform = 'direct', start, end, depositPaid = 0, balancePaid = 0, convertedReservationId = null, checkInTime = '16:00', checkOutTime = '10:00', extra = {} }) {
  const columns = {
    kind, propertyId, clientId: 1, startDate: start, endDate: end, adults: 2, platform, finalPrice: 400,
    depositAmount: 120, balanceAmount: 280, depositPaid, balancePaid, convertedReservationId, checkInTime, checkOutTime,
    ...(kind === 'devis' ? { devisNumber: `D-T-${Math.random().toString(36).slice(2, 8)}`, devisStatus: 'sent' } : {}),
    ...extra,
  };
  const names = Object.keys(columns);
  const info = db.prepare(`INSERT INTO reservations (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`).run(...names.map((n) => columns[n]));
  const id = Number(info.lastInsertRowid);
  if (kind === 'reservation') db.prepare('UPDATE reservations SET reservationNumber = ? WHERE id = ?').run(`T${id}`, id);
  return id;
}

let linkSeq = 0;
function addLink(reservationId, { type = 'deposit', status = 'open', amountCents = 12000, providerLinkId } = {}) {
  linkSeq += 1;
  const row = paymentLinksModel.create({
    reservationId, type, amountCents, provider: 'qonto', providerLinkId: providerLinkId === undefined ? `pl_dt_${linkSeq}` : providerLinkId,
    url: `https://pay.example.test/dt/${linkSeq}`, status,
    expiresAt: new Date(Date.now() + 30 * 3600 * 1000).toISOString(),
  });
  return Number(row.id);
}

const linkOf = (id) => db.prepare('SELECT * FROM payment_links WHERE id = ?').get(id);

function icsFeed(events) {
  const lines = ['BEGIN:VCALENDAR'];
  for (const e of events) {
    lines.push('BEGIN:VEVENT', `UID:${e.uid}`, `DTSTART;VALUE=DATE:${compact(e.start)}`, `DTEND;VALUE=DATE:${compact(e.end)}`, `SUMMARY:${e.summary || 'Reserved'}`, 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

let sourceSeq = 500;
// A Booking source of the logement whose feed carries `events`; returns `sync()`.
function bookingFeed(propertyId) {
  sourceSeq += 1;
  const source = { id: sourceSeq, propertyId, url: `http://booking.example.test/${sourceSeq}`, platformKey: 'booking', platformLabel: 'Booking', name: 'Booking' };
  db.prepare('INSERT INTO ical_sources (id, propertyId, name, url, isActive, platformKey, platformLabel) VALUES (?, ?, ?, ?, 1, ?, ?)')
    .run(source.id, propertyId, source.name, source.url, source.platformKey, source.platformLabel);
  let events = [];
  const fetchImpl = async () => ({ ok: true, status: 200, text: async () => icsFeed(events) });
  const model = require('../models/propertyIcalModel').buildModel(db, { fetchImpl });
  return {
    source,
    sync: async (next) => { events = next; return model.syncSource(source); },
  };
}

module.exports = { db, inDays, freshProperty, addStay, addLink, linkOf, bookingFeed };
