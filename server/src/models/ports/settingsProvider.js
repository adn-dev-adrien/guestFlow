/**
 * SettingsProvider — the one way a pricing component receives its parameters (specs/pricing-components.md §3
 * rules 48, 50).
 *
 * Contract: `create(db).for(componentId, scope)` → `{ [key]: value }`, each key resolved article → property → global →
 * default. `scope` is `{ propertyId?, articleRef?, platform? }`. A component declares its keys in its exported
 * `settingsSchema` (`[{ key, type, default, scope, validate }]`, the shape plugins use for `SETTINGS`; `validate(value)`
 * returns a French message to refuse, or null). A key's `scope` is the NARROWEST layer allowed to set it: a key declared
 * at property scope is answered by the property layer, else by the global one; an article layer is ignored for it.
 * A layer that has no row or column for a key says nothing (`undefined`), so the next one answers; a row whose column is
 * NULL says `null`, and `null` is a value that wins. The default applies only when every layer said `undefined`, and it
 * is what the engine does with an absent column: the steps read the values as they read the property row before.
 *
 * PR A adapters read exactly today's columns, so every quote stays byte-identical: no component reads a property row,
 * this module does. `create(db, { extra })` adds components (`{ [id]: { settingsSchema, read: { [layer]: (db, scope) =>
 * partial { key: value } | undefined } } }`): the article families register theirs that way.
 *
 * `articles` — `scope.articleRef` is `{ kind: 'option' | 'resource', id }`. Article layer: the lodging's override row
 * (`property_option_prices` price / freeUnits; `property_resource_prices` price / freeMinutes, a NULL column being no
 * override); global layer: the catalogue row (`options.price`, `resources.price`); property layer: `maxGuests`.
 */
const { settingsSchema: nightsSchema, parseJsonArray } = require('../../utils/pricing/nights');
const { settingsSchema: extraGuestsSchema } = require('../../utils/pricing/extraGuests');
const { settingsSchema: touristTaxSchema } = require('../../utils/pricing/touristTax');
const { settingsSchema: stayClockSchema } = require('../../utils/pricing/stayClock');
const { settingsSchema: scheduleSchema } = require('../../utils/pricing/schedule');
const { settingsSchema: platformPriceSchema } = require('../../utils/pricing/platformPrice');
const { settingsSchema: vatSchema } = require('../../utils/pricing/vat');
const { platformCollectsTouristTax, touristTaxRemittedByOwner } = require('../../utils/pricing/touristTax');

const LAYERS = ['article', 'property', 'global'];
const WIDTH = { global: 0, property: 1, article: 2 };

const nonNegative = (value) => (Number.isFinite(Number(value)) && Number(value) >= 0 ? null : 'Un nombre positif ou nul est attendu.');

// The settings of the article families' component: the price and free units an article is sold at, and the lodging's
// capacity. Defaults are what the catalogue does with an absent row (free units 0, no capacity ceiling).
const articlesSchema = [
  { key: 'price', type: 'number', default: 0, scope: 'article', validate: nonNegative },
  { key: 'freeUnits', type: 'number', default: 0, scope: 'article', validate: nonNegative },
  { key: 'freeMinutes', type: 'number', default: 0, scope: 'article', validate: nonNegative },
  {
    key: 'maxGuests', type: 'number', default: null, scope: 'property',
    validate: (value) => (value === null || nonNegative(value) === null ? null : 'Un nombre positif ou nul est attendu.'),
  },
];

// A statement is prepared once per database handle, on its first use, then reused: a quote reads the same few statements per
// article. A statement that fails to prepare (a table or column the schema lacks) is not kept, so it is retried as before.
const STATEMENTS = new WeakMap();
function prepared(db, sql) {
  let byHandle = STATEMENTS.get(db);
  if (!byHandle) { byHandle = new Map(); STATEMENTS.set(db, byHandle); }
  let statement = byHandle.get(sql);
  if (!statement) { statement = db.prepare(sql); byHandle.set(sql, statement); }
  return statement;
}

