/**
 * SettingsProvider — the one way a pricing component receives its parameters (specs/pricing-components.md §3
 * rules 48, 50).
 *
 * Contract: `create(db).for(componentId, scope)` → `{ [key]: value }`, each key resolved article → property → global →
 * default. `scope` is `{ propertyId?, articleRef?, platform? }`. A component declares its keys in its exported
 * `settingsSchema` (`[{ key, type, default, scope, validate }]`, the shape plugins use for `SETTINGS`; `validate(value)`
 * returns a French message to refuse, or null). A key declared at scope S may be supplied by the layer S or a narrower
 * one. A layer that has no value for a key says nothing (`undefined`), so the next one answers.
 *
 * PR A adapters read exactly today's columns, so every quote stays byte-identical: no component reads a property row,
 * this module does. `create(db, { extra })` adds components (`{ [id]: { settingsSchema, read: { [layer]: (db, scope) =>
 * partial { key: value } | undefined } } }`): the article families register theirs that way.
 */
const { settingsSchema: nightsSchema, parseJsonArray } = require('../../utils/pricing/nights');
const { settingsSchema: extraGuestsSchema } = require('../../utils/pricing/extraGuests');
const { settingsSchema: touristTaxSchema } = require('../../utils/pricing/touristTax');
const { settingsSchema: stayClockSchema } = require('../../utils/pricing/stayClock');
const { settingsSchema: scheduleSchema } = require('../../utils/pricing/schedule');

const LAYERS = ['article', 'property', 'global'];
const WIDTH = { global: 0, property: 1, article: 2 };

const hasTable = (db, name) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));

function propertyRow(db, propertyId) {
  const id = Number(propertyId);
  if (!(id > 0)) return null;
  return db.prepare('SELECT * FROM properties WHERE id = ?').get(id) || null;
}

const ADAPTERS = {
  nights: {
    property(db, scope) {
      const id = Number(scope.propertyId);
      if (!(id > 0) || !hasTable(db, 'pricing_rules')) return undefined;
      return { tariff: { rules: db.prepare('SELECT * FROM pricing_rules WHERE propertyId = ? ORDER BY startDate').all(id) } };
    },
  },
  extraGuests: {
    property(db, scope) {
      const property = propertyRow(db, scope.propertyId);
      if (!property) return undefined;
      return {
        includedGuests: property.basePriceIncludedGuests,
        extraGuestPrice: property.extraGuestPrice,
        extraGuestPriceUnit: property.extraGuestPriceUnit,
        tiers: parseJsonArray(property.extraGuestTiers),
      };
    },
  },
  touristTax: {
    property(db, scope) {
      const property = propertyRow(db, scope.propertyId);
      if (!property) return undefined;
      const values = {
        mode: property.touristTaxMode,
        perPersonNight: property.touristTaxPerDayPerPerson,
        percentage: property.touristTaxPercentage,
        departmentPercentage: property.touristTaxDepartmentPercentage,
        fixedAmount: property.touristTaxFixedAmount,
      };
      if (scope.platform) {
        const pricing = require('../../utils/pricing');
        values.collector = {
          chargedByPlatform: pricing.isPlatformCollectingTouristTax(db, scope.propertyId, scope.platform),
          remittedByOwner: pricing.isTouristTaxRemittedByOwner(db, scope.propertyId, scope.platform),
        };
      }
      return values;
    },
  },
  stayClock: {
    property(db, scope) {
      const property = propertyRow(db, scope.propertyId);
      if (!property) return undefined;
      return { defaultCheckIn: property.defaultCheckIn, defaultCheckOut: property.defaultCheckOut };
    },
  },
  schedule: {
    property(db, scope) {
      const property = propertyRow(db, scope.propertyId);
      if (!property) return undefined;
      return {
        depositPercent: property.depositPercent,
        depositEnabled: property.depositEnabled,
        depositDueDays: property.depositDueDays,
        balanceDaysBefore: property.balanceDaysBefore,
        cancelAfterBalanceDueDays: property.cancelAfterBalanceDueDays,
      };
    },
  },
};

const SCHEMAS = {
  nights: nightsSchema, extraGuests: extraGuestsSchema, touristTax: touristTaxSchema, stayClock: stayClockSchema, schedule: scheduleSchema,
};

function create(db, { extra = {} } = {}) {
  const schemas = { ...SCHEMAS };
  const adapters = { ...ADAPTERS };
  for (const [id, component] of Object.entries(extra)) {
    schemas[id] = component.settingsSchema;
    adapters[id] = component.read;
  }

  const schemaOf = (componentId) => {
    if (!schemas[componentId]) throw new Error(`SETTINGS_UNKNOWN_COMPONENT: ${componentId}`);
    return schemas[componentId];
  };

  function forComponent(componentId, scope = {}) {
    const schema = schemaOf(componentId);
    const read = adapters[componentId] || {};
    const layers = {};
    for (const layer of LAYERS) layers[layer] = read[layer] ? read[layer](db, scope) : undefined;
    const out = {};
    for (const entry of schema) {
      out[entry.key] = entry.default;
      for (const layer of ['global', 'property', 'article']) {
        if (WIDTH[layer] < WIDTH[entry.scope]) continue;
        const value = layers[layer] ? layers[layer][entry.key] : undefined;
        if (value !== undefined && value !== null) out[entry.key] = value;
      }
    }
    return out;
  }

  function validate(componentId, values) {
    const refusals = [];
    for (const entry of schemaOf(componentId)) {
      const message = entry.validate(values[entry.key]);
      if (message) refusals.push({ key: entry.key, message });
    }
    return refusals;
  }

  return { for: forComponent, validate, schemaOf };
}

module.exports = { create, SCHEMAS };
