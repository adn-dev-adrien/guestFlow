/**
 * Resource bookings model — sole DB access for `resource_bookings` (standalone resource slots, e.g. a
 * spa). Owns the booking price (server-authoritative, `priceBooking`, shared by the preview and the commit), the turnover-aware slot-conflict
 * check, and CRUD. `create`/`update` return `{ ok, id }` or `{ error, status }` for the thin controller.
 *
 * Exports a default model bound to the production database, and a `create(db)` factory for tests.
 */

const crypto = require('node:crypto');
const sdk = require('../sdk');
const resourceOccupancyModel = require('./occupancyModel');
const { priceBookingLines, offeredRefusal } = require('./bookingPricing');

// A slot a plugin holds before it reaches the planning, when its source names it in no words of its own.
const HELD_SLOT = 'Créneau réservé, en attente';

const JOIN_QUERY = `
  SELECT rb.*,
    r.name AS resourceName, r.slotDuration, COALESCE(prp.price, r.price) AS resourcePrice, r.openTime, r.closeTime, r.turnoverMinutes, r.openDays,
    c.firstName, c.lastName,
    p.name AS propertyName
  FROM resource_bookings rb
  LEFT JOIN resources r ON rb.resourceId = r.id
  LEFT JOIN property_resource_prices prp ON prp.resourceId = r.id AND prp.propertyId = rb.propertyId
  LEFT JOIN clients c ON rb.clientId = c.id
  LEFT JOIN properties p ON rb.propertyId = p.id
`;

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().split('T')[0];
}

function toMinutes(timeStr) {
  if (!timeStr) return 0;
  const [hours, minutes] = timeStr.split(':').map(Number);
  return (hours * 60) + (minutes || 0);
}

// The request's shape, judged where the model takes it (specs/resource-supplements-total-server-side.md rule 23). A plugin
// reads no core helper for this: the checks are the ones of `utils/bodyText` (hosting-h2 rule 68).
const CLOCK_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const isClockTime = (value) => typeof value === 'string' && CLOCK_TIME.test(value);
const isText = (value) => value === undefined || value === null || typeof value === 'string';
const isFlag = (value) => value === true || value === false || value === 1 || value === 0;
const notSent = (value) => value === undefined || value === null || value === '';
function positiveId(value) {
  const n = typeof value === 'string' && /^[1-9]\d*$/.test(value) ? Number(value) : value;
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}
const refused = (message) => ({ error: message, status: 400 });
const STAY_LINK_MESSAGE = 'Séance hors séjour : aucune réservation à lier.';
const HAS_STAY_MESSAGE = 'Cette séance appartient à un séjour : son paiement est celui du séjour.';

function shapeRefusal(payload, stored = null) {
  const kept = (field) => stored && payload[field] === stored[field];
  for (const field of ['startTime', 'endTime']) {
    if (payload[field] !== undefined && !kept(field) && !isClockTime(payload[field])) return refused('Heure invalide.');
  }
  if (payload.date !== undefined && typeof payload.date !== 'string') return refused('Date invalide.');
  for (const field of ['clientName', 'clientPhone', 'notes']) {
    if (!isText(payload[field])) return refused('Texte attendu.');
  }
  if (payload.paid !== undefined && !isFlag(payload.paid)) return refused('Valeur invalide.');
  const total = payload.displayedTotal;
  if (!notSent(total) && (typeof total === 'object' || typeof total === 'boolean' || !Number.isFinite(Number(total)))) return refused('Valeur invalide.');
  return null;
}

const { roundMoney } = sdk.coreModule('money');

function parseTenders(raw) {
  try {
    const parsed = JSON.parse(raw || 'null');
    return Array.isArray(parsed) ? parsed : null;
  } catch { return null; }
}

// Rule 37 — `paid` is the truth of a payment: every write of this release sets it with the payment columns, and a
// release before 1.4.0 (after a rollback) only knows this flag — its untick leaves `paidAt` behind, never `paid`.
const isPaid = (row) => Number(row && row.paid) === 1;

// What the screens read of a booking's money (rules 11, 15, 19, 28). The flags are the server's answer: the client
// never derives « frozen », « may invoice » or « may arrive » from the columns.
function enrichBooking(b) {
  b.displayName = (b.firstName || b.lastName)
    ? [b.firstName, b.lastName].filter(Boolean).join(' ')
    : (b.clientName || 'Client externe');
  const tenders = parseTenders(b.paymentTenders);
  b.paid = isPaid(b);
  b.payment = b.paid
    ? {
      paidAt: b.paidAt || null,
      tenders: tenders || [],
      internalCents: (tenders || []).filter((t) => t.internal).reduce((sum, t) => sum + Number(t.amountCents || 0), 0),
      label: tenders && tenders.length ? tenders.map((t) => (t.internal ? `${methodLabel(t.method)} (caisse interne)` : methodLabel(t.method))).join(' · ') : 'Moyen non saisi',
      onTheBooks: Boolean(tenders && tenders.length) && !tenders.some((t) => t.internal),
      hasCard: Boolean(tenders && tenders.some((t) => t.method === 'card')),
    }
    : null;
  b.frozen = Boolean(b.qontoInvoiceId) && !b.invoiceCancelledAt;
  b.invoice = b.qontoInvoiceId
    ? {
      number: b.invoiceNumber || null,
      issuedAt: b.invoiceIssuedAt || null,
      cancelled: Boolean(b.invoiceCancelledAt),
      markedPaid: Number(b.invoiceMarkedPaid) === 1,
      attachment: { state: b.attachmentState || null, attempts: Number(b.attachmentAttempts || 0), error: b.attachmentLastError || null },
    }
    : null;
  b.external = !b.reservationId;
  b.arrived = Boolean(b.arrivedAt);
  b.billing = { street: b.billingStreet || '', postcode: b.billingPostcode || '', city: b.billingCity || '' };
  return b;
}

