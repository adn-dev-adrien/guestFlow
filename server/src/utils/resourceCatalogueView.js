/**
 * The admin resource catalogue, shaped for the screen (specs/options-resources-ux.md rules 18-19).
 *
 * Pure. A plugin adds lines and a footer to a resource through `ctx.resourceCatalogueLines`; the core
 * knows nothing of the hourly resources beyond their price type.
 */

const { EURO_UNITS, euros, propertiesPhrase } = require('./catalogueFormat');
const { isBabyBedResource } = require('./babyBedResource');

const priceLabel = (resource, amount) => {
  if (resource.priceType === 'free') return 'Gratuit';
  return `${euros(amount)} ${EURO_UNITS[resource.priceType] || EURO_UNITS.per_stay}`;
};

function scopeLabel(resource, properties) {
  const ids = resource.propertyIds || [];
  if (ids.length === 0) return 'Tous';
  return propertiesPhrase(ids, properties).replace('tous les logements', 'Tous');
}

/** The properties that actually sell the resource: the legacy empty scope means all of them. */
function sellingProperties(resource, properties) {
  const ids = (resource.propertyIds || []).map(Number);
  return ids.length === 0 ? properties : properties.filter((p) => ids.includes(Number(p.id)));
}

function priceLines(resource, properties) {
  if (resource.priceType === 'free') return [{ label: 'Prix', value: 'Gratuit' }];
  const selling = sellingProperties(resource, properties);
  const overrides = resource.propertyPricing || {};
  const base = Number(resource.basePrice ?? resource.price ?? 0);
  const hasOverride = (p) => Boolean(overrides[String(p.id)]) && Number(overrides[String(p.id)].price) !== base;
  const overriding = selling.filter(hasOverride);
  const lines = [];
  if (overriding.length < selling.length || selling.length === 0) {
    lines.push({ label: 'Prix', value: priceLabel(resource, base) });
  }
  overriding.forEach((p) => {
    lines.push({ label: p.name, value: priceLabel(resource, overrides[String(p.id)].price) });
  });
  return lines;
}

/**
 * @param {object[]} resources    the model's shaped resources (basePrice, propertyPricing, propertyIds…)
 * @param {{id:number,name:string}[]} properties
 * @param {Array<(resource, context) => ({lines?: object[], footer?: string}|null)>} contributors
 */
function buildResourceItems(resources, properties, contributors = []) {
  return resources.map((resource) => {
    const hourly = resource.priceType === 'per_hour';
    const lines = [...priceLines(resource, properties), { label: 'Logements', value: scopeLabel(resource, properties) }];
    let footer = '';
    contributors.forEach((build) => {
      const extra = build(resource, { properties });
      if (!extra) return;
      lines.push(...(extra.lines || []));
      if (extra.footer) footer = extra.footer;
    });
    return {
      id: resource.id,
      name: resource.name || '',
      description: resource.note || resource.description || '',
      stock: { value: Number(resource.quantity || 0), label: hourly ? 'en service' : 'en stock' },
      lines,
      footer,
      deletable: !isBabyBedResource(resource),
    };
  });
}

module.exports = { buildResourceItems };
