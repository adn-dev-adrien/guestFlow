/**
 * Arrival / departure SAS controller (specs/arrival-departure-sas.md §4.1; plugin `sas` per
 * specs/plugins-phase-2-hosts.md rule 8).
 *
 * Assembles the data the SAS wizard needs (caution, options, bed-linen alert, cleaning
 * included? + property cleaning price, complements, priced linen items, portal code) and
 * commits the operator's decisions in a single call per SAS (no per-step writes).
 */

const sdk = require('../sdk');
const { sasData: pluginSasData } = require('../sdk/eventBus');
const registry = require('../sdk/registry');
const { buildSasSnapshot, computeSasChanges, money: historyMoney, dayFr } = require('./sasAudit');
const { extinguisherCheckOn } = require('./settings');
const { nothingToCollect } = require('./nothingToCollect');
const { shapeArrivalRecap } = require('./arrivalRecap');
const { shapeDepartureRecap } = require('./departureRecap');
const { wholePiecesMessage, soldOptionsMessage, breakfastCountsMessage } = require('./sasQuantityBounds');
const {
  sasFlagsRefusal, ARRIVAL_FLAGS, ARRIVAL_LINES, DEPARTURE_FLAGS, DEPARTURE_LINES,
} = require('./sasFlags');
const { roundMoneyStrict } = sdk.coreModule('money');

// The money stays in the core (specs/plugins-phase-2-hosts.md §1): the SAS commit, the settlement and
// the reception view are core modules this controller calls, never copies.
const reservationsModel = sdk.coreModule('reservationsModel');
const linenItemsModel = sdk.coreModule('linenItemsModel');
const settingsModel = sdk.coreModule('settingsModel');
const breakfastModel = sdk.coreModule('breakfastModel');
const optionsModel = sdk.coreModule('optionsModel');
const repairAmountsModel = sdk.coreModule('repairAmountsModel');
const sasCommitHooks = sdk.coreModule('sasCommitHooks');
const { buildSasSaleOffers } = sdk.coreModule('sasOptionSale');
const extraSale = sdk.coreModule('extraSale');
const { parseGroup } = sdk.coreModule('arrivalPaymentGroup');
const { CATERING_CATEGORY } = sdk.coreModule('optionCategoriesMigration');
const { isReceptionOnly } = sdk.coreModule('roles');
const { sasLockReason } = sdk.coreModule('sasEditWindow');
// Exported by the core since the round-23 audit; an older core has none and the SAS commits as before (online-payment does the same).
const { takeBackRefusal } = sdk.coreModule('reservationPaymentMark');
const refusalToTakeBack = (id, flags) => (typeof takeBackRefusal === 'function' && flags.length > 0 ? takeBackRefusal(id, { flags }) : null);
const { stayDueAtArrival, bucketStates } = sdk.coreModule('reservationSettlement');
const { isUnifiable, totalDiffered, round2 } = sdk.coreModule('arrivalSasPlan');
const { formatPlatformName, isDirectChannel, isChoreFreeChannel } = sdk.coreModule('platformNameFormat');
const { toReceptionStayPayment, toReceptionSasCommit, toReceptionReservationView } = sdk.coreModule('receptionView');

// specs/plugins-phase-2-hosts.md rule 11 (P6) — the bed-linen and towel steps belong to `linen`.
const linenLive = () => registry.isLive('linen');