const methodLabel = (method) => sdk.coreModule('paymentTenders').methodLabel(method);

// Rules 25-26 — the billing address of a guest with no client record: every part optional, the postcode 5 digits.
const POSTCODE = /^\d{5}$/;
function billingRefusal(billing) {
  if (billing === undefined || billing === null) return null;
  if (typeof billing !== 'object' || Array.isArray(billing)) return refused('Adresse invalide.');
  for (const field of ['street', 'postcode', 'city']) {
    if (!isText(billing[field])) return refused('Texte attendu.');
  }
  const postcode = String(billing.postcode || '').trim();
  if (postcode && !POSTCODE.test(postcode)) return refused('Code postal : 5 chiffres.');
  return null;
}
function billingOf(billing) {
  const clean = (value) => (typeof value === 'string' && value.trim() ? value.trim().slice(0, 200) : null);
  return { street: clean(billing && billing.street), postcode: clean(billing && billing.postcode), city: clean(billing && billing.city) };
}

// Rule 15 — what an issued invoice states. A cancelled invoice (A2) frees the booking again.
const FROZEN_FIELDS = ['date', 'startTime', 'endTime', 'offeredMinutes', 'clientId', 'clientName', 'propertyId', 'reservationId'];
const FROZEN_MESSAGE = 'Facturée : à annuler dans Qonto avant de modifier.';
const isFrozen = (row) => Boolean(row && row.qontoInvoiceId) && !row.invoiceCancelledAt;

