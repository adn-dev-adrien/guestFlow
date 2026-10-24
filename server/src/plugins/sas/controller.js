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
const { buildSasSnapshot, computeSasChanges } = require('./sasAudit');
const { extinguisherCheckOn } = require('./settings');
const { nothingToCollect } = require('./nothingToCollect');
const { shapeArrivalRecap } = require('./arrivalRecap');
const { shapeDepartureRecap } = require('./departureRecap');

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
const { parseGroup } = sdk.coreModule('arrivalPaymentGroup');
const { CATERING_CATEGORY } = sdk.coreModule('optionCategoriesMigration');
const { isReceptionOnly } = sdk.coreModule('roles');
const { sasLockReason } = sdk.coreModule('sasEditWindow');
const { stayDueAtArrival, bucketStates } = sdk.coreModule('reservationSettlement');
const { isUnifiable, totalDiffered, round2 } = sdk.coreModule('arrivalSasPlan');
const { formatPlatformName, isDirectChannel } = sdk.coreModule('platformNameFormat');
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
  deposit: 'acompte', balance: 'solde', complement: 'complément',
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
      toText: `${group.total} € — ${group.cash === 1 ? 'caisse interne' : 'CB / Chèque'} le ${group.at} — ${covered}`,
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
    collectible: Math.round((due[key].due + (ownedOf(key) ? due[key].amount : 0)) * 100) / 100,
  });
  const deposit = withCollectible('deposit');
  const balance = withCollectible('balance');
  const settledHere = own.filter((b) => Number(b.atArrival || 0) === 1);
  const paid = settledHere.some((b) => Number(b.paid || 0) === 1);
  return {
    // specs/collect-stay-payment-at-check-in.md rule 6 (revised 2026-09-08) — the step exists for
    // the DIRECT channel only: a platform solde is the OTA's payout, wired after the stay, never
    // money to claim at the door (dashboard-collection-alert.md already treats it as « normal, not
    // an alert »). A platform SAS that settled the stay on an earlier run still gets the step, so
    // its own (mistaken) collection stays visible and undoable.
    applicable: (isDirectChannel(reservation.platform) && due.total > 0) || settledHere.length > 0,
    total: Math.round((deposit.collectible + balance.collectible) * 100) / 100,
    deposit,
    balance,
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
function normaliseArrivalDraft(req, reservation) {
  let body = req.body || {};
  if (isReceptionOnly(req.user)) body = toReceptionSasCommit(body);
  body = withoutLinenDecisions(Number(reservation.id), body);
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
  if (!found) return res.status(404).json({ error: 'RESERVATION_NOT_FOUND' });
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
    portalCode: String(settings.portalCode || '').trim(),
    // What live plugin modules add to the SAS, by plugin id (specs/plugins-phase-1-sdk.md rule 17):
    // e.g. `gate-access` says only whether there is a key to show — the step reads the code and its
    // QR through its own route, so rendering a QR never holds the SAS open.
    pluginData: pluginSasData(reservation.id),
    // `sasOrigin` = this row is the arrival SAS's own upsell → the step stays visible, pre-selected
    // « ajouté », and « Non merci » removes it (specs/sas-upsells-activate-catalogue-option.md §3.2).
    cleaning: { included: cleaningIncluded, price: cleaningPrice, sasOrigin: upsells.cleaning.sasOrigin },
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
function previewArrival(req, res) {
  const reservation = reservationsModel.getByIdWithDetails(req.params.id);
  if (!reservation) return res.status(404).json({ error: 'RESERVATION_NOT_FOUND' });
  const arrivalLock = receptionSasLock(req, reservation, 'arrival');
  if (arrivalLock) return res.status(403).json({ error: 'SAS_LOCKED', reason: arrivalLock });
  const draft = normaliseArrivalDraft(req, reservation);
  if (draft.refusal) return res.status(draft.refusal.status).json(draft.refusal.body);
  const plan = reservationsModel.planArrivalSas(Number(req.params.id), draft.input);
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
const ARRIVAL_TOTAL_HISTORY = { field: 'arrivalRecapTotal', label: 'Total du récapitulatif d’arrivée' };
const DEPARTURE_TOTAL_HISTORY = { field: 'departureRecapTotal', label: 'Total du récapitulatif de départ' };

function commitArrival(req, res) {
  const reservation = reservationsModel.getByIdWithDetails(req.params.id);
  if (!reservation) return res.status(404).json({ error: 'RESERVATION_NOT_FOUND' });
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
    cautionReceived,
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
  const recap = arrivalRecapFor(req, reservation, reservationsModel.planArrivalSas(Number(req.params.id), draft.input));
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
  const mode = arrivalPaymentMode === 'defer' ? 'later' : arrivalPaymentMode;
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

  const beforeSas = snapshotSas(Number(req.params.id));
  const complementAmount = reservationsModel.commitArrivalSas(Number(req.params.id), {
    // Tri-state: undefined (caution step not shown) leaves the marker untouched; the model sets or
    // clears it on a concrete boolean (specs/reopen-completed-sas.md §6).
    cautionReceived: cautionReceived === undefined ? undefined : Boolean(cautionReceived),
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
    complementSettled: unified.complementSettled,
    complementPaidCash: unified.complementPaidCash,
    // specs/collect-stay-payment-at-check-in.md §3.3 — the séjour settled at the door. Same tri-state
    // contract: undefined = the step never ran → the acompte / solde are left untouched.
    stayPaid: unified.stayPaid,
    stayPaidCash: unified.stayPaidCash,
    // specs/single-payment-at-check-in.md §3.2 — record the collection as ONE payment. The model
    // decides what the group may claim, from the buckets it really settled.
    groupArrivalPayment: unified.grouped,
    pluginWrites: draft.plugins.writes,
  });
  recordSasHistory(Number(req.params.id), 'sas_arrival', beforeSas);
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
    warning,
    pluginLines: draft.plugins.items.map(({ label, amount }) => ({ label, amount })),
  });
}

/**
 * specs/sas-departure-recap-server-side.md rules 3-4 — the departure draft, as the preview and the
 * commit both read it: the extinguisher setting, the reception guard is the route's, and the intents
 * resolved to priced lines. `input` is what `planDepartureSas` and `commitDepartureSas` take.
 */
function normaliseDepartureDraft(req, reservation) {
  const body = req.body || {};
  // specs/plugins-phase-p-productisation.md rule 16 — with the check off, no seal field is accepted.
  const checked = extinguisherCheckOn();
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
  if (!reservation) return res.status(404).json({ error: 'RESERVATION_NOT_FOUND' });
  const departureLock = receptionSasLock(req, reservation, 'departure');
  if (departureLock) return res.status(403).json({ error: 'SAS_LOCKED', reason: departureLock });
  const draft = normaliseDepartureDraft(req, reservation);
  const plan = reservationsModel.planDepartureSas(Number(req.params.id), draft.input);
  return res.json(departureRecapFor(reservation, plan));
}

function commitDeparture(req, res) {
  const reservation = reservationsModel.getByIdWithDetails(req.params.id);
  if (!reservation) return res.status(404).json({ error: 'RESERVATION_NOT_FOUND' });
  const departureLock = receptionSasLock(req, reservation, 'departure');
  if (departureLock) return res.status(403).json({ error: 'SAS_LOCKED', reason: departureLock });
  const draft = normaliseDepartureDraft(req, reservation);
  const {
    cautionReturned, complementsSettled, complementsPaidCash, displayedDepartureTotal,
  } = draft.body;
  const id = Number(req.params.id);
  // Rule 25 — the recap the response carries is the plan this commit executes.
  const plan = reservationsModel.planDepartureSas(id, draft.input);
  const recap = departureRecapFor(reservation, plan);
  const beforeSas = snapshotSas(id);
  reservationsModel.commitDepartureSas(id, {
    // Tri-state, same contract as the arrival caution (specs/reopen-completed-sas.md §6).
    cautionReturned: cautionReturned === undefined ? undefined : Boolean(cautionReturned),
    ...draft.input,
    // specs/recall-unpaid-arrival-complement-at-checkout.md — « Compléments encaissés » → mark paid every
    // positive complement (end-of-stay + recalled arrival) at the checkout moment.
    complementsSettled: complementsSettled === undefined ? undefined : Boolean(complementsSettled),
    complementsPaidCash: Boolean(complementsPaidCash),
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
  return res.json({ ok: true, recap, warning });
}

module.exports = {
  getSas, previewArrival, commitArrival, previewDeparture, commitDeparture,
};
// Le repli d'historique de la règle 10 est de la logique pure sur une liste de changements : exposé
// pour être épinglé sans monter tout le harnais du contrôleur.
module.exports.__test = { foldGroupedPayment, buildStayPayment, withoutLinenDecisions };