// A schema without the table or the column is a schema without the setting: the layer says nothing.
function rowOrUndefined(db, sql, ...params) {
  try { return prepared(db, sql).get(...params); } catch { return undefined; }
}

function propertyRow(db, propertyId) {
  const id = Number(propertyId);
  if (!(id > 0)) return null;
  return prepared(db, 'SELECT * FROM properties WHERE id = ?').get(id) || null;
}

const ADAPTERS = {
  nights: {
    property(db, scope) {
      const id = Number(scope.propertyId);
      if (!(id > 0)) return undefined;
      return { tariff: { rules: prepared(db, 'SELECT * FROM pricing_rules WHERE propertyId = ? ORDER BY startDate').all(id) } };
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
        const { resolveGlobalPlatformTaxRow } = require('../pricingInputModel');
        const row = resolveGlobalPlatformTaxRow(db, scope.platform);
        values.collector = {
          chargedByPlatform: platformCollectsTouristTax(scope.platform, row),
          remittedByOwner: touristTaxRemittedByOwner(scope.platform, row),
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
  // No layer supplies a rate in PR A: the regime's rate answers (`rate.resources.external` arrives with PR B).
  vat: {},
  platformPrice: {
    global(db, scope) {
      if (!scope.platform) return undefined;
      const row = rowOrUndefined(db, 'SELECT commissionPercent FROM platforms WHERE name = ?', String(scope.platform));
      return row ? { commissionRate: row.commissionPercent } : undefined;
    },
  },
  articles: {
    article(db, scope) {
      const ref = scope.articleRef;
      const propertyId = Number(scope.propertyId);
      if (!ref || !(propertyId > 0)) return undefined;
      if (ref.kind === 'option') {
        const row = rowOrUndefined(db, 'SELECT price, freeUnits FROM property_option_prices WHERE optionId = ? AND propertyId = ?', ref.id, propertyId)
          || rowOrUndefined(db, 'SELECT price FROM property_option_prices WHERE optionId = ? AND propertyId = ?', ref.id, propertyId);
        return row ? { price: row.price, freeUnits: row.freeUnits } : undefined;
      }
      if (ref.kind === 'resource') {
        const row = rowOrUndefined(db, 'SELECT price, freeMinutes FROM property_resource_prices WHERE resourceId = ? AND propertyId = ?', ref.id, propertyId);
        if (!row) return undefined;
        const values = {};
        if (row.price != null) values.price = row.price;
        if (row.freeMinutes != null) values.freeMinutes = row.freeMinutes;
        return values;
      }
      return undefined;
    },
    property(db, scope) {
      const id = Number(scope.propertyId);
      const row = id > 0 ? rowOrUndefined(db, 'SELECT maxGuests FROM properties WHERE id = ?', id) : undefined;
      return row ? { maxGuests: row.maxGuests } : undefined;
    },
    global(db, scope) {
      const ref = scope.articleRef;
      const table = ref && ref.kind === 'option' ? 'options' : ref && ref.kind === 'resource' ? 'resources' : null;
      if (!table) return undefined;
      const row = rowOrUndefined(db, `SELECT price FROM ${table} WHERE id = ?`, ref.id);
      return row ? { price: row.price } : undefined;
    },
  },
};

const SCHEMAS = {
  nights: nightsSchema,
  extraGuests: extraGuestsSchema,
  touristTax: touristTaxSchema,
  stayClock: stayClockSchema,
  schedule: scheduleSchema,
  vat: vatSchema,
  platformPrice: platformPriceSchema,
  articles: articlesSchema,
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
        if (WIDTH[layer] > WIDTH[entry.scope]) continue;
        const value = layers[layer] ? layers[layer][entry.key] : undefined;
        if (value !== undefined) out[entry.key] = value;
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

module.exports = { create, prepared, SCHEMAS };
