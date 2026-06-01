/**
 * Pure audit/history helpers for reservations (no DB access).
 *
 * Snapshots are field maps compared by `computeAuditChanges` to produce a human-labeled diff stored in
 * `reservation_history`. The DB-side snapshot (current row) is built by the model using the signature
 * helpers exported here.
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
    }))
    .sort((a, b) => a.optionId - b.optionId)
    .map((line) => `${line.optionId}:${line.quantity}:${line.totalPrice.toFixed(2)}`)
    .join('|');
}

function getResourcesSignature(lines) {
  return (lines || [])
    .map((line) => ({
      resourceId: Number(line.resourceId),
      quantity: Number(line.quantity || 0),
      totalPrice: Number(line.totalPrice || 0),
      offered: Number(line.offered || 0),
    }))
    .sort((a, b) => a.resourceId - b.resourceId)
    .map((line) => `${line.resourceId}:${line.quantity}:${line.totalPrice.toFixed(2)}:${line.offered}`)
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
    optionsSignature: getOptionsSignature((quote.optionLines || []).map((line, idx) => ({
      optionId: line.optionId != null ? Number(line.optionId) : (2000000 + idx),
      quantity: Number(line.quantity || 1),
      totalPrice: Number(line.totalPrice || 0),
    }))),
    resourcesSignature: getResourcesSignature(quote.resourceLines || []),
  };
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
  normalizeHistoryValue,
  getOptionsSignature,
  getResourcesSignature,
  buildAuditSnapshotFromPayload,
  computeAuditChanges,
};
