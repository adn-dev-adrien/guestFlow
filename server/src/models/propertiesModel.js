// Properties model — property CRUD (+ enriched detail), pricing rules (+ overlap + apply-to),
// documents, option linkage, and platform colours. SQL moved verbatim from routes/properties.js.

const db = require('../database');
const optionsModel = require('./optionsModel');
const { sentenceCase } = require('../utils/textFormatters');
const {
  normalizeDateRanges,
  getBoundsFromDateRanges,
  parseRuleDateRanges,
  normalizeProgressiveTiers,
  grossFromNet,
} = require('../utils/pricing');
const { normalizePlatformKey } = require('../utils/icalParser');
const { KNOWN_PLATFORM_COLORS } = require('../constants/platformColors');
const platformsModel = require('./platformsModel');
const { saveOptimizedPhoto, removeUploadedFile } = require('../utils/propertyUploads');

// Canonical French articles for "votre séjour <article> <name>" in client emails
// (specs/email-automation.md §3 rule 13). Anything off-list falls back to 'au'.
const VALID_NAME_ARTICLES = ['au', 'à la', "à l'", 'aux'];
function normalizeNameArticle(value) {
  const v = String(value || '').trim();
  return VALID_NAME_ARTICLES.includes(v) ? v : 'au';
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

      property.pricingRules = database.prepare('SELECT * FROM pricing_rules WHERE propertyId = ? ORDER BY startDate').all(id)
        .map((rule) => {
          let tiers = [];
          try {
            tiers = JSON.parse(rule.progressiveTiers || '[]');
          } catch {
            tiers = [];
          }
          return {
            ...rule,
            pricingMode: rule.pricingMode || 'fixed',
            color: rule.color || '#1976d2',
            dateRanges: parseRuleDateRanges(rule),
            progressiveTiers: Array.isArray(tiers) ? tiers : [],
          };
        });
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
        INSERT INTO properties (name, nameArticle, photo, maxAdults, maxChildren, maxBabies, basePriceIncludedGuests, extraGuestPrice, singleBeds, doubleBeds, depositPercent, depositDaysBefore, balanceDaysBefore, defaultCheckIn, defaultCheckOut, cleaningHours, defaultCautionAmount, touristTaxPerDayPerPerson, touristTaxMode, touristTaxPercentage, touristTaxDepartmentPercentage, touristTaxFixedAmount)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        sentenceCase(body.name),
        normalizeNameArticle(body.nameArticle),
        photo,
        body.maxAdults || 2,
        body.maxChildren || 0,
        body.maxBabies || 0,
        Number(body.basePriceIncludedGuests ?? 0),
        Number(body.extraGuestPrice ?? 0),
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
      const existing = database.prepare('SELECT photo FROM properties WHERE id = ?').get(id);
      const newPhoto = photoFile ? await saveOptimizedPhoto(photoFile) : '';
      const photo = newPhoto || (body.photo || (existing ? existing.photo : ''));

      database.prepare(`
        UPDATE properties SET name=?, nameArticle=?, photo=?, maxAdults=?, maxChildren=?, maxBabies=?, basePriceIncludedGuests=?, extraGuestPrice=?, singleBeds=?, doubleBeds=?, depositPercent=?, depositDaysBefore=?, balanceDaysBefore=?, defaultCheckIn=?, defaultCheckOut=?, cleaningHours=?, defaultCautionAmount=?, touristTaxPerDayPerPerson=?, touristTaxMode=?, touristTaxPercentage=?, touristTaxDepartmentPercentage=?, touristTaxFixedAmount=?, updatedAt=datetime('now')
        WHERE id=?
      `).run(
        sentenceCase(body.name),
        normalizeNameArticle(body.nameArticle),
        photo,
        body.maxAdults || 2,
        body.maxChildren || 0,
        body.maxBabies || 0,
        Number(body.basePriceIncludedGuests ?? 0),
        Number(body.extraGuestPrice ?? 0),
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

    // « Prix plateformes » grid for the property tarif page (specs/platform-price-from-commission.md).
    // Returns the non-direct platforms (with their global commission %) + each tariff season's net
    // base /nuit and the grossed-up price per platform (`gross = net / (1 − c/100)`; null when c ≥ 100).
    platformPrices(propertyId) {
      const platforms = database.prepare(`
        SELECT id, name, COALESCE(commissionPercent, 0) AS commissionPercent
        FROM platforms
        WHERE LOWER(name) != 'direct'
        ORDER BY name COLLATE NOCASE ASC
      `).all().map((p) => ({ id: p.id, name: p.name, commissionPercent: Number(p.commissionPercent) || 0 }));

      const seasons = database.prepare(
        'SELECT id, label, pricePerNight FROM pricing_rules WHERE propertyId = ? ORDER BY startDate, id',
      ).all(Number(propertyId)).map((s) => {
        const netPerNight = Number(s.pricePerNight) || 0;
        const byPlatform = {};
        for (const p of platforms) byPlatform[p.id] = grossFromNet(netPerNight, p.commissionPercent);
        return { ruleId: s.id, label: s.label, netPerNight, byPlatform };
      });

      return { platforms, seasons };
    },

    addPricingRule(propertyId, body = {}) {
      const { label, pricePerNight, pricingMode, progressiveTiers, dateRanges, color, startDate, endDate, minNights } = body;
      const normalizedDateRanges = normalizeDateRanges(dateRanges, startDate, endDate);
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
        INSERT INTO pricing_rules (propertyId, label, pricePerNight, pricingMode, progressiveTiers, dateRanges, color, startDate, endDate, minNights)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      );
      return { data: { id: result.lastInsertRowid } };
    },

    updatePricingRule(propertyId, ruleId, body = {}) {
      const { label, pricePerNight, pricingMode, progressiveTiers, dateRanges, color, startDate, endDate, minNights } = body;
      const normalizedDateRanges = normalizeDateRanges(dateRanges, startDate, endDate);
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
      const bounds = getBoundsFromDateRanges(normalizedDateRanges);
      database.prepare(`
        UPDATE pricing_rules SET label=?, pricePerNight=?, pricingMode=?, progressiveTiers=?, dateRanges=?, color=?, startDate=?, endDate=?, minNights=?
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
        ruleId,
        propertyId,
      );
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
defaultModel.__test = { normalizeNameArticle, VALID_NAME_ARTICLES };

module.exports = defaultModel;
