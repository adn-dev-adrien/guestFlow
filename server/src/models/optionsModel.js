// Options model — option catalog CRUD + the property_options applicability links + progressive-tier
// normalization. SQL moved verbatim from routes/options.js.

const db = require('../database');
const { sentenceCase } = require('../utils/textFormatters');
const { formatTimeShort } = require('../utils/dateFr');

function normalizeProgressiveOptionTiers(raw) {
  let parsed = [];
  if (Array.isArray(raw)) parsed = raw;
  else if (typeof raw === 'string' && raw.trim()) {
    try {
      const json = JSON.parse(raw);
      parsed = Array.isArray(json) ? json : [];
    } catch {
      parsed = [];
    }
  }

  const byParticipant = new Map();
  for (const line of parsed) {
    const participantNumber = Math.max(1, Math.floor(Number(line?.participantNumber || 0)));
    const unitPrice = Math.max(0, Number(line?.unitPrice || 0));
    if (!Number.isFinite(participantNumber) || !Number.isFinite(unitPrice)) continue;
    byParticipant.set(participantNumber, { participantNumber, unitPrice });
  }

  return Array.from(byParticipant.values())
    .sort((a, b) => a.participantNumber - b.participantNumber)
    .map((line) => ({ participantNumber: Number(line.participantNumber), unitPrice: Number(line.unitPrice) }));
}

