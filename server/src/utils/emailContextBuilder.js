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

function safeStr(v) {
  return v == null ? '' : String(v);
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
function formatBedConfig({ singleBeds, doubleBeds, babyBeds }) {
  const parts = [];
  const dn = Number(doubleBeds || 0);
  const sn = Number(singleBeds || 0);
  const bn = Number(babyBeds || 0);
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
function formatPropertyWithArticle(name, article) {
  const n = safeStr(name).trim();
  if (!n) return '';
  const a = safeStr(article).trim() || 'au';
  return a.endsWith("'") ? `${a}${n}` : `${a} ${n}`;
}

/**
 * @param {{
 *   reservation: object,           // reservations row
 *   client: object | null,         // clients row
 *   property: object | null,       // properties row
 *   options: object[],             // joined reservation_options rows (with options.title + autoOptionType)
 *   settings: object,              // app_settings row
 * }} input
 * @returns {{ vars: object, flags: object }}
 */
function buildContext({ reservation, client, property, options = [], settings = {} }) {
  const r = reservation || {};
  const c = client || {};
  const p = property || {};

  const fullName = `${safeStr(c.firstName).trim()} ${safeStr(c.lastName).trim()}`.trim();
  const checkInTime  = formatTimeShort(r.checkInTime  || p.defaultCheckIn  || '');
  const checkOutTime = formatTimeShort(r.checkOutTime || p.defaultCheckOut || '');

  const nights = diffDays(r.startDate, r.endDate);
  const totalGuests = Number(r.adults || 0) + Number(r.teens || 0) + Number(r.children || 0) + Number(r.babies || 0);

  // Options list — sorted alphabetically for stable rendering across boots.
  const optionsTitles = (options || [])
    .map((o) => safeStr(o.title).trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, 'fr'));
  const optionsList = optionsTitles.join(', ');

  const hasOptions = optionsTitles.length > 0;
  const hasBedLinenOption = (options || []).some((o) => safeStr(o.autoOptionType) === 'bed_linen');

  // Spec §4.4: cautionNotBanked = cautionAmount > 0 AND depositPaid != 1. Pragmatic proxy
  // until a dedicated cautionMethod column lands.
  const cautionAmountNum = Number(r.cautionAmount || 0);
  const cautionNotBanked = cautionAmountNum > 0 && Number(r.depositPaid || 0) !== 1;

  // Baby-bed notice for the J-7 reminder (specs/j7-email-baby-beds.md). Only relevant when the
  // booking has at least one baby. If baby beds are provided → tell the guest how many; if the
  // booking has babies but NO baby bed (none left for the dates) → ask them to bring their own.
  const babiesNum = Number(r.babies || 0);
  const babyBedsNum = Number(r.babyBeds || 0);
  const hasBabyBedNotice = babiesNum > 0;
  let babyBedNotice = '';
  if (babiesNum > 0 && babyBedsNum > 0) {
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
      startDate:    formatDateLong(r.startDate),
      endDate:      formatDateLong(r.endDate),
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
      propertyWithArticle: formatPropertyWithArticle(p.name, p.nameArticle),
      propertyAddress:     '', // see §4.4: column doesn't exist yet, ship as empty string.
      // Financial
      finalPrice:      formatCurrency(Number(r.finalPrice || 0)),
      depositAmount:   formatCurrency(Number(r.depositAmount || 0)),
      depositDueDate:  formatDateLong(r.depositDueDate),
      balanceAmount:   formatCurrency(Number(r.balanceAmount || 0)),
      balanceDueDate:  formatDateLong(r.balanceDueDate),
      cautionAmount:   formatCurrency(cautionAmountNum),
      // Lists
      optionsList,
      bedConfig: formatBedConfig({
        singleBeds: r.singleBeds, doubleBeds: r.doubleBeds, babyBeds: r.babyBeds,
      }),
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
      hasBedLinenOption,
      cautionNotBanked,
      hasOptions,
      hasBabyBedNotice,
    },
  };
}

module.exports = {
  buildContext,
  // Exposed for tests.
  __test: { formatBedConfig, joinAddress, diffDays, formatPropertyWithArticle },
};