/** Rule 50 — what a Qonto client was created with (name, billing address), as one comparable digest. */
const qontoClientIdentity = (who) => crypto.createHash('sha256')
  .update(JSON.stringify([who.lastName, who.firstName, who.street, who.postcode, who.city, 'FR']))
  .digest('hex');

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const PAID_MESSAGE = 'Payée : retirer d’abord le paiement enregistré.';
// Rule 36 — what moves the price of a booking; anything else (notes, client, address) never reprices a paid one.
const PRICED_FIELDS = ['date', 'startTime', 'endTime', 'propertyId', 'reservationId', 'offeredMinutes'];
const sameValue = (a, b) => String(a ?? '') === String(b ?? '');
const pricedMovedFrom = (existing, next) => PRICED_FIELDS.some((field) => !sameValue(next[field], field === 'offeredMinutes' ? Number(existing.offeredMinutes) || 0 : existing[field]));
const todayInParis = (now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(now);

/**
 * @param {object} database
 * @param {object} [options]
 * @param {() => number} [options.standaloneVatRate] the « TVA des ventes hors séjour » setting, in percent (rule 5)
 * @param {() => Date} [options.now]
 */
function createModel(database, { standaloneVatRate = () => 20, now = () => new Date() } = {}) {
  // Bound to the same database handle so the test factory and production agree on what « occupied » is.
  const occupancyModel = resourceOccupancyModel.create(database);

  /**
   * The price of a booking and how it is made up — the one function behind the preview and the stored
   * `totalPrice` (specs/resource-supplements-total-server-side.md rule 1). Pure read.
   */
  // Rule 5 — the VAT a booking is sold with: none when the instance is out of VAT, the « TVA des ventes hors séjour »
  // setting for a guest with no lodging reservation, the stay's own rate otherwise.
  function vatFor({ reservationId, date }) {
    const vatRegime = sdk.coreModule('vatRegimeModel');
    let regime;
    try {
      regime = reservationId
        ? vatRegime.forRow(database, { id: Number(reservationId) })
        : vatRegime.forRow(database, { newSale: true, startDate: date });
    } catch {
      // A minimal schema without the core's settings: the plugin's own rate for a sale outside a stay.
      return { rate: reservationId ? null : standaloneVatRate() };
    }
    if (!regime || regime.regime === 'not_subject') return { rate: null };
    return { rate: reservationId ? Number(regime.rate) : standaloneVatRate() };
  }

  /**
   * The price of a booking and how it is made up — the one function behind the preview, the stored `totalPrice` and
   * the invoice (specs/resource-booking-pricing-and-invoicing.md rules 3-10). Pure read.
   */
  // `frozenVat` (rule 35): the rate a paid booking was sold with — `{ rate }`, `rate: null` when not subject.
  // `stored` (rule 74): the booking's own row, for a read of a booking already sold — a row priced before the one hourly grid keeps its free
  // hour on the band it fell in; a draft, a new booking or a booking whose slot or party moved is priced on the one grid.
  function breakdownOf({ resource, startTime, endTime, propertyId, reservationId, offeredMinutes = 0, date, frozenVat = null, stored = null }) {
    const pid = Number(propertyId || 0);
    const override = pid > 0 ? sdk.coreModule('catalogue').resourcePriceOverride(database, resource.id, pid) || null : null;
    return priceBookingLines({
      resource, startTime, endTime, override, external: !reservationId, offeredMinutes: Number(offeredMinutes) || 0, vat: frozenVat || vatFor({ reservationId, date }),
      freeHourAtDayRate: stored ? Number(stored.freeHourAtDayRate) === 1 : true,
    });
  }

  // Rule 35 — the VAT of a paid booking is the one frozen with its payment.
  const frozenVatOf = (row) => (row && isPaid(row) && row.paymentRecordedAt ? { rate: row.paidVatRate === null || row.paidVatRate === undefined ? null : Number(row.paidVatRate) } : null);

  // Rule 9 — offered time is judged against the duration and the property's free minutes.
  function offeredCheck({ resource, startTime, endTime, propertyId, reservationId, offeredMinutes, date }) {
    const free = breakdownOf({ resource, startTime, endTime, propertyId, reservationId, offeredMinutes: 0, date });
    const message = offeredRefusal(offeredMinutes, {
      durationMinutes: free.durationMinutes, freeMinutesApplied: free.freeMinutesApplied, perHour: resource.priceType === 'per_hour',
    });
    return message ? refused(message) : null;
  }

  // The refusals shared by the preview and the commit: a real day inside the date window (unless it is the
  // edited booking's stored day, specs/reservations-backend-mvc.md rule 13, reading of 2026-11-02), minimum
  // duration, then capacity — the booking itself excluded when it is edited.
  function checkBookable({ resource, date, startTime, endTime, excludeId = null, storedDate, storedTimes }) {
    const dateError = sdk.coreModule('stayDates').entryDateMessage(date, { stored: storedDate });
    if (dateError) return { error: dateError, status: 400 };
    // Rule 23, reading of 2026-11-05 — a booking ends after it starts; only the stored pair sent back is exempt.
    const storedPair = storedTimes && storedTimes.startTime === startTime && storedTimes.endTime === endTime;
    if (!storedPair && toMinutes(endTime) <= toMinutes(startTime)) {
      return { error: 'L’heure de fin doit suivre l’heure de début.', status: 400 };
    }
    const duration = Math.max(0, toMinutes(endTime) - toMinutes(startTime));
    const minUsage = minimumUsageMinutes(resource);
    if (minUsage > 0 && duration < minUsage) {
      return { error: `Durée minimale ${minUsage} min requise`, status: 400 };
    }
    const turnover = Number(resource.turnoverMinutes || 0);
    if (countConflicts(resource.id, date, startTime, endTime, turnover, excludeId) >= resource.quantity) {
      return { error: 'Créneau non disponible (capacité atteinte)', status: 409 };
    }
    return null;
  }

  /**
   * specs/resource-supplements-total-server-side.md rules 1, 4, 5 — prices a booking draft
   * `{ resourceId, bookingId, date, startTime, endTime, propertyId }` without writing anything.
   * Returns the breakdown, or `{ error, status }` with the very refusals the commit would give.
   */
  function priceBooking(draft = {}) {
    const { resourceId, bookingId, date, startTime, endTime, propertyId, offeredMinutes = 0 } = draft;
    if (!resourceId || !date || !startTime || !endTime) {
      return { error: 'resourceId, date, startTime, endTime sont requis', status: 400 };
    }
    if (positiveId(resourceId) === null || (!notSent(bookingId) && positiveId(bookingId) === null)) return refused('Identifiant invalide.');
    const shape = shapeRefusal({ date, startTime, endTime }) || linkRefusal({ propertyId });
    if (shape) return shape;
    const resource = getResourceForBooking(positiveId(resourceId));
    if (!resource) return { error: 'Ressource non trouvée', status: 404 };
    let reservationId = null;
    let storedDate;
    let storedTimes;
    let frozenVat = null;
    let stored = null;
    if (!notSent(bookingId)) {
      const existing = database.prepare('SELECT * FROM resource_bookings WHERE id = ?').get(bookingId);
      if (!existing) return { error: 'Réservation non trouvée', status: 404 };
      if (Number(existing.resourceId) !== Number(resourceId)) return { error: 'Réservation d’une autre ressource', status: 400 };
      reservationId = existing.reservationId;
      storedDate = existing.date;
      storedTimes = existing;
      frozenVat = frozenVatOf(existing);
      const draftPriced = { date, startTime, endTime, propertyId: propertyId || null, reservationId: existing.reservationId, offeredMinutes: Number(offeredMinutes) || 0 };
      if (!pricedMovedFrom(existing, draftPriced)) stored = existing;
    }
    const refusal = checkBookable({ resource, date, startTime, endTime, excludeId: bookingId || null, storedDate, storedTimes })
      || offeredCheck({ resource, startTime, endTime, propertyId, reservationId, offeredMinutes, date });
    if (refusal) return refusal;
    return breakdownOf({ resource, startTime, endTime, propertyId, reservationId, offeredMinutes, date, frozenVat, stored });
  }

  // Rule 15 — what the screen showed is compared with what is stored, never enforced.
  function totalWarning(displayedTotal, stored) {
    if (displayedTotal === undefined || displayedTotal === null || displayedTotal === '') return null;
    const displayed = Number(displayedTotal);
    if (!Number.isFinite(displayed) || Math.abs(displayed - stored) < 0.01) return null;
    return { code: 'BOOKING_TOTAL_DIFFERED', displayed: roundMoney(displayed), stored };
  }

  // Minimum billable/usable duration (per-hour minimum or complex slot duration).
  function minimumUsageMinutes(resource) {
    return resource.priceType === 'per_hour'
      ? Math.max(Number(resource.minimumUsageMinutes || 0), resource.isComplex ? Number(resource.slotDuration || 0) : 0)
      : (resource.isComplex ? Number(resource.slotDuration || 0) : 0);
  }

  // Count everything overlapping (turnover buffer included) on a date, optionally excluding one
  // booking. Delegates to `resourceOccupancyModel` so guest sessions count too: this predicate used to
  // read `resource_bookings` alone, which let a standalone booking be created straight on top of a
  // reservation's session (specs/hourly-resource-quantity-and-sas-scheduling.md §1 defect 4).
  function countConflicts(resourceId, date, startTime, endTime, turnover, excludeId) {
    return occupancyModel.countConflicts({
      resourceId, date, startTime, endTime, turnover, excludeBookingId: excludeId,
    });
  }

  // Rule 23 — what a booking links to: not sent, or a row that exists; a stored link sent back is not re-judged.
  const LINKS = [
    ['clientId', 'clients', 'Client non trouvé'],
    ['propertyId', 'properties', 'Logement non trouvé'],
  ];
  function linkRefusal(payload, stored = null) {
    // Rule 46 (R36-DB-L2) — a booking is a sale outside any stay: no screen links one to a stay, and money taken on such a
    // link would be booked nowhere. A stored link sent back unchanged passes.
    if (!notSent(payload.reservationId) && !(stored && payload.reservationId === stored.reservationId)) {
      return { error: STAY_LINK_MESSAGE, status: 400, code: 'BOOKING_STAY_LINK' };
    }
    for (const [field, table, missing] of LINKS) {
      const value = payload[field];
      if (notSent(value) || (stored && value === stored[field])) continue;
      const id = positiveId(value);
      if (id === null) return refused('Identifiant invalide.');
      if (!database.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(id)) return { error: missing, status: 404 };
    }
    return null;
  }

  function getResourceForBooking(resourceId) {
    return database.prepare('SELECT id, quantity, price, turnoverMinutes, priceType, minimumUsageMinutes, slotDuration, isComplex, showsPlanningCard, hourlyEveningStart, hourlyEveningRate, hourlyExternalDayRate, hourlyExternalEveningRate FROM resources WHERE id = ?')
      .get(resourceId);
  }

  function listPlanningEvents(from, to) {
    return database.prepare(`${JOIN_QUERY} WHERE rb.date >= ? AND rb.date <= ? ORDER BY rb.date, rb.startTime`)
      .all(from, to).map(enrichBooking);
  }

  function getOccupiedSlots(resourceId, date) {
    const bookings = database.prepare(`
      SELECT rb.id, rb.startTime, rb.endTime, rb.clientName, r.turnoverMinutes, c.firstName, c.lastName
      FROM resource_bookings rb
      LEFT JOIN resources r ON rb.resourceId = r.id
      LEFT JOIN clients c ON rb.clientId = c.id
      WHERE rb.resourceId = ? AND rb.date = ?
      ORDER BY rb.startTime
    `).all(resourceId, date);
    return bookings.map((b) => ({
      id: b.id,
      startTime: b.startTime,
      endTime: b.endTime,
      turnover: Number(b.turnoverMinutes || 0),
      description: [b.firstName, b.lastName].filter(Boolean).join(' ') || b.clientName || 'Client externe',
    }));
  }

  /**
   * Everything occupying the resource over the window — standalone bookings AND the sessions placed
   * on reservations — each tagged `kind`. The planning page used to fetch the two separately and merge
   * them in React (a fat-backend violation, and a second definition of « occupied » that could drift
   * from the one the writer enforces). Reservation sessions come back read-only: they belong to a
   * booking, and are edited from its fiche or from the arrival SAS.
   * See specs/hourly-resource-quantity-and-sas-scheduling.md §3.5 rule 29.
   */
  function listForResource({ resourceId, date, weekStart }) {
    const from = weekStart || date;
    const to = weekStart ? addDays(weekStart, 6) : date;
    const bookings = (weekStart
      ? database.prepare(`${JOIN_QUERY} WHERE rb.resourceId = ? AND rb.date >= ? AND rb.date < ? ORDER BY rb.date, rb.startTime`)
        .all(resourceId, weekStart, addDays(weekStart, 7))
      : database.prepare(`${JOIN_QUERY} WHERE rb.resourceId = ? AND rb.date = ? ORDER BY rb.startTime`)
        .all(resourceId, date)
    ).map((b) => ({ ...enrichBooking(b), kind: 'booking' }));

    return [...bookings, ...listReservationSessions({ resourceId, from, to }), ...listHeldSlots({ resourceId, from, to })]
      .sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.startTime).localeCompare(String(b.startTime)));
  }

  /**
   * The guest sessions of the window, shaped like a booking row so the planning can render one list.
   * Unlike `resourceOccupancyModel` (which feeds conflict checks and the guest-facing SAS picker, and
   * deliberately carries no identity), this is the OPERATOR's planning: it names the client, exactly
   * as the standalone bookings beside it do.
   */
  function listReservationSessions({ resourceId, from, to }) {
    let rows;
    try {
      rows = database.prepare(`
        SELECT rr.reservationId, rr.sessions,
               r.name AS resourceName, r.turnoverMinutes,
               COALESCE(c.firstName, '') AS firstName, COALESCE(c.lastName, '') AS lastName,
               COALESCE(p.name, '') AS propertyName
        FROM reservation_resources rr
        JOIN resources r ON r.id = rr.resourceId
        JOIN reservations res ON res.id = rr.reservationId
        LEFT JOIN clients c ON c.id = res.clientId
        LEFT JOIN properties p ON p.id = res.propertyId
        WHERE rr.resourceId = ? AND res.kind = 'reservation'
          AND rr.sessions IS NOT NULL AND TRIM(rr.sessions) != ''
      `).all(resourceId);
    } catch { return []; } // `sessions` column absent in minimal test schemas
    const out = [];
    for (const row of rows) {
      for (const session of occupancyModel.parseSessions(row.sessions)) {
        if (session.date < from || session.date > to) continue;
        out.push({
          id: `session-${row.reservationId}-${session.date}-${session.start}`,
          kind: 'session',
          reservationId: Number(row.reservationId),
          resourceId: Number(resourceId),
          resourceName: row.resourceName,
          date: session.date,
          startTime: session.start,
          endTime: session.end,
          turnoverMinutes: Number(row.turnoverMinutes || 0),
          propertyName: row.propertyName,
          displayName: [row.firstName, row.lastName].filter(Boolean).join(' ') || 'Client',
          paid: false,
        });
      }
    }
    return out;
  }

  /**
   * The slots a guest order awaiting payment holds (specs/guest-app.md rule 35), shaped like a guest session —
   * read-only, opening the stay's fiche — so the operator sees the slot taken before the money arrives.
   */
  function listHeldSlots({ resourceId, from, to }) {
    const holds = occupancyModel.listHolds({ resourceId, from, to });
    if (!holds.length) return [];
    const resource = database.prepare('SELECT name, turnoverMinutes FROM resources WHERE id = ?').get(Number(resourceId)) || {};
    return holds.map((hold) => ({
      id: `hold-${hold.reservationId || 0}-${hold.date}-${hold.start}`,
      kind: 'session',
      held: true,
      reservationId: hold.reservationId,
      resourceId: Number(resourceId),
      resourceName: resource.name,
      date: hold.date,
      startTime: hold.start,
      endTime: hold.end,
      turnoverMinutes: Number(resource.turnoverMinutes || 0),
      propertyName: '',
      displayName: hold.label || HELD_SLOT,
      paid: false,
    }));
  }

  function findById(id) {
    const booking = database.prepare(`${JOIN_QUERY} WHERE rb.id = ?`).get(id);
    return booking ? enrichBooking(booking) : null;
  }

  function createBooking(payload) {
    const { resourceId, reservationId, clientId, clientName, clientPhone, propertyId, date, startTime, endTime, notes } = payload;
    const offeredMinutes = Number(payload.offeredMinutes) || 0;
    if (!resourceId || !date || !startTime || !endTime) {
      return { error: 'resourceId, date, startTime, endTime sont requis', status: 400 };
    }
    if (positiveId(resourceId) === null) return refused('Identifiant invalide.');
    const shape = shapeRefusal(payload) || linkRefusal(payload) || billingRefusal(payload.billing);
    if (shape) return shape;
    const resource = getResourceForBooking(positiveId(resourceId));
    if (!resource) return { error: 'Ressource non trouvée', status: 404 };

    const refusal = checkBookable({ resource, date, startTime, endTime })
      || offeredCheck({ resource, startTime, endTime, propertyId, reservationId, offeredMinutes: payload.offeredMinutes, date });
    if (refusal) return refusal;

    const totalPrice = breakdownOf({ resource, startTime, endTime, propertyId, reservationId, offeredMinutes, date }).total;
    const billing = billingOf(payload.billing);
    const result = database.prepare(
      'INSERT INTO resource_bookings (resourceId, reservationId, clientId, clientName, clientPhone, propertyId, date, startTime, endTime, notes, totalPrice, paid, offeredMinutes, billingStreet, billingPostcode, billingCity, freeHourAtDayRate) VALUES (?,?,?,?,?,?,?,?,?,?,?,0,?,?,?,?,1)'
    ).run(resource.id, reservationId || null, clientId || null, clientName || null, clientPhone || null, propertyId || null, date, startTime, endTime, notes || '', totalPrice, offeredMinutes, billing.street, billing.postcode, billing.city);
    return { ok: true, id: result.lastInsertRowid, totalPrice, warning: totalWarning(payload.displayedTotal, totalPrice) };
  }

  function update(id, payload) {
    const existing = database.prepare('SELECT * FROM resource_bookings WHERE id = ?').get(id);
    if (!existing) return { error: 'Réservation non trouvée', status: 404 };
    const shape = shapeRefusal(payload, existing) || linkRefusal(payload, existing) || billingRefusal(payload.billing);
    if (shape) return shape;
    // Rule 15 — an invoiced booking keeps everything its invoice states; only the notes move.
    if (isFrozen(existing)) {
      const moved = FROZEN_FIELDS.some((field) => payload[field] !== undefined && String(payload[field] ?? '') !== String(existing[field] ?? ''));
      if (moved) return { error: FROZEN_MESSAGE, status: 409, code: 'BOOKING_INVOICED' };
      if (payload.notes !== undefined) {
        database.prepare("UPDATE resource_bookings SET notes = ?, updatedAt = datetime('now') WHERE id = ?").run(payload.notes ?? '', id);
      }
      return { ok: true, totalPrice: existing.totalPrice, warning: null };
    }

    const { reservationId, clientId, clientName, clientPhone, propertyId, date, startTime, endTime, notes } = payload;
    const newDate = date !== undefined ? date : existing.date;
    const newStart = startTime !== undefined ? startTime : existing.startTime;
    const newEnd = endTime !== undefined ? endTime : existing.endTime;

    const resource = getResourceForBooking(existing.resourceId);
    if (!resource) return { error: 'Ressource non trouvée', status: 404 };

    const nextPropertyId = propertyId !== undefined ? propertyId : existing.propertyId;
    const nextReservationId = reservationId !== undefined ? (reservationId || null) : existing.reservationId;
    const nextOffered = payload.offeredMinutes !== undefined ? payload.offeredMinutes : existing.offeredMinutes;
    const next = { date: newDate, startTime: newStart, endTime: newEnd, propertyId: nextPropertyId, reservationId: nextReservationId, offeredMinutes: Number(nextOffered) || 0 };
    const pricedMoved = pricedMovedFrom(existing, next);
    let totalPrice;
    let freeHourAtDayRate = existing.freeHourAtDayRate ?? null;
    if (isPaid(existing) && !pricedMoved) {
      // Rule 36 — a paid booking whose slot does not move keeps the total its payment covers, whatever the tariff now.
      totalPrice = Number(existing.totalPrice);
    } else {
      const refusal = checkBookable({ resource, date: newDate, startTime: newStart, endTime: newEnd, excludeId: id, storedDate: existing.date, storedTimes: existing })
        || offeredCheck({ resource, startTime: newStart, endTime: newEnd, propertyId: nextPropertyId, reservationId: nextReservationId, offeredMinutes: nextOffered, date: newDate });
      if (refusal) return refusal;
      // Specs/pricing-components.md §3 rule 74 — only the operator moving the slot or the party puts a booking on the one hourly grid; any other
      // save of an unpaid booking re-prices it as before (rule 36 reading), its free hour still valued as it was sold.
      if (pricedMoved) freeHourAtDayRate = 1;
      totalPrice = breakdownOf({
        resource, startTime: newStart, endTime: newEnd, propertyId: nextPropertyId, reservationId: nextReservationId, offeredMinutes: nextOffered, date: newDate,
        stored: { freeHourAtDayRate },
      }).total;
      // Rule 12 — a recorded payment covers the total it was taken for: a price that moves takes it back.
      if (isPaid(existing) && Math.abs(Number(existing.totalPrice) - totalPrice) >= 0.005) {
        return { error: 'Le prix change : retirer d’abord le paiement enregistré.', status: 409, code: 'BOOKING_PAID' };
      }
    }
    const billing = payload.billing !== undefined ? billingOf(payload.billing) : { street: existing.billingStreet, postcode: existing.billingPostcode, city: existing.billingCity };

    database.prepare(
      "UPDATE resource_bookings SET reservationId=?,clientId=?,clientName=?,clientPhone=?,propertyId=?,date=?,startTime=?,endTime=?,notes=?,totalPrice=?,offeredMinutes=?,billingStreet=?,billingPostcode=?,billingCity=?,freeHourAtDayRate=?,updatedAt=datetime('now') WHERE id=?"
    ).run(
      reservationId !== undefined ? (reservationId || null) : existing.reservationId,
      clientId !== undefined ? (clientId || null) : existing.clientId,
      clientName !== undefined ? (clientName || null) : existing.clientName,
      clientPhone !== undefined ? (clientPhone || null) : existing.clientPhone,
      propertyId !== undefined ? (propertyId || null) : existing.propertyId,
      newDate, newStart, newEnd,
      notes !== undefined ? (notes ?? '') : existing.notes,
      totalPrice,
      Number(nextOffered) || 0,
      billing.street || null, billing.postcode || null, billing.city || null,
      freeHourAtDayRate,
      id,
    );
    return { ok: true, totalPrice, warning: totalWarning(payload.displayedTotal, totalPrice) };
  }

  function remove(id) {
    const existing = database.prepare('SELECT * FROM resource_bookings WHERE id = ?').get(id);
    if (!existing) return { error: 'Non trouvée', status: 404 };
    if (isFrozen(existing)) return { error: FROZEN_MESSAGE, status: 409, code: 'BOOKING_INVOICED' };
    // Rule 34 — a paid booking is a sale of the journal: its payment is taken back first, on purpose.
    if (isPaid(existing)) return { error: PAID_MESSAGE, status: 409, code: 'BOOKING_PAID' };
    database.prepare('DELETE FROM resource_bookings WHERE id = ?').run(id);
    return { ok: true };
  }

  function rawById(id) {
    return database.prepare('SELECT * FROM resource_bookings WHERE id = ?').get(id) || null;
  }

  /**
   * Rules 11-12 — the payment of a booking, through the fiches' tender rules: the lines must cover the total, cash may
   * go to the caisse interne. Refused on an invoiced booking (its invoice states the payment).
   */
  function recordPayment(id, { tenders, paidAt } = {}) {
    const existing = rawById(id);
    if (!existing) return { error: 'Réservation non trouvée', status: 404 };
    if (isFrozen(existing)) return { error: FROZEN_MESSAGE, status: 409, code: 'BOOKING_INVOICED' };
    // Rule 46 — a stored row linked to a stay takes no money of its own: the stay's books do not read it.
    if (existing.reservationId) return { error: HAS_STAY_MESSAGE, status: 409, code: 'BOOKING_HAS_STAY' };
    const day = paidAt === undefined || paidAt === null || paidAt === '' ? todayInParis(now()) : paidAt;
    if (typeof day !== 'string' || !ISO_DAY.test(day) || sdk.coreModule('stayDates').entryDateMessage(day)) return refused('Date du paiement invalide.');
    const dueCents = Math.round(Number(existing.totalPrice || 0) * 100);
    if (dueCents <= 0) return refused('Rien à encaisser.');
    const check = sdk.coreModule('paymentTenders').validateSettlement({ tenders, dueCents, shortfall: null });
    if (!check.ok) return refused(check.error);
    // Rule 35 — the rate in force when the money is taken is the rate of the sale, in the journal and on the invoice.
    const { rate } = vatFor({ reservationId: existing.reservationId, date: existing.date });
    database.prepare(`UPDATE resource_bookings SET paymentTenders = ?, paidAt = ?, paymentRecordedAt = datetime('now'), paid = 1,
      paidVatRate = ?, updatedAt = datetime('now') WHERE id = ?`).run(JSON.stringify(check.lines), day, rate ?? null, id);
    return { ok: true };
  }

  function clearPayment(id) {
    const existing = rawById(id);
    if (!existing) return { error: 'Réservation non trouvée', status: 404 };
    if (isFrozen(existing)) return { error: FROZEN_MESSAGE, status: 409, code: 'BOOKING_INVOICED' };
    database.prepare(`UPDATE resource_bookings SET paymentTenders = NULL, paidAt = NULL, paymentRecordedAt = NULL, paid = 0,
      paidVatRate = NULL, invoiceMarkPending = 0, updatedAt = datetime('now') WHERE id = ?`).run(id);
    return { ok: true };
  }

  /**
   * Rules 28-31 — the arrival of a guest with no stay, in one transaction: offered time, billing address, arrival,
   * then the payment when one is given. The invoice is the caller's, after the commit (rule 30).
   */
  function recordArrival(id, { offeredMinutes, payment, billing } = {}) {
    const existing = rawById(id);
    if (!existing) return { error: 'Réservation non trouvée', status: 404 };
    if (existing.reservationId) return { error: 'Cette séance appartient à un séjour : son sas d’arrivée est celui du séjour.', status: 409, code: 'BOOKING_HAS_STAY' };
    // Rule 28 — on its day only; an arrival already recorded can be opened again any day (rule 32).
    if (!existing.arrivedAt && existing.date !== todayInParis(now())) {
      return { error: 'Arrivée : le jour de la séance seulement.', status: 409, code: 'ARRIVAL_NOT_TODAY' };
    }
    // A refusal inside the steps rolls every step back: it is thrown out of the transaction, then returned.
    const stop = (result) => { const err = new Error('refused'); err.refusal = result; throw err; };
    try {
      database.transaction(() => {
        if (!isFrozen(existing) && !isPaid(existing)) {
          const moved = update(id, {
            ...(offeredMinutes !== undefined ? { offeredMinutes } : {}),
            ...(billing !== undefined ? { billing } : {}),
          });
          if (moved.error) stop(moved);
        } else if (billing !== undefined) {
          const shape = billingRefusal(billing);
          if (shape) stop(shape);
          const b = billingOf(billing);
          database.prepare('UPDATE resource_bookings SET billingStreet = ?, billingPostcode = ?, billingCity = ? WHERE id = ?').run(b.street, b.postcode, b.city, id);
        }
        database.prepare("UPDATE resource_bookings SET arrivedAt = COALESCE(arrivedAt, datetime('now')) WHERE id = ?").run(id);
        if (payment && !isPaid(rawById(id))) {
          const paid = recordPayment(id, payment);
          if (paid.error) stop(paid);
        }
      })();
    } catch (err) {
      if (err && err.refusal) return err.refusal;
      throw err;
    }
    return { ok: true };
  }

  // Rule 25 — the address typed after Qonto asked for it: allowed on a frozen-to-be booking, never moves the price.
  function recordArrivalBilling(id, billing) {
    if (!rawById(id)) return { error: 'Réservation non trouvée', status: 404 };
    const shape = billingRefusal(billing);
    if (shape) return shape;
    const b = billingOf(billing);
    database.prepare('UPDATE resource_bookings SET billingStreet = ?, billingPostcode = ?, billingCity = ? WHERE id = ?').run(b.street, b.postcode, b.city, id);
    return { ok: true };
  }

  /** The frozen breakdown an invoice copies (rule 14): the stored booking, priced as stored. */
  function invoiceBasis(id) {
    const row = rawById(id);
    if (!row) return null;
    const resource = getResourceForBooking(row.resourceId);
    if (!resource) return null;
    // Rule 35 — the lines at the rate frozen with the payment; rule 36 — the stored total is what was paid.
    const breakdown = breakdownOf({
      resource, startTime: row.startTime, endTime: row.endTime, propertyId: row.propertyId, reservationId: row.reservationId,
      offeredMinutes: row.offeredMinutes, date: row.date, frozenVat: frozenVatOf(row), stored: row,
    });
    const client = row.clientId ? database.prepare('SELECT * FROM clients WHERE id = ?').get(row.clientId) : null;
    const [first, ...rest] = String(row.clientName || '').trim().split(/\s+/);
    const text = (value) => (typeof value === 'string' ? value.trim() : (value === null || value === undefined ? '' : String(value).trim()));
    // Rule 14 — a registered client's address is his record's; an « extérieur » has the one typed on the booking.
    const address = client
      ? {
        street: [text(client.streetNumber), text(client.street)].filter(Boolean).join(' ') || text(client.address),
        postcode: text(client.postalCode),
        city: text(client.city),
      }
      : { street: text(row.billingStreet), postcode: text(row.billingPostcode), city: text(row.billingCity) };
    const person = client
      ? { firstName: client.firstName || '', lastName: client.lastName || client.firstName || 'Client' }
      : { firstName: rest.length ? first : '', lastName: rest.length ? rest.join(' ') : (first || 'Client') };
    // Rule 50 — a Qonto client is reused only for the identity it was created with: this booking's own (a re-issue),
    // else, for a guest of the clients directory, the one an earlier invoice of his made.
    const clientIdentity = qontoClientIdentity({ ...person, ...address });
    const sameIdentity = row.qontoClientId && row.qontoClientIdentity === clientIdentity ? row.qontoClientId : null;
    const knownQontoClient = !sameIdentity && row.clientId
      ? (database.prepare(`SELECT qontoClientId FROM resource_bookings WHERE clientId = ? AND qontoClientId IS NOT NULL
        AND qontoClientIdentity = ? ORDER BY id DESC LIMIT 1`).get(row.clientId, clientIdentity) || {}).qontoClientId
      : null;
    return {
      row: enrichBooking({ ...row }),
      resource,
      breakdown,
      clientIdentity,
      who: { ...person, clientId: sameIdentity || knownQontoClient || null, ...address },
    };
  }

  function storeInvoice(id, {
    invoiceId, number, clientId, clientIdentity = null, vatRate, total, markedPaid, markPending = false,
  }) {
    database.prepare(`UPDATE resource_bookings SET qontoInvoiceId = ?, invoiceNumber = ?, qontoClientId = ?, qontoClientIdentity = ?, invoiceIssuedAt = datetime('now'),
      invoiceVatRate = ?, invoiceTotal = ?, invoiceMarkedPaid = ?, invoiceMarkPending = ?, invoiceCancelledAt = NULL, attachmentState = ?, attachmentAttempts = 0,
      attachmentLastError = NULL, attachmentTransactionId = NULL, attachmentId = NULL, updatedAt = datetime('now') WHERE id = ?`)
      .run(invoiceId, number, clientId, clientIdentity, vatRate, total, markedPaid ? 1 : 0, markPending ? 1 : 0, null, id);
  }

  // Rule 38 — « marquer payée » settled later by the watch job: done, or Qonto does not offer it (stays « à payer »).
  function settleInvoiceMark(id, { markedPaid }) {
    database.prepare('UPDATE resource_bookings SET invoiceMarkedPaid = ?, invoiceMarkPending = 0 WHERE id = ?').run(markedPaid ? 1 : 0, id);
  }

  function setAttachment(id, { state, transactionId = null, attachmentId = null, error = null, countAttempt = false }) {
    database.prepare(`UPDATE resource_bookings SET attachmentState = ?, attachmentTransactionId = COALESCE(?, attachmentTransactionId),
      attachmentId = COALESCE(?, attachmentId), attachmentLastError = ?, attachmentAttempts = attachmentAttempts + ? WHERE id = ?`)
      .run(state, transactionId, attachmentId, error, countAttempt ? 1 : 0, id);
  }

  function markInvoiceCancelled(id) {
    database.prepare("UPDATE resource_bookings SET invoiceCancelledAt = datetime('now'), attachmentState = NULL WHERE id = ?").run(id);
  }

  // Rules 18, A2 — the invoiced bookings the hourly job still looks after: an attachment to find, or an invoice that
  // may be cancelled in Qonto.
  function invoicedToWatch() {
    return database.prepare(`SELECT * FROM resource_bookings WHERE qontoInvoiceId IS NOT NULL AND invoiceCancelledAt IS NULL
      AND date >= date('now', '-60 days') ORDER BY id`).all().map((r) => enrichBooking(r));
  }

  /**
   * Rules 20-21, A4 — the sales of the window, for the journal and the card batch: payments recorded since the install,
   * on their payment day, with their part on the books (total minus caisse interne).
   */
  function standaloneSales({ from, to }) {
    const rows = database.prepare(`SELECT rb.*, c.firstName, c.lastName, r.name AS resourceName FROM resource_bookings rb
      LEFT JOIN clients c ON c.id = rb.clientId LEFT JOIN resources r ON r.id = rb.resourceId
      WHERE rb.reservationId IS NULL AND rb.paid = 1 AND rb.paymentRecordedAt IS NOT NULL AND rb.paidAt >= ? AND rb.paidAt <= ? ORDER BY rb.paidAt, rb.id`).all(from, to);
    return rows.map((row) => {
      const tenders = parseTenders(row.paymentTenders) || [];
      const totalCents = Math.round(Number(row.totalPrice || 0) * 100);
      const internalCents = tenders.filter((t) => t.internal).reduce((sum, t) => sum + Number(t.amountCents || 0), 0);
      const cardCents = tenders.filter((t) => t.method === 'card').reduce((sum, t) => sum + Number(t.amountCents || 0), 0);
      const [first, ...rest] = String(row.clientName || '').trim().split(/\s+/);
      const vat = frozenVatOf(row).rate;
      return {
        key: `resource-booking:${row.id}`,
        date: row.paidAt,
        totalCents,
        booksCents: Math.max(0, totalCents - internalCents),
        cardCents,
        label: `${row.resourceName || 'Ressource'} du ${row.date.split('-').reverse().join('/')}`,
        client: row.clientId ? { firstName: row.firstName || '', lastName: row.lastName || '' } : { firstName: rest.length ? first : '', lastName: rest.length ? rest.join(' ') : (first || '') },
        vatRate: vat,
        invoiceNumber: row.qontoInvoiceId && !row.invoiceCancelledAt ? row.invoiceNumber : null,
      };
    });
  }

  return {
    vatFor,
    settleInvoiceMark,
    recordArrivalBilling,
    recordPayment,
    clearPayment,
    recordArrival,
    invoiceBasis,
    storeInvoice,
    setAttachment,
    markInvoiceCancelled,
    invoicedToWatch,
    standaloneSales,
    rawById,
    breakdownOf,
    priceBooking,
    checkBookable,
    minimumUsageMinutes,
    countConflicts,
    listPlanningEvents,
    getOccupiedSlots,
    listForResource,
    listReservationSessions,
    findById,
    createBooking,
    update,
    remove,
  };
}

module.exports = {
  create: createModel, enrichBooking, isFrozen, isPaid, FROZEN_MESSAGE, PAID_MESSAGE,
};
