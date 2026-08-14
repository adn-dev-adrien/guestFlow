// Properties model — property CRUD (+ enriched detail), pricing rules (+ overlap + apply-to),
// documents, option linkage, and platform colours. SQL moved verbatim from routes/properties.js.

const db = require('../database');
const optionsModel = require('./optionsModel');
const { sentenceCase } = require('../utils/textFormatters');
const { groupOptionsByCategory } = require('../utils/optionGrouping');
const { isClientVisibleOption } = require('../utils/optionVisibility');
const {
  normalizeDateRanges,
  getBoundsFromDateRanges,
  parseRuleDateRanges,
  addDaysToIsoDate,
  normalizeProgressiveTiers,
  grossFromNet,
} = require('../utils/pricing');
const { normalizeExtraGuestTiers } = require('../utils/extraGuestTiers');
const { isDirectChannel } = require('../utils/platformNameFormat');
const { normalizePlatformKey } = require('../utils/icalParser');
const { KNOWN_PLATFORM_COLORS } = require('../constants/platformColors');
const platformsModel = require('./platformsModel');
const { saveOptimizedPhoto, removeUploadedFile } = require('../utils/propertyUploads');

// Multipart/FormData sends every field as a string, and "false"/"0" are truthy — so booleans must be
// coerced explicitly to a 0/1 bit for INTEGER columns.
function toBit(v) {
  return v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0;
}

// Canonical French articles for "votre séjour <article> <name>" in client emails
// (specs/email-automation.md §3 rule 13). Anything off-list falls back to 'au'.
const VALID_NAME_ARTICLES = ['au', 'à la', "à l'", 'aux'];
function normalizeNameArticle(value) {
  const v = String(value || '').trim();
  return VALID_NAME_ARTICLES.includes(v) ? v : 'au';
}

// specs/tariff-recipes/spec.md §3.6 — the extra-guest supplement is billed per stay (legacy, every
// existing property) or per night with the season's discount curve (recipe-driven properties).
const VALID_EXTRA_GUEST_UNITS = ['per_stay', 'per_night'];
function normalizeExtraGuestUnit(value, fallback = 'per_stay') {
  return VALID_EXTRA_GUEST_UNITS.includes(value) ? value : fallback;
}