// specs/reception-sas-today-only.md §3.2 rule 5 — the reception role only runs the SAS of the DAY that
// has never been committed: a past, future or already-committed SAS is refused. The rule depends on
// the reservation's dates + markers, so it can't live in the path allowlist of
// middleware/enforceRoleAccess.js — it belongs here, before any write. `null` = editable.
function receptionSasLock(req, reservation, mode, now = new Date()) {
  if (!isReceptionOnly(req.user)) return null;
  return mode === 'arrival'
    ? sasLockReason({ stay: reservation, side: 'arrival', doneAt: reservation.arrivalSasDoneAt, now })
    : sasLockReason({ stay: reservation, side: 'departure', doneAt: reservation.departureSasDoneAt, now });
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
const OFFERABLE_KINDS = new Set(['option', 'resource', 'custom', 'extraGuests']);
function normaliseOfferedRefs(refs) {
  if (!Array.isArray(refs)) return undefined;
  return refs
    .filter((x) => x && OFFERABLE_KINDS.has(String(x.kind)) && Number.isFinite(Number(x.id)))
    .map((x) => ({ kind: String(x.kind), id: Number(x.id) }));
}

// specs/single-payment-at-check-in.md §3.2 rule 10 — quand le check-in a encaissé EN UNE FOIS,
// l'historique porte UNE ligne « Encaissé à l'arrivée — paiement unique » au lieu des lignes par
// échéance. Trois lignes « Acompte encaissé / Solde encaissé / Complément encaissé » racontent trois
// gestes ; il n'y en a eu qu'un, et c'est ce qu'il faut pouvoir relire des mois plus tard.
const GROUPED_PAID_FIELDS = new Set(['depositPaid', 'balancePaid', 'complementPaid', 'endOfStayComplementPaid']);
const GROUPED_BUCKET_LABELS = {
  deposit: 'acompte', balance: 'solde', complement: "complément d'arrivée",
  endOfStayComplement: 'complément de fin de séjour',
};

function foldGroupedPayment(reservationId, changes) {
  const group = parseGroup((reservationsModel.getRow(reservationId) || {}).arrivalPaymentGroup);
  if (!group) return changes;
  // Seules les lignes de PAIEMENT sont repliées : tout le reste du check-in (ménage, petit-déjeuner,
  // caution…) garde sa propre ligne, ce sont d'autres décisions.
  const paid = changes.filter((c) => GROUPED_PAID_FIELDS.has(c.field));
  if (paid.length < 2) return changes;
  const covered = group.buckets.map((b) => GROUPED_BUCKET_LABELS[b] || b).join(', ');
  return [
    ...changes.filter((c) => !GROUPED_PAID_FIELDS.has(c.field)),
    {
      field: 'arrivalPayment',
      label: "Encaissé à l'arrivée — paiement unique",
      fromText: '—',
      toText: `${historyMoney(group.total)} — ${group.cash === 1 ? 'caisse interne' : 'CB / Chèque'} le ${dayFr(group.at)} — ${covered}`,
    },
  ];
}

function recordSasHistory(reservationId, eventType, before, extraChanges = []) {
  try {
    const changes = [...foldGroupedPayment(reservationId, computeSasChanges(before, snapshotSas(reservationId))), ...extraChanges];
    if (changes.length > 0) reservationsModel.addHistoryEntry(reservationId, eventType, changes);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[sas-history] ${eventType} on reservation ${reservationId} not recorded: ${err.message}`);
  }
}

/**
 * « Séjour à régler » — what the guest still owes on the stay itself at check-in
 * (specs/collect-stay-payment-at-check-in.md §3.1-§3.2). Arrival only, admin only.
 *
 * `applicable` drives the step's existence: something left to collect, OR a stay THIS SAS already
 * settled — the latter is what lets a re-opened wizard show its own decision and undo it.
 */
/**
 * specs/single-payment-at-check-in.md §3.1 rule 1 + §3.4 — the single arrival payment.
 *
 * `complementOpen` is the ONE thing the server can answer here: is the arrival complement still to be
 * collected? Whether the recap may settle both sides at once also depends on what the check-in is
 * about to sell — a « repas des trappeurs » taken during the wizard is not in `complementAmount`
 * when this payload is built, and that is precisely the case the feature exists for. The recap
 * therefore composes: the stay step is shown, the complement is open, and its live total is > 0.
 *
 * The money itself is never composed client-side: every amount is re-priced by the server at commit.
 *
 * `group` is the collection already recorded, so a re-opened SAS and the fiche show the payment that
 * was actually made. At check-out, and for a reception-only user (who never sees the stay side at
 * all), there is no unified settlement.
 */
function buildArrivalPayment(reservation, { isDeparture, receptionOnly }) {
  if (isDeparture || receptionOnly) return { complementOpen: false, group: null };
  return {
    complementOpen: Number(reservation.complementPaid || 0) !== 1,
    group: parseGroup(reservation.arrivalPaymentGroup),
  };
}

function buildStayPayment(reservation, { isDeparture, receptionOnly }) {
  if (isDeparture || receptionOnly) return toReceptionStayPayment();
  const due = stayDueAtArrival(reservation);
  // `collectible` = the amount THIS step is about: what is still owed, plus what this SAS already
  // collected on an earlier run. A bucket is never both, so the sum is exact — and it is what keeps a
  // re-opened SAS from announcing « Séjour à régler : 0 € » over the payment it made itself.
  const own = [
    { key: 'deposit', atArrival: reservation.depositPaidAtArrival, paid: reservation.depositPaid, cash: reservation.depositPaidCash },
    { key: 'balance', atArrival: reservation.balancePaidAtArrival, paid: reservation.balancePaid, cash: reservation.balancePaidCash },
  ];
  const ownedOf = (key) => Number(own.find((b) => b.key === key).atArrival || 0) === 1;
  const withCollectible = (key) => ({
    ...due[key],
    owned: ownedOf(key),
    collectible: roundMoneyStrict(due[key].due + (ownedOf(key) ? due[key].amount : 0)),
  });
  const deposit = withCollectible('deposit');
  const balance = withCollectible('balance');
  // specs/direct-installments.md rule 36 — what a plan still owes is due at the door: the SAS settles it
  // by marking the remaining installments paid (cash), never by ticking acompte / solde.
  const installments = due.installments;
  const settledHere = own.filter((b) => Number(b.atArrival || 0) === 1);
  const paid = settledHere.some((b) => Number(b.paid || 0) === 1);
  return {
    // specs/collect-stay-payment-at-check-in.md rule 6 (revised 2026-09-08) — the step exists for
    // the DIRECT channel only: a platform solde is the OTA's payout, wired after the stay, never
    // money to claim at the door (dashboard-collection-alert.md already treats it as « normal, not
    // an alert »). A platform SAS that settled the stay on an earlier run still gets the step, so
    // its own (mistaken) collection stays visible and undoable.
    applicable: (isDirectChannel(reservation.platform) && due.total > 0) || settledHere.length > 0,
    total: roundMoneyStrict(deposit.collectible + balance.collectible + installments.due),
    deposit,
    balance,
    installments,
    // The OTA warning of rule 9 — on a platform booking the solde is the payout, not the guest's money.
    channel: isDirectChannel(reservation.platform) ? 'direct' : 'platform',
    platformLabel: formatPlatformName(reservation.platform),
    // Re-open pre-fill (rule 14): what THIS SAS recorded, never a payment made elsewhere.
    paid,
    paidCash: paid && settledHere.some((b) => Number(b.cash || 0) === 1),
  };
}

// specs/plugins-phase-2-hosts.md rule 11 (gap 5) — without `linen`, the arrival SAS has no bed-linen
// or towel step, so its payload carries neither their data nor the reservation's bed-linen alert. The
// priced items stay in the DEPARTURE payload: « Objets manquants » is a SAS step, priced from them.
function withoutLinenAlert(reservation) {
  if (linenLive() || !('bedLinenAlert' in reservation)) return reservation;
  const copy = { ...reservation };
  delete copy.bedLinenAlert;
  return copy;
}

// Rule 11 — without `linen`, the arrival commit ignores the bed-linen and towel decisions: the towel
// upsell is left as it is, no linen element is priced, and the bed-linen lines already stored are kept
// at their stored amount (the commit replaces every SAS-origin line, so leaving them out would drop
// money a previous check-in recorded). « Offrir » on such a line stays the operator's gesture.
function withoutLinenDecisions(reservationId, body) {
  if (linenLive()) return body;
  const bedLabels = new Set(linenItemsModel.list()
    .filter((i) => i.category === 'bed').map((i) => String(i.label).trim()));
  const storedBed = (reservationsModel.listSasArrivalCustomLines(reservationId) || [])
    .filter((l) => bedLabels.has(String(l.description || '').trim()));
  const storedIds = new Set(storedBed.map((l) => Number(l.id)));
  const sent = Array.isArray(body.keptLines) ? body.keptLines : [];
  const sentFor = (id) => sent.find((k) => k && Number(k.customOptionId) === id);
  return {
    ...body,
    linenItems: [],
    keptLines: [
      ...sent.filter((k) => k && !storedIds.has(Number(k.customOptionId))),
      ...storedBed.map((l) => {
        const line = sentFor(Number(l.id));
        return { customOptionId: Number(l.id), offered: line ? Boolean(line.offered) : Number(l.offered) === 1 };
      }),
    ],
    bathLinenAdded: undefined,
    bathLinenOffered: false,
  };
}

// What the check-in may still sell (specs/sas-breakfast-and-catering-upsell.md §3.1-§3.2).
function saleOffersFor(reservation, { isDeparture }) {
  if (isDeparture) return { persons: 0, nights: 0, breakfast: { available: false }, catering: { available: false, options: [] } };
  return buildSasSaleOffers({
    reservation,
    options: optionsModel.listForProperty(reservation.propertyId),
    cateringCategory: CATERING_CATEGORY,
    // Ceiling of the « personnes servies » stepper: the capacity of the logement, so a friend
    // invited to dinner can be served (specs/card-option-served-persons.md §3.1 rule 3).
    maxPersons: reservation.propertyMaxGuests,
  });
}

/**
 * specs/sas-arrival-total-server-side.md rules 3-4 — the arrival draft, as the preview and the commit
 * both read it: the reception strip, the linen gate, the plugin hooks (a refusal stops both), and the
 * intents resolved to priced items. `input` is what `planArrivalSas` and `commitArrivalSas` take.
 */
// specs/sas-departure-recap-server-side.md rule 28 (2026-10-27 spec review) — a linen element is
// counted in whole pieces. A quantity of 1.5 used to be rounded to 2 and billed; it is refused, at
// the preview as at the commit, so the recap never shows a count the operator did not type.
// Rule 29 — and every count is bounded, on the same refusal.
const quantityRefusal = (message) => (message ? { status: 400, body: { error: 'INVALID_QUANTITY', message } } : null);

function normaliseArrivalDraft(req, reservation) {
  let body = req.body || {};
  if (isReceptionOnly(req.user)) body = toReceptionSasCommit(body);
  // Rule 72 of reservation-payment-ledger — after reception's silent drop (collect-stay-payment rule 25), before any read.
  const ticks = sasFlagsRefusal(body, ARRIVAL_FLAGS, ARRIVAL_LINES);
  if (ticks.refusal) return { refusal: ticks.refusal };
  body = withoutLinenDecisions(Number(reservation.id), ticks.body);
  const refusedQuantity = quantityRefusal(wholePiecesMessage(body.linenItems)
    || soldOptionsMessage(body.soldOptions, (optionId) => optionsModel.get(optionId)?.priceType, reservation.options)
    || breakfastCountsMessage(body, reservation));
  if (refusedQuantity) return { refusal: refusedQuantity };
  const plugins = sasCommitHooks.prepare({ reservation, pluginSteps: body.pluginSteps || {} });
  if (plugins.refusal) return { refusal: plugins.refusal };
  const resolved = reservationsModel.resolveSasArrivalItems(Number(reservation.id), {
    linenItems: body.linenItems, keptLines: body.keptLines,
  });
  return {
    body,
    plugins,
    input: {
      // A plugin's line rides in as an ordinary SAS complement line, so it inherits the
      // replace-and-delta machinery for free: a re-committed SAS recomputes it instead of stacking it.
      // A line a plugin bills that the dialog carries back is dropped (rule 7 of phase 3c).
      complementItems: [
        ...resolved.filter((i) => !plugins.labels.has(i.label)),
        ...plugins.items,
      ],
      // specs/sas-upsells-activate-catalogue-option.md §3.1 rule 4 — intent only; tri-state.
      cleaningAdded: body.cleaningAdded === undefined ? undefined : Boolean(body.cleaningAdded),
      bathLinenAdded: body.bathLinenAdded === undefined ? undefined : Boolean(body.bathLinenAdded),
      // specs/sas-breakfast-and-catering-upsell.md §3.3 — intent; `undefined` = the sale steps never ran.
      soldOptions: Array.isArray(body.soldOptions) ? body.soldOptions : undefined,
      // specs/sas-offer-complement-lines.md §3.2 rule 8 — the upsell stays activated, billed 0 €.
      cleaningOffered: Boolean(body.cleaningOffered),
      bathLinenOffered: Boolean(body.bathLinenOffered),
      offeredExtras: normaliseOfferedRefs(body.offeredExtras),
    },
  };
}

function arrivalRecapFor(req, reservation, plan) {
  const receptionOnly = isReceptionOnly(req.user);
  return shapeArrivalRecap(plan, {
    stayPayment: buildStayPayment(reservation, { isDeparture: false, receptionOnly }),
    arrivalPayment: buildArrivalPayment(reservation, { isDeparture: false, receptionOnly }),
    saleOffers: saleOffersFor(reservation, { isDeparture: false }),
    nothingToCollect: nothingToCollect(reservation, { isDeparture: false, bucketStates, isDirectChannel }),
  });
}

function linenPayload(build, { isDeparture }) {
  const live = linenLive();
  const out = {};
  if (live || isDeparture) out.linenItems = linenItemsModel.list();
  if (live) out.bathLinen = build();
  return out;
}

function getSas(req, res) {
  const found = reservationsModel.getByIdWithDetails(req.params.id);
  if (!found) return res.status(404).json({ error: 'RESERVATION_NOT_FOUND', message: 'Réservation introuvable.' });
  const reservation = withoutLinenAlert(found);

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
    // specs/reception-role-checkin-only.md §3.6 rule 12 — the SAS read serves the same reception
    // view as GET /reservations/:id: door money only, no revenue/settlement figure, no client PII.
    // The SAS-specific keys below already carry their own reception guards (stayPayment,
    // arrivalPayment) or are door money by nature (arrivalComplement, upsell prices).
    reservation: isReceptionOnly(req.user) ? toReceptionReservationView(reservation) : reservation,
    receptionLock,
    // specs/mixed-method-payments.md rule 45 — « Plusieurs moyens » is the admin's: reception records one method.
    canSplitPayment: !isReceptionOnly(req.user),
    portalCode: String(settings.portalCode || '').trim(),
    // What live plugin modules add to the SAS, by plugin id (specs/plugins-phase-1-sdk.md rule 17):
    // e.g. `gate-access` says only whether there is a key to show — the step reads the code and its
    // QR through its own route, so rendering a QR never holds the SAS open.
    pluginData: pluginSasData(reservation.id),
    // `sasOrigin` = this row is the arrival SAS's own upsell → the step stays visible, pre-selected
    // « ajouté », and « Non merci » removes it (specs/sas-upsells-activate-catalogue-option.md §3.2).
    // `guestReminder` — the « vaisselle / poubelles » reminder, never on a channel that forbids checkout
    // chores and any request added at arrival (specs/airbnb-no-checkout-chores.md rules 1, 8).
    cleaning: {
      included: cleaningIncluded,
      price: cleaningPrice,
      sasOrigin: upsells.cleaning.sasOrigin,
      guestReminder: cleaningIncluded && !isChoreFreeChannel(reservation.platform),
      // Rule 7 — a ménage left undone is never billed on such a channel (it forbids the penalty).
      billableAtDeparture: !cleaningIncluded && !isChoreFreeChannel(reservation.platform),
    },
    // specs/sas-bath-linen-upsell.md §3.1 — bath-linen upsell (per-person price, mirrors the engine).
    // Still offered while the only row present is our own, so the operator can undo it.
    ...linenPayload(() => {
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
    }, { isDeparture }),
    // specs/collect-stay-payment-at-check-in.md — the séjour still owed at the door (last-minute
    // stays arrive unpaid). `{ applicable: false }` for a reception-only user: no amount is served.
    stayPayment: buildStayPayment(reservation, { isDeparture, receptionOnly: isReceptionOnly(req.user) }),
    // specs/single-payment-at-check-in.md §3.1 — may the recap settle the stay AND the complement in
    // ONE gesture? The server answers, so the client never decides it from amounts it does not own.
    arrivalPayment: buildArrivalPayment(reservation, { isDeparture, receptionOnly: isReceptionOnly(req.user) }),
    // specs/ui-review-2026-10-19-operations.md rule 4 — the recap's « Rien à percevoir » is the
    // server's call: nothing owed on the stay or the stored complements before this run.
    nothingToCollect: nothingToCollect(reservation, { isDeparture, bucketStates, isDirectChannel }),
    // specs/recall-unpaid-arrival-complement-at-checkout.md — the arrival complement (amount + paid +
    // itemised detail) so the departure SAS can recall it when it was never settled.
    // `includeOffered` is the SAS flavour (specs/sas-offer-complement-lines.md §4.3): the already-offered
    // lines ride along at 0 € with their real price, so the recap can show the gesture and undo it.
    arrivalComplement: reservationsModel.buildArrivalComplementDetail(reservation.id, { includeOffered: true }),
    // « Tarifs facturables » — repair prices (incl. the keyed extinguisher seal) for the SAS check.
    repairAmounts: repairAmountsModel.list(),
    // specs/plugins-phase-p-productisation.md rule 16 — off, the departure shows no extinguisher step.
    extinguisherCheck: extinguisherCheckOn(),
    // Breakfast page state (arrival SAS): applicable? + resolved person count + effective hour +
    // stored counts/note. `reservation.departureHandoverNote` rides along via `r.*`.
    breakfast: breakfastModel.getForReservation(reservation.id),
    // specs/sas-breakfast-and-catering-upsell.md §3.1-§3.2 — what the check-in may still sell: the
    // breakfast (its candidate mornings, bounded by the nights of the stay) and the « Restauration »
    // catalogue of the property, prices already resolved per property. Arrival only — nothing is sold
    // at check-out. An option the operator booked on the fiche is absent (its step is closed).
    sasSales: saleOffersFor(reservation, { isDeparture }),
    // Rule 32 — what the stay sold for its departure, apart from the total the arrival collects (reception sees no money).
    staySales: isReceptionOnly(req.user) ? null : extraSale.departureSalesOf(reservation.id),
    // specs/sas-departure-recap-server-side.md rule 12 — what the stored detail says the operator
    // decided, so the dialog seeds its state without dividing an amount by a price.
    ...(isDeparture ? { departureSeed: reservationsModel.buildDepartureSeed(reservation.id) } : {}),
  });
}

/**
 * specs/sas-arrival-total-server-side.md rule 3 — the arrival recap of a DRAFT: the very body the
 * commit would receive, planned by the very function the commit runs, and nothing written. A plugin
 * refusal answers exactly as the commit would (rule 12).
 */
// specs/recall-unpaid-arrival-complement-at-checkout.md rule 11, specs/sas-breakfast-and-catering-upsell.md rule 17 (audit R26 H1) —
// an end-of-stay complement collected outside the departure SAS is closed: a run that would raise it is refused, preview and
// commit alike, before anything is written.
const END_OF_STAY_COLLECTED = 'END_OF_STAY_ALREADY_COLLECTED';
const collectedEndOfStayRefusal = (raises, gesture) => (raises
  ? { status: 409, body: { error: `Complément de fin de séjour déjà encaissé : le décocher sur la fiche avant ${gesture}.`, code: END_OF_STAY_COLLECTED } }
  : null);
// Rule 36 of arrival-departure-sas.md — and one that would take a prestation OUT of it (a line dropped or lowered whose money sits in
// the collected end-of-stay complement) is refused the same way: the fiche unticks the collection first.
const arrivalGrowthRefusal = (plan) => collectedEndOfStayRefusal(Boolean(plan && plan.saleRaisesCollectedEndOfStay), 'de vendre une prestation')
  || collectedEndOfStayRefusal(Boolean(plan && plan.removesFromCollectedEndOfStay), 'de retirer une prestation');
const departureGrowthRefusal = (plan) => collectedEndOfStayRefusal(Boolean(plan && plan.raisesCollectedEndOfStay), 'd’ajouter des frais');

function previewArrival(req, res) {
  const reservation = reservationsModel.getByIdWithDetails(req.params.id);
  if (!reservation) return res.status(404).json({ error: 'RESERVATION_NOT_FOUND', message: 'Réservation introuvable.' });
  const closed = closedStayRefusal(reservation);
  if (closed) return res.status(409).json(closed);
  const arrivalLock = receptionSasLock(req, reservation, 'arrival');
  if (arrivalLock) return res.status(403).json({ error: 'SAS_LOCKED', reason: arrivalLock });
  const draft = normaliseArrivalDraft(req, reservation);
  if (draft.refusal) return res.status(draft.refusal.status).json(draft.refusal.body);
  const plan = reservationsModel.planArrivalSas(Number(req.params.id), draft.input);
  const grows = arrivalGrowthRefusal(plan);
  if (grows) return res.status(grows.status).json(grows.body);
  return res.json(arrivalRecapFor(req, reservation, plan));
}

// specs/sas-arrival-total-server-side.md rule 22bis, specs/sas-departure-recap-server-side.md rule 23 —
// the history line that keeps what the operator was shown next to what was recorded.
const formatEuro = (n) => `${round2(n).toFixed(2).replace('.', ',')} €`;
function totalDifferenceChange({ field, label }, warning) {
  return {
    field,
    label,
    fromText: `affiché ${formatEuro(warning.displayed)}`,
    toText: `enregistré ${formatEuro(warning.stored)}`,
  };
}
function recordTotalDifference(reservationId, eventType, history, warning) {
  try {
    reservationsModel.addHistoryEntry(reservationId, eventType, [totalDifferenceChange(history, warning)]);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[sas-history] ${eventType} total difference on reservation ${reservationId} not recorded: ${err.message}`);
  }
}
// A cancelled stay or a duplicate set aside takes no check-in nor check-out (specs/calendar-property-parity.md
// rule 25): the SAS refuses it before reading or writing anything. The plugin holds the stay already, so it
// reads its kind rather than reaching for a core helper.
const CLOSED_STAY_REFUSALS = {
  cancelled: { error: 'Cette réservation est annulée et ne peut plus être modifiée.', code: 'RESERVATION_CANCELLED' },
  superseded: { error: 'Ce doublon est écarté : le rétablir pour le modifier.', code: 'RESERVATION_SUPERSEDED' },
};
const closedStayRefusal = (reservation) => CLOSED_STAY_REFUSALS[String(reservation.kind)] || null;

