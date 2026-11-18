// specs/pricing-components.md §3 rule 94 reading S14-3 (« the preview prices as the save ») — invariant harness of the stabilisation loop t16
// (sale `pa.js`, made permanent by the sale fixer, 2026-11-17). The fiche is reproduced from the client's OWN pure modules — the hydration
// (`bookingFormHydration`, `cardOccurrences`), the quote write-back (`applyQuoteToForm`) and the one request body of every quote of the fiche
// (`ficheQuoteBody`, S16-2) — and the PUT the page sends through the real route handler. For every fixture stay (direct, platform) × stay
// moment (before the arrival; arrival day before / after the check-in hour, validated or not; mid-stay validated or not; departure day; after;
// admin-unlocked mid-stay / late guest / after) × fiche gesture (free line, option, resource, paid flags), what the live preview shows when
// « Enregistrer » is clicked is what the save stores — figures AND each line's amount and routing — or the save refuses with a known code.
// Members found failing in t16: S16-1 (a free line's unit under « undefined » priced an added option), S16-2 (the save-time quote had no unlock).
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, beer, stay, row, todayIso, addDaysToIsoDate } = require('./saleRound1Fixtures');
const extraSale = require('../utils/extraSale');
const ctrl = require('../controllers/reservationsController');
const { storedBody } = require('../utils/stayOrderLines');
const { extraLineKey } = require('../utils/pricing/storedLines');

const linen = Number(db.prepare("INSERT INTO options (title, price, priceType) VALUES ('Linge matrice', 15, 'per_stay')").run().lastInsertRowid);
db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (9701, ?)').run(linen);
const spa = Number(db.prepare("INSERT INTO resources (name, quantity, price, priceType) VALUES ('Spa matrice', 1, 30, 'per_stay')").run().lastInsertRowid);
db.prepare('INSERT INTO resource_properties (resourceId, propertyId) VALUES (?, 9701)').run(spa);

const CLIENT = path.join(__dirname, '../../../client/src/utils');
const load = (name) => import(pathToFileURL(path.join(CLIENT, name)).href);
const cents = (x) => Math.round(Number(x || 0) * 100);
const clone = (x) => JSON.parse(JSON.stringify(x));
const call = (fn, body, params = {}) => new Promise((resolve, reject) => {
  const res = { statusCode: 200, status(s) { this.statusCode = s; return this; }, json(b) { resolve({ status: this.statusCode, body: b }); return this; }, set() { return this; }, setHeader() {}, end() { resolve({ status: this.statusCode }); } };
  Promise.resolve(fn({ body, params, query: {}, user: { role: 'admin', id: 1 }, headers: {} }, res)).catch(reject);
});
const hm = (time, dh) => { const [h, m] = String(time).split(':').map(Number); return `${String(Math.max(0, Math.min(23, h + dh))).padStart(2, '0')}:${String(m || 0).padStart(2, '0')}`; };
const instant = (date, time) => new Date(`${date}T${time}:00`).getTime();

const MOMENTS = {
  pre: (s) => ({ date: addDaysToIsoDate(s.startDate, -3), time: '12:00', val: 0 }),
  j0am: (s) => ({ date: s.startDate, time: hm(s.checkInTime, -3), val: 0 }),
  j0late: (s) => ({ date: s.startDate, time: hm(s.checkInTime, 2), val: 0 }),
  j0val: (s) => ({ date: s.startDate, time: hm(s.checkInTime, 2), val: 1 }),
  mid: (s) => ({ date: addDaysToIsoDate(s.startDate, 1), time: '12:00', val: 1 }),
  midLate: (s) => ({ date: addDaysToIsoDate(s.startDate, 1), time: '12:00', val: 0 }),
  dep: (s) => ({ date: s.endDate, time: '11:00', val: 1 }),
  after: (s) => ({ date: addDaysToIsoDate(s.endDate, 2), time: '12:00', val: 1 }),
  unlockMid: (s) => ({ date: addDaysToIsoDate(s.startDate, 1), time: '12:00', val: 1, unlock: 1 }),
  unlockLate: (s) => ({ date: addDaysToIsoDate(s.startDate, 1), time: '12:00', val: 0, unlock: 1 }),
  unlockAfter: (s) => ({ date: addDaysToIsoDate(s.endDate, 2), time: '12:00', val: 1, unlock: 1 }),
};
const GESTURES = ['none', 'addFree', 'addDup', 'addCase', 'removeFree', 'renameFree', 'renameSwap', 'raiseFree', 'lowerFree', 'offerFree',
  'toggleFreeIC', 'optQty', 'optAdd', 'optRemove', 'optToggleIC', 'resToggleIC', 'flagDep', 'flagBal', 'flagComp'];
