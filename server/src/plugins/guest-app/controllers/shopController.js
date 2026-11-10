/**
 * `GET /public/v1/guest/shop` — the sellable catalogue of the stay's lodging, ready to render
 * (specs/guest-app.md rules 23-27). Prices and labels are GuestFlow's, per lodging, through the core
 * projections the website shows; the free / included state is `sellable.js`'s; the shop is open exactly
 * when the fiche takes mid-stay extras; the service hours of §3.G come from `serviceHours.js`.
 *
 * `GET /shop/resources/:id/slots` — the bookable slots of an hourly resource, read from the resource planning
 * by the scheduler `hourly-resources` declares (rules 28-31); `POST /shop/delivery-slots` — the delivery times
 * of a cart's staff-prepared items (rules 41-42).
 */

const sdk = require('../../sdk');
const { parisDate } = require('../currentStay');
const { BREAKFAST, DEFAULT_BREAKFAST_TIME, remainingMornings, shopItems, stayConsumption } = require('../sellable');
const { languageOf } = require('../language');
const { fail, refusal } = require('../refusals');
const { shopStockView } = require('../stock');
const { deliveryQuestion } = require('../orderLabels');
const {
  deliveryPicker, deliveryTimes, ignitionInHours, serviceState,
} = require('../serviceHours');

const publicHttp = sdk.coreModule('publicHttp');
const { toPublicOption, toPublicResource, hoursLabel, isOfferedPlural } = sdk.coreModule('publicCatalogProjection');
const { isDirectChannel } = sdk.coreModule('platformNameFormat');
const { isOffered } = sdk.coreModule('resourceOffer');
const paymentProviders = sdk.coreModule('paymentProviders');
const { groupOptionsByCategory } = sdk.coreModule('optionGrouping');
const { isRealIsoDay } = sdk.coreModule('stayDates');

// Rule 26 — hourly resources are sold in « Bien-être »; what has no category closes the list.
const WELLNESS = 'Bien-être';

// Rule 28, §6.4 — the guest is shown only the slots it can book.
const BOOKABLE = Object.freeze(new Set(['free', 'evening']));
const ORDER_KINDS = Object.freeze(['option', 'breakfast', 'resource']);
const MAX_LINES = 20;

const LABELS = Object.freeze({
  fr: Object.freeze({
    included: 'Inclus',
    stayIncluded: 'Compris dans votre séjour',
    offered: 'Offert',
    eveningRate: 'tarif soirée',
    eveningExtra: (price) => `+ ${price} soirée`,
    bathClosed: 'Fermé',
    bathFull: 'Complet',
    includedHours: (hours) => `${hours} comprise${hours === '1 h' ? '' : 's'} dans votre séjour, à programmer`,
    perPersonPerMorning: 'par personne et par matin',
    alreadyIncluded: 'Déjà inclus dans votre séjour',
    ordersOpenOnArrival: 'Pour ce séjour, les commandes ouvrent à votre arrivée.',
    payOnArrival: 'Régler à l’arrivée',
    addToBill: 'Ajouter à ma note',
    closed: 'La boutique est fermée. Bon retour chez vous !',
    noDeliveryLeft: 'Plus disponible pour votre séjour',
    wellness: WELLNESS,
    other: 'Autres',
    unitsLeft: (n) => `${n} offert${n > 1 ? 's' : ''} avec votre séjour`,
    unitsUsed: (n) => `${n} offert${n > 1 ? 's' : ''} — déjà utilisé${n > 1 ? 's' : ''}`,
    minutesLeft: (minutes) => `${hoursLabel(minutes)} offerte${isOfferedPlural(minutes) ? 's' : ''} avec votre séjour`,
    minutesUsed: (minutes) => {
      const s = isOfferedPlural(minutes) ? 's' : '';
      return `${hoursLabel(minutes)} offerte${s} — déjà utilisée${s}`;
    },
  }),
  en: Object.freeze({
    included: 'Included',
    stayIncluded: 'Included in your stay',
    offered: 'Free',
    eveningRate: 'evening rate',
    eveningExtra: (price) => `+ ${price} evening`,
    bathClosed: 'Closed',
    bathFull: 'Full',
    includedHours: (hours) => `${hours} included in your stay, to schedule`,
    perPersonPerMorning: 'per person per morning',
    alreadyIncluded: 'Already included in your stay',
    ordersOpenOnArrival: 'For this stay, ordering opens on arrival.',
    payOnArrival: 'Pay on arrival',
    addToBill: 'Add to my bill',
    closed: 'The shop is closed. Safe travels home!',
    noDeliveryLeft: 'No longer available for your stay',
    wellness: 'Wellness',
    other: 'Other',
    unitsLeft: (n) => `${n} included with your stay`,
    unitsUsed: (n) => `${n} included — already used`,
    minutesLeft: (minutes) => `${hoursLabel(minutes)} included with your stay`,
    minutesUsed: (minutes) => `${hoursLabel(minutes)} included — already used`,
  }),
});

