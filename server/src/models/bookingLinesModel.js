/**
 * Booking lines model — the SINGLE writer of a booking's line graph.
 *
 * Since `specs/devis-reservation-fusion.md` a devis and a reservation are the same row (`reservations`,
 * discriminated by `kind`) and their lines live in the very same children: `reservation_options`,
 * `reservation_custom_options`, `reservation_resources`, `reservation_nights`. They nevertheless had two
 * separate persistence stacks, and every extras feature shipped since the fusion landed in the reservation
 * one only — planning-card occurrences and hourly-resource sessions were silently dropped from every devis
 * (specs/devis-extras-parity-and-price-lock.md §1). This module exists so a new line column can never again
 * be written on one side and forgotten on the other.
 *
 * `reservationsModel` and `devisModel` both delegate here; neither writes those four tables directly.
 * Column presence is probed once per instance so the minimal schemas used by unit tests degrade instead of
 * throwing. Exposes a `createBookingLinesModel(db)` factory (default instance bound to the production DB).
 */

const db = require('../database');

function createBookingLinesModel(database) {
  const columnsOf = (table) => {
    try { return new Set(database.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name)); }
    catch { return new Set(); }
  };
  const OPTION_COLUMNS = columnsOf('reservation_options');
  const CUSTOM_OPTION_COLUMNS = columnsOf('reservation_custom_options');
  const RESOURCE_COLUMNS = columnsOf('reservation_resources');
  const hasColumn = (table, column) => {
    if (table === 'reservation_options') return OPTION_COLUMNS.has(column);
    if (table === 'reservation_custom_options') return CUSTOM_OPTION_COLUMNS.has(column);
    if (table === 'reservation_resources') return RESOURCE_COLUMNS.has(column);
    return columnsOf(table).has(column);
  };

  // One INSERT built from a `{ column: value }` map, keeping only the columns the schema really has.
  // The routing/contribution columns landed at different times and the unit-test schemas are minimal
  // on purpose, so an absent column must be dropped rather than throw.
  const insertInto = (table, present) => {
    const cache = new Map();
    return (values) => {
      const names = Object.keys(values).filter((name) => present.has(name));
      const key = names.join(',');
      if (!cache.has(key)) {
        cache.set(key, database.prepare(`INSERT INTO ${table} (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`));
      }
      cache.get(key).run(...names.map((name) => values[name]));
    };
  };

  const insertOption = insertInto('reservation_options', OPTION_COLUMNS);
  const insertCustomOption = insertInto('reservation_custom_options', CUSTOM_OPTION_COLUMNS);
  const insertResource = insertInto('reservation_resources', RESOURCE_COLUMNS);

  // Option-driven planning cards (specs/option-planning-card.md §3.2) — the selected occurrences.
  const HAS_CARD_OCCURRENCES = hasColumn('reservation_options', 'cardOccurrences');
  // « This option row was added by the arrival SAS » (specs/sas-upsells-activate-catalogue-option.md §3.2).
  const HAS_SAS_ARRIVAL_ORIGIN = hasColumn('reservation_options', 'sasArrivalOrigin');
  // Served persons of a per-person card option (specs/card-option-served-persons.md §5).
  const HAS_CARD_PERSONS = hasColumn('reservation_options', 'cardPersons');
  // Hourly-scheduled resource sessions (specs/resource-hourly-scheduling.md), stored as JSON.
  const HAS_RESOURCE_SESSIONS = hasColumn('reservation_resources', 'sessions');
  // Client-visibility flag on the options catalog (specs/laundry-bath-mat.md §3 rule 11).
  const HAS_OPTION_DISPLAY_TO_CLIENT = hasColumn('options', 'displayToClient');

  const serializeCardOccurrences = (line) => (
    Array.isArray(line.cardOccurrences) && line.cardOccurrences.length > 0
      ? JSON.stringify(line.cardOccurrences)
      : null
  );
  const serializeSessions = (line) => (
    Array.isArray(line.sessions) && line.sessions.length > 0 ? JSON.stringify(line.sessions) : null
  );

  // Internal LINEN options (specs/laundry-bath-mat.md §3 rule 11, e.g. the bath-mat option) are NEVER
  // persisted as a booking line — they're counted via the laundry/stock property-default fallback and never
  // billed/shown. Scoped to linen ON PURPOSE: a non-linen internal option (e.g. an internal breakfast) MUST
  // still be materialised so it keeps producing its planning card; only its client display is suppressed
  // elsewhere. Guarded → minimal schemas no-op.
  const internalLinenOptionIds = () => {
    if (!HAS_OPTION_DISPLAY_TO_CLIENT) return new Set();
    try {
      return new Set(database.prepare(`
        SELECT id FROM options
         WHERE displayToClient = 0
           AND (COALESCE(countsAsBedLinen, 0) = 1 OR COALESCE(countsAsBathroomLinen, 0) = 1 OR COALESCE(countsAsBathMat, 0) = 1)
      `).all().map((r) => Number(r.id)));
    } catch { return new Set(); }
  };

  const model = {
    // ── Catalogue options ────────────────────────────────────────────────────────────────────────
    // `inComplement` is carried on every write, authoritative as resolved by the pricing engine
    // (specs/force-extras-complement-on-platform.md §3): the engine applies the platform default for
    // unflagged lines AND honours an explicit operator override, so the model trusts the value verbatim.
    // `acompteContribTtc`/`soldeContribTtc` are owned by the payment-flip path (`updatePayment` →
    // `captureContribsOnFlip`); regular saves preserve whatever the engine returned. Lines in Complément
    // always get NULL contribs — they live 100 % in the Complément entry, never in Acompte/Solde.
    insertOptions(bookingId, optionLines, sasOriginIds = []) {
      const sasOriginSet = new Set((sasOriginIds || []).map((id) => Number(id)));
      const internalLinenIds = internalLinenOptionIds();
      for (const opt of (optionLines || []).filter((line) => !line.isCustom && !internalLinenIds.has(Number(line.optionId)))) {
        const forced = opt.inComplement ? 1 : 0;
        insertOption({
          reservationId: bookingId,
          optionId: opt.optionId,
          quantity: opt.quantity || 1,
          unitPrice: Number(opt.unitPrice || 0),
          billedUnits: Number(opt.billedUnits || 0),
          priceType: opt.priceType || 'per_stay',
          totalPrice: opt.totalPrice || 0,
          offered: opt.offered ? 1 : 0,
          inComplement: forced,
          acompteContribTtc: forced ? null : (opt.acompteContribTtc != null ? Number(opt.acompteContribTtc) : null),
          soldeContribTtc: forced ? null : (opt.soldeContribTtc != null ? Number(opt.soldeContribTtc) : null),
          ...(HAS_CARD_OCCURRENCES ? { cardOccurrences: serializeCardOccurrences(opt) } : {}),
          // How many covers each moment of a per-person card option serves
          // (specs/card-option-served-persons.md §3.1). NULL = the whole party; the engine resolves it
          // and echoes it back, so a fiche re-save can never silently re-inflate a reduced count.
          ...(HAS_CARD_PERSONS ? { cardPersons: opt.cardPersons != null ? Number(opt.cardPersons) : null } : {}),
          ...(sasOriginSet.size > 0 ? { sasArrivalOrigin: sasOriginSet.has(Number(opt.optionId)) ? 1 : 0 } : {}),
        });
      }
    },

    // A fiche save is a DELETE + INSERT, so the SAS-origin marker must be carried over per optionId;
    // otherwise the arrival SAS loses the right to remove its own upsell at the first save
    // (specs/sas-upsells-activate-catalogue-option.md §3.2 rule 9). Guarded: absent column → nothing to carry.
    replaceOptions(bookingId, optionLines) {
      let sasOriginIds = [];
      if (HAS_SAS_ARRIVAL_ORIGIN) {
        sasOriginIds = database.prepare('SELECT optionId FROM reservation_options WHERE reservationId = ? AND COALESCE(sasArrivalOrigin, 0) = 1')
          .all(bookingId).map((r) => Number(r.optionId));
      }
      database.prepare('DELETE FROM reservation_options WHERE reservationId = ?').run(bookingId);
      model.insertOptions(bookingId, optionLines, sasOriginIds);
    },

    // ── Custom (free-text) options ───────────────────────────────────────────────────────────────
    deleteCustomOptions(bookingId) {
      database.prepare('DELETE FROM reservation_custom_options WHERE reservationId = ?').run(bookingId);
    },

    insertCustomOptions(bookingId, optionLines) {
      let sortOrder = 0;
      for (const line of optionLines || []) {
        if (!line.isCustom) continue;
        const forced = line.inComplement ? 1 : 0;
        insertCustomOption({
          reservationId: bookingId,
          description: String(line.title || line.description || '').trim(),
          amount: Number(line.originalTotalPrice || line.totalPrice || 0),
          offered: line.offered ? 1 : 0,
          sortOrder,
          inComplement: forced,
          acompteContribTtc: forced ? null : (line.acompteContribTtc != null ? Number(line.acompteContribTtc) : null),
          soldeContribTtc: forced ? null : (line.soldeContribTtc != null ? Number(line.soldeContribTtc) : null),
        });
        sortOrder += 1;
      }
    },

    replaceCustomOptions(bookingId, optionLines) {
      model.deleteCustomOptions(bookingId);
      model.insertCustomOptions(bookingId, optionLines);
    },

    // ── Resources ────────────────────────────────────────────────────────────────────────────────
    deleteResources(bookingId) {
      database.prepare('DELETE FROM reservation_resources WHERE reservationId = ?').run(bookingId);
    },

    insertResourceLine(bookingId, rr, unitPrice, qty, priceType) {
      const forced = rr.inComplement ? 1 : 0;
      // specs/devis-offered-resource-parity.md §3 rule 1 — an OFFERED line is priced 0 € by the engine,
      // and `||` used to read that legitimate zero as « no total supplied » and re-bill the resource at
      // its catalogue price. The line was then stored `offered = 1` WITH its price, so the devis PDF
      // printed it unmarked and subtracted it from the accommodation row. The fallback now only covers
      // a caller that supplies no total at all.
      const suppliedTotal = rr.totalPrice == null || rr.totalPrice === '' ? null : Number(rr.totalPrice);
      const billedTotal = suppliedTotal != null ? suppliedTotal : Number(unitPrice) * Number(qty);
      insertResource({
        reservationId: bookingId,
        resourceId: rr.resourceId,
        quantity: qty,
        unitPrice,
        billedUnits: Number(rr.billedUnits || qty),
        priceType: priceType || rr.priceType || 'per_stay',
        totalPrice: rr.offered ? 0 : billedTotal,
        offered: rr.offered ? 1 : 0,
        inComplement: forced,
        acompteContribTtc: forced ? null : (rr.acompteContribTtc != null ? Number(rr.acompteContribTtc) : null),
        soldeContribTtc: forced ? null : (rr.soldeContribTtc != null ? Number(rr.soldeContribTtc) : null),
        ...(HAS_RESOURCE_SESSIONS ? { sessions: serializeSessions(rr) } : {}),
      });
    },

    // The engine's `resourceLines` straight from a quote: each line already carries its unit price,
    // billed units and price type.
    replaceResources(bookingId, resourceLines) {
      model.deleteResources(bookingId);
      for (const line of resourceLines || []) {
        model.insertResourceLine(bookingId, line, Number(line.unitPrice || 0), Number(line.quantity || 1), line.priceType);
      }
    },

    // ── Nights ───────────────────────────────────────────────────────────────────────────────────
    insertNights(bookingId, nightlyBreakdown) {
      if (!nightlyBreakdown || nightlyBreakdown.length === 0) return;
      const insertNight = database.prepare('INSERT INTO reservation_nights (reservationId, date, seasonLabel, pricingMode, price) VALUES (?, ?, ?, ?, ?)');
      for (const night of nightlyBreakdown) {
        insertNight.run(bookingId, night.date, night.seasonLabel || 'Standard', night.pricingMode || 'fixed', Number(night.price || 0));
      }
    },

    replaceNights(bookingId, nightlyBreakdown) {
      database.prepare('DELETE FROM reservation_nights WHERE reservationId = ?').run(bookingId);
      model.insertNights(bookingId, nightlyBreakdown);
    },

    // ── Whole-graph helpers ──────────────────────────────────────────────────────────────────────
    // Copy every line of `fromId` onto `toId`, column for column. Used by both convert flows
    // (devis → réservation and réservation → devis): what was quoted is what gets booked, occurrences
    // and sessions included.
    copyLineGraph(fromId, toId) {
      model.replaceOptions(toId, database.prepare('SELECT * FROM reservation_options WHERE reservationId = ?').all(fromId)
        .map((o) => ({
          ...o,
          cardOccurrences: parseJsonArray(o.cardOccurrences),
        })));
      // `reservation_custom_options` stores one `amount`; the writer speaks the engine's shape
      // (`title` + `originalTotalPrice`), so the row is translated rather than spread as-is.
      model.replaceCustomOptions(toId, database.prepare('SELECT * FROM reservation_custom_options WHERE reservationId = ? ORDER BY sortOrder, id').all(fromId)
        .map((o) => ({
          isCustom: true,
          title: o.description,
          originalTotalPrice: o.amount,
          offered: o.offered,
          inComplement: o.inComplement,
          acompteContribTtc: o.acompteContribTtc,
          soldeContribTtc: o.soldeContribTtc,
        })));
      model.deleteResources(toId);
      for (const r of database.prepare('SELECT * FROM reservation_resources WHERE reservationId = ?').all(fromId)) {
        model.insertResourceLine(toId, { ...r, sessions: parseJsonArray(r.sessions) }, r.unitPrice, r.quantity, r.priceType);
      }
      model.replaceNights(toId, database.prepare('SELECT * FROM reservation_nights WHERE reservationId = ?').all(fromId));
    },

    // The prices a booking was sold at, in the shape the pricing engine consumes as `locked*` inputs.
    // Kind-agnostic: a devis under its validity window locks exactly like a saved reservation
    // (specs/devis-extras-parity-and-price-lock.md §3 rule 13).
    getPricingSnapshot(bookingId) {
      const lockedNightlyBreakdown = database.prepare(`
        SELECT date, seasonLabel, pricingMode, price
        FROM reservation_nights WHERE reservationId = ? ORDER BY date
      `).all(bookingId);
      // `inComplement` / `acompteContribTtc` / `soldeContribTtc` are surfaced so the engine can thread
      // them into the returned `quote.optionLines[i]` for the client + accounting model. Selected
      // through the same column probe as the writers: a minimal schema reads the routing as « not in
      // Complément » instead of failing the whole quote.
      const routingSelect = (present) => [
        present.has('inComplement') ? 'COALESCE(inComplement, 0) as inComplement' : '0 as inComplement',
        present.has('acompteContribTtc') ? 'acompteContribTtc' : 'NULL as acompteContribTtc',
        present.has('soldeContribTtc') ? 'soldeContribTtc' : 'NULL as soldeContribTtc',
      ].join(', ');
      const lockedOptionLines = database.prepare(`
        SELECT optionId, quantity, unitPrice, billedUnits, priceType, totalPrice, offered,
          ${routingSelect(OPTION_COLUMNS)}
        FROM reservation_options WHERE reservationId = ?
      `).all(bookingId);
      const lockedResourceLines = database.prepare(`
        SELECT resourceId, quantity, unitPrice, billedUnits, priceType, totalPrice, offered,
          ${routingSelect(RESOURCE_COLUMNS)}
        FROM reservation_resources WHERE reservationId = ?
      `).all(bookingId);
      // The property-level tariff the booking was sold under (tariff-recipes rule 12bis). NULL for a row
      // created before the column: it keeps the pre-existing live behaviour rather than inventing a past
      // tariff nobody recorded.
      let lockedTariff = null;
      try {
        const row = database.prepare('SELECT tariffSnapshot FROM reservations WHERE id = ?').get(bookingId);
        if (row && row.tariffSnapshot) lockedTariff = JSON.parse(row.tariffSnapshot);
      } catch { lockedTariff = null; }
      return { lockedNightlyBreakdown, lockedOptionLines, lockedResourceLines, lockedTariff };
    },
  };

  return model;
}

// Stored JSON columns (`cardOccurrences`, `sessions`) come back as text; the writers expect arrays.
function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

const defaultModel = createBookingLinesModel(db);
defaultModel.buildModel = createBookingLinesModel;

module.exports = defaultModel;
