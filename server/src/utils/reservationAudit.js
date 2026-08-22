/**
 * Pure audit/history helpers for reservations (no DB access).
 *
 * Snapshots are field maps compared by `computeAuditChanges` to produce a human-labeled diff stored in
 * `reservation_history`. The DB-side snapshot (current row) is built by the model using the signature
 * helpers exported here.
 *
 * Read side: `buildHistoryRows` turns that stored diff into ready-to-print rows for the fiche's
 * « Historique des modifications » — ids resolved to names, values in French (€, JJ/MM/AAAA, Oui/Non),
 * options/resources expanded line by line, engine recalculations split apart.
 * See specs/reservation-history-granular-diff.md.
 */

const { sentenceCase } = require('./textFormatters');

const HISTORY_FIELD_LABELS = {
  propertyId: 'Logement',
  clientId: 'Client',
  startDate: 'Date arrivée',
  endDate: 'Date départ',
  adults: 'Adultes',
  children: 'Enfants',
  teens: 'Ados',
  babies: 'Bébés',
  singleBeds: 'Lits simples',
  doubleBeds: 'Lits doubles',
  babyBeds: 'Lits bébé',
  checkInTime: 'Heure arrivée',
  checkOutTime: 'Heure départ',
  platform: 'Plateforme',
  totalPrice: 'Prix hébergement',
  customPrice: 'Prix personnalisé',
  touristTaxRate: 'Taux taxe de séjour',
  touristTaxTotal: 'Taxe de séjour',
  discountPercent: 'Réduction (%)',
  finalPrice: 'Prix final',
  depositAmount: 'Acompte',
  depositDueDate: 'Date acompte',
  balanceAmount: 'Solde',
  balanceDueDate: 'Date solde',
  notes: 'Notes',
  cautionAmount: 'Caution',
  cautionReceived: 'Caution reçue',
  cautionReceivedDate: 'Date réception caution',
  cautionReturned: 'Caution restituée',
  cautionReturnedDate: 'Date restitution caution',
  extraGuestSurchargeOffered: 'Surcoût voyageurs offert',
  depositDisabled: 'Acompte désactivé',
  touristTaxInComplement: 'Taxe en complément',
  // specs/adjustable-complement-amounts.md §3.1 rule 11 — an adjusted complement is money moved by
  // hand: it has to be re-readable in the history like any other field edit.
  complementAmountOverride: "Complément d'arrivée ajusté",
  endOfStayComplementAmountOverride: 'Complément de fin de séjour ajusté',
  optionsSignature: 'Options',
  resourcesSignature: 'Ressources',
};

function normalizeHistoryValue(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'number') return Math.round(value * 100) / 100;
  return value;
}

function getOptionsSignature(lines) {
  return (lines || [])
    .map((line) => ({
      optionId: Number(line.optionId),
      quantity: Number(line.quantity || 0),
      totalPrice: Number(line.totalPrice || 0),
      inComplement: Number(line.inComplement || 0),
    }))
    .sort((a, b) => a.optionId - b.optionId)
    .map((line) => `${line.optionId}:${line.quantity}:${line.totalPrice.toFixed(2)}:c${line.inComplement}`)
    .join('|');
}

function getResourcesSignature(lines) {
  return (lines || [])
    .map((line) => ({
      resourceId: Number(line.resourceId),
      quantity: Number(line.quantity || 0),
      totalPrice: Number(line.totalPrice || 0),
      offered: Number(line.offered || 0),
      inComplement: Number(line.inComplement || 0),
    }))
    .sort((a, b) => a.resourceId - b.resourceId)
    .map((line) => `${line.resourceId}:${line.quantity}:${line.totalPrice.toFixed(2)}:${line.offered}:c${line.inComplement}`)
    .join('|');
}