// The refusals a fiche gesture can meet at some moment (the save writes nothing then).
const KNOWN_REFUSALS = new Set(['UNLOCKED_PRICE_CHANGED', 'ARRIVAL_LINE_RENAME', 'ARRIVAL_EXTRAS_FROZEN', 'MID_STAY_EXTRAS_CLOSED',
  'PAST_RESERVATION_LOCKED', 'OVERPAID', 'LINE_PAID', 'LINE_PAID_RENAMED', 'LINE_LABEL_TAKEN']);

let H; let CO; let AQ; let FQ;
test.before(async () => {
  [H, CO, AQ, FQ] = await Promise.all(['bookingFormHydration.js', 'cardOccurrences.js', 'applyQuoteToForm.js', 'ficheQuoteBody.js'].map(load));
});

// The stay of the matrix: booked 20 days ahead with a beer and the spa, then a free « Bois » 15 € sold from the sale panel at J-3.
function seeded(t, platform) {
  const id = stay(20);
  db.prepare('UPDATE reservations SET checkOutTime = ?, platform = ? WHERE id = ?').run('10:00', platform, id);
  const s = row(id);
  t.mock.timers.enable({ apis: ['Date'], now: instant(addDaysToIsoDate(s.startDate, -10), '12:00') });
  const booked = ctrl.performUpdate(id, { ...storedBody(id), options: [{ optionId: beer, quantity: 1 }], resources: [{ resourceId: spa, quantity: 1 }], restatePricing: true }, { now: new Date() });
  assert.equal(booked.status, 200, JSON.stringify(booked.body));
  t.mock.timers.setTime(instant(addDaysToIsoDate(s.startDate, -3), '12:00'));
  assert.equal(extraSale.sell(id, [{ articleRef: 'custom', label: 'Bois', amount: 15 }], { now: new Date() }).status, 200);
  return id;
}

// GET → the form the page builds (reservation branch), through the client's own mappers.
function formOf(res, catalogue) {
  return {
    ...res,
    customPrice: res.customPrice == null ? '' : res.customPrice,
    depositAmountOverride: res.depositAmountOverride == null || res.depositAmountOverride === '' ? '' : Number(res.depositAmountOverride),
    complementAmountOverride: res.complementAmountOverride == null ? '' : res.complementAmountOverride,
    endOfStayComplementAmountOverride: res.endOfStayComplementAmountOverride == null ? '' : res.endOfStayComplementAmountOverride,
    platformCommissionAmount: res.platformCommissionAmount ?? '', acompteCommissionAmount: res.acompteCommissionAmount ?? '',
    platformGrossAmount: res.platformGrossAmount ?? '', platformPayoutAmount: res.platformPayoutAmount ?? '', platformTouristTaxAmount: res.platformTouristTaxAmount ?? '',
    discountPercent: res.discountPercent || 0, discountTarget: res.discountTarget || 'nights',
    singleBeds: res.singleBeds ?? '', doubleBeds: res.doubleBeds ?? '', babyBeds: res.babyBeds ?? '',
    depositPaid: Boolean(res.depositPaid), balancePaid: Boolean(res.balancePaid), complementPaid: Boolean(res.complementPaid),
    depositPaidDate: res.depositPaidDate || '', balancePaidDate: res.balancePaidDate || '', complementPaidDate: res.complementPaidDate || '',
    touristTaxInComplement: Boolean(res.touristTaxInComplement),
    selectedOptions: H.hydrateSelectedOptions(res.options, res, catalogue, CO.buildGridFromStored),
    ...H.hydrateLaterLines(res.options, res.resources),
    customOptions: H.hydrateCustomOptions(res.options),
    selectedResources: H.hydrateSelectedResources(res.resources),
    autoOptionsInComplement: [],
  };
}