const ARRIVAL_TOTAL_HISTORY = { field: 'arrivalRecapTotal', label: 'Total du récapitulatif d’arrivée' };
const DEPARTURE_TOTAL_HISTORY = { field: 'departureRecapTotal', label: 'Total du récapitulatif de départ' };

// specs/reservation-refunds.md rule 52, reading of 2026-11-05 (audit R24-DB-2) — the marks a re-opened SAS would take off the
// books: an answer « Pas maintenant » (false) or a move to the caisse interne. The stay buckets follow `resolveStayPayment`: the
// SAS only undoes or re-stamps what it settled itself (`*PaidAtArrival`), the departure what it settled itself too.
const leavesTheBooks = (settled, cash) => settled === false || (settled === true && Boolean(cash));

// specs/defer-arrival-complement-to-checkout.md rule 21 (audit R25-A1) — the arrival complement is the SAS's to settle, undo or
// re-stamp only while it is still due or when THIS SAS settled it (`complementPaidAtArrival`): one paid before check-in (link,
// fiche, reconciliation) is left as it is, whatever the commit answers. Same reading for the end-of-stay complement at departure
// (`endOfStayComplementPaidAtDeparture`, recall-unpaid-arrival-complement-at-checkout rules 9bis, 10).
const arrivalSasOwnsComplement = (row) => Number(row.complementPaid || 0) !== 1 || Number(row.complementPaidAtArrival ?? 1) === 1;
const departureSasOwnsEndOfStay = (row) => Number(row.endOfStayComplementPaid || 0) !== 1
  || Number(row.endOfStayComplementPaidAtDeparture ?? 1) === 1;

