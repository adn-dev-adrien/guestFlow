/**
 * A stand-in for the server's arrival preview (specs/sas-arrival-total-server-side.md §4.3) and, further
 * down, for its departure preview (specs/sas-departure-recap-server-side.md §4.3), for the
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
    const units = s.occurrences ? s.occurrences.length * (offer.perPerson ? Number(s.persons) : 1) : Number(s.units);
    const real = round2(Number(offer.unitPrice) * units);
    sales.push({ optionId: Number(offer.optionId), units, amount: real });
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
  const catering = (payload.sasSales?.catering?.options || []).map((o) => sales.find((s) => s.optionId === Number(o.optionId)) || { optionId: Number(o.optionId), units: 0, amount: 0 });
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
      breakfast: breakfastId != null ? (sales.find((s) => s.optionId === breakfastId) || { optionId: breakfastId, units: 0, amount: 0 }) : null,
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

// ---------------------------------------------------------------------------------------------
// The departure preview (specs/sas-departure-recap-server-side.md §4.3). Same contract as above: the
// dialog renders what the server answers, so the double answers like it for the fixture payload. The
// arithmetic itself is pinned server-side (server/src/tests/sas-departure-plan.unit.test.js).
// ---------------------------------------------------------------------------------------------

const CLEANING_LABEL = 'Ménage de fin de séjour';
const storedKeyFor = (index) => `stored:${index}:test`;

function parseDetail(reservation) {
  try { return JSON.parse((reservation && reservation.endOfStayComplementDetail) || '[]') || []; } catch { return []; }
}

// The real price of a stored line, as the server reads it.
const realOfStored = (l) => (Number(l.offered || 0) === 1
  ? round2(l.originalAmount != null ? l.originalAmount : (Number(l.qty) || 1) * Number(l.unitPrice || 0))
  : round2(l.amount));

// What the server classifies out of the stored detail: the lines a run carries (tagged `source`) or
// preserves (a label that maps to no priced item), each with its key.
export function storedLinesOf(reservation, linenItems = []) {
  const priced = new Set(linenItems.map((i) => String(i.label).trim()));
  return parseDetail(reservation)
    .map((line, index) => ({ line, index, key: storedKeyFor(index) }))
    .filter(({ line }) => line && line.source !== 'adjustment')
    .filter(({ line }) => line.source
      || !(String(line.repairKey || '').startsWith('extinguisher') || String(line.label).trim() === CLEANING_LABEL || priced.has(String(line.label).trim())));
}

/** The `departureSeed` of the SAS read, for a fixture whose reservation carries a stored detail. */
export function departureSeedFor(reservation, linenItems = []) {
  const stored = storedLinesOf(reservation, linenItems);
  return {
    missingItems: {}, cleaningCharged: false, extinguisherQty: {},
    storedKeys: stored.map((e) => e.key),
    offeredKeys: stored.filter((e) => Number(e.line.offered || 0) === 1).map((e) => e.key),
  };
}

