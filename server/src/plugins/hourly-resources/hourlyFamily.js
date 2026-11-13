/**
 * The `hourly` article family — the hourly contributor wrapped (specs/pricing-components.md §3 rules 5, 47).
 *
 * The family is registered next to the contributor (`ctx.priceLineContributor` stays as the alias the engine reads
 * until PR C): `price` asks the contributor, line by line, and returns what the core families return — `quantity`,
 * `unitPrice`, `billedUnits`, `components`, `allowanceUsed`, tagged amounts (never VAT) — plus the contributor's `extra`
 * (sessions, scheduled hours, detail) and the contributor's `totalPrice`. An answer without amounts is a plain quantity of
 * hours: the head bills it at the lodging's rate after the free minutes. No answer (`null`) is no contribution: the head
 * prices the line as if the plugin were not there, and it guards the call itself (a throw, a malformed answer).
 *
 * `config.resource` is the catalogue row of the resource (makeArticle, kind 'resource'); `request` carries
 * `{ quantity, selected, sold, startDate, endDate }`, `ctx` the stay's `{ nights, persons }`.
 */
const NBSP = ' ';
const euros = (value) => `${(Math.round((Number(value) || 0) * 100) / 100).toFixed(2).replace('.', ',')}${NBSP}€`;
const toCents = (value) => Math.round((Number(value) || 0) * 100);
const nonNegative = (value) => (Number.isFinite(Number(value)) && Number(value) >= 0 ? null : 'Un nombre positif ou nul est attendu.');

function createHourlyFamily(contributor) {
  const configSchema = [
    { key: 'price', type: 'number', default: 0, scope: 'article', validate: nonNegative },
    { key: 'label', type: 'string', default: '', scope: 'article', validate: (value) => (typeof value === 'string' ? null : 'Un texte est attendu.') },
    { key: 'vatClass', type: 'string', default: 'resources', scope: 'article', validate: (value) => (typeof value === 'string' && value ? null : 'Une classe de TVA est attendue.') },
    { key: 'priceType', type: 'string', default: 'per_hour', scope: 'article', validate: (value) => (value === 'per_hour' ? null : 'Seul le type « à l’heure » est servi.') },
    { key: 'freeMinutes', type: 'number', default: 0, scope: 'article', validate: nonNegative },
  ];

  const validate = (config, request) => {
    const quantity = Number(request && request.quantity);
    return Number.isFinite(quantity) && quantity >= 0 ? [] : [{ code: 'INVALID_QUANTITY', message: 'La quantité doit être un nombre positif ou nul.' }];
  };

  function price(config, request, ctx) {
    const answer = contributor.priceLine({
      resource: config.resource,
      selected: request.selected || { quantity: request.quantity, sessions: request.sessions },
      sold: Boolean(request.sold),
      startDate: request.startDate,
      endDate: request.endDate,
      nights: ctx && ctx.nights,
      persons: ctx && ctx.persons,
    });
    if (!answer) return null;
    const unitPrice = Number(config.price || 0);
    if (answer.totalPrice === undefined) {
      return {
        quantity: answer.quantity, unitPrice, billedUnits: answer.quantity, components: [], allowanceUsed: 0, amounts: [], extra: answer.extra || {},
      };
    }
    return {
      quantity: answer.quantity,
      unitPrice: answer.unitPrice,
      billedUnits: answer.billedUnits,
      totalPrice: answer.totalPrice,
      components: [{ kind: 'base', hours: answer.billedUnits, unitPrice: answer.unitPrice }],
      allowanceUsed: Math.max(0, Math.round((answer.quantity - answer.billedUnits) * 60)),
      amounts: [{
        amountCents: toCents(answer.totalPrice), vatClass: config.vatClass, customerContext: 'hosted', source: { kind: 'line', ref: request.ref }, docKey: request.ref,
      }],
      extra: answer.extra || {},
    };
  }

  function describe(config, line) {
    const hours = Number(line && line.billedUnits != null ? line.billedUnits : (line && line.quantity) || 0);
    const parts = [`${String(hours).replace('.', ',')} h × ${euros(line && line.unitPrice)}`];
    if (line && line.detail) parts.push(line.detail);
    return { label: config.label, detail: parts.join(' · ') };
  }

  return {
    id: 'hourly', configSchema, validate, price, describe,
  };
}

module.exports = { createHourlyFamily };