function createOptionsModel(database) {
  // Bilingual devis PDF (specs/devis-english-language.md §3 rule 6). When the EN columns are
  // missing (minimal test schemas), the SQL gracefully drops the references.
  const HAS_OPTION_TITLE_EN = (() => {
    try { return database.prepare("PRAGMA table_info(options)").all().some((c) => c.name === 'titleEn'); }
    catch { return false; }
  })();
  // Breakfast default time (specs/breakfast-time.md). Persisted via a dedicated guarded write so the
  // big INSERT/UPDATE stays untouched; absent in minimal test schemas → no-op.
  const HAS_OPTION_BREAKFAST_TIME = (() => {
    try { return database.prepare("PRAGMA table_info(options)").all().some((c) => c.name === 'breakfastTime'); }
    catch { return false; }
  })();
  // Soft-delete (specs/option-soft-delete.md). Guarded so minimal test schemas without the column
  // simply skip the "active only" filter. `ACTIVE_FILTER`/`ACTIVE_AND` are spliced into the offering
  // queries (list / listForProperty) so archived options stop being offered for new reservations.
  const HAS_OPTION_ARCHIVED = (() => {
    try { return database.prepare("PRAGMA table_info(options)").all().some((c) => c.name === 'archivedAt'); }
    catch { return false; }
  })();
  const ACTIVE_WHERE = HAS_OPTION_ARCHIVED ? 'WHERE archivedAt IS NULL ' : '';
  const ACTIVE_AND_O = HAS_OPTION_ARCHIVED ? 'AND o.archivedAt IS NULL ' : '';
  function persistBreakfastTime(optionId, payload) {
    if (!HAS_OPTION_BREAKFAST_TIME || payload.breakfastTime === undefined) return;
    const t = formatTimeShort(payload.breakfastTime) || '09:00';
    database.prepare('UPDATE options SET breakfastTime = ? WHERE id = ?').run(t, optionId);
  }
  // Option-driven planning cards (specs/option-planning-card.md §3.1). Persisted via a dedicated
  // guarded write so the big INSERT/UPDATE stays untouched; absent in minimal test schemas → no-op.
  const HAS_OPTION_PLANNING_CARD = (() => {
    try { return database.prepare("PRAGMA table_info(options)").all().some((c) => c.name === 'showsPlanningCard'); }
    catch { return false; }
  })();
  function persistPlanningCard(optionId, payload) {
    if (!HAS_OPTION_PLANNING_CARD || payload.showsPlanningCard === undefined) return;
    const shows = payload.showsPlanningCard ? 1 : 0;
    // Two day-based modes (specs/option-planning-card.md §3.1): « une fois par jour » (one slot) or
    // « plusieurs fois par jour » (N slots). Legacy 'daily' maps to multiple. No fixed-date mode.
    const repeat = (payload.cardRepeat === 'multiple_per_day' || payload.cardRepeat === 'daily')
      ? 'multiple_per_day'
      : 'once_per_day';
    // Normalize the slots: an array of valid HH:MM strings; « une fois par jour » keeps exactly one.
    const rawTimes = Array.isArray(payload.planningCardTimes) ? payload.planningCardTimes : [];
    let times = rawTimes.map((t) => formatTimeShort(t)).filter(Boolean);
    if (repeat === 'once_per_day') times = times.slice(0, 1);
    if (shows && times.length === 0) times = ['09:00']; // a shown card always has ≥1 slot
    database.prepare(
      'UPDATE options SET showsPlanningCard = ?, cardRepeat = ?, planningCardDate = ?, planningCardTimes = ? WHERE id = ?'
    ).run(shows, repeat, null, JSON.stringify(times), optionId);
  }
  // Parse the stored planningCardTimes JSON into a clean HH:MM array for API consumers.
  function decoratePlanningCard(option) {
    if (!HAS_OPTION_PLANNING_CARD || !option) return option;
    let times = [];
    try { const parsed = JSON.parse(option.planningCardTimes || '[]'); if (Array.isArray(parsed)) times = parsed; }
    catch { times = []; }
    option.planningCardTimes = times;
    return option;
  }

  const propertyIdsFor = (optionId) => database
    .prepare('SELECT propertyId FROM property_options WHERE optionId = ? ORDER BY propertyId')
    .all(optionId)
    .map((r) => r.propertyId);

  // Per-property price overrides (specs/per-property-option-prices.md). Returns { [propertyId]: price }
  // for the rows that exist; an absent property inherits the option's base price. Guarded so a
  // minimal test schema without the table degrades to "no overrides".
  const HAS_OPTION_PROPERTY_PRICES = (() => {
    try { database.prepare('SELECT 1 FROM property_option_prices LIMIT 1').get(); return true; }
    catch { return false; }
  })();
  const propertyPricesFor = (optionId) => {
    if (!HAS_OPTION_PROPERTY_PRICES) return {};
    return database
      .prepare('SELECT propertyId, price FROM property_option_prices WHERE optionId = ? ORDER BY propertyId')
      .all(optionId)
      .reduce((acc, row) => { acc[String(row.propertyId)] = Number(row.price || 0); return acc; }, {});
  };
  // Per-property « inclus par défaut » (specs/per-property-default-options.md). Returns
  // { [propertyId]: { offered: bool } } for the properties where this option is a default. Guarded so a
  // minimal test schema without the table degrades to "no defaults".
  const HAS_PROPERTY_OPTION_DEFAULTS = (() => {
    try { database.prepare('SELECT 1 FROM property_option_defaults LIMIT 1').get(); return true; }
    catch { return false; }
  })();
  const propertyDefaultsFor = (optionId) => {
    if (!HAS_PROPERTY_OPTION_DEFAULTS) return {};
    return database
      .prepare('SELECT propertyId, offered FROM property_option_defaults WHERE optionId = ? ORDER BY propertyId')
      .all(optionId)
      .reduce((acc, r) => { acc[String(r.propertyId)] = { offered: Number(r.offered) === 1 }; return acc; }, {});
  };
  // Replace the option's default rows from `payload.propertyDefaults` = { [propertyId]: { default, offered } }.
  // `undefined` payload → leave untouched. Auto-timed options (autoEnabled) are engine-derived and can
  // never be defaults → their default rows are cleared. Setting a default implies applicability.
  function persistPropertyDefaults(optionId, payload) {
    if (!HAS_PROPERTY_OPTION_DEFAULTS || payload.propertyDefaults === undefined) return;
    database.prepare('DELETE FROM property_option_defaults WHERE optionId = ?').run(optionId);
    if (payload.autoEnabled) return; // auto-timed → never a default
    const ensureApplicable = database.prepare('INSERT OR IGNORE INTO property_options (propertyId, optionId) VALUES (?, ?)');
    const insert = database.prepare('INSERT INTO property_option_defaults (propertyId, optionId, offered) VALUES (?, ?, ?)');
    for (const [pid, cfg] of Object.entries(payload.propertyDefaults || {})) {
      const propertyId = Number(pid);
      if (!Number.isInteger(propertyId) || propertyId <= 0) continue;
      if (!cfg || !cfg.default) continue; // only persist properties marked « inclus par défaut »
      ensureApplicable.run(propertyId, optionId);
      insert.run(propertyId, optionId, cfg.offered ? 1 : 0);
    }
  }

  // Per-property bath-mat quantity (specs/laundry-bath-mat.md §4). Returns { [propertyId]: qty }
  // for the rows that exist; an absent property means 0. Strict mirror of propertyPricesFor.
  // Guarded so a minimal test schema without the table degrades to "no quantities".
  const HAS_OPTION_PROPERTY_BATH_MATS = (() => {
    try { database.prepare('SELECT 1 FROM property_option_bath_mats LIMIT 1').get(); return true; }
    catch { return false; }
  })();
  const propertyBathMatsFor = (optionId) => {
    if (!HAS_OPTION_PROPERTY_BATH_MATS) return {};
    return database
      .prepare('SELECT propertyId, quantity FROM property_option_bath_mats WHERE optionId = ? ORDER BY propertyId')
      .all(optionId)
      .reduce((acc, row) => { acc[String(row.propertyId)] = Number(row.quantity || 0); return acc; }, {});
  };
  // Replace the per-property bath-mat quantity rows. A blank/empty value or 0 means "no bath mat
  // for that property" (no row). `undefined` payload → leave untouched. Mirror of persistPropertyPrices.
  function persistPropertyBathMats(optionId, payload) {
    if (!HAS_OPTION_PROPERTY_BATH_MATS || payload.propertyBathMats === undefined) return;
    database.prepare('DELETE FROM property_option_bath_mats WHERE optionId = ?').run(optionId);
    const insert = database.prepare('INSERT INTO property_option_bath_mats (propertyId, optionId, quantity) VALUES (?, ?, ?)');
    for (const [pid, raw] of Object.entries(payload.propertyBathMats || {})) {
      if (raw === null || raw === undefined || raw === '') continue;
      const quantity = Math.floor(Number(raw));
      const propertyId = Number(pid);
      if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isInteger(propertyId) || propertyId <= 0) continue;
      insert.run(propertyId, optionId, quantity);
    }
  }

  // Replace the override rows for an option. A blank/empty value means "inherit the base price" (no
  // row); an explicit number (incl. 0 = free) is persisted. `undefined` payload → leave untouched.
  function persistPropertyPrices(optionId, payload) {
    if (!HAS_OPTION_PROPERTY_PRICES || payload.propertyPrices === undefined) return;
    database.prepare('DELETE FROM property_option_prices WHERE optionId = ?').run(optionId);
    const insert = database.prepare('INSERT INTO property_option_prices (propertyId, optionId, price) VALUES (?, ?, ?)');
    for (const [pid, raw] of Object.entries(payload.propertyPrices || {})) {
      if (raw === null || raw === undefined || raw === '') continue; // blank = inherit
      const price = Number(raw);
      const propertyId = Number(pid);
      if (!Number.isFinite(price) || price < 0 || !Number.isInteger(propertyId) || propertyId <= 0) continue;
      insert.run(propertyId, optionId, price);
    }
  }

  const model = {
    list() {
      return database.prepare(`SELECT * FROM options ${ACTIVE_WHERE}ORDER BY title`).all().map((o) => decoratePlanningCard({
        ...o,
        propertyIds: propertyIdsFor(o.id),
        propertyPrices: propertyPricesFor(o.id),
        propertyDefaults: propertyDefaultsFor(o.id),
        propertyBathMats: propertyBathMatsFor(o.id),
        optionProgressiveTiers: normalizeProgressiveOptionTiers(o.optionProgressiveTiers),
      }));
    },

    get(id) {
      const option = database.prepare('SELECT * FROM options WHERE id = ?').get(id);
      if (!option) return null;
      option.propertyIds = propertyIdsFor(id);
      option.propertyPrices = propertyPricesFor(id);
      option.propertyDefaults = propertyDefaultsFor(id);
      option.propertyBathMats = propertyBathMatsFor(id);
      option.optionProgressiveTiers = normalizeProgressiveOptionTiers(option.optionProgressiveTiers);
      return decoratePlanningCard(option);
    },

    // Options applicable to a single property (via the property_options link). Used by the public
    // API to expose only the options a visitor can pick for that property (specs/public-api.md).
    listForProperty(propertyId) {
      // Applicable options = those EXPLICITLY linked to this property (specs/option-property-scope.md
      // §3.3). The legacy « linked to no property = global » clause is removed: an option with no link is
      // available nowhere. Mirrors the pricing engine (getApplicableOptions: `propertyIds.includes(pid)`).
      // `price` is the EFFECTIVE price for this property: the per-property override
      // (property_option_prices) when present, else the option's base price
      // (specs/per-property-option-prices.md). The LEFT JOIN is guarded by the table's existence at
      // build time so minimal schemas degrade to the base price.
      const pid = Number(propertyId);
      const priceJoin = HAS_OPTION_PROPERTY_PRICES
        ? 'LEFT JOIN property_option_prices pop ON pop.optionId = o.id AND pop.propertyId = ?'
        : '';
      const rows = database.prepare(`
        SELECT o.*${HAS_OPTION_PROPERTY_PRICES ? ', pop.price AS __propertyPrice' : ''}
        FROM options o
        ${priceJoin}
        WHERE EXISTS (SELECT 1 FROM property_options po WHERE po.optionId = o.id AND po.propertyId = ?)
        ${ACTIVE_AND_O}
        ORDER BY o.title
      `).all(...(HAS_OPTION_PROPERTY_PRICES ? [pid, pid] : [pid]));
      return rows.map((o) => {
        const { __propertyPrice, ...rest } = o;
        return decoratePlanningCard({
          ...rest,
          price: __propertyPrice != null ? Number(__propertyPrice) : Number(rest.price || 0),
          optionProgressiveTiers: normalizeProgressiveOptionTiers(rest.optionProgressiveTiers),
        });
      });
    },

    create(payload = {}) {
      const insertOption = database.prepare(HAS_OPTION_TITLE_EN ? `
        INSERT INTO options (
          title, description, priceType, price, optionProgressiveTiers,
          autoOptionType, autoEnabled, autoPricingMode, autoFullNightThreshold,
          countsAsBedLinen, countsAsBathroomLinen,
          linenIncludesSingle, linenIncludesDouble, linenIncludesBaby,
          towelLargePerPerson, towelMediumPerPerson, towelSmallPerPerson,
          titleEn
        )
        VALUES (?, ?, ?, ?, ?,  ?, ?, ?, ?,  ?, ?,  ?, ?, ?,  ?, ?, ?,  ?)
      ` : `
        INSERT INTO options (
          title, description, priceType, price, optionProgressiveTiers,
          autoOptionType, autoEnabled, autoPricingMode, autoFullNightThreshold,
          countsAsBedLinen, countsAsBathroomLinen,
          linenIncludesSingle, linenIncludesDouble, linenIncludesBaby,
          towelLargePerPerson, towelMediumPerPerson, towelSmallPerPerson
        )
        VALUES (?, ?, ?, ?, ?,  ?, ?, ?, ?,  ?, ?,  ?, ?, ?,  ?, ?, ?)
      `);
      const insertLink = database.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (?, ?)');
      const optionId = database.transaction(() => {
        const args = [
          sentenceCase(payload.title),
          sentenceCase(payload.description),
          payload.priceType || 'per_stay',
          Number(payload.price || 0),
          JSON.stringify(normalizeProgressiveOptionTiers(payload.optionProgressiveTiers)),
          payload.autoOptionType || null,
          payload.autoEnabled ? 1 : 0,
          payload.autoPricingMode || 'fixed',
          payload.autoFullNightThreshold || null,
          payload.countsAsBedLinen ? 1 : 0,
          payload.countsAsBathroomLinen ? 1 : 0,
          // Bed-linen per-type includes (specs §3.5.ter). Default ON to preserve legacy behaviour.
          payload.linenIncludesSingle === undefined ? 1 : (payload.linenIncludesSingle ? 1 : 0),
          payload.linenIncludesDouble === undefined ? 1 : (payload.linenIncludesDouble ? 1 : 0),
          payload.linenIncludesBaby   === undefined ? 1 : (payload.linenIncludesBaby   ? 1 : 0),
          // Bathroom-linen per-person multipliers. Coerce to a non-negative integer; default
          // shape (1 large + 1 small) preserves the previous "1 set per person" semantic.
          Math.max(0, Math.floor(Number(payload.towelLargePerPerson  ?? 1))),
          Math.max(0, Math.floor(Number(payload.towelMediumPerPerson ?? 0))),
          Math.max(0, Math.floor(Number(payload.towelSmallPerPerson  ?? 1))),
        ];
        if (HAS_OPTION_TITLE_EN) {
          // Bilingual devis PDF (specs/devis-english-language.md §3 rule 6) — trimmed string,
          // empty by default. Not run through sentenceCase: the operator decides EN casing.
          // Description has no EN counterpart — see the spec rule for why.
          args.push(String(payload.titleEn || '').trim());
        }
        const result = insertOption.run(...args);
        const id = result.lastInsertRowid;
        for (const pid of (payload.propertyIds || [])) insertLink.run(pid, id);
        persistBreakfastTime(id, payload);
        persistPlanningCard(id, payload);
        persistPropertyPrices(id, payload);
        persistPropertyDefaults(id, payload);
        persistPropertyBathMats(id, payload);
        return id;
      })();
      return { id: optionId };
    },

    update(id, payload = {}) {
      const updateOption = database.prepare(HAS_OPTION_TITLE_EN ? `
        UPDATE options SET
          title = ?, description = ?, priceType = ?, price = ?, optionProgressiveTiers = ?,
          autoOptionType = ?, autoEnabled = ?, autoPricingMode = ?, autoFullNightThreshold = ?,
          countsAsBedLinen = ?, countsAsBathroomLinen = ?,
          linenIncludesSingle = ?, linenIncludesDouble = ?, linenIncludesBaby = ?,
          towelLargePerPerson = ?, towelMediumPerPerson = ?, towelSmallPerPerson = ?,
          titleEn = ?
        WHERE id = ?
      ` : `
        UPDATE options SET
          title = ?, description = ?, priceType = ?, price = ?, optionProgressiveTiers = ?,
          autoOptionType = ?, autoEnabled = ?, autoPricingMode = ?, autoFullNightThreshold = ?,
          countsAsBedLinen = ?, countsAsBathroomLinen = ?,
          linenIncludesSingle = ?, linenIncludesDouble = ?, linenIncludesBaby = ?,
          towelLargePerPerson = ?, towelMediumPerPerson = ?, towelSmallPerPerson = ?
        WHERE id = ?
      `);
      const deleteLinks = database.prepare('DELETE FROM property_options WHERE optionId = ?');
      const insertLink = database.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (?, ?)');
      database.transaction(() => {
        const args = [
          sentenceCase(payload.title),
          sentenceCase(payload.description),
          payload.priceType || 'per_stay',
          Number(payload.price || 0),
          JSON.stringify(normalizeProgressiveOptionTiers(payload.optionProgressiveTiers)),
          payload.autoOptionType || null,
          payload.autoEnabled ? 1 : 0,
          payload.autoPricingMode || 'fixed',
          payload.autoFullNightThreshold || null,
          payload.countsAsBedLinen ? 1 : 0,
          payload.countsAsBathroomLinen ? 1 : 0,
          payload.linenIncludesSingle === undefined ? 1 : (payload.linenIncludesSingle ? 1 : 0),
          payload.linenIncludesDouble === undefined ? 1 : (payload.linenIncludesDouble ? 1 : 0),
          payload.linenIncludesBaby   === undefined ? 1 : (payload.linenIncludesBaby   ? 1 : 0),
          Math.max(0, Math.floor(Number(payload.towelLargePerPerson  ?? 1))),
          Math.max(0, Math.floor(Number(payload.towelMediumPerPerson ?? 0))),
          Math.max(0, Math.floor(Number(payload.towelSmallPerPerson  ?? 1))),
        ];
        if (HAS_OPTION_TITLE_EN) {
          args.push(String(payload.titleEn || '').trim());
        }
        args.push(id);
        updateOption.run(...args);
        deleteLinks.run(id);
        for (const pid of (payload.propertyIds || [])) insertLink.run(pid, id);
        persistBreakfastTime(id, payload);
        persistPlanningCard(id, payload);
        persistPropertyPrices(id, payload);
        persistPropertyDefaults(id, payload);
        persistPropertyBathMats(id, payload);
      })();
      return { ok: true };
    },

    // Soft-delete (specs/option-soft-delete.md): archive the option instead of deleting it, so the
    // reservations that already use it keep it (the `reservation_options → options` JOIN still resolves).
    // The row + reservation_options + property_options (applicability, for re-pricing existing
    // reservations) are kept; only the per-property DEFAULT rows are removed so the option stops being
    // auto-added to new reservations. Auto-options (autoOptionType) are non-deletable (UI + here).
    remove(id) {
      const row = database.prepare('SELECT autoOptionType FROM options WHERE id = ?').get(id);
      if (!row) return { error: 'OPTION_NOT_FOUND', status: 404 };
      if (row.autoOptionType) {
        return { error: 'AUTO_OPTION_NON_DELETABLE', status: 409 };
      }
      database.transaction(() => {
        if (HAS_OPTION_ARCHIVED) {
          database.prepare("UPDATE options SET archivedAt = datetime('now') WHERE id = ?").run(id);
        } else {
          // Schema without the column (shouldn't happen in prod) → fall back to hard delete.
          database.prepare('DELETE FROM property_options WHERE optionId = ?').run(id);
          database.prepare('DELETE FROM options WHERE id = ?').run(id);
        }
        // Stop auto-adding to NEW reservations (keep property_options applicability for re-pricing).
        try { database.prepare('DELETE FROM property_option_defaults WHERE optionId = ?').run(id); } catch { /* table may be absent in minimal schemas */ }
      })();
      return { ok: true, archived: HAS_OPTION_ARCHIVED };
    },
  };

  return model;
}

const defaultModel = createOptionsModel(db);
defaultModel.buildModel = createOptionsModel;
defaultModel.__test = { normalizeProgressiveOptionTiers };

module.exports = defaultModel;