function gesture(g, form, m, offered) {
  const free = form.customOptions || [];
  const bois = free.find((l) => /^bois$/i.test(l.description));
  const setFree = (patch) => { form.customOptions = free.map((l) => (l === bois ? { ...l, ...patch } : l)); };
  const addFree = (description, amount = 10) => { form.customOptions = [...free, { customKey: `custom_new_${description}`, description, amount, offered: false }]; };
  const firstOpt = (form.selectedOptions || []).find((o) => Number(o.optionId) === beer);
  switch (g) {
    case 'none': return offered;
    case 'addFree': addFree('Neuf'); return offered;
    case 'addDup': addFree(bois.description); return offered;
    case 'addCase': addFree(`  ${bois.description.toUpperCase()}  `); return offered;
    case 'removeFree': form.customOptions = free.filter((l) => l !== bois); return offered;
    case 'renameFree': setFree({ description: 'Renommé' }); return offered;
    case 'renameSwap': setFree({ description: 'Renommé' }); form.customOptions.push({ customKey: 'custom_swap', description: 'Bois', amount: 10, offered: false }); return offered;
    case 'raiseFree': setFree({ amount: Number(bois.amount) + 5 }); return offered;
    case 'lowerFree': setFree({ amount: Math.max(1, Number(bois.amount) - 3) }); return offered;
    case 'offerFree': setFree({ offered: !bois.offered }); return offered;
    case 'toggleFreeIC': setFree({ inComplement: !bois.inComplement }); return offered;
    case 'optQty': form.selectedOptions = form.selectedOptions.map((o) => (o === firstOpt ? { ...o, quantity: Number(o.quantity || 0) + 1 } : o)); return offered;
    case 'optAdd': form.selectedOptions = [...form.selectedOptions, { optionId: linen, quantity: 1 }]; return offered;
    case 'optRemove': form.selectedOptions = form.selectedOptions.filter((o) => o !== firstOpt); return new Set([...offered].filter((x) => x !== beer));
    case 'optToggleIC': form.selectedOptions = form.selectedOptions.map((o) => (o === firstOpt ? { ...o, inComplement: !o.inComplement } : o)); return offered;
    case 'resToggleIC': form.selectedResources = form.selectedResources.map((r) => (Number(r.resourceId) === spa ? { ...r, inComplement: !r.inComplement } : r)); return offered;
    case 'flagDep': form.depositPaid = !form.depositPaid; form.depositPaidDate = form.depositPaid ? m.date : ''; return offered;
    case 'flagBal': form.balancePaid = !form.balancePaid; form.balancePaidDate = form.balancePaid ? m.date : ''; return offered;
    case 'flagComp': form.complementPaid = !form.complementPaid; form.complementPaidDate = form.complementPaid ? m.date : ''; return offered;
    default: throw new Error(`gesture ${g}`);
  }
}

