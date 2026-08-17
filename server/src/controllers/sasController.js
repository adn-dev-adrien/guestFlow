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
const optionsModel = require('../models/optionsModel');
const repairAmountsModel = require('../models/repairAmountsModel');
const resourceSchedulingModel = require('../models/resourceSchedulingModel');
const { buildSasSaleOffers } = require('../utils/sasOptionSale');
const { CATERING_CATEGORY } = require('../utils/optionCategoriesMigration');
const { buildSasSnapshot, computeSasChanges } = require('../utils/sasAudit');
const { isReceptionOnly } = require('../constants/roles');
const { sasLockReason } = require('../utils/sasEditWindow');

// specs/reception-sas-today-only.md §3.2 rule 5 — the reception role only runs the SAS of the DAY that
// has never been committed: a past, future or already-committed SAS is refused. The rule depends on
// the reservation's dates + markers, so it can't live in the path allowlist of
// middleware/enforceRoleAccess.js — it belongs here, before any write. `null` = editable.
function receptionSasLock(req, reservation, mode, now = new Date()) {
  if (!isReceptionOnly(req.user)) return null;
  return mode === 'arrival'
    ? sasLockReason({ dateIso: reservation.startDate, doneAt: reservation.arrivalSasDoneAt, now })
    : sasLockReason({ dateIso: reservation.endDate, doneAt: reservation.departureSasDoneAt, now });
}

// specs/arrival-departure-sas.md §3.7 — a SAS commit is a reservation edit like any other and must
// leave a trace in the fiche's « Historique des modifications ». Snapshot before, snapshot after,
// store the labeled diff. Never throws into the commit path: a history failure must not lose a
// check-in (the money side is already committed at that point).
function snapshotSas(reservationId) {
  const row = reservationsModel.getRow(reservationId);
  if (!row) return null;
  const upsells = reservationsModel.getSasUpsellOptions(reservationId);
  let endOfStayLines = [];
  try { endOfStayLines = JSON.parse(row.endOfStayComplementDetail || '[]') || []; } catch { endOfStayLines = []; }
  return buildSasSnapshot(row, {
    cleaningPresent: upsells.cleaning.present,
    bathLinenPresent: upsells.bathLinen.present,
    endOfStayLines,
    linenLines: reservationsModel.listSasArrivalCustomLines(reservationId),
    soldOptionLines: reservationsModel.listSasArrivalOptionLines(reservationId),
  });
}

// specs/sas-offer-complement-lines.md §4.3 — the offered set sent by a recap, sanitised at the
// boundary: `[{ kind, id }]` limited to the three addressable row kinds. `undefined` (the recap had no
// offerable line, or an older client) means « leave every offered flag as it is ».
const OFFERABLE_KINDS = new Set(['option', 'resource', 'custom']);
function normaliseOfferedRefs(refs) {
  if (!Array.isArray(refs)) return undefined;
  return refs
    .filter((x) => x && OFFERABLE_KINDS.has(String(x.kind)) && Number.isFinite(Number(x.id)))
    .map((x) => ({ kind: String(x.kind), id: Number(x.id) }));
}

