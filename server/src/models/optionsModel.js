// Options model — option catalog CRUD + the property_options applicability links + progressive-tier
// normalization. SQL moved verbatim from routes/options.js.

const db = require('../database');
const { sentenceCase } = require('../utils/textFormatters');

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

  const propertyIdsFor = (optionId) => database
    .prepare('SELECT propertyId FROM property_options WHERE optionId = ? ORDER BY propertyId')
    .all(optionId)
    .map((r) => r.propertyId);

  const model = {
    list() {
      return database.prepare('SELECT * FROM options ORDER BY title').all().map((o) => ({
        ...o,
        propertyIds: propertyIdsFor(o.id),
        optionProgressiveTiers: normalizeProgressiveOptionTiers(o.optionProgressiveTiers),
      }));
    },

    get(id) {
      const option = database.prepare('SELECT * FROM options WHERE id = ?').get(id);
      if (!option) return null;
      option.propertyIds = propertyIdsFor(id);
      option.optionProgressiveTiers = normalizeProgressiveOptionTiers(option.optionProgressiveTiers);
      return option;
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
      })();
      return { ok: true };
    },

    remove(id) {
      database.prepare('DELETE FROM property_options WHERE optionId = ?').run(id);
      database.prepare('DELETE FROM options WHERE id = ?').run(id);
      return { ok: true };
    },
  };

  return model;
}

const defaultModel = createOptionsModel(db);
defaultModel.buildModel = createOptionsModel;
defaultModel.__test = { normalizeProgressiveOptionTiers };

module.exports = defaultModel;