// Each line's amount and routing, by key, as the preview prices it and as the save stores it.
function previewLines(quote) {
  const out = {};
  const add = (k, total, ic) => { const e = out[k] || (out[k] = { t: 0, ic: new Set() }); e.t += cents(total); e.ic.add(ic ? 1 : 0); };
  for (const l of quote.optionLines || []) if (!l.isAuto && !l.autoEnabled) add(l.isCustom ? l.key : `opt:${l.optionId}`, l.offered ? 0 : l.totalPrice, l.inComplement);
  for (const l of quote.resourceLines || []) add(`res:${l.resourceId}`, l.offered ? 0 : l.totalPrice, l.inComplement);
  return out;
}
function storedLines(id) {
  const out = {};
  const add = (k, total, ic) => { const e = out[k] || (out[k] = { t: 0, ic: new Set() }); e.t += cents(total); e.ic.add(ic ? 1 : 0); };
  for (const l of db.prepare('SELECT o.optionId, o.totalPrice, o.offered, o.inComplement, op.autoEnabled FROM reservation_options o LEFT JOIN options op ON op.id = o.optionId WHERE reservationId = ?').all(id)) {
    if (!l.autoEnabled) add(`opt:${l.optionId}`, l.offered ? 0 : l.totalPrice, l.inComplement);
  }
  for (const l of db.prepare('SELECT description, amount, offered, inComplement, discountCents FROM reservation_custom_options WHERE reservationId = ?').all(id)) {
    add(extraLineKey({ isCustom: true, description: l.description }), l.offered ? 0 : l.amount - Number(l.discountCents || 0) / 100, l.inComplement);
  }
  for (const l of db.prepare('SELECT resourceId, totalPrice, offered, inComplement FROM reservation_resources WHERE reservationId = ?').all(id)) add(`res:${l.resourceId}`, l.offered ? 0 : l.totalPrice, l.inComplement);
  return out;
}
const lineDiffs = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])]
  .map((k) => [k, a[k] ? `${a[k].t}:${[...a[k].ic].sort().join('')}` : '-', b[k] ? `${b[k].t}:${[...b[k].ic].sort().join('')}` : '-'])
  .filter(([, x, y]) => x !== y).map(([k, x, y]) => `${k} preview=${x} stored=${y}`);

