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
    // specs/recall-unpaid-arrival-complement-at-checkout.md — the arrival complement (amount + paid +
    // itemised detail) so the departure SAS can recall it when it was never settled.
    arrivalComplement: reservationsModel.buildArrivalComplementDetail(reservation.id),
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
    cautionReceived, complementItems = [],
    breakfastTime, breakfastCoffee, breakfastTea, breakfastChocolate, breakfastNote,
    departureHandoverNote, extinguisherSealOkAtArrival,
    complementSettled, complementPaidCash,
  } = req.body || {};
  const complementAmount = reservationsModel.commitArrivalSas(Number(req.params.id), {
    // Tri-state: undefined (caution step not shown) leaves the marker untouched; the model sets or
    // clears it on a concrete boolean (specs/reopen-completed-sas.md §6).
    cautionReceived: cautionReceived === undefined ? undefined : Boolean(cautionReceived),
    complementItems: Array.isArray(complementItems) ? complementItems : [],
    breakfastTime,
    breakfastCoffee,
    breakfastTea,
    breakfastChocolate,
    breakfastNote,
    departureHandoverNote,
    extinguisherSealOkAtArrival,
    // specs/recall-unpaid-arrival-complement-at-checkout.md — explicit « Complément encaissé » confirmation.
    complementSettled: complementSettled === undefined ? undefined : Boolean(complementSettled),
    complementPaidCash: Boolean(complementPaidCash),
  });
  return res.json({ ok: true, complementAmount });
}

function commitDeparture(req, res) {
  const reservation = reservationsModel.getByIdWithDetails(req.params.id);
  if (!reservation) return res.status(404).json({ error: 'RESERVATION_NOT_FOUND' });
  const { cautionReturned, endOfStayComplementDetail = null, extinguisherSealOkAtDeparture, extinguisherCharges, complementsSettled, complementsPaidCash } = req.body || {};
  reservationsModel.commitDepartureSas(Number(req.params.id), {
    // Tri-state, same contract as the arrival caution (specs/reopen-completed-sas.md §6).
    cautionReturned: cautionReturned === undefined ? undefined : Boolean(cautionReturned),
    // The end-of-stay amount is recomputed server-side from the detail + the extinguisher charges, so
    // no client-supplied total is trusted (specs/extinguisher-seal-and-repair-amounts.md §3.2).
    endOfStayComplementDetail,
    extinguisherSealOkAtDeparture,
    extinguisherCharges: Array.isArray(extinguisherCharges) ? extinguisherCharges : undefined,
    // specs/recall-unpaid-arrival-complement-at-checkout.md — « Compléments encaissés » → mark paid every
    // positive complement (end-of-stay + recalled arrival) at the checkout moment.
    complementsSettled: complementsSettled === undefined ? undefined : Boolean(complementsSettled),
    complementsPaidCash: Boolean(complementsPaidCash),
  });
  return res.json({ ok: true });
}

module.exports = { getSas, commitArrival, commitDeparture };