// specs/defer-arrival-complement-to-checkout.md rule 23 (audit R28 verification N2) — « Plus tard » sets the deferral marker; it is
// never switched on over an end-of-stay complement already collected (books or caisse interne). Same refusal as the fiche's
// PATCH /payment (utils/checkoutComplement.js deferralRefusal), read here from the stored row: SDK 2.21 exposes no such name.
const DEFERRAL_END_OF_STAY_SETTLED = { error: 'Complément de fin de séjour déjà encaissé.', code: 'DEFERRAL_END_OF_STAY_SETTLED' };
function arrivalDeferralRefusal(row, complementSettled) {
  if (complementSettled !== false || Number(row.complementDeferredToCheckout || 0) === 1) return null;
  const endOfStaySettled = Number(row.endOfStayComplementPaid || 0) === 1 || Number(row.endOfStayComplementPaidCash || 0) === 1;
  return endOfStaySettled ? DEFERRAL_END_OF_STAY_SETTLED : null;
}

function arrivalTakeBackFlags(row, { stayPaid, stayPaidCash, complementSettled, complementPaidCash }) {
  const flags = [];
  if (leavesTheBooks(stayPaid, stayPaidCash)) {
    if (Number(row.depositPaidAtArrival || 0) === 1) flags.push('depositPaid');
    if (Number(row.balancePaidAtArrival || 0) === 1) flags.push('balancePaid');
  }
  if (leavesTheBooks(complementSettled, complementPaidCash) && arrivalSasOwnsComplement(row)) flags.push('complementPaid');
  return flags;
}