// `pricing_rules.extraGuestTiers` is a JSON TEXT column; a malformed value must degrade to "no
// tiers" (the single price applies) rather than throw on a page load.
function parseTiersColumn(value) {
  if (Array.isArray(value)) return value;
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// Store a tier table, or NULL when there is nothing usable — NULL is what every existing row holds
// and means « the single extraGuestPrice applies », so a bad payload can never silently re-price.
function serializeTiers(value) {
  const normalized = normalizeExtraGuestTiers(parseTiersColumn(value));
  return normalized ? JSON.stringify(normalized) : null;
}

// Maximum stay in nights; NULL/blank/0 = unlimited (what every existing property carries).
function normalizeMaxNights(value) {
  if (value === '' || value === null || value === undefined) return null;
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n >= 1 ? n : null;
}

// Changeover weekday: JS convention (0 = dimanche … 6 = samedi); NULL/blank = unrestricted.
function normalizeChangeoverDay(value) {
  if (value === '' || value === null || value === undefined) return null;
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n >= 0 && n <= 6 ? n : null;
}

// Optional non-negative REAL columns (net targets, per-season extra-guest price): blank = NULL = inherit.
function normalizeOptionalMoney(value) {
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// Subtract a set of closure ranges from a season's date ranges — DISPLAY ONLY (spec §3.4 rule 25ter).
// A range entirely inside a closure disappears; one that straddles a boundary is trimmed; one split
// in two by a closure yields two visible pieces. Per-range overrides ride along on each piece. Pure.
function subtractClosuresFromRanges(ranges, closures) {
  if (!Array.isArray(closures) || closures.length === 0) return (ranges || []).map((r) => ({ ...r }));
  let out = (ranges || []).map((r) => ({ ...r }));
  for (const closure of closures) {
    const next = [];
    for (const range of out) {
      if (range.endDate < closure.startDate || range.startDate > closure.endDate) { next.push(range); continue; }
      if (range.startDate < closure.startDate) {
        next.push({ ...range, endDate: addDaysToIsoDate(closure.startDate, -1) });
      }
      if (range.endDate > closure.endDate) {
        next.push({ ...range, startDate: addDaysToIsoDate(closure.endDate, 1) });
      }
      // fully covered → dropped
    }
    out = next;
  }
  return out.sort((a, b) => a.startDate.localeCompare(b.startDate));
}

// A per-range `minNights` is only stored when it OVERRIDES the season default; a value equal to the
// season-level `minNights` is dropped so the range simply inherits (specs/pricing-min-nights-per-range.md).
function stripRangeMinEqualToDefault(ranges, seasonMinNights) {
  const seasonMin = Math.max(1, Number(seasonMinNights || 1));
  return (ranges || []).map((range) => {
    if (Number(range?.minNights) === seasonMin) {
      const { minNights, ...rest } = range;
      return rest;
    }
    return range;
  });
}

// Carve a selected period [selStart, selEnd] out of every season's date ranges and (re)attach it to a
// target season with its own `minNights` — the engine of the "calendar season painting" feature
// (specs/pricing-min-nights-per-range.md). PURE (no DB) so it is unit-testable.
//
//   rules     : raw pricing_rules rows (id, label, pricePerNight, pricingMode, progressiveTiers,
//               dateRanges JSON, color, minNights, …)
//   selection : { startDate, endDate, minNights, target } where target is
//               { mode:'existing', ruleId } | { mode:'new', label, color, pricePerNight, pricingMode }
//
// Returns { updatedRules:[{id,dateRanges,startDate,endDate}], deletedRuleIds:[id], newRule|null }.
// A range fully containing the period is split into the two surrounding sub-ranges (kept on the same
// season, each preserving its own min); a season emptied by the carve is flagged for deletion. Seasons
// with no explicit ranges (legacy catch-all) are left untouched. Disjointness across seasons is
// preserved because the period is removed from every season before being re-attached to the target.
function computeDateRangeAssignment(rules, selection) {
  const { startDate: selStart, endDate: selEnd, minNights, target } = selection;
  const dayBefore = (iso) => addDaysToIsoDate(iso, -1);
  const dayAfter = (iso) => addDaysToIsoDate(iso, 1);
  const rangeKeyMin = (range) => (range && range.minNights != null ? Number(range.minNights) : null);

  // Merge overlapping/adjacent ranges that carry the SAME per-range min (absent === absent).
  const mergeRanges = (ranges) => {
    const sorted = ranges
      .filter((r) => r.startDate && r.endDate)
      .sort((a, b) => a.startDate.localeCompare(b.startDate));
    const out = [];
    for (const r of sorted) {
      const prev = out[out.length - 1];
      if (prev && rangeKeyMin(prev) === rangeKeyMin(r) && r.startDate <= dayAfter(prev.endDate)) {
        if (r.endDate > prev.endDate) prev.endDate = r.endDate;
      } else {
        out.push({ ...r });
      }
    }
    return out;
  };

  // Remove [selStart, selEnd] from a single range, keeping the surrounding parts (with their own min).
  const carveRange = (r) => {
    if (r.endDate < selStart || r.startDate > selEnd) return [r];
    const parts = [];
    const carryMin = r.minNights != null ? { minNights: Number(r.minNights) } : {};
    if (r.startDate <= dayBefore(selStart)) {
      parts.push({ startDate: r.startDate, endDate: dayBefore(selStart), ...carryMin });
    }
    if (dayAfter(selEnd) <= r.endDate) {
      parts.push({ startDate: dayAfter(selEnd), endDate: r.endDate, ...carryMin });
    }
    return parts;
  };

  const targetRuleId = target.mode === 'existing' ? Number(target.ruleId) : null;
  const updatedRules = [];
  const deletedRuleIds = [];
  let newRule = null;

  for (const rule of rules) {
    const originalRanges = parseRuleDateRanges(rule);
    if (!originalRanges.length) continue; // legacy catch-all season — never carved nor deleted

    const isTarget = targetRuleId != null && Number(rule.id) === targetRuleId;
    let ranges = originalRanges.flatMap(carveRange);
    if (isTarget) {
      const seasonDefaultMin = Math.max(1, Number(rule.minNights || 1));
      const attached = { startDate: selStart, endDate: selEnd };
      if (Number(minNights) !== seasonDefaultMin) attached.minNights = Number(minNights);
      ranges.push(attached);
    }
    ranges = mergeRanges(ranges);

    if (!ranges.length) {
      deletedRuleIds.push(Number(rule.id));
      continue;
    }
    const normalized = normalizeDateRanges(ranges);
    if (!isTarget && JSON.stringify(normalized) === JSON.stringify(normalizeDateRanges(originalRanges))) {
      continue; // carve did not touch this season
    }
    const bounds = getBoundsFromDateRanges(normalized);
    updatedRules.push({ id: Number(rule.id), dateRanges: normalized, startDate: bounds.startDate, endDate: bounds.endDate });
  }

  if (target.mode === 'new') {
    const normalized = normalizeDateRanges([{ startDate: selStart, endDate: selEnd }]);
    const bounds = getBoundsFromDateRanges(normalized);
    newRule = {
      label: target.label,
      color: target.color,
      pricePerNight: Number(target.pricePerNight || 0),
      pricingMode: target.pricingMode || 'fixed',
      progressiveTiers: target.progressiveTiers || [],
      dateRanges: normalized,
      startDate: bounds.startDate,
      endDate: bounds.endDate,
      minNights: Math.max(1, Number(minNights || 1)),
    };
  }

  return { updatedRules, deletedRuleIds, newRule };
}

function createPropertiesModel(database) {
  function findPricingRuleOverlap(propertyId, dateRanges, excludeRuleId = null) {
    if (!dateRanges.length) return null;
    let sql = 'SELECT id, label, startDate, endDate, dateRanges FROM pricing_rules WHERE propertyId = ?';
    const params = [propertyId];
    if (excludeRuleId) {
      sql += ' AND id != ?';
      params.push(excludeRuleId);
    }
    sql += ' ORDER BY startDate';
    const rules = database.prepare(sql).all(...params);

    for (const rule of rules) {
      const existingRanges = parseRuleDateRanges(rule);
      for (const incomingRange of dateRanges) {
        const conflictingRange = existingRanges.find((existingRange) => (
          incomingRange.startDate <= existingRange.endDate && incomingRange.endDate >= existingRange.startDate
        ));
        if (conflictingRange) {
          return { id: rule.id, label: rule.label, startDate: conflictingRange.startDate, endDate: conflictingRange.endDate };
        }
      }
    }
    return null;
  }

  const model = {
    findPricingRuleOverlap,

    list() {
      return database.prepare('SELECT * FROM properties ORDER BY name').all();
    },

    getPlatformColors() {
      const customRows = database.prepare(`
        SELECT platformKey, platformColor
        FROM ical_sources
        WHERE isActive = 1
          AND platformKey IS NOT NULL
          AND trim(platformKey) != ''
          AND platformColor IS NOT NULL
          AND trim(platformColor) != ''
        ORDER BY updatedAt DESC, id DESC
      `).all();

      const customColors = {};
      customRows.forEach((row) => {
        const key = normalizePlatformKey(row.platformKey);
        if (!key || customColors[key]) return;
        customColors[key] = row.platformColor;
      });

      // specs/platforms-and-ical-rework.md §3 rule 6 — the GLOBAL `platforms.color` overrides are
      // authoritative for the calendar; overlay them on top of any legacy per-source colour so the
      // new palette wins. Built-in defaults stay in `knownColors` (the client merges both).
      Object.assign(customColors, platformsModel.create(database).colorMap());

      return { knownColors: KNOWN_PLATFORM_COLORS, customColors };
    },

    getByIdWithDetails(id) {
      const property = database.prepare('SELECT * FROM properties WHERE id = ?').get(id);
      if (!property) return null;

      if (typeof database.ensureDefaultTimedOptionsForProperty === 'function') {
        database.ensureDefaultTimedOptionsForProperty(Number(id));
      }
      // Same lazy-seed hook for the catering catalogue (specs/option-categories.md §5.2): the boot
      // seed links the articles to the properties that existed AT BOOT, so a property created since
      // would otherwise show no « Boissons » until the next restart. The call is idempotent.
      if (typeof database.ensureCateringOptions === 'function') {
        database.ensureCateringOptions(database);
      }

      // specs/tariff-recipes/spec.md §3.4 rules 25bis-25ter — the closures applicable to this
      // property (its own + the global ones), and, per season, the date ranges MINUS those closures.
      // The stored ranges keep their full span: a closure that moves simply re-reveals the days.
      // Computed here rather than in the client so the page renders without doing date maths.
      let closureRanges = [];
      try {
        closureRanges = database.prepare(`
          SELECT startDate, endDate, label FROM establishment_closures
          WHERE propertyId IS NULL OR propertyId = ?
          ORDER BY startDate
        `).all(Number(id));
      } catch (_) { closureRanges = []; } // table absent in minimal test schemas
      property.closureRanges = closureRanges;

      property.pricingRules = database.prepare('SELECT * FROM pricing_rules WHERE propertyId = ? ORDER BY startDate').all(id)
        .map((rule) => {
          let tiers = [];
          try {
            tiers = JSON.parse(rule.progressiveTiers || '[]');
          } catch {
            tiers = [];
          }
          const dateRanges = parseRuleDateRanges(rule);
          return {
            ...rule,
            pricingMode: rule.pricingMode || 'fixed',
            color: rule.color || '#1976d2',
            dateRanges,
            // Display-only view; never persisted, never used for pricing.
            dateRangesVisible: subtractClosuresFromRanges(dateRanges, closureRanges),
            progressiveTiers: Array.isArray(tiers) ? tiers : [],
          };
        })
        // Ordered by the earliest date the season actually covers — the stored `startDate` can lag
        // behind a multi-range season, and a season fully hidden by a closure must not jump the queue.
        .sort((a, b) => {
          const first = (rule) => (rule.dateRanges.length
            ? rule.dateRanges.map((r) => r.startDate).sort()[0]
            : '9999-12-31');
          return first(a).localeCompare(first(b)) || String(a.label || '').localeCompare(String(b.label || ''), 'fr');
        });
      // specs/tariff-recipes/spec.md §3.9 rule 53bis — what this property's RATE already covers:
      // the options marked « comprise » by default, and any option whose first N units are included
      // (the direct welcome pack's breakfasts). Surfaced so the tariff page can state the deal in
      // one place instead of leaving it implicit across three screens.
      try {
        property.rateInclusions = database.prepare(`
          SELECT o.id AS optionId, o.title, o.priceType,
                 COALESCE(pop.price, o.price) AS unitPrice,
                 COALESCE(d.offered, 0) AS offered,
                 COALESCE(pop.freeUnits, 0) AS freeUnits
          FROM options o
          JOIN property_options po ON po.optionId = o.id AND po.propertyId = ?
          LEFT JOIN property_option_defaults d ON d.optionId = o.id AND d.propertyId = ?
          LEFT JOIN property_option_prices pop ON pop.optionId = o.id AND pop.propertyId = ?
          WHERE o.archivedAt IS NULL AND COALESCE(o.displayToClient, 1) != 0
            AND (COALESCE(d.offered, 0) = 1 OR COALESCE(pop.freeUnits, 0) > 0)
          ORDER BY o.title COLLATE NOCASE
        `).all(Number(id), Number(id), Number(id));
      } catch (_) { property.rateInclusions = []; }

      property.documents = database.prepare('SELECT * FROM documents WHERE propertyId = ?').all(id);
      property.optionIds = database.prepare('SELECT optionId FROM property_options WHERE propertyId = ?').all(id).map((r) => r.optionId);
      // Options applicable to this property, each carrying its EFFECTIVE price for THIS property (the
      // per-property override when set, else the base price — specs/per-property-option-prices.md). The
      // reservation fiche consumes `property.options` so the option unit price it displays matches what
      // the pricing engine computes for this property (previously it fell back to the base price).
      // Defensive: minimal schemas (some unit-test DBs) have no `options` table → degrade to [].
      try {
        property.options = optionsModel.buildModel(database).listForProperty(id);
      } catch (_) {
        property.options = [];
      }
      // Render-ready grouping for the reservation fiche (specs/option-categories.md §3 rules 3-4,
      // 14): ungrouped options first, then the categories in display order. Internal-only options
      // are dropped BEFORE grouping so an all-internal category yields no section at all. The flat
      // `property.options` above stays untouched — the pricing engine and the SAS consume it.
      property.optionGroups = groupOptionsByCategory(property.options.filter(isClientVisibleOption));
      property.icalSources = database.prepare(`
        SELECT id, propertyId, name, url, platformKey, platformLabel, platformColor, isActive,
          collectsTouristTax, touristTaxRemittedByPlatform,
          lastSyncAt, lastSyncStatus, lastSyncMessage, lastImportedCount, createdAt, updatedAt
        FROM ical_sources
        WHERE propertyId = ?
        ORDER BY name COLLATE NOCASE, id DESC
      `).all(id);
      return property;
    },

    /**
     * Strictly READ-ONLY property detail for the PUBLIC API. Unlike getByIdWithDetails it must
     * never write: no ensureDefaultTimedOptionsForProperty seeding, no side effects. Returns only
     * the property row + the nightly prices the public "from €X" teaser needs — nothing else is
     * exposed publicly, so documents/icalSources/optionIds are deliberately omitted.
     */
    getByIdPublicReadOnly(id) {
      const property = database.prepare('SELECT * FROM properties WHERE id = ?').get(Number(id));
      if (!property) return null;
      property.pricingRules = database
        .prepare('SELECT pricePerNight FROM pricing_rules WHERE propertyId = ?')
        .all(Number(id));
      return property;
    },

    async create(body = {}, photoFile = null) {
      const photo = photoFile ? await saveOptimizedPhoto(photoFile) : '';
      const result = database.prepare(`
        INSERT INTO properties (name, nameArticle, photo, maxGuests, maxBabies, basePriceIncludedGuests, extraGuestPrice, extraGuestPriceUnit, welcomePackCost, singleBeds, doubleBeds, depositPercent, depositDaysBefore, balanceDaysBefore, defaultCheckIn, defaultCheckOut, cleaningHours, defaultCautionAmount, touristTaxPerDayPerPerson, touristTaxMode, touristTaxPercentage, touristTaxDepartmentPercentage, touristTaxFixedAmount, publicDepositEnabled)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        sentenceCase(body.name),
        normalizeNameArticle(body.nameArticle),
        photo,
        body.maxGuests || 2,
        body.maxBabies || 0,
        Number(body.basePriceIncludedGuests ?? 0),
        Number(body.extraGuestPrice ?? 0),
        normalizeExtraGuestUnit(body.extraGuestPriceUnit),
        Math.max(0, Number(body.welcomePackCost ?? 0) || 0),
        body.singleBeds ?? 0,
        body.doubleBeds ?? 0,
        body.depositPercent || 30,
        body.depositDaysBefore || 30,
        body.balanceDaysBefore || 7,
        body.defaultCheckIn || '15:00',
        body.defaultCheckOut || '10:00',
        body.cleaningHours || 3,
        body.defaultCautionAmount ?? 500,
        body.touristTaxPerDayPerPerson ?? 0,
        body.touristTaxMode || 'per_day_per_person',
        body.touristTaxPercentage ?? 0,
        body.touristTaxDepartmentPercentage ?? 0,
        body.touristTaxFixedAmount ?? 0,
        toBit(body.publicDepositEnabled),
      );

      const propertyId = result.lastInsertRowid;
      const currentYear = new Date().getFullYear();
      database.prepare(`
        INSERT INTO pricing_rules (propertyId, label, pricePerNight, pricingMode, progressiveTiers, dateRanges, color, startDate, endDate, minNights)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        propertyId,
        'Tarif annuel',
        100,
        'fixed',
        '[]',
        JSON.stringify([{ startDate: `${currentYear}-01-01`, endDate: `${currentYear}-12-31` }]),
        '#1976d2',
        `${currentYear}-01-01`,
        `${currentYear}-12-31`,
        1,
      );

      if (typeof database.ensureDefaultTimedOptionsForProperty === 'function') {
        database.ensureDefaultTimedOptionsForProperty(Number(propertyId));
      }

      return { id: propertyId };
    },

    async update(id, body = {}, photoFile = null) {
      const existing = database.prepare('SELECT photo, extraGuestPriceUnit, welcomePackCost FROM properties WHERE id = ?').get(id);
      const newPhoto = photoFile ? await saveOptimizedPhoto(photoFile) : '';
      const photo = newPhoto || (body.photo || (existing ? existing.photo : ''));

      database.prepare(`
        UPDATE properties SET name=?, nameArticle=?, photo=?, maxGuests=?, maxBabies=?, basePriceIncludedGuests=?, extraGuestPrice=?, extraGuestPriceUnit=?, welcomePackCost=?, singleBeds=?, doubleBeds=?, depositPercent=?, depositDaysBefore=?, balanceDaysBefore=?, defaultCheckIn=?, defaultCheckOut=?, cleaningHours=?, defaultCautionAmount=?, touristTaxPerDayPerPerson=?, touristTaxMode=?, touristTaxPercentage=?, touristTaxDepartmentPercentage=?, touristTaxFixedAmount=?, publicDepositEnabled=?, updatedAt=datetime('now')
        WHERE id=?
      `).run(
        sentenceCase(body.name),
        normalizeNameArticle(body.nameArticle),
        photo,
        body.maxGuests || 2,
        body.maxBabies || 0,
        Number(body.basePriceIncludedGuests ?? 0),
        Number(body.extraGuestPrice ?? 0),
        // An older client form that doesn't send the field keeps the stored value (never resets).
        body.extraGuestPriceUnit === undefined
          ? normalizeExtraGuestUnit(existing?.extraGuestPriceUnit)
          : normalizeExtraGuestUnit(body.extraGuestPriceUnit),
        body.welcomePackCost === undefined
          ? Math.max(0, Number(existing?.welcomePackCost ?? 0) || 0)
          : Math.max(0, Number(body.welcomePackCost ?? 0) || 0),
        body.singleBeds ?? 0,
        body.doubleBeds ?? 0,
        body.depositPercent || 30,
        body.depositDaysBefore || 30,
        body.balanceDaysBefore || 7,
        body.defaultCheckIn || '15:00',
        body.defaultCheckOut || '10:00',
        body.cleaningHours || 3,
        body.defaultCautionAmount ?? 500,
        body.touristTaxPerDayPerPerson ?? 0,
        body.touristTaxMode || 'per_day_per_person',
        body.touristTaxPercentage ?? 0,
        body.touristTaxDepartmentPercentage ?? 0,
        body.touristTaxFixedAmount ?? 0,
        toBit(body.publicDepositEnabled),
        id,
      );

      if (newPhoto && existing && existing.photo && existing.photo !== newPhoto) {
        removeUploadedFile(existing.photo);
      }

      return { ok: true };
    },

    remove(id) {
      const existing = database.prepare('SELECT photo FROM properties WHERE id = ?').get(id);
      if (!existing) return { ok: true };

      const affectedClientIds = database
        .prepare('SELECT DISTINCT clientId FROM reservations WHERE propertyId = ?')
        .all(id)
        .map((r) => r.clientId);

      database.transaction(() => {
        // Cascades to reservations + children, pricing_rules, documents, property_options,
        // ical_sources, ical_import_events, calendar_notes.
        database.prepare('DELETE FROM properties WHERE id = ?').run(id);

        if (affectedClientIds.length > 0) {
          const placeholders = affectedClientIds.map(() => '?').join(',');
          database.prepare(`
            DELETE FROM clients
            WHERE id IN (${placeholders})
              AND NOT EXISTS (SELECT 1 FROM reservations WHERE clientId = clients.id)
          `).run(...affectedClientIds);
        }
      })();

      if (existing.photo) removeUploadedFile(existing.photo);
      return { ok: true };
    },

    // « Prix plateformes » grid for the property tarif page (specs/platform-price-from-commission.md,
    // widened by specs/tariff-recipes/spec.md §3.6 rules 31-34). Returns EVERY channel — the direct
    // row first (its displayed price covers the welcome pack after the Lodgify fee), then the
    // commissioned platforms — with, per tariff season, the whole-euro price to configure on that
    // channel plus the per-night extra-guest price. Net pivots per rule 34bis:
    // COALESCE(netTargetPerNight, pricePerNight) and
    // COALESCE(extraGuestNetTarget, rule.extraGuestPrice, property.extraGuestPrice) — legacy rows have
    // every net column NULL, so the grid keeps meaning "gross up the season price".
    platformPrices(propertyId) {
      const property = database.prepare(
        'SELECT welcomePackCost, extraGuestPrice, extraGuestPriceUnit FROM properties WHERE id = ?'
      ).get(Number(propertyId)) || {};
      const welcomePackCost = Math.max(0, Number(property.welcomePackCost || 0));

      const rows = database.prepare(`
        SELECT id, name, COALESCE(commissionPercent, 0) AS commissionPercent
        FROM platforms
        ORDER BY name COLLATE NOCASE ASC
      `).all().map((p) => ({
        id: p.id,
        name: p.name,
        commissionPercent: Number(p.commissionPercent) || 0,
        isDirect: String(p.name || '').toLowerCase() === 'direct',
      }));
      // Direct row first (synthesized at 0 % when no `Direct` platform row exists yet).
      const directRow = rows.find((p) => p.isDirect)
        || { id: 'direct', name: 'Direct', commissionPercent: 0, isDirect: true };
      // The other OWN channels — Lodgify — are the Direct row: its « moteur Lodgify » caption says
      // so, and its commission IS the engine fee. Listing Lodgify again underneath would ask the
      // operator to configure the same channel twice, with two rates that must never disagree.
      // Hidden from this grid only: the platform row itself still carries reservations and their
      // commissions.
      const platforms = [directRow, ...rows.filter((p) => !p.isDirect && !isDirectChannel(p.name))];

      const seasons = database.prepare(
        'SELECT id, label, pricePerNight, netTargetPerNight, extraGuestPrice, extraGuestNetTarget, extraGuestTiers FROM pricing_rules WHERE propertyId = ? ORDER BY startDate, id',
      ).all(Number(propertyId)).map((s) => {
        const netPerNight = s.netTargetPerNight != null ? Number(s.netTargetPerNight) : (Number(s.pricePerNight) || 0);
        const extraGuestNet = s.extraGuestNetTarget != null
          ? Number(s.extraGuestNetTarget)
          : (s.extraGuestPrice != null ? Number(s.extraGuestPrice) : Number(property.extraGuestPrice || 0));
        // A tiered supplement grosses up tier by tier: each band is its own net pivot, so a channel
        // sees « 17 € puis 9 € » rather than one price no night actually costs. The pivot is the
        // band's NET (`netPrice`, merged in by the recipe apply); a band without one uses its
        // displayed price as its own net — never the other way round, or every channel is grossed
        // up from a price that already contains the direct margin.
        const storedTiers = normalizeExtraGuestTiers(parseTiersColumn(s.extraGuestTiers));
        const byPlatform = {};
        const extraGuestByPlatform = {};
        const extraGuestTiersByPlatform = storedTiers ? {} : null;
        for (const p of platforms) {
          // The welcome pack is per stay, not per guest: it loads the nightly price of the direct
          // channel only, never the extra-guest column.
          byPlatform[p.id] = grossFromNet(netPerNight, p.commissionPercent, { fixedCost: p.isDirect ? welcomePackCost : 0 });
          extraGuestByPlatform[p.id] = grossFromNet(extraGuestNet, p.commissionPercent);
          if (storedTiers) {
            extraGuestTiersByPlatform[p.id] = storedTiers.map((t) => ({
              fromNight: t.fromNight,
              price: grossFromNet(t.netPrice ?? t.price, p.commissionPercent),
            }));
          }
        }
        return {
          ruleId: s.id,
          label: s.label,
          netPerNight,
          extraGuestNet,
          extraGuestPriceUnit: property.extraGuestPriceUnit === 'per_night' ? 'per_night' : 'per_stay',
          byPlatform,
          extraGuestByPlatform,
          extraGuestTiersByPlatform,
        };
      });

      return { platforms, seasons };
    },

    addPricingRule(propertyId, body = {}) {
      const { label, pricePerNight, pricingMode, progressiveTiers, dateRanges, color, startDate, endDate, minNights } = body;
      const normalizedDateRanges = stripRangeMinEqualToDefault(normalizeDateRanges(dateRanges, startDate, endDate), minNights);
      const normalizedProgressiveTiers = pricingMode === 'progressive'
        ? normalizeProgressiveTiers(Number(pricePerNight || 0), progressiveTiers)
        : [];
      const conflictingRule = findPricingRuleOverlap(propertyId, normalizedDateRanges);
      if (conflictingRule) {
        return {
          error: `Chevauchement avec la saison "${conflictingRule.label}" (${conflictingRule.startDate} au ${conflictingRule.endDate}).`,
          status: 400,
          conflictingRule,
        };
      }
      const bounds = getBoundsFromDateRanges(normalizedDateRanges);
      const result = database.prepare(`
        INSERT INTO pricing_rules (propertyId, label, pricePerNight, pricingMode, progressiveTiers, dateRanges, color, startDate, endDate, minNights,
          seasonKey, seasonRank, netTargetPerNight, extraGuestPrice, extraGuestNetTarget, maxNights, changeoverArrival, changeoverDeparture,
          extraGuestTiers)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        propertyId,
        sentenceCase(label || 'Standard'),
        Number(pricePerNight || 0),
        pricingMode || 'fixed',
        JSON.stringify(normalizedProgressiveTiers),
        JSON.stringify(normalizedDateRanges),
        color || '#1976d2',
        bounds.startDate,
        bounds.endDate,
        minNights || 1,
        // Recipe columns (specs/tariff-recipes/spec.md §5) — all NULL by default: an untagged season is
        // manual, never touched by a recipe apply; NULL net targets keep the platform grid on pricePerNight.
        body.seasonKey ? String(body.seasonKey) : null,
        Number.isFinite(Number(body.seasonRank)) && body.seasonRank != null && body.seasonRank !== '' ? Math.floor(Number(body.seasonRank)) : null,
        normalizeOptionalMoney(body.netTargetPerNight),
        normalizeOptionalMoney(body.extraGuestPrice),
        normalizeOptionalMoney(body.extraGuestNetTarget),
        normalizeMaxNights(body.maxNights),
        normalizeChangeoverDay(body.changeoverArrival),
        normalizeChangeoverDay(body.changeoverDeparture),
        serializeTiers(body.extraGuestTiers),
      );
      return { data: { id: result.lastInsertRowid } };
    },

    updatePricingRule(propertyId, ruleId, body = {}) {
      const { label, pricePerNight, pricingMode, progressiveTiers, dateRanges, color, startDate, endDate, minNights } = body;
      const normalizedDateRanges = stripRangeMinEqualToDefault(normalizeDateRanges(dateRanges, startDate, endDate), minNights);
      const normalizedProgressiveTiers = pricingMode === 'progressive'
        ? normalizeProgressiveTiers(Number(pricePerNight || 0), progressiveTiers)
        : [];
      const conflictingRule = findPricingRuleOverlap(propertyId, normalizedDateRanges, ruleId);
      if (conflictingRule) {
        return {
          error: `Chevauchement avec la saison "${conflictingRule.label}" (${conflictingRule.startDate} au ${conflictingRule.endDate}).`,
          status: 400,
          conflictingRule,
        };
      }
      // The recipe columns keep their stored value when the caller doesn't send them (the season
      // dialog edits a subset; a recipe apply always sends the full set).
      const existing = database.prepare('SELECT seasonKey, seasonRank, netTargetPerNight, extraGuestPrice, extraGuestNetTarget, maxNights, changeoverArrival, changeoverDeparture, extraGuestTiers FROM pricing_rules WHERE id = ? AND propertyId = ?').get(ruleId, propertyId) || {};
      const keepOr = (key, normalizer) => (body[key] === undefined ? (existing[key] ?? null) : normalizer(body[key]));
      const bounds = getBoundsFromDateRanges(normalizedDateRanges);
      database.prepare(`
        UPDATE pricing_rules SET label=?, pricePerNight=?, pricingMode=?, progressiveTiers=?, dateRanges=?, color=?, startDate=?, endDate=?, minNights=?,
          seasonKey=?, seasonRank=?, netTargetPerNight=?, extraGuestPrice=?, extraGuestNetTarget=?, maxNights=?, changeoverArrival=?, changeoverDeparture=?,
          extraGuestTiers=?
        WHERE id=? AND propertyId=?
      `).run(
        sentenceCase(label || 'Standard'),
        Number(pricePerNight || 0),
        pricingMode || 'fixed',
        JSON.stringify(normalizedProgressiveTiers),
        JSON.stringify(normalizedDateRanges),
        color || '#1976d2',
        bounds.startDate,
        bounds.endDate,
        minNights || 1,
        keepOr('seasonKey', (v) => (v ? String(v) : null)),
        keepOr('seasonRank', (v) => (Number.isFinite(Number(v)) && v !== '' && v != null ? Math.floor(Number(v)) : null)),
        keepOr('netTargetPerNight', normalizeOptionalMoney),
        keepOr('extraGuestPrice', normalizeOptionalMoney),
        keepOr('extraGuestNetTarget', normalizeOptionalMoney),
        keepOr('maxNights', normalizeMaxNights),
        keepOr('changeoverArrival', normalizeChangeoverDay),
        keepOr('changeoverDeparture', normalizeChangeoverDay),
        keepOr('extraGuestTiers', serializeTiers),
        ruleId,
        propertyId,
      );
      return { data: { ok: true } };
    },

    // specs/tariff-recipes/spec.md §3.2 — the property's active recipe pointer. Written by the recipe
    // apply (and cleared by a detach); deliberately NOT part of the generic update() so a property
    // form save can never wipe it.
    setTariffRecipe(propertyId, recipeId, recipeVersion) {
      database.prepare("UPDATE properties SET tariffRecipeId = ?, tariffRecipeVersion = ?, updatedAt = datetime('now') WHERE id = ?")
        .run(String(recipeId || ''), String(recipeVersion || ''), Number(propertyId));
      return { data: { ok: true } };
    },

    // specs/tariff-events-and-extra-guest-tiers/spec.md §3.1 — the welcome-pack cost price is owned
    // by the RECIPE, not by the property form: it is a margin input for the channel grid, never a
    // guest-facing amount. Written only by the recipe apply, exactly like the recipe pointer.
    setWelcomePackCost(propertyId, cost) {
      database.prepare("UPDATE properties SET welcomePackCost = ?, updatedAt = datetime('now') WHERE id = ?")
        .run(Math.max(0, Number(cost) || 0), Number(propertyId));
      return { data: { ok: true } };
    },

    deletePricingRule(propertyId, ruleId) {
      database.prepare('DELETE FROM pricing_rules WHERE id = ? AND propertyId = ?').run(ruleId, propertyId);
      return { data: { ok: true } };
    },

    applyPricingTo(sourcePropertyId, body = {}) {
      const targetPropertyId = Number(body.targetPropertyId);
      const replaceExisting = Boolean(body.replaceExisting);

      if (!targetPropertyId) return { error: 'Le logement cible est requis.', status: 400 };
      if (sourcePropertyId === targetPropertyId) {
        return { error: 'Le logement source et le logement cible doivent être différents.', status: 400 };
      }

      const sourceProperty = database.prepare('SELECT id, name FROM properties WHERE id = ?').get(sourcePropertyId);
      if (!sourceProperty) return { error: 'Logement source introuvable.', status: 404 };
      const targetProperty = database.prepare('SELECT id, name FROM properties WHERE id = ?').get(targetPropertyId);
      if (!targetProperty) return { error: 'Logement cible introuvable.', status: 404 };

      const sourceRules = database.prepare('SELECT * FROM pricing_rules WHERE propertyId = ? ORDER BY startDate').all(sourcePropertyId);
      if (!sourceRules.length) return { error: 'Aucune saison à appliquer pour le logement source.', status: 400 };

      const normalizedSourceRules = sourceRules.map((rule) => {
        const normalizedDateRanges = normalizeDateRanges(parseRuleDateRanges(rule), rule.startDate, rule.endDate);
        const bounds = getBoundsFromDateRanges(normalizedDateRanges);
        return {
          label: sentenceCase(rule.label || 'Standard'),
          pricePerNight: Number(rule.pricePerNight || 0),
          pricingMode: rule.pricingMode || 'fixed',
          progressiveTiers: rule.progressiveTiers || '[]',
          dateRanges: JSON.stringify(normalizedDateRanges),
          color: rule.color || '#1976d2',
          startDate: bounds.startDate,
          endDate: bounds.endDate,
          minNights: Number(rule.minNights || 1),
          normalizedDateRanges,
        };
      });

      if (!replaceExisting) {
        for (const sourceRule of normalizedSourceRules) {
          const conflict = findPricingRuleOverlap(targetPropertyId, sourceRule.normalizedDateRanges);
          if (conflict) {
            return {
              error: `Impossible d'appliquer: chevauchement avec la saison "${conflict.label}" du logement cible (${conflict.startDate} au ${conflict.endDate}).`,
              status: 409,
              code: 'PRICING_OVERLAP',
              conflictingRule: conflict,
            };
          }
        }
      }

      const insertRule = database.prepare(`
        INSERT INTO pricing_rules (propertyId, label, pricePerNight, pricingMode, progressiveTiers, dateRanges, color, startDate, endDate, minNights)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      database.transaction(() => {
        if (replaceExisting) {
          database.prepare('DELETE FROM pricing_rules WHERE propertyId = ?').run(targetPropertyId);
        }
        for (const rule of normalizedSourceRules) {
          insertRule.run(
            targetPropertyId,
            rule.label,
            rule.pricePerNight,
            rule.pricingMode,
            rule.progressiveTiers,
            rule.dateRanges,
            rule.color,
            rule.startDate,
            rule.endDate,
            rule.minNights,
          );
        }
      })();

      return { data: { ok: true, copiedRules: normalizedSourceRules.length, replaceExisting } };
    },

    // Calendar season painting (specs/pricing-min-nights-per-range.md): carve a selected period out of
    // every season and (re)attach it to a target season (existing or new) with its own minimum nights.
    // All the date-range algebra is the pure `computeDateRangeAssignment`; here we validate + persist.
    assignDateRangeToSeason(propertyId, body = {}) {
      const pid = Number(propertyId);
      const startDate = String(body.startDate || '');
      const endDate = String(body.endDate || '');
      const minNights = Math.floor(Number(body.minNights));
      const target = body.target || {};
      const ISO = /^\d{4}-\d{2}-\d{2}$/;

      if (!ISO.test(startDate) || !ISO.test(endDate)) return { error: 'Dates invalides.', status: 400 };
      if (startDate > endDate) return { error: 'La date de début doit précéder la date de fin.', status: 400 };
      if (!Number.isFinite(minNights) || minNights < 1) return { error: 'Le minimum de nuits doit être un entier ≥ 1.', status: 400 };
      if (target.mode !== 'existing' && target.mode !== 'new') return { error: 'Cible invalide.', status: 400 };

      const rules = database.prepare('SELECT * FROM pricing_rules WHERE propertyId = ? ORDER BY startDate').all(pid);

      let targetRuleId = null;
      if (target.mode === 'existing') {
        targetRuleId = Number(target.ruleId);
        if (!rules.some((r) => Number(r.id) === targetRuleId)) return { error: 'Saison cible introuvable.', status: 404 };
      }

      const plan = computeDateRangeAssignment(rules, {
        startDate, endDate, minNights, target: { ...target, ruleId: targetRuleId },
      });

      const deletedLabels = plan.deletedRuleIds
        .map((id) => rules.find((r) => Number(r.id) === id)?.label)
        .filter(Boolean);

      const updateStmt = database.prepare('UPDATE pricing_rules SET dateRanges=?, startDate=?, endDate=? WHERE id=? AND propertyId=?');
      const deleteStmt = database.prepare('DELETE FROM pricing_rules WHERE id=? AND propertyId=?');
      const insertStmt = database.prepare(`
        INSERT INTO pricing_rules (propertyId, label, pricePerNight, pricingMode, progressiveTiers, dateRanges, color, startDate, endDate, minNights)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      let createdRuleId = null;
      database.transaction(() => {
        for (const u of plan.updatedRules) {
          updateStmt.run(JSON.stringify(u.dateRanges), u.startDate, u.endDate, u.id, pid);
        }
        for (const id of plan.deletedRuleIds) {
          deleteStmt.run(id, pid);
        }
        if (plan.newRule) {
          const nr = plan.newRule;
          const tiers = nr.pricingMode === 'progressive'
            ? normalizeProgressiveTiers(Number(nr.pricePerNight || 0), nr.progressiveTiers)
            : [];
          const res = insertStmt.run(
            pid,
            sentenceCase(nr.label || 'Standard'),
            Number(nr.pricePerNight || 0),
            nr.pricingMode || 'fixed',
            JSON.stringify(tiers),
            JSON.stringify(nr.dateRanges),
            nr.color || '#1976d2',
            nr.startDate,
            nr.endDate,
            Math.max(1, Number(nr.minNights || 1)),
          );
          createdRuleId = res.lastInsertRowid;
        }
      })();

      return { data: { ok: true, deletedLabels, createdRuleId } };
    },

    addDocument(propertyId, file, body = {}) {
      if (!file) return { error: 'Fichier requis', status: 400 };
      const filePath = `/uploads/${file.filename}`;
      const result = database.prepare(`
        INSERT INTO documents (propertyId, type, name, filePath) VALUES (?, ?, ?, ?)
      `).run(propertyId, body.type || 'other', sentenceCase(body.name || file.originalname), filePath);
      return { data: { id: result.lastInsertRowid, filePath } };
    },

    deleteDocument(propertyId, docId) {
      database.prepare('DELETE FROM documents WHERE id = ? AND propertyId = ?').run(docId, propertyId);
      return { data: { ok: true } };
    },

    // specs/welcome-pack-auto-options.md §3.1 — the property's welcome pack: the options this
    // property's rate already covers by the unit (`freeUnits > 0`, written by the tariff recipe).
    // Engine-derived options (`autoEnabled = 1`) are excluded: they are never part of a reservation's
    // manual selection. Defensive like `rateInclusions`: a minimal schema degrades to an empty pack.
    listWelcomePackOptions(propertyId) {
      const pid = Number(propertyId);
      if (!Number.isInteger(pid) || pid <= 0) return [];
      try {
        return database.prepare(`
          SELECT o.id AS optionId, o.title, o.priceType, o.autoOptionType,
                 o.showsPlanningCard, o.cardRepeat, o.planningCardTimes, o.breakfastTime,
                 COALESCE(pop.price, o.price) AS unitPrice,
                 COALESCE(pop.freeUnits, 0) AS freeUnits
          FROM options o
          JOIN property_options po ON po.optionId = o.id AND po.propertyId = ?
          JOIN property_option_prices pop ON pop.optionId = o.id AND pop.propertyId = ?
          WHERE o.archivedAt IS NULL
            AND COALESCE(o.displayToClient, 1) != 0
            AND COALESCE(o.autoEnabled, 0) != 1
            AND COALESCE(pop.freeUnits, 0) > 0
          ORDER BY o.title COLLATE NOCASE
        `).all(pid, pid);
      } catch (_) {
        return [];
      }
    },

    setOptions(propertyId, optionIds = []) {
      const deleteAll = database.prepare('DELETE FROM property_options WHERE propertyId = ?');
      const insert = database.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (?, ?)');
      database.transaction(() => {
        deleteAll.run(propertyId);
        for (const oid of (optionIds || [])) {
          insert.run(propertyId, oid);
        }
      })();
      return { ok: true };
    },
  };

  return model;
}

const defaultModel = createPropertiesModel(db);
defaultModel.buildModel = createPropertiesModel;
// Exposed for unit tests.
defaultModel.__test = { normalizeNameArticle, VALID_NAME_ARTICLES, computeDateRangeAssignment, stripRangeMinEqualToDefault, subtractClosuresFromRanges };

module.exports = defaultModel;
