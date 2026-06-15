/**
 * Arrival / departure SAS controller (specs/arrival-departure-sas.md §4.1).
 *
 * Assembles the data the SAS wizard needs (caution, options, bed-linen alert, cleaning
 * included? + property cleaning price, complements, priced linen items, portal code) and
 * commits the operator's decisions in a single call per SAS (no per-step writes).
 */

const db = require('../database');
const reservationsModel = require('../models/reservationsModel');
const linenItemsModel = require('../models/linenItemsModel');
const settingsModel = require('../models/settingsModel');
const breakfastModel = require('../models/breakfastModel');
const repairAmountsModel = require('../models/repairAmountsModel');

// Is bed linen / cleaning "included" for this reservation? = an option of that autoOptionType is on
// the reservation, OR the property has it as a default-offered option.
function propertyHasDefault(propertyId, autoOptionType) {
  try {
    return Boolean(db.prepare(`
      SELECT 1 FROM property_option_defaults d
      JOIN options o ON o.id = d.optionId
      WHERE d.propertyId = ? AND o.autoOptionType = ? AND d.offered = 1 LIMIT 1
    `).get(Number(propertyId), autoOptionType));
  } catch { return false; }
}

function getSas(req, res) {
  const reservation = reservationsModel.getByIdWithDetails(req.params.id);
  if (!reservation) return res.status(404).json({ error: 'RESERVATION_NOT_FOUND' });

  const options = reservation.options || [];
  const cleaningIncluded = options.some((o) => o.autoOptionType === 'cleaning')
    || propertyHasDefault(reservation.propertyId, 'cleaning');
  const cleaningPrice = reservationsModel.getCleaningPriceForProperty(reservation.propertyId);
  const settings = settingsModel.read();

  return res.json({
    reservation,
    portalCode: String(settings.portalCode || '').trim(),
    cleaning: { included: cleaningIncluded, price: cleaningPrice },
    linenItems: linenItemsModel.list(),
    // « Tarifs facturables » — repair prices (incl. the keyed extinguisher seal) for the SAS check.
    repairAmounts: repairAmountsModel.list(),
    // Breakfast page state (arrival SAS): applicable? + resolved person count + effective hour +
    // stored counts/note. `reservation.departureHandoverNote` rides along via `r.*`.
    breakfast: breakfastModel.getForReservation(reservation.id),
  });
}

function commitArrival(req, res) {
  const reservation = reservationsModel.getByIdWithDetails(req.params.id);
  if (!reservation) return res.status(404).json({ error: 'RESERVATION_NOT_FOUND' });
  const {
    cautionReceived = false, complementItems = [],
    breakfastTime, breakfastCoffee, breakfastTea, breakfastChocolate, breakfastNote,
    departureHandoverNote, extinguisherSealOkAtArrival,
  } = req.body || {};
  const complementAmount = reservationsModel.commitArrivalSas(Number(req.params.id), {
    cautionReceived: Boolean(cautionReceived),
    complementItems: Array.isArray(complementItems) ? complementItems : [],
    breakfastTime,
    breakfastCoffee,
    breakfastTea,
    breakfastChocolate,
    breakfastNote,
    departureHandoverNote,
    extinguisherSealOkAtArrival,
  });
  return res.json({ ok: true, complementAmount });
}

function commitDeparture(req, res) {
  const reservation = reservationsModel.getByIdWithDetails(req.params.id);
  if (!reservation) return res.status(404).json({ error: 'RESERVATION_NOT_FOUND' });
  const { cautionReturned = false, endOfStayComplementAmount = 0, endOfStayComplementDetail = null, extinguisherSealOkAtDeparture } = req.body || {};
  reservationsModel.commitDepartureSas(Number(req.params.id), {
    cautionReturned: Boolean(cautionReturned),
    endOfStayComplementAmount: Number(endOfStayComplementAmount) || 0,
    endOfStayComplementDetail,
    extinguisherSealOkAtDeparture,
  });
  return res.json({ ok: true });
}

module.exports = { getSas, commitArrival, commitDeparture };
