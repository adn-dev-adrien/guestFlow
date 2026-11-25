/**
 * `resource_session_orders` — a session ordered on the website and paid online in full (specs/site-outside-resource-booking.md rule 12): the slot, the party, the contact, the terms
 * version, and where the 15 minutes stand. An order is `held` while its payment is awaited, `booked` once the bank confirmed and the session exists, `lapsed` when the 15 minutes ended
 * unpaid, `refund_owed` when money came after the lapse and the slot could not be booked. `ref` is the unguessable token the sale link, the slot hold and the return page share.
 */

const crypto = require('crypto');

const iso = (date) => (date instanceof Date ? date.toISOString() : date);

const CREATE_SQL = `
  CREATE TABLE IF NOT EXISTS resource_session_orders (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    ref            TEXT NOT NULL UNIQUE,
    state          TEXT NOT NULL CHECK (state IN ('held', 'booked', 'lapsed', 'refund_owed')),
    resourceId     INTEGER NOT NULL,
    date           TEXT NOT NULL,
    startTime      TEXT NOT NULL,
    endTime        TEXT NOT NULL,
    minutes        INTEGER NOT NULL,
    people         INTEGER NOT NULL,
    addOns         TEXT NOT NULL DEFAULT '[]',
    recap          TEXT NOT NULL DEFAULT '{}',
    firstName      TEXT NOT NULL,
    lastName       TEXT NOT NULL,
    email          TEXT NOT NULL,
    phone          TEXT NOT NULL,
    termsVersionId INTEGER,
    userAgent      TEXT,
    ip             TEXT,
    dueCents       INTEGER NOT NULL,
    linkId         INTEGER,
    heldUntil      TEXT NOT NULL,
    bookingId      INTEGER,
    saleId         INTEGER,
    note           TEXT,
    createdAt      TEXT NOT NULL,
    settledAt      TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_resource_session_orders_held ON resource_session_orders(state, heldUntil);
`;

function createSessionOrdersModel(db, { now = () => new Date(), token = () => crypto.randomBytes(16).toString('hex') } = {}) {
  const find = (ref) => db.prepare('SELECT * FROM resource_session_orders WHERE ref = ?').get(String(ref)) || null;

  function insert({
    resourceId, date, startTime, endTime, minutes, people, addOns, recap, firstName, lastName, email, phone, termsVersionId, userAgent, ip, dueCents, heldUntil,
  }) {
    const ref = token();
    db.prepare(`INSERT INTO resource_session_orders (ref, state, resourceId, date, startTime, endTime, minutes, people, addOns, recap, firstName, lastName, email, phone, termsVersionId,
      userAgent, ip, dueCents, heldUntil, createdAt) VALUES (?, 'held', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(ref, Number(resourceId), date, startTime, endTime, minutes, people, JSON.stringify(addOns || []), JSON.stringify(recap || {}), firstName, lastName, email, phone, termsVersionId || null,
        userAgent || null, ip || null, dueCents, iso(heldUntil), iso(now()));
    return find(ref);
  }

  const setLink = (ref, linkId) => db.prepare('UPDATE resource_session_orders SET linkId = ? WHERE ref = ?').run(linkId, String(ref));

  const setBooked = (ref, { bookingId, saleId }) => db.prepare("UPDATE resource_session_orders SET state = 'booked', bookingId = ?, saleId = ?, settledAt = ? WHERE ref = ?")
    .run(bookingId, saleId, iso(now()), String(ref));

  /** → whether the order left the state it was in (an order already `booked` never goes back). */
  const setState = (ref, state, note = null) => db.prepare("UPDATE resource_session_orders SET state = ?, note = ?, settledAt = ? WHERE ref = ? AND state != 'booked'")
    .run(state, note, iso(now()), String(ref)).changes > 0;

  const dueLapsed = (at) => db.prepare("SELECT * FROM resource_session_orders WHERE state = 'held' AND heldUntil <= ? ORDER BY id").all(iso(at));

  return {
    find, insert, setLink, setBooked, setState, dueLapsed,
  };
}

module.exports = { createSessionOrdersModel, CREATE_SQL };