function buildAuditSnapshotFromPayload(payload, quote) {
  return {
    propertyId: Number(payload.propertyId),
    clientId: Number(payload.clientId),
    startDate: payload.startDate || null,
    endDate: payload.endDate || null,
    adults: Number(payload.adults || 0),
    children: Number(payload.children || 0),
    teens: Number(payload.teens || 0),
    babies: Number(payload.babies || 0),
    singleBeds: payload.singleBeds === null || payload.singleBeds === undefined || payload.singleBeds === '' ? null : Number(payload.singleBeds),
    doubleBeds: payload.doubleBeds === null || payload.doubleBeds === undefined || payload.doubleBeds === '' ? null : Number(payload.doubleBeds),
    babyBeds: payload.babyBeds === null || payload.babyBeds === undefined || payload.babyBeds === '' ? null : Number(payload.babyBeds),
    checkInTime: payload.checkInTime || null,
    checkOutTime: payload.checkOutTime || null,
    platform: payload.platform || null,
    totalPrice: quote.totalPrice == null ? null : Number(quote.totalPrice),
    customPrice: payload.customPrice === undefined || payload.customPrice === null || payload.customPrice === '' ? null : Number(payload.customPrice),
    touristTaxRate: Number(quote.touristTaxRate || 0),
    touristTaxTotal: Number(quote.touristTaxTotal || 0),
    discountPercent: Number(payload.discountPercent || 0),
    finalPrice: quote.finalPrice == null ? null : Number(quote.finalPrice),
    depositAmount: Number(quote.depositAmount || 0),
    depositDueDate: quote.depositDueDate || payload.depositDueDate || null,
    balanceAmount: Number(quote.balanceAmount || 0),
    balanceDueDate: quote.balanceDueDate || payload.balanceDueDate || null,
    notes: sentenceCase(payload.notes) || null,
    cautionAmount: Number(payload.cautionAmount || 0),
    cautionReceived: payload.cautionReceived ? 1 : 0,
    cautionReceivedDate: payload.cautionReceivedDate || null,
    cautionReturned: payload.cautionReturned ? 1 : 0,
    cautionReturnedDate: payload.cautionReturnedDate || null,
    extraGuestSurchargeOffered: payload.extraGuestSurchargeOffered ? 1 : 0,
    // Per-reservation deposit opt-out (specs/disable-deposit-per-reservation.md). Tracked
    // here so a toggle change shows up in `reservation_history` like any other field edit.
    depositDisabled: payload.depositDisabled ? 1 : 0,
    // Per-item routing of the tourist tax to Complément (specs/force-item-to-complement.md).
    touristTaxInComplement: payload.touristTaxInComplement ? 1 : 0,
    // specs/adjustable-complement-amounts.md §3.1 rule 11 — NULL when the bucket is on automatic.
    complementAmountOverride: payload.complementAmountOverride === undefined || payload.complementAmountOverride === null || payload.complementAmountOverride === ''
      ? null : Number(payload.complementAmountOverride),
    endOfStayComplementAmountOverride: payload.endOfStayComplementAmountOverride === undefined || payload.endOfStayComplementAmountOverride === null || payload.endOfStayComplementAmountOverride === ''
      ? null : Number(payload.endOfStayComplementAmountOverride),
    optionsSignature: getOptionsSignature((quote.optionLines || []).map((line, idx) => ({
      optionId: line.optionId != null ? Number(line.optionId) : (2000000 + idx),
      quantity: Number(line.quantity || 1),
      totalPrice: Number(line.totalPrice || 0),
      inComplement: Number(line.inComplement || 0),
    }))),
    resourcesSignature: getResourcesSignature(quote.resourceLines || []),
  };
}

function formatHistoryMoney(amount) {
  const value = Math.round(Number(amount || 0) * 100) / 100;
  const text = Number.isInteger(value) ? String(value) : value.toFixed(2).replace('.', ',');
  return `${text} €`;
}

function optionDisplayName(optionId, optionNames = {}) {
  const id = Number(optionId);
  // Custom options are recorded in the signature under synthetic ids (≥ 1_000_000) and carry no name.
  if (id >= 1000000) return 'Option personnalisée';
  return optionNames[id] || `Option #${id}`;
}

