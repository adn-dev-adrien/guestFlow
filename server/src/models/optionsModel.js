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
      const insertOption = database.prepare(`
        INSERT INTO options (title, description, priceType, price, optionProgressiveTiers, autoOptionType, autoEnabled, autoPricingMode, autoFullNightThreshold)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const insertLink = database.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (?, ?)');
      const optionId = database.transaction(() => {
        const result = insertOption.run(
          sentenceCase(payload.title),
          sentenceCase(payload.description),
          payload.priceType || 'per_stay',
          Number(payload.price || 0),
          JSON.stringify(normalizeProgressiveOptionTiers(payload.optionProgressiveTiers)),
          payload.autoOptionType || null,
          payload.autoEnabled ? 1 : 0,
          payload.autoPricingMode || 'fixed',
          payload.autoFullNightThreshold || null,
        );
        const id = result.lastInsertRowid;
        for (const pid of (payload.propertyIds || [])) insertLink.run(pid, id);
        return id;
      })();
      return { id: optionId };
    },

    update(id, payload = {}) {
      const updateOption = database.prepare(`
        UPDATE options
        SET title=?, description=?, priceType=?, price=?, optionProgressiveTiers=?, autoOptionType=?, autoEnabled=?, autoPricingMode=?, autoFullNightThreshold=?
        WHERE id=?
      `);
      const deleteLinks = database.prepare('DELETE FROM property_options WHERE optionId = ?');
      const insertLink = database.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (?, ?)');
      database.transaction(() => {
        updateOption.run(
          sentenceCase(payload.title),
          sentenceCase(payload.description),
          payload.priceType || 'per_stay',
          Number(payload.price || 0),
          JSON.stringify(normalizeProgressiveOptionTiers(payload.optionProgressiveTiers)),
          payload.autoOptionType || null,
          payload.autoEnabled ? 1 : 0,
          payload.autoPricingMode || 'fixed',
          payload.autoFullNightThreshold || null,
          id,
        );
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