function departureTakeBackFlags(row, { complementsSettled, complementsPaidCash }) {
  return leavesTheBooks(complementsSettled, complementsPaidCash) && departureSasOwnsEndOfStay(row) ? ['endOfStayComplementPaid'] : [];
}

// specs/reception-role-checkin-only.md rule 16 (audit R25-A2) — reception sees door money only: the refusal names no refund.
const RECEPTION_REFUND_REFUSAL = 'Un remboursement bloque ce passage : à voir avec l’administrateur.';
function takeBackAnswer(req, takeBack) {
  if (!isReceptionOnly(req.user)) return takeBack.body;
  return { error: RECEPTION_REFUND_REFUSAL, code: takeBack.body.code };
}

const settlementService = sdk.coreModule('paymentSettlementService');

// The buckets of `names` still to collect on the stay: what a split of the SAS would pay (mixed-method-payments rules 43-44).
const unpaidBuckets = (row, names) => names.filter((b) => Number(row[`${b}Amount`] || 0) > 0
  && Number(row[`${b}Paid`] || 0) !== 1 && Number(row[`${b}PaidCash`] || 0) !== 1
  && !(b === 'deposit' && Number(row.depositDisabled || 0) === 1));

// specs/mixed-method-payments.md rules 1, 32 — the single payment of the arrival SAS split over several methods:
// only the unified payment (one amount asked), never with an installment plan (its installments are recorded
// one by one, each with its own method).
function splitArrivalRefusalOrPrepared(req, recap, unifiable, separately) {
  const refuse = (message, status = 400) => ({ refusal: { status, body: { error: 'INVALID_TENDERS', message } } });
  if (isReceptionOnly(req.user)) return refuse('Accès refusé.', 403);
  if (!unifiable || separately === true) return refuse('Plusieurs moyens : seulement pour le paiement unique.');
  const row = reservationsModel.getRow(Number(req.params.id)) || {};
  if (Number(row.installmentsPaidAmount || 0) + Number(row.installmentsUnpaidAmount || 0) > 0) {
    return refuse('Plusieurs moyens : pas avec un échéancier.');
  }
  const prepared = settlementService.prepare({
    tenders: req.body.arrivalPaymentTenders, dueCents: Math.round(Number(recap.totalAtArrival) * 100), shortfall: req.body.arrivalPaymentShortfall,
    reservationId: row.id, target: { kind: 'arrivalGroup', buckets: unpaidBuckets(row, ['deposit', 'balance', 'complement']) },
  });
  if (!prepared.ok) return refuse(prepared.error, prepared.status || 400);
  return { prepared };
}

