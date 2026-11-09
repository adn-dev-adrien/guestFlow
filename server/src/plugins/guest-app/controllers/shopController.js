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
const { languageOf } = require('./sessionController');
const { shopStockView } = require('../stock');
const { deliveryQuestion } = require('../orderLabels');
const {
  deliveryPicker, deliveryTimes, ignitionInHours, serviceState, wallClock,
} = require('../serviceHours');

const publicHttp = sdk.coreModule('publicHttp');
const { toPublicOption, toPublicResource, hoursLabel, isOfferedPlural } = sdk.coreModule('publicCatalogProjection');
const { midStayExtrasWindow } = sdk.coreModule('midStayExtrasWindow');
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
    perPersonPerMorning: 'par personne et par matin',
    alreadyIncluded: 'Déjà inclus dans votre séjour',
    preArrival: 'Disponible pendant votre séjour',
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
    perPersonPerMorning: 'per person per morning',
    alreadyIncluded: 'Already included in your stay',
    preArrival: 'Available during your stay',
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

/** Rule 27 — open exactly while the stay takes mid-stay extras; a pre-arrival session reads it only. */
function shopState(mode, window, today) {
  const state = midStayExtrasWindow(window, today);
  if (mode === 'stay' && state.extrasEditable) return { open: true, closedReason: null };
  return { open: false, closedReason: state.extrasClosedReason === 'endOfStayCollected' ? 'closed' : 'preArrival' };
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

/** `POST /shop/delivery-slots` — `{ lines: [{ kind, id, … }] }`, 1 to 20 lines; the other keys of a cart line are not read. */
function deliveryLinesError(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((k) => k !== 'lines')) return 'Requête invalide.';
  if (!Array.isArray(body.lines) || body.lines.length < 1 || body.lines.length > MAX_LINES) return 'Le panier est invalide.';
  const bad = body.lines.some((line) => !line || typeof line !== 'object' || Array.isArray(line)
    || !ORDER_KINDS.includes(line.kind) || !Number.isInteger(line.id) || line.id <= 0);
  return bad ? 'Un article du panier est invalide.' : null;
}

function buildShopController({
  items, stayLines, orders, serviceHours, stock, scheduler, translator, now,
  fulfilment = () => ({ mode: 'delivery', place: null }),
}) {
  /**
   * Rules 25, 42 — why an item cannot be ordered: already in the stay, or staff-prepared with no delivery time
   * left before the check-out.
   */
  function unavailableReason(sold, { L, stay, schedule, wall }) {
    if (sold.alreadyIncluded) return L.alreadyIncluded;
    if (isStaffItem(sold) && !deliveryTimes({ now: wall, stay, leadMinutes: sold.item.leadMinutes, schedule }).length) return L.noDeliveryLeft;
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
      pendingOrderLines: orders().pendingLines(stay.id),
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
    const { stay, lodging, mode } = req.guest;
    const lang = languageOf(req, stay);
    const L = LABELS[lang];
    const { sold, extras, catalogue } = soldFor(req.guest);
    const at = now();
    const today = parisDate(at);
    const state = shopState(mode, extras.window, today);
    const schedule = scheduleOf(lodging, at);
    return publicHttp.ok(res, {
      open: state.open,
      ...(state.closedReason ? { closedReason: L[state.closedReason] } : {}),
      service: serviceState({ now: at, stay, schedule, lang }),
      canPayCard: state.open && Boolean(paymentProviders.active()),
      canPayNote: state.open,
      categories: categoriesOf(sold, {
        lang, translate: translator(lang), L, mediaPaths: catalogue.mediaPaths, stay, extras, today, time: parisClock.format(at), schedule, wall: wallClock(at),
        stocks: stock().states(at),
      }),
    });
  }

  /**
   * Rules 28-31 — the slots the guest can book on an hourly resource of the shop, by day: only `free` and
   * `evening` ones (§6.4), days without one left out. A slot that needs the resource lit from cold is
   * bookable only when its ignition falls in the service hours.
   */
  function slots(req, res) {
    const { stay, lodging } = req.guest;
    const resourceId = positiveId(req.params.id);
    const { from, to } = req.query;
    if (!Number.isInteger(resourceId) || resourceId <= 0) return publicHttp.fail(res, 400, 'INVALID_INPUT', 'Identifiant invalide.');
    if ([from, to].some((d) => d !== undefined && !isRealIsoDay(d))) return publicHttp.fail(res, 400, 'INVALID_INPUT', 'Date invalide.');
    const lang = languageOf(req, stay);
    const L = LABELS[lang];
    const at = now();
    const sold = soldFor(req.guest).sold.find((s) => s.kind === 'resource' && s.hourly && Number(s.row.id) === resourceId);
    const found = sold && scheduler().slotsForStay({
      resourceId, propertyId: lodging.propertyId, stay, now: at, canIgnite: ignitionInHours(scheduleOf(lodging, at)),
    });
    if (!found) return publicHttp.fail(res, 404, 'ITEM_NOT_FOUND', 'Cet article n’est pas proposé.');
    const freeLabel = sold.included ? null : freeLeftLabel(sold, L, lang);
    return publicHttp.ok(res, {
      freeMinutesLeft: sold.freeMinutes ? sold.freeMinutes.left : 0,
      ...(freeLabel ? { freeLabel } : {}),
      days: found.days
        .filter((day) => (from === undefined || day.date >= from) && (to === undefined || day.date <= to))
        .map((day) => ({
          date: day.date,
          label: morningLabel(day.date, lang),
          slots: day.slots.filter((slot) => BOOKABLE.has(slot.state)).map((slot) => ({
            start: slot.start,
            end: slot.end,
            state: slot.state,
            priceLabel: sold.included ? L.included : priceLabel(slot.price, lang),
          })),
        }))
        .filter((day) => day.slots.length),
    });
  }

  /**
   * Rules 41-42 — the delivery times of a cart: the lead is the longest `leadMinutes` of its staff-prepared
   * items. A cart without one needs no delivery time. Lines the shop does not sell are not read: the quote
   * judges the cart.
   */
  function deliverySlots(req, res) {
    const error = deliveryLinesError(req.body);
    if (error) return publicHttp.fail(res, 400, 'INVALID_INPUT', error);
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
    const { stay, lodging, mode } = guest;
    const today = parisDate(at);
    const { sold, extras } = soldFor(guest);
    if (!shopState(mode, extras.window, today).open) return null;
    const canIgnite = ignitionInHours(scheduleOf(lodging, at));
    const starts = sold.filter((s) => s.kind === 'resource' && s.hourly).flatMap((s) => {
      const found = scheduler().slotsForStay({
        resourceId: Number(s.row.id), propertyId: lodging.propertyId, stay, now: at, canIgnite,
      });
      const day = found && found.days.find((d) => d.date === today);
      return day ? day.slots.filter((slot) => BOOKABLE.has(slot.state)).map((slot) => slot.start) : [];
    });
    return starts.length ? starts.sort()[0] : null;
  }

  return {
    read, slots, deliverySlots, soldKeysOf, soldFor, scheduleOf, firstBathSlotToday,
  };
}

module.exports = {
  LABELS, buildShopController, isStaffItem, morningLabel, priceLabel, shopState,
};