function resourceDisplayName(resourceId, resourceNames = {}) {
  const id = Number(resourceId);
  return resourceNames[id] || `Ressource #${id}`;
}

// How a stored primitive value is turned into French display text. Anything unlisted prints raw.
const HISTORY_FIELD_FORMATS = {
  propertyId: 'property',
  clientId: 'client',
  startDate: 'date',
  endDate: 'date',
  depositDueDate: 'date',
  balanceDueDate: 'date',
  cautionReceivedDate: 'date',
  cautionReturnedDate: 'date',
  totalPrice: 'money',
  customPrice: 'money',
  touristTaxRate: 'money',
  touristTaxTotal: 'money',
  finalPrice: 'money',
  depositAmount: 'money',
  balanceAmount: 'money',
  cautionAmount: 'money',
  discountPercent: 'percent',
  cautionReceived: 'boolean',
  cautionReturned: 'boolean',
  extraGuestSurchargeOffered: 'boolean',
  depositDisabled: 'boolean',
  touristTaxInComplement: 'boolean',
  complementAmountOverride: 'money',
  endOfStayComplementAmountOverride: 'money',
};

// Fields the pricing engine recomputes on its own: they move on almost every edit and would bury the
// change the user actually made, so the UI renders them in a separate « Recalculs » block.
const DERIVED_HISTORY_FIELDS = new Set([
  'totalPrice', 'touristTaxRate', 'touristTaxTotal', 'finalPrice', 'depositAmount', 'balanceAmount',
]);

const SIGNATURE_GROUPS = {
  optionsSignature: 'Options',
  resourcesSignature: 'Ressources',
};