const tally = { saved: 0, refused: 0 };
for (const platform of ['direct', 'Booking']) {
  for (const [mName, momentOf] of Object.entries(MOMENTS)) {
    test(`${platform} × ${mName}: every fiche gesture saves what its live preview showed`, async (t) => {
      // The seeded stay is the same for every gesture: it is booked once per test, and each gesture runs and rolls back on it
      // (specs/server-test-isolation.md rule 22).
      db.exec('SAVEPOINT seed');
      try {
        const id = seeded(t, platform);
        for (const g of GESTURES) {
          db.exec('SAVEPOINT matrix');
          try {
            const s = row(id);
            const m = momentOf(s);
            t.mock.timers.setTime(instant(m.date, m.time));
            db.prepare('UPDATE reservations SET checkInDone = ?, arrivalSasDoneAt = NULL WHERE id = ?').run(m.val, id);
            const res = (await call(ctrl.getById, undefined, { id: String(id) })).body;
            const catalogue = db.prepare('SELECT * FROM options').all();
            const form = formOf(res, catalogue);
            const locked = Boolean(res.editLock && res.editLock.locked);
            if (m.unlock && !locked) continue;
            const offered = gesture(g, form, m, H.hydrateOfferedOptionIds(res.options));
            const lockedOptionUnits = H.frozenUnitPrices(res.options, 'optionId');
            const bodyOf = () => FQ.ficheQuoteBody({
              form, propertyId: form.propertyId, catalogue, offeredOptionIds: offered, lockedOptionUnits,
              lockedResourceUnits: H.frozenUnitPrices(res.resources, 'resourceId'), forceCurrentPricing: false, refreshTouristTax: false,
              reservationId: id, unlockPast: Boolean(m.unlock),
            });
            assert.ok(!Object.prototype.hasOwnProperty.call(lockedOptionUnits, 'undefined'), 'S16-1: no unit keyed « undefined »');
            // The live effect re-asks while the quote changes the form; then « Enregistrer » asks the same body once more.
            let body = bodyOf();
            let live = await call(ctrl.calculatePrice, clone(body));
            for (let k = 0; k < 3 && live.status === 200; k += 1) {
              Object.assign(form, AQ.applyQuoteToForm(form, live.body, {}));
              const next = bodyOf();
              if (JSON.stringify(next) === JSON.stringify(body)) break;
              body = next;
              live = await call(ctrl.calculatePrice, clone(body));
            }
            assert.equal(live.status, 200, `${g}: ${JSON.stringify(live.body)}`);
            const quote = (await call(ctrl.calculatePrice, clone(bodyOf()))).body;
            const put = {
              ...(m.unlock ? { unlockPast: true } : {}), loadedUpdatedAt: res.updatedAt || undefined, propertyId: Number(form.propertyId), clientId: form.clientId,
              reservationNumber: form.reservationNumber || '', startDate: form.startDate, endDate: form.endDate, adults: form.adults, children: form.children,
              teens: form.teens, babies: form.babies, singleBeds: form.singleBeds === '' ? null : Number(form.singleBeds),
              doubleBeds: form.doubleBeds === '' ? null : Number(form.doubleBeds), babyBeds: form.babyBeds === '' ? null : Number(form.babyBeds),
              checkInTime: form.checkInTime, checkOutTime: form.checkOutTime, platform: form.platform, touristTaxInComplement: form.touristTaxInComplement ? 1 : 0,
              autoOptionsInComplement: [], refreshTouristTax: false, totalPrice: quote.totalPrice, discountPercent: form.discountPercent,
              discountTarget: form.discountTarget, finalPrice: quote.finalPrice, customPrice: form.customPrice, extraGuestSurchargeOffered: Boolean(form.extraGuestSurchargeOffered),
              depositAmount: quote.depositAmount, depositDueDate: quote.depositDueDate, depositAmountOverride: form.depositAmountOverride === '' ? null : Number(form.depositAmountOverride),
              complementAmountOverride: form.complementAmountOverride === '' ? null : Number(form.complementAmountOverride),
              endOfStayComplementAmountOverride: form.endOfStayComplementAmountOverride === '' ? null : Number(form.endOfStayComplementAmountOverride),
              depositDisabled: Boolean(form.depositDisabled), depositPaid: form.depositPaid, depositPaidDate: form.depositPaidDate || null,
              balanceAmount: quote.balanceAmount, balanceDueDate: quote.balanceDueDate, balancePaid: form.balancePaid, balancePaidDate: form.balancePaidDate || null,
              complementPaid: form.complementPaid, complementPaidDate: form.complementPaidDate || null, complementAmount: quote.complementAmount,
              platformCommissionAmount: form.platformCommissionAmount === '' ? null : form.platformCommissionAmount,
              acompteCommissionAmount: form.acompteCommissionAmount === '' ? null : form.acompteCommissionAmount,
              platformGrossAmount: form.platformGrossAmount === '' ? null : form.platformGrossAmount, platformPayoutAmount: form.platformPayoutAmount === '' ? null : form.platformPayoutAmount,
              platformTouristTaxAmount: form.platformTouristTaxAmount === '' ? null : form.platformTouristTaxAmount, cautionAmount: form.cautionAmount, notes: form.notes,
              refreshPricingToCurrent: false, forceMinNights: true, forceCapacity: true, forceChangeover: true, forceMaxNights: true, forceOverpayment: false, forceTypedCounts: false,
              offeredOptionIds: Array.from(offered), options: FQ.selectedOptionsPayload(form, catalogue), customOptions: FQ.customOptionsPayload(form.customOptions),
              resources: quote.resourceLines,
            };
            const saved = await call(ctrl.update, clone(put), { id: String(id) });
            if (saved.status !== 200) {
              assert.ok(KNOWN_REFUSALS.has(saved.body && saved.body.code), `${g}: unexpected refusal ${saved.status} ${JSON.stringify(saved.body)}`);
              tally.refused += 1;
              continue;
            }
            tally.saved += 1;
            const after = row(id);
            for (const field of ['finalPrice', 'depositAmount', 'balanceAmount', 'complementAmount', 'touristTaxTotal']) {
              assert.equal(cents(live.body[field]), cents(after[field]), `${g}: ${field}`);
            }
            assert.deepEqual(lineDiffs(previewLines(live.body), storedLines(id)), [], `${g}: lines`);
          } finally {
            db.exec('ROLLBACK TO matrix');
            db.exec('RELEASE matrix');
          }
        }
      } finally {
        t.mock.timers.reset();
        db.exec('ROLLBACK TO seed');
        db.exec('RELEASE seed');
      }
    });
  }
}

test.after(() => {
  // The harness stays a harness: most gestures save (the refusals are the locked moments' own).
  assert.ok(tally.saved > tally.refused, JSON.stringify(tally));
});
