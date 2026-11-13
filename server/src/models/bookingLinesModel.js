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
 *
 * Line identity (specs/pricing-components.md §3 rule 79): every line row has a stable `lineId`, and a save keeps it. A save
 * stays a DELETE + INSERT in the engine's order (the rows are read back in that order by readers that sort nothing, and a
 * custom line's `id` is still renumbered), but each line that is sold again is written with the `lineId` and every column
 * this writer does not know, read from the row it replaces: by article for a catalogue line, by text for a custom line.
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
  // What a save carries across from the line it replaces: every column of the row that this writer does not write — the
  // `lineId`, and the sale columns of rule 74. Read before the DELETE, by article.
  const WRITTEN = {
    reservation_options: ['reservationId', 'optionId', 'quantity', 'unitPrice', 'billedUnits', 'priceType', 'totalPrice', 'offered', 'inComplement',
      'acompteContribTtc', 'soldeContribTtc', 'cardOccurrences', 'cardPersons', 'cardNights', 'sasArrivalOrigin', 'allowanceUsed'],
    reservation_resources: ['reservationId', 'resourceId', 'quantity', 'unitPrice', 'billedUnits', 'priceType', 'totalPrice', 'offered', 'inComplement',
      'acompteContribTtc', 'soldeContribTtc', 'sessions'],
  };
  WRITTEN.reservation_custom_options = ['id', 'reservationId', 'description', 'amount', 'offered', 'sortOrder', 'createdAt', 'updatedAt', 'inComplement',
    'acompteContribTtc', 'soldeContribTtc', 'sasArrivalOrigin', 'sasLineKey', 'quantity'];
  const carriedColumns = (table, present) => [...present].filter((name) => !WRITTEN[table].includes(name));
  // Rule 85: an article may be stored on several lines. `get(article)` hands out the carried columns of ONE stored line per call, in the
  // order the lines were numbered, so each line of a save takes the identity of a different stored line (never two the same `lineId`);
  // `get(article, lineId)` asks for the line a posted line names. An article with one stored line answers once, as it always did.
  class CarriedLines extends Map {
    get(article, lineId) {
      const queue = super.get(article);
      if (!queue || queue.length === 0) return undefined;
      const at = lineId == null ? -1 : queue.findIndex((entry) => entry.lineId === Number(lineId));
      return queue.splice(at >= 0 ? at : 0, 1)[0].columns;
    }
  }
  const carriedByArticle = (table, present, articleColumn, bookingId) => {
    const carried = carriedColumns(table, present);
    const byArticle = new CarriedLines();
    if (carried.length === 0) return byArticle;
    const ordered = present.has('lineId') ? ' ORDER BY lineId' : '';
    for (const row of database.prepare(`SELECT ${articleColumn}, ${carried.join(', ')} FROM ${table} WHERE reservationId = ?${ordered}`).all(bookingId)) {
      const article = Number(row[articleColumn]);
      if (!Map.prototype.has.call(byArticle, article)) Map.prototype.set.call(byArticle, article, []);
      Map.prototype.get.call(byArticle, article).push({ lineId: row.lineId == null ? null : Number(row.lineId), columns: Object.fromEntries(carried.map((name) => [name, row[name]])) });
    }
    return byArticle;
  };

  // Option-driven planning cards (specs/option-planning-card.md §3.2) — the selected occurrences.
  const HAS_CARD_OCCURRENCES = hasColumn('reservation_options', 'cardOccurrences');
  // « This option row was added by the arrival SAS » (specs/sas-upsells-activate-catalogue-option.md §3.2).
  const HAS_SAS_ARRIVAL_ORIGIN = hasColumn('reservation_options', 'sasArrivalOrigin');
  // Served persons of a per-person card option (specs/card-option-served-persons.md §5).
  const HAS_CARD_PERSONS = hasColumn('reservation_options', 'cardPersons');
  // Nights typed on a per-night option (specs/non-card-option-served-persons.md rule 19). NULL = the stay.
  const HAS_CARD_NIGHTS = hasColumn('reservation_options', 'cardNights');
  // Hourly-scheduled resource sessions (specs/resource-hourly-scheduling.md), stored as JSON.
  const HAS_RESOURCE_SESSIONS = hasColumn('reservation_resources', 'sessions');
  // Client-visibility flag on the options catalog (specs/laundry-bath-mat.md §3 rule 11).
  const HAS_OPTION_DISPLAY_TO_CLIENT = hasColumn('options', 'displayToClient');

  // Rule 26 — the free units a line consumed stay with it (`{ freeUnits, amount }`), NULL when it used none.
  const allowanceUsedOf = (line) => (Number(line.freeUnits) > 0
    ? JSON.stringify({ freeUnits: Number(line.freeUnits), amount: Number(line.freeUnitsAmount || 0) })
    : null);
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
    insertOptions(bookingId, optionLines, sasOriginIds = [], carried = new Map()) {
      const sasOriginSet = new Set((sasOriginIds || []).map((id) => Number(id)));
      const internalLinenIds = internalLinenOptionIds();
      for (const opt of (optionLines || []).filter((line) => !line.isCustom && !internalLinenIds.has(Number(line.optionId)))) {
        const forced = opt.inComplement ? 1 : 0;
        insertOption({
          ...(carried.get(Number(opt.optionId), opt.lineId) || {}),
          reservationId: bookingId,
          optionId: opt.optionId,
          quantity: opt.quantity || 1,
          unitPrice: Number(opt.unitPrice || 0),
          billedUnits: Number(opt.billedUnits || 0),
          priceType: opt.priceType || 'per_stay',
          // A line keeps its catalogue amount: a discount (rules 39, 40) is a fact beside it, never a lower stored total.
          totalPrice: opt.grossTotalPrice ?? opt.totalPrice ?? 0,
          offered: opt.offered ? 1 : 0,
          inComplement: forced,
          acompteContribTtc: forced ? null : (opt.acompteContribTtc != null ? Number(opt.acompteContribTtc) : null),
          soldeContribTtc: forced ? null : (opt.soldeContribTtc != null ? Number(opt.soldeContribTtc) : null),
          allowanceUsed: allowanceUsedOf(opt),
          ...(HAS_CARD_OCCURRENCES ? { cardOccurrences: serializeCardOccurrences(opt) } : {}),
          // How many covers each moment of a per-person card option serves
          // (specs/card-option-served-persons.md §3.1). NULL = the whole party; the engine resolves it
          // and echoes it back, so a fiche re-save can never silently re-inflate a reduced count.
          ...(HAS_CARD_PERSONS ? { cardPersons: opt.cardPersons != null ? Number(opt.cardPersons) : null } : {}),
          ...(HAS_CARD_NIGHTS ? { cardNights: opt.cardNights != null ? Number(opt.cardNights) : null } : {}),
          ...(sasOriginSet.size > 0 ? { sasArrivalOrigin: sasOriginSet.has(Number(opt.optionId)) ? 1 : 0 } : {}),
        });
      }
    },

    // A fiche save is a DELETE + INSERT (rule 79: the identity and the sale columns are carried too), so the SAS-origin marker must be carried over per optionId;
    // otherwise the arrival SAS loses the right to remove its own upsell at the first save
    // (specs/sas-upsells-activate-catalogue-option.md §3.2 rule 9). Guarded: absent column → nothing to carry.
    replaceOptions(bookingId, optionLines) {
      let sasOriginIds = [];
      if (HAS_SAS_ARRIVAL_ORIGIN) {
        sasOriginIds = database.prepare('SELECT optionId FROM reservation_options WHERE reservationId = ? AND COALESCE(sasArrivalOrigin, 0) = 1')
          .all(bookingId).map((r) => Number(r.optionId));
      }
      const carried = carriedByArticle('reservation_options', OPTION_COLUMNS, 'optionId', bookingId);
      database.prepare('DELETE FROM reservation_options WHERE reservationId = ?').run(bookingId);
      model.insertOptions(bookingId, optionLines, sasOriginIds, carried);
    },

    // ── Custom (free-text) options ───────────────────────────────────────────────────────────────
    // Returns what the deleted lines carried (rule 79), one entry per line in the order of the save, for `insertCustomOptions`.
    deleteCustomOptions(bookingId) {
      const carriedNames = carriedColumns('reservation_custom_options', CUSTOM_OPTION_COLUMNS);
      const carried = carriedNames.length === 0 ? [] : database.prepare(`SELECT description, ${carriedNames.join(', ')} FROM reservation_custom_options WHERE reservationId = ? ORDER BY sortOrder, id`)
        .all(bookingId).map((row) => ({ description: String(row.description || '').trim(), columns: Object.fromEntries(carriedNames.map((name) => [name, row[name]])) }));
      database.prepare('DELETE FROM reservation_custom_options WHERE reservationId = ?').run(bookingId);
      return carried;
    },

    // The labels of the lines the arrival SAS wrote, one entry per row. A fiche save is a DELETE +
    // INSERT, so `insertCustomOptions` carries the marker over by label; without it the SAS lost its
    // own lines at the first save and a re-opened SAS billed them again
    // (specs/hourly-resource-quantity-and-sas-scheduling.md §3.6 rule 33).
    // Each entry is `{ description, sasLineKey, quantity }`: the key of a line a plugin billed rides along
    // (specs/plugins-phase-3c-hourly-resources.md rule 7).
    sasOriginCustomLabels(bookingId) {
      if (!CUSTOM_OPTION_COLUMNS.has('sasArrivalOrigin')) return [];
      const key = CUSTOM_OPTION_COLUMNS.has('sasLineKey') ? 'sasLineKey' : 'NULL AS sasLineKey';
      const qty = CUSTOM_OPTION_COLUMNS.has('quantity') ? 'quantity' : '1 AS quantity';
      return database.prepare(`SELECT description, ${key}, ${qty} FROM reservation_custom_options WHERE reservationId = ? AND COALESCE(sasArrivalOrigin, 0) = 1`)
        .all(bookingId).map((r) => ({ description: String(r.description || '').trim(), sasLineKey: r.sasLineKey || null, quantity: Number(r.quantity) || 1 }));
    },

    // `carried`: what `deleteCustomOptions` returned for the lines this save replaces, one entry per stored line; a posted
    // line takes the first entry of its text (rule 79).
    insertCustomOptions(bookingId, optionLines, sasOriginLabels = [], carried = []) {
      const pendingSasLabels = [...sasOriginLabels];
      const pendingCarried = [...(carried || [])];
      let sortOrder = 0;
      for (const line of optionLines || []) {
        if (!line.isCustom) continue;
        const forced = line.inComplement ? 1 : 0;
        const description = String(line.title || line.description || '').trim();
        const sasIndex = pendingSasLabels.findIndex((l) => l.description === description);
        const sasLine = sasIndex >= 0 ? pendingSasLabels.splice(sasIndex, 1)[0] : null;
        const carriedIndex = pendingCarried.findIndex((entry) => entry.description === description);
        const kept = carriedIndex >= 0 ? pendingCarried.splice(carriedIndex, 1)[0].columns : {};
        insertCustomOption({
          ...kept,
          reservationId: bookingId,
          description,
          amount: Number(line.originalTotalPrice || line.grossTotalPrice || line.totalPrice || 0),
          offered: line.offered ? 1 : 0,
          sortOrder,
          inComplement: forced,
          acompteContribTtc: forced ? null : (line.acompteContribTtc != null ? Number(line.acompteContribTtc) : null),
          soldeContribTtc: forced ? null : (line.soldeContribTtc != null ? Number(line.soldeContribTtc) : null),
          // The count the SAS stored travels with its marker (specs/arrival-departure-sas.md rule 29).
          ...(sasLine ? { sasArrivalOrigin: 1, sasLineKey: sasLine.sasLineKey, quantity: sasLine.quantity } : {}),
        });
        sortOrder += 1;
      }
    },

    replaceCustomOptions(bookingId, optionLines) {
      const sasOriginLabels = model.sasOriginCustomLabels(bookingId);
      const carried = model.deleteCustomOptions(bookingId);
      model.insertCustomOptions(bookingId, optionLines, sasOriginLabels, carried);
    },

    // ── Resources ────────────────────────────────────────────────────────────────────────────────
    // Returns what the deleted lines carried (rule 79), by resource id: the caller hands it back to `insertResourceLine` for
    // each line it sells again.
    deleteResources(bookingId) {
      const carried = carriedByArticle('reservation_resources', RESOURCE_COLUMNS, 'resourceId', bookingId);
      database.prepare('DELETE FROM reservation_resources WHERE reservationId = ?').run(bookingId);
      return carried;
    },

    insertResourceLine(bookingId, rr, unitPrice, qty, priceType, carried = null) {
      const forced = rr.inComplement ? 1 : 0;
      // specs/devis-offered-resource-parity.md §3 rule 1 — an OFFERED line is priced 0 € by the engine,
      // and `||` used to read that legitimate zero as « no total supplied » and re-bill the resource at
      // its catalogue price. The line was then stored `offered = 1` WITH its price, so the devis PDF
      // printed it unmarked and subtracted it from the accommodation row. The fallback now only covers
      // a caller that supplies no total at all.
      const grossTotal = rr.grossTotalPrice ?? rr.totalPrice;
      const suppliedTotal = grossTotal == null || grossTotal === '' ? null : Number(grossTotal);
      const billedTotal = suppliedTotal != null ? suppliedTotal : Number(unitPrice) * Number(qty);
      insertResource({
        ...(carried || {}),
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
      const carried = model.deleteResources(bookingId);
      for (const line of resourceLines || []) {
        model.insertResourceLine(bookingId, line, Number(line.unitPrice || 0), Number(line.quantity || 1), line.priceType, carried.get(Number(line.resourceId), line.lineId));
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
      const carried = model.deleteResources(toId);
      for (const r of database.prepare('SELECT * FROM reservation_resources WHERE reservationId = ?').all(fromId)) {
        model.insertResourceLine(toId, { ...r, sessions: parseJsonArray(r.sessions) }, r.unitPrice, r.quantity, r.priceType, carried.get(Number(r.resourceId)));
      }
      model.replaceNights(toId, database.prepare('SELECT * FROM reservation_nights WHERE reservationId = ?').all(fromId));
    },

    // The dates each line of a booking already stores — `{ options: { [optionId]: dates }, resources:
    // { [resourceId]: dates } }` — which `stayDates.stayItemDatesRefusal` does not re-judge
    // (specs/reservations-backend-mvc.md rule 13, second reading).
    getStoredItemDates(bookingId) {
      const datesOf = (list) => parseJsonArray(list).map((item) => String((item && item.date) || '').slice(0, 10));
      const options = {};
      if (HAS_CARD_OCCURRENCES) {
        for (const row of database.prepare('SELECT optionId, cardOccurrences FROM reservation_options WHERE reservationId = ?').all(bookingId)) {
          options[Number(row.optionId)] = [...(options[Number(row.optionId)] || []), ...datesOf(row.cardOccurrences)];
        }
      }
      const resources = {};
      if (HAS_RESOURCE_SESSIONS) {
        for (const row of database.prepare('SELECT resourceId, sessions FROM reservation_resources WHERE reservationId = ?').all(bookingId)) {
          resources[Number(row.resourceId)] = [...(resources[Number(row.resourceId)] || []), ...parseJsonArray(row.sessions).map((item) => String((item && item.date) || ''))];
        }
      }
      return { options, resources };
    },

    // specs/non-card-option-served-persons.md rule 34 — the typed counts a booking stores: sent back
    // unchanged, they are not re-judged.
    getStoredTypedCounts(bookingId) {
      if (!HAS_CARD_PERSONS && !HAS_CARD_NIGHTS) return {};
      const columns = [HAS_CARD_PERSONS ? 'cardPersons' : 'NULL AS cardPersons', HAS_CARD_NIGHTS ? 'cardNights' : 'NULL AS cardNights'];
      const counts = {};
      for (const row of database.prepare(`SELECT optionId, ${columns.join(', ')} FROM reservation_options WHERE reservationId = ?`).all(bookingId)) {
        // Rule 85: a stay may store several lines of one article; a count any of them stores is not re-judged (`others` only when there are several).
        const entry = { cardPersons: row.cardPersons, cardNights: row.cardNights };
        const held = counts[Number(row.optionId)];
        if (held) held.others = [...(held.others || []), entry];
        else counts[Number(row.optionId)] = entry;
      }
      return counts;
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
        SELECT ${OPTION_COLUMNS.has('lineId') ? 'lineId, ' : ''}optionId, quantity, unitPrice, billedUnits, priceType, totalPrice, offered,
          ${routingSelect(OPTION_COLUMNS)}
        FROM reservation_options WHERE reservationId = ?
      `).all(bookingId);
      const lockedResourceLines = database.prepare(`
        SELECT ${RESOURCE_COLUMNS.has('lineId') ? 'lineId, ' : ''}resourceId, quantity, unitPrice, billedUnits, priceType, totalPrice, offered,
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
