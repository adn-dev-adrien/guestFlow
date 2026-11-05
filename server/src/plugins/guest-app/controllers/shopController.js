/**
 * `GET /public/v1/guest/shop` — the sellable catalogue of the stay's lodging, ready to render
 * (specs/guest-app.md rules 23-27). Prices and labels are GuestFlow's, per lodging, through the core
 * projections the website shows; the free / included state is `sellable.js`'s; the shop is open exactly
 * when the fiche takes mid-stay extras.
 */

const sdk = require('../../sdk');
const { parisDate } = require('../currentStay');
const { BREAKFAST, DEFAULT_BREAKFAST_TIME, remainingMornings, shopItems, stayConsumption } = require('../sellable');
const { languageOf } = require('./sessionController');

const publicHttp = sdk.coreModule('publicHttp');
const { toPublicOption, toPublicResource, hoursLabel, isOfferedPlural } = sdk.coreModule('publicCatalogProjection');
const { midStayExtrasWindow } = sdk.coreModule('midStayExtrasWindow');
const { isDirectChannel } = sdk.coreModule('platformNameFormat');
const { isOffered } = sdk.coreModule('resourceOffer');
const paymentProviders = sdk.coreModule('paymentProviders');
const { groupOptionsByCategory } = sdk.coreModule('optionGrouping');

// Rule 26 — hourly resources are sold in « Bien-être »; what has no category closes the list.
const WELLNESS = 'Bien-être';

const LABELS = Object.freeze({
  fr: Object.freeze({
    included: 'Inclus',
    alreadyIncluded: 'Déjà inclus dans votre séjour',
    preArrival: 'Disponible pendant votre séjour',
    closed: 'La boutique est fermée — bon retour !',
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
    alreadyIncluded: 'Already included in your stay',
    preArrival: 'Available during your stay',
    closed: 'The shop is closed — safe travels home!',
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

function buildShopController({ items, stayLines, orders, translator, now }) {
  /** Rule 24 — the core projection for the stay's lodging, plus the guest app's own fields. */
  function itemView(sold, context) {
    const { lang, translate, L, mediaPaths } = context;
    const { kind, row, item } = sold;
    const projected = kind === 'resource' ? toPublicResource(row, lang, translate) : toPublicOption(row, lang, translate);
    const included = sold.included || sold.alreadyIncluded;
    const shortDescription = (lang === 'en' && item.shortDescriptionEn) || item.shortDescriptionFr || null;
    const mediaPath = item.mediaId ? mediaPaths.get(Number(item.mediaId)) : null;
    const freeLabel = included ? null : freeLeftLabel(sold, L, lang);
    return {
      kind,
      id: projected.id,
      title: kind === 'resource' ? projected.name : projected.title,
      shortDescription,
      imageUrl: mediaPath ? `/uploads/${mediaPath}` : null,
      price: included ? 0 : projected.price,
      priceLabel: included ? L.included : priceLabel(projected.price, lang),
      priceUnitLabel: included ? null : projected.priceUnitLabel,
      ...(included ? { included: true } : {}),
      ...(sold.includedLeft !== null && !sold.alreadyIncluded ? { includedLeft: sold.includedLeft } : {}),
      ...(freeLabel ? { freeLeftLabel: freeLabel } : {}),
      maxQuantity: Number(item.maxQuantity),
      needsStaff: kind !== 'resource' && Number(item.needsStaff) === 1,
      ...(sold.hourly ? { scheduling: 'hourly' } : {}),
      ...(sold.alreadyIncluded ? { unavailableReason: L.alreadyIncluded } : {}),
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

  function read(req, res) {
    const { stay, lodging, mode } = req.guest;
    const lang = languageOf(req, stay);
    const L = LABELS[lang];
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
      hourlyOffered: isOffered,
    });
    const at = now();
    const today = parisDate(at);
    const state = shopState(mode, extras.window, today);
    return publicHttp.ok(res, {
      open: state.open,
      ...(state.closedReason ? { closedReason: L[state.closedReason] } : {}),
      canPayCard: state.open && Boolean(paymentProviders.active()),
      canPayNote: state.open,
      categories: categoriesOf(sold, {
        lang, translate: translator(lang), L, mediaPaths: catalogue.mediaPaths, stay, extras, today, time: parisClock.format(at),
      }),
    });
  }

  return { read };
}

module.exports = { buildShopController };