const MONEY = Object.freeze({ fr: 'fr-FR', en: 'en-GB' });

const parisClock = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** « mer. 8 juil. » / « Wed 8 Jul »: a morning as the picker prints it. */
function morningLabel(ymd, lang) {
  return new Intl.DateTimeFormat(MONEY[lang], { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' })
    .format(new Date(`${ymd}T12:00:00Z`));
}

/** « 12 € », « 4,50 € » / « €12 », « €4.50 »: the guest app prints it as it is. */
function priceLabel(amount, lang) {
  const whole = Number.isInteger(amount);
  return new Intl.NumberFormat(MONEY[lang], {
    style: 'currency', currency: 'EUR', minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2,
  }).format(amount);
}

const unitsText = (n, lang) => String(n).replace('.', lang === 'fr' ? ',' : '.');

/**
 * Rules 27, 65-68 — the shop is open while the core takes the stay's orders: `arrival` (before the arrival, the
 * pre-arrival money settled) or `departure`. `closed` once the end-of-stay complement is collected; `unavailable`
 * (an acompte, a solde or an installment still due) reads the catalogue only, ordering opens on arrival.
 */
function shopState(collection) {
  if (collection === 'arrival' || collection === 'departure') return { open: true, closedReason: null };
  return { open: false, closedReason: collection === 'closed' ? 'closed' : 'ordersOpenOnArrival' };
}

function freeLeftLabel(sold, L, lang) {
  if (sold.freeUnits) {
    const { granted, left } = sold.freeUnits;
    return left > 0 ? L.unitsLeft(unitsText(left, lang)) : L.unitsUsed(unitsText(granted, lang));
  }
  if (sold.freeMinutes) {
    const { granted, left } = sold.freeMinutes;
    return left > 0 ? L.minutesLeft(left) : L.minutesUsed(granted);
  }
  return null;
}

/**
 * Rule 27bis — what the app needs to order a breakfast: its state, the mornings still possible and the
 * ones the stay already has, with their hour.
 */
function breakfastFields(sold, { lang, stay, extras, today, time }) {
  const serviceTime = sold.row.breakfastTime || DEFAULT_BREAKFAST_TIME;
  const line = extras.optionLines.find((l) => Number(l.optionId) === Number(sold.row.id));
  return {
    state: sold.included ? 'included' : 'sold',
    defaultTime: serviceTime,
    mornings: remainingMornings({ startDate: stay.startDate, endDate: stay.endDate, today, time, serviceTime })
      .map((date) => ({ date, label: morningLabel(date, lang) })),
    occurrences: (line ? line.cardOccurrences : [])
      .filter((o) => o && o.date)
      .map((o) => ({ date: String(o.date).slice(0, 10), time: String(o.time || serviceTime) })),
  };
}

/** Rule 39 — prepared by the staff, so delivered at a time of the service: options only (rule 31 governs the bath). */
const isStaffItem = (sold) => sold.kind === 'option' && Number(sold.item.needsStaff) === 1;

const positiveId = (value) => (typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN);

/**
 * `POST /shop/delivery-slots` — `{ lines: [{ kind, id, … }] }`, 1 to 20 lines; the other keys of a cart line are not read.
 * → the refusal key (refusals.js) or null.
 */
function deliveryLinesError(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((k) => k !== 'lines')) return 'invalidRequest';
  if (!Array.isArray(body.lines) || body.lines.length < 1 || body.lines.length > MAX_LINES) return 'invalidCart';
  const bad = body.lines.some((line) => !line || typeof line !== 'object' || Array.isArray(line)
    || !ORDER_KINDS.includes(line.kind) || !Number.isInteger(line.id) || line.id <= 0);
  return bad ? 'invalidLine' : null;
}

function buildShopController({
  items, stayLines, orders, serviceHours, stock, scheduler, translator, now, orderCollection,
  fulfilment = () => ({ mode: 'delivery', place: null }),
}) {
  /** Rule 67 — where the core collects an order of this stay: the shop's and the orders' one reading. */
  const collectionOf = (stay) => orderCollection(stay.id);

  /**
   * Rules 25, 42 — why an item cannot be ordered: already in the stay, or staff-prepared with no delivery time
   * left before the check-out.
   */
  function unavailableReason(sold, { L, stay, schedule, at }) {
    if (sold.alreadyIncluded) return L.alreadyIncluded;
    if (isStaffItem(sold) && !deliveryTimes({ now: at, stay, leadMinutes: sold.item.leadMinutes, schedule }).length) return L.noDeliveryLeft;
    return null;
  }

  /** Rule 24 — the core projection for the stay's lodging, plus the guest app's own fields. */
  function itemView(sold, context) {
    const { lang, translate, L, mediaPaths } = context;
    const { kind, row, item } = sold;
    const projected = kind === 'resource' ? toPublicResource(row, lang, translate) : toPublicOption(row, lang, translate);
    const included = sold.included || sold.alreadyIncluded;
    const shortDescription = (lang === 'en' && item.shortDescriptionEn) || item.shortDescriptionFr || null;
    const mediaPath = item.mediaId ? mediaPaths.get(Number(item.mediaId)) : null;
    const freeLabel = included ? null : freeLeftLabel(sold, L, lang);
    const unavailable = unavailableReason(sold, context);
    // Rule 37quater — a tracked article says what is left; the breakfast and the bath have no stock.
    const stockState = kind === BREAKFAST ? null : context.stocks.get(`${kind}:${Number(row.id)}`);
    const stockView = stockState ? shopStockView(stockState, item.maxQuantity, lang) : null;
    return {
      kind,
      id: projected.id,
      title: kind === 'resource' ? projected.name : projected.title,
      shortDescription,
      imageUrl: mediaPath ? `/uploads/${mediaPath}` : null,
      price: included ? 0 : projected.price,
      priceLabel: included ? L.included : priceLabel(projected.price, lang),
      // Rule 27bis — the breakfast is shown « par personne et par matin », whatever its catalogue unit says.
      priceUnitLabel: included ? null : (kind === BREAKFAST ? L.perPersonPerMorning : projected.priceUnitLabel),
      ...(included ? { included: true } : {}),
      ...(sold.includedLeft !== null && !sold.alreadyIncluded ? { includedLeft: sold.includedLeft } : {}),
      ...(freeLabel ? { freeLeftLabel: freeLabel } : {}),
      maxQuantity: Number(item.maxQuantity),
      needsStaff: kind !== 'resource' && Number(item.needsStaff) === 1,
      ...(sold.hourly ? { scheduling: 'hourly' } : {}),
      ...(unavailable ? { unavailableReason: unavailable } : {}),
      ...(stockView ? { stock: stockView } : {}),
      ...(kind === BREAKFAST ? breakfastFields(sold, context) : {}),
    };
  }

  /**
   * Rule 26 — grouped by the option category, in the core's category order (French collation), items by
   * the plugin's `sortOrder` then title; hourly resources in « Bien-être », the rest last. Empty
   * categories never exist: a category is made of the items it holds.
   */
  function categoriesOf(sold, context) {
    const entries = sold.map((s) => ({
      sold: s,
      title: s.row.title || s.row.name,
      category: s.kind === 'resource' ? (s.hourly ? WELLNESS : '') : s.row.category,
    }));
    const { ungrouped, groups } = groupOptionsByCategory(entries);
    const bySortOrder = (list) => list.slice().sort((a, b) => (a.sold.item.sortOrder ?? Infinity) - (b.sold.item.sortOrder ?? Infinity));
    const label = (category) => {
      const translated = context.translate.category(category);
      return category === WELLNESS && translated === WELLNESS ? context.L.wellness : translated;
    };
    return [
      ...groups.map((g) => ({ name: label(g.category), entries: g.options })),
      ...(ungrouped.length ? [{ name: context.L.other, entries: ungrouped }] : []),
    ].map(({ name, entries: list }) => ({ name, items: bySortOrder(list).map((e) => itemView(e.sold, context)) }));
  }

  // The guest app never schedules hours itself: without the scheduler of `hourly-resources`, no bath.
  const hourlyOffered = (row) => isOffered(row) && Boolean(scheduler());

  /** Rules 23, 25 — the items the stay's lodging sells, with what the stay already received. */
  function soldFor({ stay, lodging }) {
    const extras = stayLines().ofStay(stay.id);
    const catalogue = items().catalogueFor(lodging.propertyId);
    const consumed = stayConsumption({
      optionLines: extras.optionLines,
      resourceLines: extras.resourceLines,
      pendingOrderLines: orders().pendingLines(stay.id, { at: now() }),
      orderedLines: orders().orderedLines(stay.id),
    });
    const sold = shopItems({
      ...catalogue,
      stay: {
        isDirectBooking: isDirectChannel(extras.platform),
        grantedFreeUnitsByOption: extras.grantedFreeUnitsByOption,
        optionLines: extras.optionLines,
        ...consumed,
      },
      hourlyOffered,
    });
    return { sold, extras, catalogue };
  }

  /**
   * Rule 18 — the items a lodging's shop sells (`kind:id`), whatever a stay already received: a booklet button
   * to an item is shown only while the item is sold there.
   */
  function soldKeysOf(propertyId) {
    const sold = shopItems({
      ...items().catalogueFor(propertyId),
      stay: { isDirectBooking: false, grantedFreeUnitsByOption: {}, optionLines: [], ...stayConsumption({}) },
      hourlyOffered,
    });
    return new Set(sold.map((s) => `${s.kind}:${Number(s.row.id)}`));
  }

  const scheduleOf = (lodging, at) => serviceHours().scheduleFor(lodging.propertyId, { from: parisDate(at) });

  function read(req, res) {
    const { stay, lodging } = req.guest;
    const lang = languageOf(req, stay);
    const L = LABELS[lang];
    const { sold, extras, catalogue } = soldFor(req.guest);
    const at = now();
    const today = parisDate(at);
    const collection = collectionOf(stay);
    const state = shopState(collection);
    const schedule = scheduleOf(lodging, at);
    const { arrivalLabel, ...service } = serviceState({ now: at, stay, schedule, lang });
    return publicHttp.ok(res, {
      open: state.open,
      ...(state.closedReason ? { closedReason: L[state.closedReason] } : {}),
      orderCollection: collection,
      noteLabel: collection === 'arrival' ? L.payOnArrival : L.addToBill,
      service,
      ...(arrivalLabel ? { preArrivalBanner: arrivalLabel } : {}),
      canPayCard: state.open && Boolean(paymentProviders.active()),
      canPayNote: state.open,
      categories: categoriesOf(sold, {
        lang, translate: translator(lang), L, mediaPaths: catalogue.mediaPaths, stay, extras, today, time: parisClock.format(at), schedule, at,
        stocks: stock().states(at),
      }),
    });
  }

  const minutesOf = (time) => {
    const [h, m] = String(time || '').split(':').map(Number);
    return h * 60 + m;
  };

  /**
   * Rule 82 — the hours the stay already holds on a resource and has not placed on a slot: sold at booking or offered,
   * `quantity` minus the hours of its sessions. These hours are placed first, at no charge.
   */
  function includedHoursLeft(extras, resourceId) {
    const line = (extras.resourceLines || []).find((l) => Number(l.resourceId) === Number(resourceId));
    if (!line) return 0;
    const placed = (Array.isArray(line.sessions) ? line.sessions : [])
      .reduce((sum, x) => sum + Math.max(0, minutesOf(x.end) - minutesOf(x.start)), 0) / 60;
    return Math.max(0, Math.round((Number(line.quantity || 0) - placed) * 100) / 100);
  }

  /**
   * Rule 84 — what one slot costs this stay, now, picked alone: the hours of the stay first, then the free minutes, then the
   * lodging's price; the evening supplement is named where it applies. Several picks are priced by the quote.
   */
  function slotPriceLabel(slot, { sold, hoursLeft, L, lang }) {
    const minutes = minutesOf(slot.end) - minutesOf(slot.start);
    const extra = slot.supplement > 0 ? ` · ${L.eveningExtra(priceLabel(slot.supplement, lang))}` : '';
    if (sold.included) return L.included;
    if (hoursLeft * 60 >= minutes) return `${L.stayIncluded}${extra}`;
    const freeLeft = sold.freeMinutes ? sold.freeMinutes.left : 0;
    if (freeLeft >= minutes) return `${L.offered}${extra}`;
    return slot.band === 'evening' ? `${priceLabel(slot.price, lang)} · ${L.eveningRate}` : priceLabel(slot.price, lang);
  }

  /** Rule 78 — the bath's opening as the thin bar of a day: `[{ from, to, open }]`, closed hours greyed. */
  function openingBands(day, opening) {
    if (day.closed) return [{ from: '00:00', to: '24:00', open: false }];
    return [
      { from: '00:00', to: opening.from, open: false },
      { from: opening.from, to: opening.to, open: true },
      { from: opening.to, to: '24:00', open: false },
    ].filter((band) => minutesOf(band.from) < (band.to === '24:00' ? 1440 : minutesOf(band.to)));
  }

  /**
   * Rules 28-31, 78-80, 82, 84 — the slots the guest can book on an hourly resource, by day: EVERY day of the stay (a day
   * with no bookable slot is `available: false` with its reason), none outside it; only `free` and `evening` slots are
   * drawn (§6.4). The scheduler judges the stay's presence, the bath's own hours, the other uses of the bath and the
   * heat-up counted from now (`heatFrom`); a slot that needs the resource lit from cold is bookable only when its ignition
   * falls in the service hours.
   */
  function slots(req, res) {
    const { stay, lodging } = req.guest;
    const resourceId = positiveId(req.params.id);
    const { from, to } = req.query;
    if (!Number.isInteger(resourceId) || resourceId <= 0) return fail(res, refusal(400, 'INVALID_INPUT', 'invalidId'));
    if ([from, to].some((d) => d !== undefined && !isRealIsoDay(d))) return fail(res, refusal(400, 'INVALID_INPUT', 'invalidDate'));
    const lang = languageOf(req, stay);
    const L = LABELS[lang];
    const at = now();
    const { sold: items, extras } = soldFor(req.guest);
    const sold = items.find((s) => s.kind === 'resource' && s.hourly && Number(s.row.id) === resourceId);
    const found = sold && scheduler().slotsForStay({
      resourceId, propertyId: lodging.propertyId, stay, now: at, heatFrom: at, canIgnite: ignitionInHours(scheduleOf(lodging, at)),
    });
    if (!found) return fail(res, refusal(404, 'ITEM_NOT_FOUND', 'itemNotFound'));
    const freeLabel = sold.included ? null : freeLeftLabel(sold, L, lang);
    const hoursLeft = includedHoursLeft(extras, resourceId);
    const opening = found.opening || { from: '00:00', to: '24:00' };
    return publicHttp.ok(res, {
      freeMinutesLeft: sold.freeMinutes ? sold.freeMinutes.left : 0,
      ...(freeLabel ? { freeLabel } : {}),
      includedHoursLeft: hoursLeft,
      ...(hoursLeft > 0 ? { includedLabel: L.includedHours(hoursLabel(Math.round(hoursLeft * 60))) } : {}),
      days: found.days
        .filter((day) => (from === undefined || day.date >= from) && (to === undefined || day.date <= to))
        .map((day) => {
          const bookable = day.slots.filter((slot) => BOOKABLE.has(slot.state));
          return {
            date: day.date,
            label: morningLabel(day.date, lang),
            available: bookable.length > 0,
            ...(bookable.length ? {} : { reasonLabel: day.closed || day.slots.every((slot) => ['closed', 'past'].includes(slot.state)) ? L.bathClosed : L.bathFull }),
            openingBands: openingBands(day, opening),
            slots: bookable.map((slot) => ({
              start: slot.start,
              end: slot.end,
              state: slot.state,
              band: slot.band,
              priceLabel: slotPriceLabel(slot, { sold, hoursLeft, L, lang }),
            })),
          };
        }),
    });
  }

  /**
   * Rules 41-42 — the delivery times of a cart: the lead is the longest `leadMinutes` of its staff-prepared
   * items. A cart without one needs no delivery time. Lines the shop does not sell are not read: the quote
   * judges the cart.
   */
  function deliverySlots(req, res) {
    const error = deliveryLinesError(req.body);
    if (error) return fail(res, refusal(400, 'INVALID_INPUT', error));
    const { stay, lodging } = req.guest;
    const lang = languageOf(req, stay);
    const wanted = new Set(req.body.lines.map((line) => `${line.kind}:${line.id}`));
    const sold = soldFor(req.guest).sold;
    const staffOptions = sold.filter((s) => isStaffItem(s) && wanted.has(`option:${Number(s.row.id)}`));
    // Rule 27bis — the breakfast keeps its own hour on its mornings, never the cart's delivery time: asked alone (its
    // sheet), it answers the times its own lead allows; beside other staff items, the cart's time is theirs only.
    const staffBreakfasts = sold.filter((s) => s.kind === BREAKFAST && Number(s.item.needsStaff) === 1
      && wanted.has(`${BREAKFAST}:${Number(s.row.id)}`));
    const staff = staffOptions.length ? staffOptions : staffBreakfasts;
    // Rule 41bis — delivered to the lodging or picked up: the picker asks its own question.
    const { mode } = fulfilment();
    const asked = { mode, question: deliveryQuestion(mode, lang) };
    if (!staff.length) return publicHttp.ok(res, { needed: false, asap: null, days: [], ...asked });
    const at = now();
    const schedule = scheduleOf(lodging, at);
    const leadMinutes = Math.max(...staff.map((s) => Number(s.item.leadMinutes) || 0));
    const service = serviceState({ now: at, stay, schedule, lang });
    return publicHttp.ok(res, {
      needed: true,
      ...asked,
      ...deliveryPicker({ now: at, stay, leadMinutes, schedule, lang }),
      ...(service.bannerLabel ? { bannerLabel: service.bannerLabel } : {}),
    });
  }

  /**
   * Rule 11 — the home's bath card: the first slot still bookable today (`HH:MM`) on an hourly resource the stay's
   * shop sells while it is open, read from the planning like the slot picker; null when there is none.
   */
  function firstBathSlotToday(guest, at) {
    if (!scheduler()) return null;
    const { stay, lodging } = guest;
    const today = parisDate(at);
    const { sold } = soldFor(guest);
    if (!shopState(collectionOf(stay)).open) return null;
    const canIgnite = ignitionInHours(scheduleOf(lodging, at));
    const starts = sold.filter((s) => s.kind === 'resource' && s.hourly).flatMap((s) => {
      const found = scheduler().slotsForStay({
        resourceId: Number(s.row.id), propertyId: lodging.propertyId, stay, now: at, heatFrom: at, canIgnite,
      });
      const day = found && found.days.find((d) => d.date === today);
      return day ? day.slots.filter((slot) => BOOKABLE.has(slot.state)).map((slot) => slot.start) : [];
    });
    return starts.length ? starts.sort()[0] : null;
  }

  return {
    read, slots, deliverySlots, soldKeysOf, soldFor, scheduleOf, firstBathSlotToday, collectionOf, includedHoursLeft,
  };
}

module.exports = {
  LABELS, buildShopController, isStaffItem, morningLabel, priceLabel, shopState,
};
