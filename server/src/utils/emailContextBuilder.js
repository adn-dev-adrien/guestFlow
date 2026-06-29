/**
 * Email template context builder — pure (specs/email-automation.md §3 rule 3 + §4.4).
 *
 * Given the enriched reservation graph (reservation row + client + property + options +
 * app settings), produces a flat `{ vars, flags }` object the renderer consumes. Every
 * value is normalised to a string. Missing source columns default to the empty string so
 * the renderer never emits `undefined`.
 *
 * Pure: no DB access. The caller passes raw rows; this module just shapes them.
 */

const { formatDateLong, formatTimeShort } = require('./dateFr');
const { formatCurrency } = require('./devisHelpers');
const { isClientVisibleOption } = require('./optionVisibility');

function safeStr(v) {
  return v == null ? '' : String(v);
}

// Accent/case-insensitive keyword matcher for option/resource NAMES (specs/email-automation.md).
// Matching on the operator-facing name is more robust than an `autoOptionType` tag, which custom
// catalog entries don't always carry (e.g. a hand-created « Ménage » or « Bain nordique »).
function normalizeName(v) {
  return safeStr(v).toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
}

function diffDays(startIso, endIso) {
  if (!startIso || !endIso) return 0;
  const s = new Date(`${startIso}T00:00:00Z`);
  const e = new Date(`${endIso}T00:00:00Z`);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return 0;
  return Math.max(0, Math.round((e - s) / 86400000));
}

function joinAddress(client) {
  if (!client) return '';
  const parts = [
    [safeStr(client.streetNumber).trim(), safeStr(client.street).trim()].filter(Boolean).join(' ').trim(),
    [safeStr(client.postalCode).trim(),   safeStr(client.city).trim()].filter(Boolean).join(' ').trim(),
  ].filter(Boolean);
  return parts.join(', ');
}

// Bed configuration string used inside the J-7 reminder body. Omits zero counts so we
// don't print "0 lit bébé". Examples:
//   { single: 1, double: 2, baby: 0 } → "2 lits doubles, 1 lit simple"
//   { single: 0, double: 0, baby: 1 } → "1 lit bébé"
//   { single: 0, double: 0, baby: 0 } → ""
function formatBedConfig({ singleBeds, doubleBeds, babyBeds }, lang = 'fr') {
  const parts = [];
  const dn = Number(doubleBeds || 0);
  const sn = Number(singleBeds || 0);
  const bn = Number(babyBeds || 0);
  if (lang === 'en') {
    if (dn > 0) parts.push(`${dn} double bed${dn > 1 ? 's' : ''}`);
    if (sn > 0) parts.push(`${sn} single bed${sn > 1 ? 's' : ''}`);
    if (bn > 0) parts.push(`${bn} baby cot${bn > 1 ? 's' : ''}`);
    return parts.join(', ');
  }
  if (dn > 0) parts.push(`${dn} lit${dn > 1 ? 's' : ''} double${dn > 1 ? 's' : ''}`);
  if (sn > 0) parts.push(`${sn} lit${sn > 1 ? 's' : ''} simple${sn > 1 ? 's' : ''}`);
  if (bn > 0) parts.push(`${bn} lit${bn > 1 ? 's' : ''} bébé`);
  return parts.join(', ');
}

// Combine the property's stored French article with its name for "votre séjour <…>" phrasing
// (specs/email-automation.md §3 rule 13). The article is operator-chosen per property — the
// only reliable source, since gender/elision can't be inferred from arbitrary brand names.
//   'au'    + 'Gite'           → 'au Gite'
//   'à la'  + 'Tente'          → 'à la Tente'
//   "à l'"  + 'Aventura Lodge' → "à l'Aventura Lodge"   (elided forms glue, no space)
//   'aux'   + 'Gîtes'          → 'aux Gîtes'
function formatPropertyWithArticle(name, article, lang = 'fr') {
  const n = safeStr(name).trim();
  if (!n) return '';
  // English has no gendered article to glue — the EN bodies phrase it as "at {{propertyWithArticle}}",
  // so we return the bare name (e.g. "the Gite" would over-assume; the name alone reads cleanly).
  if (lang === 'en') return n;
  const a = safeStr(article).trim() || 'au';
  return a.endsWith("'") ? `${a}${n}` : `${a} ${n}`;
}