/**
 * Records the settlement of a SAS commit that just ran (specs/mixed-method-payments.md rules 10-14): on the group
 * when the commit grouped its payment, on the bucket(s) it settled otherwise. A commit that settled another
 * total than the recap showed is re-checked on what it really settled; when the lines no longer fit, the
 * ordinary payment stands and the answer says the split was not recorded.
 */
function recordSasSplit(reservationId, before, prepared, { tenders, shortfall }) {
  const after = reservationsModel.getRow(reservationId) || {};
  const parts = settlementService.flippedParts(before, after);
  const covered = parts.reduce((sum, p) => sum + p.amountCents, 0);
  const notRecorded = { code: 'SPLIT_NOT_RECORDED', message: 'Paiement enregistré sans le détail des moyens : le total a changé. Le corriger depuis la fiche.' };
  if (parts.length === 0) return notRecorded;
  const fitted = covered === prepared.dueCents ? prepared : settlementService.prepare({ tenders, dueCents: covered, shortfall });
  if (!fitted.ok) return notRecorded;
  const group = parseGroup(after.arrivalPaymentGroup);
  const grouped = group && parts.every((p) => group.buckets.includes(p.kind)) && parts.length > 1;
  const recorded = settlementService.record({
    reservationId,
    targetKind: grouped ? 'arrivalGroup' : 'bucket',
    targetKey: grouped ? group.at : parts[0].kind,
    paidDate: grouped ? group.at : (after[`${parts[0].kind}PaidDate`] || before.departureSasDoneAt || after.endDate),
    prepared: fitted,
    parts,
  });
  return recorded.ok ? null : notRecorded;
}

function commitArrival(req, res) {
  const reservation = reservationsModel.getByIdWithDetails(req.params.id);
  if (!reservation) return res.status(404).json({ error: 'RESERVATION_NOT_FOUND', message: 'Réservation introuvable.' });
  const closed = closedStayRefusal(reservation);
  if (closed) return res.status(409).json(closed);
  const arrivalLock = receptionSasLock(req, reservation, 'arrival');
  if (arrivalLock) return res.status(403).json({ error: 'SAS_LOCKED', reason: arrivalLock });
  // specs/collect-stay-payment-at-check-in.md §3.6 rule 25 — fail-closed: a reception-only commit
  // never settles the stay. The fields are dropped silently (inside `normaliseArrivalDraft`); the rest
  // of the check-in goes through.
  // The steps of other plugins (specs/plugins-phase-3c-hourly-resources.md rules 6–8): each checks
  // its payload before anything is written — a refusal aborts the WHOLE commit, as the slot conflict
  // of the scheduling step does — bills its own lines, recomputed on every commit, and writes inside
  // the commit's transaction.
  const draft = normaliseArrivalDraft(req, reservation);
  if (draft.refusal) return res.status(draft.refusal.status).json(draft.refusal.body);
  const {
    cautionReceived, cautionWaived,
    breakfastTime, breakfastCoffee, breakfastTea, breakfastChocolate, breakfastMilk,
    breakfastPastries, breakfastCereals, breakfastBread, breakfastNote,
    departureHandoverNote, extinguisherSealOkAtArrival,
    complementSettled, complementPaidCash,
    stayPaid, stayPaidCash,
    // specs/single-payment-at-check-in.md §3.1 — one gesture for both sides. `arrivalPaymentSplit`
    // true means the operator chose « Régler séparément », and the four fields above are honoured
    // exactly as in v2.8.0.
    arrivalPaymentMode, arrivalPaymentSplit,
    displayedArrivalTotal,
  } = draft.body;

  // specs/sas-arrival-total-server-side.md rules 8-9 — whether ONE gesture may settle both sides is
  // decided here, on the planned total, never by the dialog: it only says whether the operator chose
  // « Régler séparément ».
  const arrivalPlan = reservationsModel.planArrivalSas(Number(req.params.id), draft.input);
  const grows = arrivalGrowthRefusal(arrivalPlan);
  if (grows) return res.status(grows.status).json(grows.body);
  const recap = arrivalRecapFor(req, reservation, arrivalPlan);
  const unifiable = isUnifiable({
    complementOpen: recap.complementOpen,
    stayApplicable: buildStayPayment(reservation, { isDeparture: false, receptionOnly: isReceptionOnly(req.user) }).applicable,
    arrivalComplementTotal: recap.arrivalComplementTotal,
  });

  // specs/single-payment-at-check-in.md §3.1 rule 2 — ONE mode drives both sides. This is a
  // translation, not a second settlement path: the model keeps the two tri-states it has always had,
  // so everything downstream (contribution capture, deferral marker, accounting) is unchanged.
  //
  //   'card'  → both settled, ordinary accounting
  //   'cash'  → both settled into the caisse interne, off the books on both sides at once
  //   'later' → neither settled, and each side keeps its own meaning of « later »: the stay stays
  //             due, the complement is recalled at the check-out.
  //
  // « Régler séparément », or a plan that is not unifiable, hands the decision back to the two
  // v2.8.0 fields.
  // specs/mixed-method-payments.md rules 1, 32 — « Plusieurs moyens » on the single payment: the lines are
  // validated against the planned total first, then the gesture is the card or caisse one (rule 11).
  const splitArrival = arrivalPaymentMode === 'split' ? splitArrivalRefusalOrPrepared(req, recap, unifiable, arrivalPaymentSplit) : null;
  if (splitArrival && splitArrival.refusal) return res.status(splitArrival.refusal.status).json(splitArrival.refusal.body);
  const requested = splitArrival ? (splitArrival.prepared.allInternal ? 'cash' : 'card') : arrivalPaymentMode;
  const mode = requested === 'defer' ? 'later' : requested;
  const unifying = unifiable && arrivalPaymentSplit !== true && (mode === 'card' || mode === 'cash' || mode === 'later');
  const settles = unifying && mode !== 'later';
  const unified = unifying
    ? {
      stayPaid: settles,
      stayPaidCash: mode === 'cash',
      complementSettled: settles,
      complementPaidCash: mode === 'cash',
      // false (not undefined) on « later »: a re-opened SAS undoing its single payment must DROP the
      // group, not leave the fiche announcing a collection that no longer exists.
      grouped: settles,
    }
    : {
      stayPaid: stayPaid === undefined ? undefined : Boolean(stayPaid),
      stayPaidCash: Boolean(stayPaidCash),
      complementSettled: complementSettled === undefined ? undefined : Boolean(complementSettled),
      complementPaidCash: Boolean(complementPaidCash),
      grouped: undefined,
    };

  const storedRow = reservationsModel.getRow(Number(req.params.id)) || {};
  const owned = arrivalSasOwnsComplement(storedRow) ? unified : { ...unified, complementSettled: undefined, complementPaidCash: false };
  // Rule 23: with no arrival complement planned the dialog hides the step and still sends « Plus tard »; over a collected end
  // of stay there is nothing to defer, so the answer writes no marker instead of being refused.
  const nothingToDefer = owned.complementSettled === false && Number(recap.arrivalComplementTotal || 0) <= 0
    && arrivalDeferralRefusal(storedRow, false) !== null;
  const settlement = nothingToDefer ? { ...owned, complementSettled: undefined, complementPaidCash: false } : owned;
  const deferral = arrivalDeferralRefusal(storedRow, settlement.complementSettled);
  if (deferral) return res.status(409).json(deferral);
  const takeBack = refusalToTakeBack(Number(req.params.id), arrivalTakeBackFlags(storedRow, settlement));
  if (takeBack) return res.status(takeBack.status).json(takeBackAnswer(req, takeBack));

  const beforeSas = snapshotSas(Number(req.params.id));
  const beforeSplit = reservationsModel.getRow(Number(req.params.id)) || {};
  const complementAmount = reservationsModel.commitArrivalSas(Number(req.params.id), {
    // Tri-state: undefined (caution step not shown) leaves the marker untouched; the model sets or
    // clears it on a concrete boolean (specs/reopen-completed-sas.md §6).
    cautionReceived: cautionReceived === undefined ? undefined : Boolean(cautionReceived),
    cautionWaived: cautionWaived === undefined ? undefined : Boolean(cautionWaived),
    ...draft.input,
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
    extinguisherSealOkAtArrival: extinguisherCheckOn() ? extinguisherSealOkAtArrival : undefined,
    // specs/recall-unpaid-arrival-complement-at-checkout.md — explicit « Complément encaissé » confirmation.
    complementSettled: settlement.complementSettled,
    complementPaidCash: settlement.complementPaidCash,
    // specs/collect-stay-payment-at-check-in.md §3.3 — the séjour settled at the door. Same tri-state
    // contract: undefined = the step never ran → the acompte / solde are left untouched.
    stayPaid: settlement.stayPaid,
    stayPaidCash: settlement.stayPaidCash,
    // specs/single-payment-at-check-in.md §3.2 — record the collection as ONE payment. The model
    // decides what the group may claim, from the buckets it really settled.
    groupArrivalPayment: settlement.grouped,
    pluginWrites: draft.plugins.writes,
  });
  recordSasHistory(Number(req.params.id), 'sas_arrival', beforeSas);
  const splitWarning = splitArrival ? recordSasSplit(Number(req.params.id), beforeSplit, splitArrival.prepared, {
    tenders: req.body.arrivalPaymentTenders, shortfall: req.body.arrivalPaymentShortfall,
  }) : null;
  // specs/sas-arrival-total-server-side.md rules 22-22bis — the total the recap showed is compared,
  // never used: the commit went through on its own plan, and a difference is said and kept.
  const stored = round2(complementAmount);
  const warning = totalDiffered(displayedArrivalTotal, stored)
    ? { code: 'ARRIVAL_TOTAL_DIFFERED', displayed: round2(displayedArrivalTotal), stored }
    : null;
  if (warning) recordTotalDifference(Number(req.params.id), 'sas_arrival', ARRIVAL_TOTAL_HISTORY, warning);
  return res.json({
    ok: true,
    complementAmount,
    recap,
    warning: warning || splitWarning,
    pluginLines: draft.plugins.items.map(({ label, amount }) => ({ label, amount })),
  });
}

