/**
 * CatalogueProvider — the lodging's catalogue as the pricing reads it (specs/pricing-components.md §3 rules 11, 48).
 *
 * Contract (plain functions over today's queries; `create(db)` binds them to a database):
 *   applicableOptions(propertyId)            the options sold at that lodging, each at its effective price and free units
 *   applicableResources(propertyId)          the resources of that lodging, each at its effective price and free minutes
 *   optionPriceOverride(optionId, propertyId) the lodging's own `property_option_prices` row `{ price }`, undefined when none
 *
 * The per-property override of an option exists once: in the SettingsProvider's `articles` adapter, which every price,
 * free unit and free minute here is read through. The resources query keeps its `property_resource_prices` join for the
 * shape of the rows it returns. The resource override read of the hourly-resources booking model (a plugin file) is a
 * different table and stays in the plugin.
 */
const settingsProvider = require('./settingsProvider');

function getApplicableOptions(db, propertyId) {
  const pid = Number(propertyId);
  const options = db.prepare('SELECT * FROM options ORDER BY title').all();
  const propStmt = db.prepare('SELECT propertyId FROM property_options WHERE optionId = ? ORDER BY propertyId');
  const provider = settingsProvider.create(db);
  return options
    .map((option) => {
      // Per-property price override (specs/per-property-option-prices.md): the effective unit price for
      // this property is the override row when present, else the option's base price. A schema without the
      // table keeps the base price. A row with price 0 is an explicit free.
      const settings = provider.for('articles', { propertyId: pid, articleRef: { kind: 'option', id: option.id } });
      return {
        ...option,
        price: Number(settings.price || 0),
        // specs/tariff-recipes/spec.md §3.9 rule 52bis — units included in the rate for this property.
        freeUnits: Math.max(0, Number(settings.freeUnits || 0)),
        propertyIds: propStmt.all(option.id).map((row) => Number(row.propertyId)),
      };
    })
    // specs/option-property-scope.md §3.3: an option is applicable ONLY to the properties it's explicitly
    // linked to. No link = available nowhere (the legacy « empty = all » rule is removed).
    .filter((option) => option.propertyIds.includes(pid));
}

function getApplicableResources(db, propertyId) {
  let resources;
  try {
    resources = db.prepare(`
      SELECT r.*, prp.price as propertyPrice, prp.freeMinutes as propertyFreeMinutes
      FROM resources r
      LEFT JOIN property_resource_prices prp ON prp.resourceId = r.id AND prp.propertyId = ?
      ORDER BY r.name
    `).all(Number(propertyId));
  } catch (error) {
    if (!String(error?.message || '').toLowerCase().includes('no such table: property_resource_prices')) {
      throw error;
    }
    resources = db.prepare('SELECT * FROM resources ORDER BY name').all();
  }
  // Applicability from the resource_properties pivot (a resource with no rows = global / all logements).
  let scopedByResource = null; // Map<resourceId, Set<propertyId>>
  try {
    scopedByResource = new Map();
    for (const row of db.prepare('SELECT resourceId, propertyId FROM resource_properties').all()) {
      if (!scopedByResource.has(row.resourceId)) scopedByResource.set(row.resourceId, new Set());
      scopedByResource.get(row.resourceId).add(Number(row.propertyId));
    }
  } catch {
    scopedByResource = null; // pivot absent (minimal test schema) → treat all as global
  }

  const provider = settingsProvider.create(db);
  return resources
    .map((resource) => {
      const settings = provider.for('articles', { propertyId: Number(propertyId), articleRef: { kind: 'resource', id: resource.id } });
      return {
        ...resource,
        price: Number(settings.price || 0),
        freeMinutes: Math.max(0, Number(settings.freeMinutes || 0)),
      };
    })
    .filter((resource) => {
      if (!scopedByResource) return true;
      const scoped = scopedByResource.get(resource.id);
      return !scoped || scoped.size === 0 || scoped.has(Number(propertyId));
    });
}

function optionPriceOverride(db, optionId, propertyId) {
  let override;
  try {
    override = db.prepare('SELECT price FROM property_option_prices WHERE optionId = ? AND propertyId = ?')
      .get(optionId, Number(propertyId));
  } catch { override = undefined; }
  return override;
}

function create(db) {
  return {
    applicableOptions: (propertyId) => getApplicableOptions(db, propertyId),
    applicableResources: (propertyId) => getApplicableResources(db, propertyId),
    optionPriceOverride: (optionId, propertyId) => optionPriceOverride(db, optionId, propertyId),
  };
}

module.exports = { create, getApplicableOptions, getApplicableResources, optionPriceOverride };