// Minimal language normaliser shared with the send pipeline (kept inline to avoid a circular require).
function normaliseLang(v) {
  return String(v || '').toLowerCase() === 'en' ? 'en' : 'fr';
}

/**
 * @param {{
 *   reservation: object,           // reservations row
 *   client: object | null,         // clients row
 *   property: object | null,       // properties row
 *   options: object[],             // joined reservation_options rows (with options.title + autoOptionType)
 *   resources: object[],           // joined reservation_resources rows (with resources.name)
 *   settings: object,              // app_settings row
 * }} input
 * @returns {{ vars: object, flags: object }}
 */
function buildContext({ reservation, client, property, options = [], resources = [], customOptions = [], settings = {}, bedLinenProvidedByDefault = false, lang = 'fr', arrivalComplementDetail = null }) {
  // Internal-only options (specs/laundry-bath-mat.md §3 rule 11) never appear in client emails —
  // drop them up-front so every option-derived list/flag/complement line below ignores them.
  options = (options || []).filter(isClientVisibleOption);
  const r = reservation || {};
  const c = client || {};
  const p = property || {};
  const linenByDefault = Boolean(bedLinenProvidedByDefault);
  // specs/email-language-fr-en.md §3 rule 4 — every composed string below is emitted in `lang`.
  const L = normaliseLang(lang);
  const isEn = L === 'en';
  // Localised catalog names (specs/email-client-language-and-fiche-polish.md §3 rule 4): in English use
  // the option/resource English name, falling back to the French one when it's empty (never blanks an item).
  const optionName = (o) => {
    const fr = safeStr(o.title).trim();
    return isEn ? (safeStr(o.titleEn).trim() || fr) : fr;
  };
  const resourceName = (rr) => {
    const fr = safeStr(rr.name).trim();
    return isEn ? (safeStr(rr.nameEn).trim() || fr) : fr;
  };

  const fullName = `${safeStr(c.firstName).trim()} ${safeStr(c.lastName).trim()}`.trim();
  const checkInTime  = formatTimeShort(r.checkInTime  || p.defaultCheckIn  || '');
  const checkOutTime = formatTimeShort(r.checkOutTime || p.defaultCheckOut || '');

  const nights = diffDays(r.startDate, r.endDate);
  const totalGuests = Number(r.adults || 0) + Number(r.teens || 0) + Number(r.children || 0) + Number(r.babies || 0);

  // Options list — sorted alphabetically for stable rendering across boots.
  const optionsTitles = (options || [])
    .map(optionName)
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, 'fr'));
  const optionsList = optionsTitles.join(', ');

  const hasOptions = optionsTitles.length > 0;
  const hasBedLinenOption = (options || []).some((o) => safeStr(o.autoOptionType) === 'bed_linen');
  // Cleaning ("Ménage") option — matched on the option NAME ("menage") with the `autoOptionType`
  // tag as a fallback. Name-matching fixes the bug where a hand-created « Ménage » option (no tag)
  // left the "cleaning at your charge" else-branch showing even when cleaning WAS booked.
  const hasCleaningOption = (options || []).some((o) =>
    safeStr(o.autoOptionType) === 'cleaning' || normalizeName(o.title).includes('menage'));

  // "Linge fourni par défaut" — the reservation's PROPERTY includes bed linen as a default-offered
  // option (specs/j1-linen-default-message.md §3). When so, the J-1 reminder reassures the guest the
  // beds will be made on arrival, and the bed-linen option is dropped from the "Option(s) réservée(s)"
  // list (it isn't a chosen extra). `optionsList` itself is left intact for other templates (e.g. J-7).
  const bedLinenProvided = linenByDefault;
  const reservedOptionsTitles = (options || [])
    .filter((o) => !(bedLinenProvided && safeStr(o.autoOptionType) === 'bed_linen'))
    .map(optionName)
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, 'fr'));
  const reservedOptionsList = reservedOptionsTitles.join(', ');
  const hasReservedOptions = reservedOptionsTitles.length > 0;
  // "Bring your own linen" only when linen is neither provided by default nor on the reservation —
  // never contradicts the "beds made" line.
  const bedLinenBringYourOwn = !hasBedLinenOption && !bedLinenProvided;

  // Resources list (specs/manual-email-from-template.md is unrelated; this is J-1 §3 rule 4) —
  // booked resources' names, sorted alphabetically for stable rendering.
  const resourcesTitles = (resources || [])
    .map(resourceName)
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, 'fr'));
  const resourcesList = resourcesTitles.join(', ');
  const hasResources = resourcesTitles.length > 0;

  // Nordic-bath reminder (specs/email-automation.md): guests who booked the « Bain nordique »
  // resource must bring their own swimsuit / towel / flip-flops (nothing is provided). Matched on
  // the resource name. If hourly sessions are scheduled on the booking, recall the date/time too.
  const nordicResource = (resources || []).find((rr) => normalizeName(rr.name).includes('nordique'));
  const hasNordicBath = Boolean(nordicResource);
  const parseSessions = (raw) => {
    if (Array.isArray(raw)) return raw;
    try { const parsed = JSON.parse(raw || '[]'); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
  };
  const nordicBathSchedule = (nordicResource ? parseSessions(nordicResource.sessions) : [])
    .filter((s) => s && s.date)
    .map((s) => {
      const day = formatDateLong(s.date, L);
      const start = s.start ? formatTimeShort(s.start) : '';
      const end = s.end ? formatTimeShort(s.end) : '';
      if (isEn) {
        if (start && end) return `on ${day} from ${start} to ${end}`;
        if (start) return `on ${day} at ${start}`;
        return `on ${day}`;
      }
      if (start && end) return `le ${day} de ${start} à ${end}`;
      if (start) return `le ${day} à ${start}`;
      return `le ${day}`;
    })
    .join(isEn ? ' and ' : ' et ');
  // Composed server-side (the renderer has no nested conditionals): one sentence that optionally
  // recalls the scheduled slot. The template renders it via `{{#if hasNordicBath}}{{nordicBathReminder}}{{/if}}`.
  const nordicBathReminder = hasNordicBath
    ? (isEn
      ? [
        'You have booked the nordic bath: a real moment of relaxation awaits you!',
        nordicBathSchedule ? `Your slot is reserved ${nordicBathSchedule}.` : '',
        'To make the most of it, remember to bring your swimsuit, a bathrobe or a towel, and a pair of flip-flops — these items are not provided on site.',
      ].filter(Boolean).join(' ')
      : [
        'Vous avez réservé le bain nordique : un véritable moment de détente vous attend !',
        nordicBathSchedule ? `Votre créneau est réservé ${nordicBathSchedule}.` : '',
        'Pour en profiter pleinement, pensez à emporter votre maillot de bain, un peignoir ou une serviette, ainsi qu\'une paire de tongs — ces équipements ne sont pas fournis sur place.',
      ].filter(Boolean).join(' '))
    : '';

  // Complement to collect on arrival (specs/j1-complement-to-collect.md). The notice appears only
  // when an unpaid complement remains. The per-item breakdown matches the options/resources/custom
  // options flagged `inComplement` (paid ones, offered=0) + the tourist tax when it's in the
  // complement — so the guest knows what the complement corresponds to. The list may be partial vs.
  // the total (the complement can also carry an accommodation auto-gap), hence "comprend notamment".
  const complementAmountNum = Number(r.complementAmount || 0);
  const complementToCollect = complementAmountNum > 0 && Number(r.complementPaid || 0) !== 1;
  const inComplementItems = [];
  for (const o of (options || [])) {
    if (Number(o.inComplement || 0) === 1 && Number(o.offered || 0) !== 1) {
      inComplementItems.push({ label: safeStr(o.title).trim(), amount: Number(o.totalPrice || 0) });
    }
  }
  for (const rr of (resources || [])) {
    if (Number(rr.inComplement || 0) === 1 && Number(rr.offered || 0) !== 1) {
      inComplementItems.push({ label: safeStr(rr.name).trim(), amount: Number(rr.totalPrice || 0) });
    }
  }
  for (const co of (customOptions || [])) {
    if (Number(co.inComplement || 0) === 1 && Number(co.offered || 0) !== 1) {
      inComplementItems.push({ label: safeStr(co.description).trim(), amount: Number(co.amount || 0) });
    }
  }
  if (Number(r.touristTaxInComplement || 0) === 1 && Number(r.touristTaxTotal || 0) > 0) {
    inComplementItems.push({ label: isEn ? 'Tourist tax' : 'Taxe de séjour', amount: Number(r.touristTaxTotal || 0) });
  }
  // specs/j2-email-arrival-complement-line.md — when the caller passes the arrival-SAS breakdown
  // (`arrivalComplementDetail` = the SAME source of truth as the SAS recap:
  // reservationsModel.buildArrivalComplementDetail), use it: it's COMPLETE (options + resources +
  // the 3-way tourist-tax-in-complement amount + a « Complément d'arrivée » remainder) and sums to
  // the full complement — so the line always describes what the complement is for. The inline list
  // above is kept as the fallback for callers that don't provide the detail (back-compat).
  const sasDetailLines = Array.isArray(arrivalComplementDetail?.detail) ? arrivalComplementDetail.detail : null;
  const usingSasDetail = sasDetailLines && sasDetailLines.length > 0;
  const complementBreakdown = usingSasDetail
    ? sasDetailLines
      .filter((it) => safeStr(it.label).trim() && Number(it.amount) > 0)
      .map((it) => `${safeStr(it.label).trim()} (${formatCurrency(Number(it.amount))})`)
      .join(', ')
    : inComplementItems
      .filter((it) => it.label && it.amount > 0)
      .map((it) => `${it.label} (${formatCurrency(it.amount)})`)
      .join(', ');
  let complementNotice = '';
  if (complementToCollect) {
    if (isEn) {
      complementNotice = `A balance of ${formatCurrency(complementAmountNum)} will be payable directly on site on arrival.`;
      // « includes » (complete, from the SAS detail) vs « notably includes » (partial inline list).
      if (complementBreakdown) complementNotice += `${usingSasDetail ? ' It includes' : ' It notably includes'}: ${complementBreakdown}.`;
    } else {
      complementNotice = `Un complément de ${formatCurrency(complementAmountNum)} sera à régler directement sur place à votre arrivée.`;
      if (complementBreakdown) complementNotice += `${usingSasDetail ? ' Il comprend' : ' Il comprend notamment'} : ${complementBreakdown}.`;
    }
  }

  // Spec §4.4: cautionNotBanked = cautionAmount > 0 AND depositPaid != 1. Pragmatic proxy
  // until a dedicated cautionMethod column lands. Also suppressed once the caution has been
  // RECEIVED (`cautionReceived = 1`): if the operator already has the caution in hand, no arrival
  // email should ask the guest to bring it (2026-06-22 fix — was reminding on a received caution).
  const cautionReceivedFlag = Number(r.cautionReceived || 0) === 1;
  // specs/caution-live-from-property.md §3 — caution is live from the property's current
  // defaultCautionAmount until received, then frozen to the collected amount on the reservation.
  const cautionAmountNum = cautionReceivedFlag
    ? Number(r.cautionAmount || 0)
    : Number(p.defaultCautionAmount || 0);
  const cautionNotBanked = cautionAmountNum > 0 && Number(r.depositPaid || 0) !== 1 && !cautionReceivedFlag;
  // Precise caution signal for the J-1 reminder (specs/j1-arrival-reminder-email.md §3 rule 5):
  // the caution cheque is still owed when an amount is due AND it has not been received yet.
  const cautionNotReceived = cautionAmountNum > 0 && !cautionReceivedFlag;

  // Baby-bed notice for the J-7 reminder (specs/j7-email-baby-beds.md). Only relevant when the
  // booking has at least one baby. If baby beds are provided → tell the guest how many; if the
  // booking has babies but NO baby bed (none left for the dates) → ask them to bring their own.
  const babiesNum = Number(r.babies || 0);
  const babyBedsNum = Number(r.babyBeds || 0);
  const hasBabyBedNotice = babiesNum > 0;
  let babyBedNotice = '';
  if (isEn) {
    const babiesPart = babiesNum > 1 ? 'babies' : 'a baby';
    if (babiesNum > 0 && babyBedsNum > 0) {
      babyBedNotice = babyBedsNum > 1
        ? `You are travelling with ${babiesPart}: ${babyBedsNum} baby cots are provided.`
        : `You are travelling with ${babiesPart}: a baby cot is provided.`;
    } else if (babiesNum > 0) {
      babyBedNotice = `You are travelling with ${babiesPart}: we no longer have a baby cot available for your dates. Please plan to bring your own.`;
    }
  } else if (babiesNum > 0 && babyBedsNum > 0) {
    const babiesPart = babiesNum > 1 ? 'des bébés' : 'un bébé';
    babyBedNotice = babyBedsNum > 1
      ? `Vous voyagez avec ${babiesPart} : ${babyBedsNum} lits bébé vous sont fournis.`
      : `Vous voyagez avec ${babiesPart} : un lit bébé vous est fourni.`;
  } else if (babiesNum > 0) {
    const babiesPart = babiesNum > 1 ? 'des bébés' : 'un bébé';
    babyBedNotice = `Vous voyagez avec ${babiesPart} : nous ne disposons plus de lit bébé disponible pour vos dates. Merci de prévoir d'en apporter un.`;
  }

  return {
    vars: {
      // Client
      clientFirstName: safeStr(c.firstName),
      clientLastName:  safeStr(c.lastName),
      clientFullName:  fullName,
      clientEmail:     safeStr(c.email),
      clientPhone:     safeStr(c.phone),
      clientAddress:   joinAddress(c),
      // Reservation
      reservationNumber: safeStr(r.reservationNumber),
      startDate:    formatDateLong(r.startDate, L),
      endDate:      formatDateLong(r.endDate, L),
      checkInTime,
      checkOutTime,
      nights:       String(nights),
      adultsCount:  String(Number(r.adults || 0)),
      teensCount:   String(Number(r.teens || 0)),
      childrenCount:String(Number(r.children || 0)),
      babiesCount:  String(Number(r.babies || 0)),
      totalGuests:  String(totalGuests),
      // Property
      propertyName:        safeStr(p.name),
      propertyWithArticle: formatPropertyWithArticle(p.name, p.nameArticle, L),
      propertyAddress:     '', // see §4.4: column doesn't exist yet, ship as empty string.
      // Financial
      finalPrice:      formatCurrency(Number(r.finalPrice || 0)),
      depositAmount:   formatCurrency(Number(r.depositAmount || 0)),
      depositDueDate:  formatDateLong(r.depositDueDate, L),
      validUntil:      formatDateLong(r.validUntil, L), // devis validity date — used by the deposit reminder

      balanceAmount:   formatCurrency(Number(r.balanceAmount || 0)),
      balanceDueDate:  formatDateLong(r.balanceDueDate, L),
      cautionAmount:   formatCurrency(cautionAmountNum),
      complementAmount: formatCurrency(complementAmountNum),
      complementNotice,
      // Online payment link — empty by default; the sender injects the real URL per-send via
      // `extraContext` (the link is created on demand, it is not a reservation column).
      paymentLink:     '',
      // Lists
      optionsList,
      reservedOptionsList,
      resourcesList,
      nordicBathSchedule,
      nordicBathReminder,
      bedConfig: formatBedConfig({
        singleBeds: r.singleBeds, doubleBeds: r.doubleBeds, babyBeds: r.babyBeds,
      }, L),
      babyBedNotice,
      // Company
      companyName:  safeStr(settings.companyName),
      companyPhone: safeStr(settings.companyPhone),
      companyEmail: safeStr(settings.companyEmail),
      // Email sender display name (Settings → Envoi d'emails → "Nom expéditeur"); falls back
      // to the legal company name when blank. Used for the email signature.
      senderName:   safeStr(settings.smtpFromName).trim() || safeStr(settings.companyName),
    },
    flags: {
      hasReservationNumber: safeStr(r.reservationNumber).trim().length > 0,
      hasBedLinenOption,
      hasCleaningOption,
      bedLinenProvidedByDefault: bedLinenProvided,
      bedLinenBringYourOwn,
      cautionNotBanked,
      cautionNotReceived,
      complementToCollect,
      hasOptions,
      hasReservedOptions,
      hasResources,
      hasNordicBath,
      hasBabyBedNotice,
      hasPaymentLink: false, // overridden per-send via extraContext when a payment link is attached
    },
  };
}

module.exports = {
  buildContext,
  normaliseLang,
  // Exposed for tests.
  __test: { formatBedConfig, joinAddress, diffDays, formatPropertyWithArticle },
};