/**
 * specs/sas-departure-recap-server-side.md rules 3-4 — the departure draft, as the preview and the
 * commit both read it: the extinguisher setting, the reception guard is the route's, and the intents
 * resolved to priced lines. `input` is what `planDepartureSas` and `commitDepartureSas` take.
 */
function normaliseDepartureDraft(req, reservation) {
  const ticks = sasFlagsRefusal(req.body || {}, DEPARTURE_FLAGS, DEPARTURE_LINES);
  if (ticks.refusal) return { refusal: ticks.refusal };
  const { body } = ticks;
  // specs/plugins-phase-p-productisation.md rule 16 — with the check off, no seal field is accepted.
  const checked = extinguisherCheckOn();
  const refusedQuantity = quantityRefusal(wholePiecesMessage(body.missingItems)
    || wholePiecesMessage(checked ? body.extinguisherCharges : []));
  if (refusedQuantity) return { refusal: refusedQuantity };
  return {
    body,
    input: {
      // The detail lines are priced here from « Facturables », the property and the stored detail —
      // never read from the body (rules 6-9).
      endOfStayComplementDetail: reservationsModel.resolveSasDepartureItems(Number(reservation.id), {
        missingItems: body.missingItems,
        cleaningCharged: Boolean(body.cleaningCharged),
        cleaningOffered: Boolean(body.cleaningOffered),
        storedLines: body.storedLines,
      }),
      extinguisherSealOkAtDeparture: checked ? body.extinguisherSealOkAtDeparture : undefined,
      extinguisherCharges: checked && Array.isArray(body.extinguisherCharges) ? body.extinguisherCharges : undefined,
      // specs/sas-offer-complement-lines.md §3.2 rule 6 — gestes commerciaux on the RECALLED arrival
      // lines; whether the set counts is the plan's call (rule 11).
      offeredArrivalExtras: normaliseOfferedRefs(body.offeredArrivalExtras),
    },
  };
}

function departureRecapFor(reservation, plan) {
  return shapeDepartureRecap(plan, {
    nothingToCollect: nothingToCollect(reservation, { isDeparture: true, bucketStates, isDirectChannel }),
  });
}

