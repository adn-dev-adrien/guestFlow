// Shared fixture of the closure suites of specs/payment-link-lifecycle.md (rules 40, 41, 49): the baseline
// schema with two logements, the closures controller bound to it, and a fake Express response.

const { localIsoDate } = require('../utils/localDate');
const closuresModel = require('../models/establishmentClosuresModel');
const { buildController } = require('../controllers/establishmentClosuresController');
const { seedDb, addStay, addLink } = require('./paymentLinkLifecycleFixture');

const inDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return localIsoDate(d); };

function seedClosures() {
  const { db, links } = seedDb();
  // The baseline schema predates the number column the boot migration adds (database.js).
  if (!db.prepare('PRAGMA table_info(reservations)').all().some((c) => c.name === 'reservationNumber')) {
    db.exec('ALTER TABLE reservations ADD COLUMN reservationNumber TEXT');
  }
  db.prepare("INSERT INTO properties (id, name) VALUES (2, 'Tente')").run();
  db.prepare("UPDATE clients SET firstName = 'Ana', lastName = 'Test' WHERE id = 1").run();
  const controller = buildController({ database: db, model: closuresModel.create(db), onPricingChanged: () => {} });
  return { db, links, controller };
}

// A stay `from` → `to` days ahead; `number` is its reservation or devis number.
function stay(db, { kind = 'reservation', from, to, propertyId = 1, number = null, devisStatus = null }) {
  const id = addStay(db, { kind, startDate: inDays(from), endDate: inDays(to) });
  db.prepare(`UPDATE reservations SET propertyId = ?, ${kind === 'devis' ? 'devisNumber' : 'reservationNumber'} = ?, devisStatus = ? WHERE id = ?`)
    .run(propertyId, number, devisStatus, id);
  return id;
}

function call(handler, { body = {}, query = {}, params = {} } = {}) {
  const res = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
  handler({ body, query, params }, res);
  return res;
}

// « 02/11 », with the year when it is not the closure's (the ledger's shortDate).
const dayLabel = (iso, closureStart) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}${iso.slice(0, 4) === closureStart.slice(0, 4) ? '' : `/${iso.slice(0, 4)}`}`;

module.exports = { seedClosures, stay, call, inDays, addLink, dayLabel };
