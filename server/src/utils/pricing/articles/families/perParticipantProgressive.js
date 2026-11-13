/**
 * Article family `perParticipantProgressive` — a unit price that changes with the participant's rank: the second
 * participant pays the tier of rank 2 (specs/pricing-components.md §3 rule 47).
 *
 * Contract: `{ id, configSchema, validate, price, describe }`. `config.progressiveTiers` is the stored tier list
 * (JSON text or array); `price` returns the computed total of `quantity` participants in `components`, the average unit
 * price and the last tier reached. The head keeps a sold line's snapshot. Tagged amounts, never VAT.
 * Price type served: per_participant_progressive.
 *
 * Pure: no DB, no clock, no settings.
 */
const { roundMoney } = require('../../money');
const { parseJsonArray } = require('../../nights');
const kit = require('../familyKit');

function normalizeOptionProgressiveTiers(rawTiers) {
  const parsed = parseJsonArray(rawTiers);
  const byParticipant = new Map();

  parsed.forEach((entry) => {
    const participantNumber = Math.max(1, Math.floor(Number(entry?.participantNumber || 0)));
    const unitPrice = Math.max(0, Number(entry?.unitPrice || 0));
    if (!Number.isFinite(participantNumber) || !Number.isFinite(unitPrice)) return;
    byParticipant.set(participantNumber, {
      participantNumber,
      unitPrice: roundMoney(unitPrice),
    });
  });

  return Array.from(byParticipant.values())
    .sort((a, b) => a.participantNumber - b.participantNumber);
}

function getProgressiveUnitPriceForParticipant(tiers, participantNumber, fallbackUnitPrice = 0) {
  const target = Math.max(1, Math.floor(Number(participantNumber || 0)));
  const normalizedFallback = Math.max(0, Number(fallbackUnitPrice || 0));
  const normalizedTiers = Array.isArray(tiers) ? tiers : [];

  let resolved = normalizedFallback;
  for (const tier of normalizedTiers) {
    if (Number(tier.participantNumber) > target) break;
    resolved = Math.max(0, Number(tier.unitPrice || 0));
  }

  return roundMoney(resolved);
}

function calculateProgressiveParticipantOptionTotal(quantity, tiers, fallbackUnitPrice = 0) {
  const billedUnits = Math.max(0, Math.floor(Number(quantity || 0)));
  if (billedUnits <= 0) {
    return {
      billedUnits: 0,
      totalPrice: 0,
      averageUnitPrice: 0,
      lastUnitPrice: roundMoney(Math.max(0, Number(fallbackUnitPrice || 0))),
    };
  }

  let total = 0;
  let lastUnitPrice = roundMoney(Math.max(0, Number(fallbackUnitPrice || 0)));
  for (let index = 1; index <= billedUnits; index += 1) {
    lastUnitPrice = getProgressiveUnitPriceForParticipant(tiers, index, fallbackUnitPrice);
    total += lastUnitPrice;
  }

  const totalPrice = roundMoney(total);
  return {
    billedUnits,
    totalPrice,
    averageUnitPrice: billedUnits > 0 ? roundMoney(totalPrice / billedUnits) : 0,
    lastUnitPrice,
  };
}

const PRICE_TYPES = ['per_participant_progressive'];
const configSchema = [
  ...kit.configSchemaFor(PRICE_TYPES),
  { key: 'progressiveTiers', type: 'array', default: [], scope: 'article', validate: (value) => (Array.isArray(value) || typeof value === 'string' || value == null ? null : 'Une liste de paliers est attendue.') },
];

const validate = (config, request, ctx) => kit.refusalsOf(request, ctx);

function price(config, request) {
  const fallbackUnitPrice = Number(config.price || 0);
  const tiers = normalizeOptionProgressiveTiers(config.progressiveTiers);
  const computed = calculateProgressiveParticipantOptionTotal(request.quantity, tiers, fallbackUnitPrice);
  return {
    quantity: request.quantity,
    unitPrice: computed.billedUnits > 0 ? computed.averageUnitPrice : 0,
    billedUnits: computed.billedUnits,
    typed: null,
    tiers,
    computed,
    components: [{ kind: 'base', units: computed.billedUnits, unitPrice: computed.averageUnitPrice, lastUnitPrice: computed.lastUnitPrice }],
    allowanceUsed: 0,
    amounts: [kit.taggedAmount({ totalPrice: computed.totalPrice, vatClass: config.vatClass, ref: request.ref })],
  };
}

function describe(config, line) {
  const base = kit.describeLine(config, line);
  return { label: base.label, detail: `${base.detail} (tarif dégressif)` };
}

const family = {
  id: 'perParticipantProgressive', priceTypes: PRICE_TYPES, configSchema, validate, price, describe,
};

module.exports = {
  family, PRICE_TYPES, normalizeOptionProgressiveTiers, getProgressiveUnitPriceForParticipant, calculateProgressiveParticipantOptionTotal,
};