/**
 * specs/sas-departure-recap-server-side.md rule 3 — the departure recap of a DRAFT: the very body the
 * commit would receive (settlement fields ignored), planned by the very function the commit runs, and
 * nothing written.
 */
function previewDeparture(req, res) {
  const reservation = reservationsModel.getByIdWithDetails(req.params.id);
  if (!reservation) return res.status(404).json({ error: 'RESERVATION_NOT_FOUND', message: 'Réservation introuvable.' });
  const closed = closedStayRefusal(reservation);
  if (closed) return res.status(409).json(closed);
  const departureLock = receptionSasLock(req, reservation, 'departure');
  if (departureLock) return res.status(403).json({ error: 'SAS_LOCKED', reason: departureLock });
  const draft = normaliseDepartureDraft(req, reservation);
  if (draft.refusal) return res.status(draft.refusal.status).json(draft.refusal.body);
  const plan = reservationsModel.planDepartureSas(Number(req.params.id), draft.input);
  const grows = departureGrowthRefusal(plan);
  if (grows) return res.status(grows.status).json(grows.body);
  return res.json(departureRecapFor(reservation, plan));
}

function commitDeparture(req, res) {
  const reservation = reservationsModel.getByIdWithDetails(req.params.id);
  if (!reservation) return res.status(404).json({ error: 'RESERVATION_NOT_FOUND', message: 'Réservation introuvable.' });
  const closed = closedStayRefusal(reservation);
  if (closed) return res.status(409).json(closed);
  const departureLock = receptionSasLock(req, reservation, 'departure');
  if (departureLock) return res.status(403).json({ error: 'SAS_LOCKED', reason: departureLock });
  const draft = normaliseDepartureDraft(req, reservation);
  if (draft.refusal) return res.status(draft.refusal.status).json(draft.refusal.body);
  const {
    cautionReturned, complementsSettled, complementsPaidCash, displayedDepartureTotal,
  } = draft.body;
  const id = Number(req.params.id);
  // Rule 25 — the recap the response carries is the plan this commit executes.
  const plan = reservationsModel.planDepartureSas(id, draft.input);
  const grows = departureGrowthRefusal(plan);
  if (grows) return res.status(grows.status).json(grows.body);
  const takeBack = refusalToTakeBack(id, departureTakeBackFlags(reservationsModel.getRow(id) || {}, { complementsSettled, complementsPaidCash }));
  if (takeBack) return res.status(takeBack.status).json(takeBackAnswer(req, takeBack));
  // specs/reservation-payment-ledger.md rules 12-13 (audit R38-DB-L1) — the SAS obeys the PATCH's guard: no return
  // of a caution that was never received (a stale SAS tab after « Caution reçue » was undone on the fiche).
  if (cautionReturned !== undefined && Boolean(cautionReturned) && !Number(reservation.cautionReceived)) {
    return res.status(409).json({ error: 'La caution n\'a pas encore été reçue.', code: 'CAUTION_NOT_RECEIVED' });
  }
  const recap = departureRecapFor(reservation, plan);
  // specs/mixed-method-payments.md rules 1, 32 — « Plusieurs moyens » at the check-out: the lines are validated
  // against the recap's total first; the gesture is « Compléments encaissés », in the caisse when every line is.
  const splitTenders = req.body && req.body.complementsTenders;
  let splitPrepared = null;
  if (splitTenders !== undefined) {
    // specs/mixed-method-payments.md rule 45 — reception records a check-out with one method: the dialog offers no split.
    if (isReceptionOnly(req.user)) return res.status(403).json({ error: 'FORBIDDEN', message: 'Plusieurs moyens : réservé à l\'administrateur.' });
    if (complementsSettled !== true) return res.status(400).json({ error: 'SPLIT_WITHOUT_SETTLEMENT', message: 'Plusieurs moyens : les compléments doivent être encaissés.' });
    splitPrepared = settlementService.prepare({
      tenders: splitTenders, dueCents: Math.round(Number(recap.grandTotal) * 100), shortfall: req.body.complementsShortfall,
      reservationId: id, target: { kind: 'bucket', buckets: unpaidBuckets(reservationsModel.getRow(id) || {}, ['complement', 'endOfStayComplement']) },
    });
    if (!splitPrepared.ok) return res.status(splitPrepared.status || 400).json({ error: 'INVALID_TENDERS', message: splitPrepared.error, field: splitPrepared.field });
  }
  const beforeSas = snapshotSas(id);
  const beforeSplit = reservationsModel.getRow(id) || {};
  reservationsModel.commitDepartureSas(id, {
    // Tri-state, same contract as the arrival caution (specs/reopen-completed-sas.md §6).
    cautionReturned: cautionReturned === undefined ? undefined : Boolean(cautionReturned),
    ...draft.input,
    // specs/recall-unpaid-arrival-complement-at-checkout.md — « Compléments encaissés » → mark paid every
    // positive complement (end-of-stay + recalled arrival) at the checkout moment.
    complementsSettled: complementsSettled === undefined ? undefined : Boolean(complementsSettled),
    complementsPaidCash: splitPrepared ? splitPrepared.allInternal : Boolean(complementsPaidCash),
  });
  // Rules 22-23 — the total the recap showed is compared, never used: the commit went through on its
  // own plan, and a difference is said and kept, as one more change of the `sas_departure` entry.
  // `stored` is what was written.
  const written = reservationsModel.getRow(id) || {};
  const stored = round2(Number(written.endOfStayComplementAmount || 0) + (plan.recall ? Number(written.complementAmount || 0) : 0));
  const warning = totalDiffered(displayedDepartureTotal, stored)
    ? { code: 'DEPARTURE_TOTAL_DIFFERED', displayed: round2(displayedDepartureTotal), stored }
    : null;
  recordSasHistory(id, 'sas_departure', beforeSas, warning ? [totalDifferenceChange(DEPARTURE_TOTAL_HISTORY, warning)] : []);
  const splitWarning = splitPrepared ? recordSasSplit(id, beforeSplit, splitPrepared, {
    tenders: splitTenders, shortfall: req.body.complementsShortfall,
  }) : null;
  return res.json({ ok: true, recap, warning: warning || splitWarning });
}

module.exports = {
  getSas, previewArrival, commitArrival, previewDeparture, commitDeparture,
};
// Le repli d'historique de la règle 10 est de la logique pure sur une liste de changements : exposé
// pour être épinglé sans monter tout le harnais du contrôleur.
module.exports.__test = { foldGroupedPayment, buildStayPayment, withoutLinenDecisions };