function recordSasHistory(reservationId, eventType, before) {
  try {
    const changes = computeSasChanges(before, snapshotSas(reservationId));
    if (changes.length > 0) reservationsModel.addHistoryEntry(reservationId, eventType, changes);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[sas-history] ${eventType} on reservation ${reservationId} not recorded: ${err.message}`);
  }
}

function getSas(req, res) {
  const reservation = reservationsModel.getByIdWithDetails(req.params.id);
  if (!reservation) return res.status(404).json({ error: 'RESERVATION_NOT_FOUND' });

  // Cleaning is "included" when the reservation already carries it: a booked option (by
  // `autoOptionType='cleaning'` tag OR by name « ménage » — same rule as the J-1 email, see
  // utils/cleaningOption.js), a « Ménage » line added by the arrival SAS, or a property default.
  // Single source of truth shared with the departure billing guard
  // (specs/defer-arrival-complement-to-checkout.md §3.1 rule 1): BOTH SAS ends then hide their
  // ménage page — the guest is never asked about a cleaning the host was paid to do.
  //
  // EXCEPT when the only reason it is « included » is the arrival SAS's OWN row
  // (specs/sas-upsells-activate-catalogue-option.md §3.2 rule 7): on ARRIVAL the page must stay
  // visible (pre-selected « ajouté »), else adding the ménage would hide its own undo button. The
  // DEPARTURE guard keeps the raw answer — « is it sold? » is a different question from « can I
  // still cancel it? ».
  const upsells = reservationsModel.getSasUpsellOptions(reservation.id);
  const cleaningSold = reservationsModel.isCleaningSoldForReservation(reservation.id);
  const isDeparture = String(req.query.mode || '') === 'departure';
  const cleaningIncluded = cleaningSold && !(!isDeparture && upsells.cleaning.sasOrigin);
  const cleaningPrice = reservationsModel.getCleaningPriceForProperty(reservation.propertyId);
  const settings = settingsModel.read();

  // specs/reception-sas-today-only.md §3.2 rule 9 — the read stays open on a locked SAS; the resolved
  // reasons are what let the wizard render its locked panel instead of the steps. `null` for an admin.
  const receptionLock = isReceptionOnly(req.user)
    ? { arrival: receptionSasLock(req, reservation, 'arrival'), departure: receptionSasLock(req, reservation, 'departure') }
    : null;

  return res.json({
    reservation,
    receptionLock,
    portalCode: String(settings.portalCode || '').trim(),
    // `sasOrigin` = this row is the arrival SAS's own upsell → the step stays visible, pre-selected
    // « ajouté », and « Non merci » removes it (specs/sas-upsells-activate-catalogue-option.md §3.2).
    cleaning: { included: cleaningIncluded, price: cleaningPrice, sasOrigin: upsells.cleaning.sasOrigin },
    // specs/sas-bath-linen-upsell.md §3.1 — bath-linen upsell (per-person price, mirrors the engine).
    // Still offered while the only row present is our own, so the operator can undo it.
    bathLinen: (() => {
      const offer = reservationsModel.getBathLinenOfferForReservation(reservation);
      if (!upsells.bathLinen.sasOrigin) return { ...offer, sasOrigin: false };
      return {
        available: upsells.bathLinen.totalPrice > 0,
        unitPrice: upsells.bathLinen.unitPrice,
        priceType: upsells.bathLinen.priceType,
        persons: upsells.bathLinen.persons,
        nights: reservation.nights ? reservation.nights.length : 0,
        amount: upsells.bathLinen.totalPrice,
        label: offer.label,
        sasOrigin: true,
      };
    })(),
    linenItems: linenItemsModel.list(),
    // specs/recall-unpaid-arrival-complement-at-checkout.md — the arrival complement (amount + paid +
    // itemised detail) so the departure SAS can recall it when it was never settled.
    // `includeOffered` is the SAS flavour (specs/sas-offer-complement-lines.md §4.3): the already-offered
    // lines ride along at 0 € with their real price, so the recap can show the gesture and undo it.
    arrivalComplement: reservationsModel.buildArrivalComplementDetail(reservation.id, { includeOffered: true }),
    // « Tarifs facturables » — repair prices (incl. the keyed extinguisher seal) for the SAS check.
    repairAmounts: repairAmountsModel.list(),
    // Breakfast page state (arrival SAS): applicable? + resolved person count + effective hour +
    // stored counts/note. `reservation.departureHandoverNote` rides along via `r.*`.
    breakfast: breakfastModel.getForReservation(reservation.id),
    // specs/sas-breakfast-and-catering-upsell.md §3.1-§3.2 — what the check-in may still sell: the
    // breakfast (its candidate mornings, bounded by the nights of the stay) and the « Restauration »
    // catalogue of the property, prices already resolved per property. Arrival only — nothing is sold
    // at check-out. An option the operator booked on the fiche is absent (its step is closed).
    sasSales: isDeparture
      ? { persons: 0, nights: 0, breakfast: { available: false }, catering: { available: false, options: [] } }
      : buildSasSaleOffers({
        reservation,
        options: optionsModel.listForProperty(reservation.propertyId),
        cateringCategory: CATERING_CATEGORY,
      }),
    // « Planifier les ressources » step (specs/hourly-resource-quantity-and-sas-scheduling.md §3.4):
    // the hours still owed per hourly resource + every slot of the stay, already classified
    // free/taken/heating/past/closed. Arrival only — nothing is scheduled at check-out.
    resourceScheduling: isDeparture
      ? { applicable: false, resources: [] }
      : resourceSchedulingModel.getSchedulingPayload(reservation),
  });
}

function commitArrival(req, res) {
  const reservation = reservationsModel.getByIdWithDetails(req.params.id);
  if (!reservation) return res.status(404).json({ error: 'RESERVATION_NOT_FOUND' });
  const arrivalLock = receptionSasLock(req, reservation, 'arrival');
  if (arrivalLock) return res.status(403).json({ error: 'SAS_LOCKED', reason: arrivalLock });
  const {
    cautionReceived, complementItems = [],
    breakfastTime, breakfastCoffee, breakfastTea, breakfastChocolate, breakfastMilk,
    breakfastPastries, breakfastCereals, breakfastBread, breakfastNote,
    departureHandoverNote, extinguisherSealOkAtArrival,
    complementSettled, complementPaidCash,
    cleaningAdded, bathLinenAdded, resourceBlocks, soldOptions,
    offeredExtras, cleaningOffered, bathLinenOffered,
  } = req.body || {};

  // Hours placed on the resource picker. The picker only ever offers bookable slots, but its payload
  // can be stale by the time it commits — so everything is re-checked here (opening window, capacity,
  // turnover, thermal readiness, the sold-hours budget) and a conflict aborts the WHOLE commit rather
  // than double-booking (specs/hourly-resource-quantity-and-sas-scheduling.md §3.4 rule 27).
  let eveningSupplements = [];
  const blocks = Array.isArray(resourceBlocks) ? resourceBlocks : undefined;
  if (blocks) {
    const verdict = resourceSchedulingModel.validateBlocks({ reservation, blocks });
    if (!verdict.ok) {
      return res.status(409).json({ error: 'SLOT_CONFLICT', block: verdict.block, reason: verdict.reason });
    }
    eveningSupplements = verdict.supplements;
  }

  const beforeSas = snapshotSas(Number(req.params.id));
  const complementAmount = reservationsModel.commitArrivalSas(Number(req.params.id), {
    // Tri-state: undefined (caution step not shown) leaves the marker untouched; the model sets or
    // clears it on a concrete boolean (specs/reopen-completed-sas.md §6).
    cautionReceived: cautionReceived === undefined ? undefined : Boolean(cautionReceived),
    // The evening supplement rides in as an ordinary SAS complement line, so it inherits the
    // replace-and-delta machinery for free: a re-committed SAS recomputes it instead of stacking it.
    // specs/sas-offer-complement-lines.md §3.2 — each item carries its own `offered` flag (a linen
    // element noted but not billed). The evening supplement is never offered: it is machine-computed.
    complementItems: [
      ...(Array.isArray(complementItems) ? complementItems : [])
        .map((i) => ({ label: i && i.label, amount: i && i.amount, offered: Boolean(i && i.offered) })),
      ...eveningSupplements.map((s) => ({ label: s.label, amount: s.amount })),
    ],
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
    // specs/sas-upsells-activate-catalogue-option.md §3.1 rule 4 — intent only; the model resolves the
    // catalogue option and its price. Tri-state: undefined = step not shown → leave the option alone.
    cleaningAdded: cleaningAdded === undefined ? undefined : Boolean(cleaningAdded),
    bathLinenAdded: bathLinenAdded === undefined ? undefined : Boolean(bathLinenAdded),
    // specs/sas-breakfast-and-catering-upsell.md §3.3 — intent only; the model resolves the option,
    // its per-property price and the engine arithmetic. `undefined` = the sale steps never ran.
    soldOptions: Array.isArray(soldOptions) ? soldOptions : undefined,
    // specs/sas-offer-complement-lines.md §3.2 rule 8 — the upsell stays activated, billed 0 €.
    cleaningOffered: Boolean(cleaningOffered),
    bathLinenOffered: Boolean(bathLinenOffered),
    offeredExtras: normaliseOfferedRefs(offeredExtras),
    resourceBlocks: blocks,
  });
  recordSasHistory(Number(req.params.id), 'sas_arrival', beforeSas);
  return res.json({
    ok: true,
    complementAmount,
    eveningSupplement: Math.round(eveningSupplements.reduce((s, x) => s + x.amount, 0) * 100) / 100,
  });
}

function commitDeparture(req, res) {
  const reservation = reservationsModel.getByIdWithDetails(req.params.id);
  if (!reservation) return res.status(404).json({ error: 'RESERVATION_NOT_FOUND' });
  const departureLock = receptionSasLock(req, reservation, 'departure');
  if (departureLock) return res.status(403).json({ error: 'SAS_LOCKED', reason: departureLock });
  const {
    cautionReturned, endOfStayComplementDetail = null, extinguisherSealOkAtDeparture, extinguisherCharges,
    complementsSettled, complementsPaidCash, offeredArrivalExtras,
  } = req.body || {};
  const beforeSas = snapshotSas(Number(req.params.id));
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
    // specs/sas-offer-complement-lines.md §3.2 rule 6 — gestes commerciaux on the RECALLED arrival lines.
    offeredArrivalExtras: normaliseOfferedRefs(offeredArrivalExtras),
  });
  recordSasHistory(Number(req.params.id), 'sas_departure', beforeSas);
  return res.json({ ok: true });
}

module.exports = { getSas, commitArrival, commitDeparture };
