/**
 * A stand-in for the server's arrival preview (specs/sas-arrival-total-server-side.md §4.3), for the
 * ReservationSasDialog suites. The dialog no longer prices anything: it renders what
 * `POST …/sas/arrival/preview` answers. These suites test THAT rendering and the draft it sends, so the
 * double answers like the server would for the fixture payload (`sasPayload`) the test loaded — the
 * arithmetic itself is pinned server-side (server/src/tests/sas-arrival-plan.unit.test.js).
 *
 * Usage, in a suite whose `api` mock declares `previewArrivalSas: vi.fn()`:
 *   beforeEach(() => { vi.clearAllMocks(); api.previewArrivalSas.mockImplementation(previewLikeTheServer(api)); });
 */

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function refKey(x) {
  if (x.resourceId != null && x.optionId == null && x.customOptionId == null) return `resource:${Number(x.resourceId)}`;
  return Number(x.isCustom || 0) === 1 ? `custom:${Number(x.customOptionId)}` : `option:${Number(x.optionId)}`;
}

export function recapFor(payload, draft = {}) {
  const r = payload.reservation || {};
  const offeredSet = Array.isArray(draft.offeredExtras)
    ? new Set(draft.offeredExtras.map((x) => `${x.kind}:${Number(x.id)}`)) : null;
  const isOffered = (key, stored) => (offeredSet ? offeredSet.has(key) : stored);
  const lines = [];
  let offerDelta = 0;
  for (const x of [...(r.options || []), ...(r.resources || [])]) {
    if (Number(x.inComplement) !== 1 || Number(x.sasArrivalOrigin || 0) === 1) continue;
    if (!(Number(x.originalTotalPrice ?? x.totalPrice ?? 0) > 0)) continue;
    const stored = Number(x.offered || 0) === 1;
    const real = round2(stored ? (x.originalTotalPrice ?? x.totalPrice) : (x.totalPrice ?? x.originalTotalPrice));
    const key = refKey(x);
    const offered = isOffered(key, stored);
    offerDelta += (offered && !stored ? -real : 0) + (!offered && stored ? real : 0);
    lines.push({
      key, group: 'existing', label: String(x.title || x.name || 'Prestation'), qty: Number(x.billedUnits || x.quantity || 1),
      unitPrice: round2(x.unitPrice), real, billed: offered ? 0 : real, offerable: true, offered,
    });
  }
  const extraGuests = round2(r.extraGuestComplementSurcharge);
  if (extraGuests > 0) {
    const count = Number(r.extraGuestComplementCount || 1);
    const stored = Number(r.extraGuestSurchargeOffered || 0) === 1;
    const offered = isOffered('extraGuests:0', stored);
    offerDelta += (offered && !stored ? -extraGuests : 0) + (!offered && stored ? extraGuests : 0);
    lines.push({
      key: 'extraGuests:0', group: 'existing', label: `Voyageurs ajoutés · ${count} pers.`, qty: count,
      unitPrice: round2(extraGuests / count), real: extraGuests, billed: offered ? 0 : extraGuests, offerable: true, offered,
    });
  }
  const tax = round2(r.touristTaxInComplementAmount);
  if (tax > 0) lines.push({ key: null, group: 'existing', label: 'Taxe de séjour', qty: 1, unitPrice: tax, real: tax, billed: tax, offerable: false, offered: false });

  const added = [];
  for (const l of (draft.linenItems || [])) {
    const item = (payload.linenItems || []).find((i) => Number(i.id) === Number(l.itemId));
    if (!item || !(Number(l.qty) > 0)) continue;
    const real = round2(Number(item.price) * Number(l.qty));
    added.push({ key: `bed:${item.id}`, group: 'added', label: item.label, qty: Number(l.qty), unitPrice: Number(item.price), real, billed: l.offered ? 0 : real, offerable: true, offered: Boolean(l.offered) });
  }
  const sasRow = (type) => (r.options || []).find((o) => !o.isCustom && String(o.autoOptionType || '') === type && Number(o.sasArrivalOrigin || 0) === 1);
  const cleaningKept = draft.cleaningAdded === undefined && sasRow('cleaning');
  if ((draft.cleaningAdded && payload.cleaning?.price) || cleaningKept) {
    const real = round2(payload.cleaning?.price || cleaningKept?.originalTotalPrice || 0);
    const offered = draft.cleaningAdded === undefined ? Number(cleaningKept.offered || 0) === 1 : Boolean(draft.cleaningOffered);
    added.push({ key: 'cleaning', group: 'added', label: 'Ménage', qty: 1, unitPrice: real, real, billed: offered ? 0 : real, offerable: true, offered });
  }
  if (draft.bathLinenAdded && payload.bathLinen?.available) {
    const real = round2(payload.bathLinen.amount);
    added.push({
      key: 'bathLinen', group: 'added', label: payload.bathLinen.label, qty: Number(payload.bathLinen.persons) || 1,
      unitPrice: round2(payload.bathLinen.unitPrice), real, billed: draft.bathLinenOffered ? 0 : real, offerable: true, offered: Boolean(draft.bathLinenOffered),
    });
  }
  const offers = [payload.sasSales?.breakfast, ...(payload.sasSales?.catering?.options || [])].filter(Boolean);
  const sales = [];
  for (const s of (draft.soldOptions || [])) {
    const offer = offers.find((o) => Number(o.optionId) === Number(s.optionId));
    if (!offer) continue;
    const units = s.occurrences ? s.occurrences.length * (offer.perPerson ? Math.min(Number(s.persons), Math.max(1, Number(offer.maxPersons) || 1)) : 1) : Number(s.units);
    const real = round2(Number(offer.unitPrice) * units);
    const covers = s.occurrences && offer.perPerson ? Math.min(Number(s.persons), Math.max(1, Number(offer.maxPersons) || 1)) : null;
    const billed = s.occurrences ? s.occurrences.length * (offer.perPerson ? covers : 1) : Number(s.units);
    sales.push({
      optionId: Number(offer.optionId), moments: s.occurrences ? s.occurrences.length : null, servedPersons: covers,
      units: billed, unitPrice: Number(offer.unitPrice), amount: round2(Number(offer.unitPrice) * billed),
    });
    added.push({ key: null, group: 'added', label: offer.title, qty: units, unitPrice: Number(offer.unitPrice), real, billed: real, offerable: false, offered: false });
  }
  // Plugin lines: the hourly-resources evening supplement the server bills, and a plugin's stored
  // line when that plugin is off (rule 8 of phase 3c).
  for (const res of (payload.pluginData?.['hourly-resources']?.resources || [])) {
    const real = round2(res.supplement);
    if (real > 0) added.push({ key: null, group: 'plugin', label: res.supplementLabel, qty: 1, unitPrice: real, real, billed: real, offerable: false, offered: false });
  }
  for (const o of (r.options || [])) {
    if (!o.isCustom || !o.sasLineKey || payload.pluginData?.[String(o.sasLineKey).split(':')[0]]) continue;
    const real = round2(o.unitPrice ?? o.amount);
    added.push({ key: null, group: 'plugin', label: String(o.description || o.title), qty: 1, unitPrice: real, real, billed: real, offerable: false, offered: false });
  }
  for (const k of (draft.keptLines || [])) {
    const row = (r.options || []).find((o) => o.isCustom && Number(o.customOptionId) === Number(k.customOptionId));
    if (!row) continue;
    const real = round2(row.unitPrice ?? row.amount);
    added.push({ key: `kept:${k.customOptionId}`, group: 'kept', label: String(row.description || row.title), qty: 1, unitPrice: real, real, billed: k.offered ? 0 : real, offerable: true, offered: Boolean(k.offered) });
  }

  const sasOrigin = (r.options || []).filter((o) => Number(o.sasArrivalOrigin) === 1 && Number(o.offered || 0) !== 1)
    .reduce((s, o) => s + Number(o.isCustom ? (o.unitPrice ?? o.amount ?? o.totalPrice ?? 0) : (o.totalPrice ?? 0)), 0);
  const addedSum = round2(added.reduce((s, l) => s + l.billed, 0));
  const paid = Number(r.complementPaid || 0) === 1;
  const existingTotal = Math.max(0, round2(Number(r.complementAmount || 0) - sasOrigin + offerDelta));
  const total = paid ? round2(r.complementAmount) : round2(existingTotal + addedSum);
  const stayDue = payload.stayPayment?.applicable ? round2(payload.stayPayment.total) : 0;
  const breakfastId = payload.sasSales?.breakfast?.available ? Number(payload.sasSales.breakfast.optionId) : null;
  const catering = (payload.sasSales?.catering?.options || []).map((o) => sales.find((s) => s.optionId === Number(o.optionId)) || { optionId: Number(o.optionId), moments: 0, servedPersons: null, units: 0, unitPrice: Number(o.unitPrice), amount: 0 });
  return {
    lines: [...lines, ...added],
    existingTotal: paid ? round2(r.complementAmount) : existingTotal,
    addedTotal: addedSum,
    arrivalComplementTotal: total,
    stayDue,
    totalAtArrival: round2(stayDue + total),
    unifiable: Boolean(payload.arrivalPayment?.complementOpen) && Boolean(payload.stayPayment?.applicable) && total > 0,
    complementOpen: Boolean(payload.arrivalPayment?.complementOpen),
    nothingToCollect: Boolean(payload.nothingToCollect),
    supplementOutsideComplement: paid ? addedSum : 0,
    adjusted: null,
    sales: {
      breakfast: breakfastId != null ? (sales.find((s) => s.optionId === breakfastId) || { optionId: breakfastId, moments: 0, servedPersons: null, units: 0, unitPrice: Number(payload.sasSales.breakfast.unitPrice), amount: 0 }) : null,
      catering: { options: catering, amount: round2(catering.reduce((s, o) => s + o.amount, 0)) },
    },
  };
}

/** The mock implementation: answers for the payload the dialog last loaded. */
export function previewLikeTheServer(api) {
  return async (id, draft) => {
    const results = api.getReservationSas.mock.results;
    const payload = await results[results.length - 1].value;
    return recapFor(payload, draft);
  };
}