export function departureRecapFor(payload, draft = {}) {
  const r = payload.reservation || {};
  const offeredRefs = new Set((draft.offeredArrivalExtras || []).map((x) => `${x.kind}:${Number(x.id)}`));
  const decisions = new Map((draft.storedLines || []).map((x) => [x.key, Boolean(x.offered)]));
  const own = [];
  const line = (key, group, label, qty, unitPrice, real, offered, extra = {}) => ({
    key, group, label, qty, unitPrice, real, billed: offered ? 0 : real, offerable: Boolean(key), offered: Boolean(offered), ...extra,
  });
  if (draft.cleaningCharged && !payload.cleaning?.included && Number(payload.cleaning?.price) > 0) {
    const price = round2(payload.cleaning.price);
    own.push({ rank: 0, ...line('depCleaning', 'endOfStay', CLEANING_LABEL, 1, price, price, draft.cleaningOffered) });
  }
  for (const m of (draft.missingItems || [])) {
    const item = (payload.linenItems || []).find((i) => Number(i.id) === Number(m.itemId));
    if (!item || !(Number(m.qty) > 0)) continue;
    own.push({ rank: 0, ...line(`dep:${item.id}`, 'endOfStay', item.label, Number(m.qty), Number(item.price), round2(Number(item.price) * Number(m.qty)), m.offered) });
  }
  for (const { line: l, key } of storedLinesOf(r, payload.linenItems)) {
    const offered = decisions.has(key) ? decisions.get(key) : Number(l.offered || 0) === 1;
    own.push({ rank: l.source ? 1 : 3, ...line(key, 'stored', l.label, Number(l.qty || 1), Number(l.unitPrice || 0), realOfStored(l), offered) });
  }
  if (draft.extinguisherSealOkAtDeparture === 0) {
    for (const c of (draft.extinguisherCharges || [])) {
      const tariff = (payload.repairAmounts || []).find((t) => t.repairKey === c.repairKey);
      if (!tariff || !(Number(c.qty) > 0)) continue;
      own.push({ rank: 2, ...line(`ext:${c.repairKey}`, 'extinguisher', tariff.label, Number(c.qty), Number(tariff.price), round2(Number(tariff.price) * Number(c.qty)), c.offered) });
    }
  }
  const ordered = own.map((l, i) => ({ l, i })).sort((a, b) => a.l.rank - b.l.rank || a.i - b.i).map(({ l: { rank, ...rest } }) => rest);
  const endOfStayTotal = round2(ordered.reduce((s, l) => s + l.billed, 0));
  const extinguisherTotal = round2(ordered.filter((l) => l.group === 'extinguisher').reduce((s, l) => s + l.billed, 0));

  const ac = payload.arrivalComplement;
  const recalled = ac && Number(ac.amount) > 0 && Number(ac.paid) !== 1;
  let recall = null;
  let recalledLines = [];
  if (recalled) {
    let delta = 0;
    recalledLines = (ac.detail || []).map((l) => {
      const key = l.ref ? `${l.ref.kind}:${l.ref.id}` : null;
      const stored = Number(l.offered || 0) === 1;
      const real = realOfStored(l);
      const offered = Boolean(key) && offeredRefs.has(key);
      if (key) delta += (offered && !stored ? -real : 0) + (!offered && stored ? real : 0);
      return line(key, 'recalled', l.label, Number(l.qty || 1), Number(l.unitPrice || 0), real, offered, { billed: key ? (offered ? 0 : real) : round2(l.amount) });
    });
    recall = { shown: true, framing: ordered.length > 0 ? 'merged' : 'alone', total: Math.max(0, round2(Number(ac.amount) + delta)) };
  }
  const grandTotal = round2(endOfStayTotal + (recall ? recall.total : 0));
  let notes = [];
  try { notes = JSON.parse(r.midStaySettledNotes || '[]') || []; } catch { notes = []; }
  return {
    lines: [...ordered, ...recalledLines],
    endOfStayTotal,
    extinguisherTotal,
    recall,
    grandTotal,
    settleable: grandTotal > 0,
    nothingToCollect: Boolean(payload.nothingToCollect) && grandTotal <= 0,
    endOfStayPaid: Number(r.endOfStayComplementPaid || 0) === 1
      ? { date: r.endOfStayComplementPaidDate || null, cash: Number(r.endOfStayComplementPaidCash || 0) === 1 } : null,
    midStaySettled: round2(notes.reduce((s, n) => s + (Number(n && n.total) || 0), 0)),
    adjusted: null,
  };
}

/** The mock implementation of `api.previewDepartureSas`: answers for the payload the dialog last loaded. */
export function departurePreviewLikeTheServer(api) {
  return async (id, draft) => {
    const results = api.getReservationSas.mock.results;
    const payload = await results[results.length - 1].value;
    return departureRecapFor(payload, draft);
  };
}
