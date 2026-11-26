/**
 * Rule 2 of specs/platforms/platform-host-statement-and-commission-vat.md applied to an engine input: the fiche's option lines follow
 * « Options (relevé) ». The quote, the preview and the save call it before they price, so all three show and store the lines
 * the statement implies.
 */
const { calculateReservationQuote } = require('./pricing').__test;
const { getApplicableOptions } = require('../models/ports/catalogueProvider');
const { adjustOptionLines } = require('./platformOptionsAdjustment');
const { isNamedChannel } = require('./saleChannel');
const { platformDisplayName } = require('./attributionChannel');

const blank = (value) => value === '' || value == null || !Number.isFinite(Number(value));

// The posted arrays are kept (the caller holds the same references for what it writes); a missing one is created.
function swapIn(target, next) {
  if (!Array.isArray(target)) return next;
  target.splice(0, target.length, ...next);
  return target;
}

/**
 * @param {object} engineInput  `selectedOptions`, `customOptions`, `offeredOptionIds`, `platform`, `propertyId`… (mutated on success)
 * @param {number|string|null} optionsAmount  « Options (relevé) »
 * @returns {{ applied: boolean, notes: string[], refusal: null | { field: string, message: string } }}
 */
function settleStatementOptions(engineInput, optionsAmount) {
  const none = { applied: false, notes: [], refusal: null };
  if (blank(optionsAmount) || !isNamedChannel(engineInput.platform)) return none;
  const quote = calculateReservationQuote(engineInput);
  if (!quote || quote.error) return none;
  const lines = {
    options: engineInput.selectedOptions || [],
    customOptions: engineInput.customOptions || [],
    offeredOptionIds: engineInput.offeredOptionIds || [],
  };
  const result = adjustOptionLines({
    optionsAmount: Number(optionsAmount),
    quote,
    lines,
    catalogue: getApplicableOptions(engineInput.db, engineInput.propertyId),
    platformLabel: platformDisplayName(engineInput.platform),
    requote: (next) => calculateReservationQuote({
      ...engineInput, selectedOptions: next.options, customOptions: next.customOptions, offeredOptionIds: next.offeredOptionIds,
    }),
  });
  if (!result.ok) return { applied: false, notes: [], refusal: { field: result.field, message: result.message } };
  if (!result.changed) return none;
  engineInput.selectedOptions = swapIn(engineInput.selectedOptions, result.lines.options);
  engineInput.customOptions = swapIn(engineInput.customOptions, result.lines.customOptions);
  engineInput.offeredOptionIds = swapIn(engineInput.offeredOptionIds, result.lines.offeredOptionIds);
  return { applied: true, notes: result.notes, refusal: null };
}

const hasStatementOptions = (body) => !blank(body && body.platformOptionsAmount);

module.exports = { settleStatementOptions, hasStatementOptions };