function formatHistoryNumber(value) {
  const rounded = Math.round(Number(value || 0) * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace('.', ',');
}

function formatHistoryDateFr(value) {
  const raw = String(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : raw;
}

function clientDisplayName(clientId, clientNames = {}) {
  return clientNames[Number(clientId)] || `#${clientId}`;
}

function propertyDisplayName(propertyId, propertyNames = {}) {
  return propertyNames[Number(propertyId)] || `#${propertyId}`;
}

/**
 * French display text for one stored value. `null` reads « vide », except on boolean fields where the
 * absence of a flag genuinely means « Non ».
 */
function formatHistoryFieldValue(field, value, context = {}) {
  const format = HISTORY_FIELD_FORMATS[field];
  if (format === 'boolean') return Number(value) === 1 || value === true ? 'Oui' : 'Non';
  if (value === null || value === undefined || value === '') return 'vide';
  switch (format) {
    case 'money': return formatHistoryMoney(value);
    case 'percent': return `${formatHistoryNumber(value)} %`;
    case 'date': return formatHistoryDateFr(value);
    case 'property': return propertyDisplayName(value, context.propertyNames);
    case 'client': return clientDisplayName(value, context.clientNames);
    default: return String(value);
  }
}

/**
 * Explodes a compact signature into a map keyed by option/resource id. Segment layout:
 *   optionsSignature   → `id:qty:total:cN`
 *   resourcesSignature → `id:qty:total:offered:cN`
 */
function parseSignature(field, rawSignature) {
  const raw = rawSignature == null ? '' : String(rawSignature);
  if (raw === '') return new Map();
  const isResource = field === 'resourcesSignature';
  return new Map(raw.split('|').map((part) => {
    const seg = part.split(':');
    const id = Number(seg[0]);
    return [id, {
      id,
      quantity: Number(seg[1] || 0),
      total: Number(seg[2] || 0),
      offered: isResource ? String(seg[3] || '') === '1' : false,
      inComplement: String((isResource ? seg[4] : seg[3]) || '') === 'c1',
    }];
  }));
}

// « ×3 : 22,50 € (offert, compl.) » — the name lives in the row label, not here.
function formatSignatureLine(line) {
  const qtyText = line.quantity > 1 ? `×${line.quantity} : ` : '';
  const tags = [line.offered ? 'offert' : null, line.inComplement ? 'compl.' : null].filter(Boolean);
  const tagText = tags.length ? ` (${tags.join(', ')})` : '';
  return `${qtyText}${formatHistoryMoney(line.total)}${tagText}`;
}

function sameSignatureLine(a, b) {
  return a.quantity === b.quantity && a.total === b.total
    && a.offered === b.offered && a.inComplement === b.inComplement;
}

/**
 * One row per option/resource that was added, removed or altered — lines identical on both sides are
 * dropped, so the reader never has to diff two full lists by eye.
 */
function diffSignatureChange(change, context = {}) {
  const { field } = change;
  const before = parseSignature(field, change.from);
  const after = parseSignature(field, change.to);
  const isResource = field === 'resourcesSignature';
  const ids = [...new Set([...before.keys(), ...after.keys()])].sort((a, b) => a - b);
  const rows = [];
  ids.forEach((id) => {
    const from = before.get(id);
    const to = after.get(id);
    if (from && to && sameSignatureLine(from, to)) return;
    rows.push({
      field,
      group: SIGNATURE_GROUPS[field] || change.label,
      label: isResource
        ? resourceDisplayName(id, context.resourceNames)
        : optionDisplayName(id, context.optionNames),
      kind: !from ? 'added' : (!to ? 'removed' : 'changed'),
      fromText: from ? formatSignatureLine(from) : null,
      toText: to ? formatSignatureLine(to) : null,
    });
  });
  return rows;
}

function expandHistoryChange(change, context) {
  // The SAS commits and the iCal lock line already ship rendered French text — never re-format them.
  if (change.fromText !== undefined || change.toText !== undefined) {
    return [{
      field: change.field,
      group: null,
      label: change.label,
      kind: 'changed',
      fromText: change.fromText ?? null,
      toText: change.toText ?? null,
    }];
  }
  if (SIGNATURE_GROUPS[change.field]) return diffSignatureChange(change, context);
  return [{
    field: change.field,
    group: null,
    label: change.label,
    kind: 'changed',
    fromText: formatHistoryFieldValue(change.field, change.from, context),
    toText: formatHistoryFieldValue(change.field, change.to, context),
  }];
}

/**
 * Stored diff → `{ changes, derived }`, both arrays of ready-to-print rows
 * `{ field, group, label, kind, fromText, toText }`. An entry made only of engine recalculations
 * keeps them in `changes` so it never renders as an empty « Recalculs » block.
 */
function buildHistoryRows(changes, context = {}) {
  const main = [];
  const derived = [];
  (Array.isArray(changes) ? changes : []).forEach((change) => {
    if (!change || !change.field) return;
    expandHistoryChange(change, context).forEach((row) => {
      (DERIVED_HISTORY_FIELDS.has(row.field) ? derived : main).push(row);
    });
  });
  return main.length === 0 ? { changes: derived, derived: [] } : { changes: main, derived };
}

function computeAuditChanges(beforeSnapshot, afterSnapshot) {
  const keys = Object.keys(HISTORY_FIELD_LABELS);
  const changes = [];
  keys.forEach((key) => {
    const beforeValue = normalizeHistoryValue(beforeSnapshot?.[key]);
    const afterValue = normalizeHistoryValue(afterSnapshot?.[key]);
    if (JSON.stringify(beforeValue) !== JSON.stringify(afterValue)) {
      changes.push({
        field: key,
        label: HISTORY_FIELD_LABELS[key] || key,
        from: beforeValue,
        to: afterValue,
      });
    }
  });
  return changes;
}

module.exports = {
  HISTORY_FIELD_LABELS,
  DERIVED_HISTORY_FIELDS,
  normalizeHistoryValue,
  getOptionsSignature,
  getResourcesSignature,
  buildAuditSnapshotFromPayload,
  computeAuditChanges,
  formatHistoryMoney,
  formatHistoryFieldValue,
  buildHistoryRows,
};
