/**
 * Arrival / departure SAS controller (specs/arrival-departure-sas.md §4.1).
 *
 * Assembles the data the SAS wizard needs (caution, options, bed-linen alert, cleaning
 * included? + property cleaning price, complements, priced linen items, portal code) and
 * commits the operator's decisions in a single call per SAS (no per-step writes).
 */

const reservationsModel = require('../models/reservationsModel');
const linenItemsModel = require('../models/linenItemsModel');
const settingsModel = require('../models/settingsModel');
const breakfastModel = require('../models/breakfastModel');
const repairAmountsModel = require('../models/repairAmountsModel');

function getSas(req, res) {
  const reservation = reservationsModel.getByIdWithDetails(req.params.id);
  if (!reservation) return res.status(404).json({ error: 'RESERVATION_NOT_FOUND' });

  // Cleaning is "included" when the reservation already carries it: a booked option (by
  // `autoOptionType='cleaning'` tag OR by name « ménage » — same rule as the J-1 email, see
  // utils/cleaningOption.js), a « Ménage » line added by the arrival SAS, or a property default.
  // Single source of truth shared with the departure billing guard
  // (specs/defer-arrival-complement-to-checkout.md §3.1 rule 1): BOTH SAS ends then hide their
  // ménage page — the guest is never asked about a cleaning the host was paid to do.
  const cleaningIncluded = reservationsModel.isCleaningSoldForReservation(reservation.id);
  const cleaningPrice = reservationsModel.getCleaningPriceForProperty(reservation.propertyId);
  const settings = settingsModel.read();

  return res.json({
    reservation,
    portalCode: String(settings.portalCode || '').trim(),
    cleaning: { included: cleaningIncluded, price: cleaningPrice },
    // specs/sas-bath-linen-upsell.md §3.1 — bath-linen upsell (per-person price, mirrors the engine).
    bathLinen: reservationsModel.getBathLinenOfferForReservation(reservation),
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
    breakfastTime, breakfastCoffee, breakfastTea, breakfastChocolate, breakfastMilk,
    breakfastPastries, breakfastCereals, breakfastBread, breakfastNote,
    departureHandoverNote, extinguisherSealOkAtArrival,
    complementSettled, complementPaidCash,
    endOfStayBathLinen,
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
    breakfastMilk,
    breakfastPastries,
    breakfastCereals,
    breakfastBread,
    breakfastNote,
    departureHandoverNote,
    extinguisherSealOkAtArrival,
    // specs/recall-unpaid-arrival-complement-at-checkout.md — explicit « Complément encaissé » confirmation.
    complementSettled: complementSettled === undefined ? undefined : Boolean(complementSettled),
    complementPaidCash: Boolean(complementPaidCash),
    // specs/sas-bath-linen-upsell.md §3.2 — tri-state: undefined (step not shown) leaves the end-of-stay
    // complement untouched; the model recomputes the offer server-side when true.
    endOfStayBathLinen: endOfStayBathLinen === undefined ? undefined : Boolean(endOfStayBathLinen),
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
