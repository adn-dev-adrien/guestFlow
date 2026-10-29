/**
 * Pure input validators for the PUBLIC API boundary (specs/public-api.md §3 rule 8).
 *
 * Every public request is validated here BEFORE any engine/DB call. Validators are pure and
 * unit-tested; they never touch the DB. They return a structured result so the controller can
 * emit the uniform error envelope:
 *   { ok: true, value } | { ok: false, errors: [{ field, issue }] }
 *
 * Date format is strict ISO `YYYY-MM-DD`. Guest counts are non-negative integers. Capacity is
 * NOT checked here (that needs the property row) — only shape/range/coherence.
 */

const sdk = require('../sdk');

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
// Same shape as the client dialog's (utils/clientValidation.isValidPhone): 8–15 digits, an optional leading +,
// spaces, dots, dashes and brackets as separators — and nothing else, so no line break reaches an operator e-mail.
const isValidPhone = (value) => {
  const normalized = String(value || '').trim().replace(/[ ().-]/g, '');
  return normalized.startsWith('+') ? /^\+[0-9]{8,15}$/.test(normalized) : /^[0-9]{10,15}$/.test(normalized);
};
// The length is checked before the shape (core `validateEmail`, linear): a 195 KB address once froze the instance for 35 s.
const isValidGuestEmail = (value) => value !== '' && sdk.coreModule('settingsValidation').validateEmail(value) === null;
const MAX_AVAILABILITY_DAYS = 365;
// Bounds on a public stay (specs/public-api.md rule 8). The engine walks the stay night by night,
// synchronously: an unbounded endDate (9999-12-31) is millions of iterations that block the server.
const MAX_STAY_NIGHTS = 365;
const MAX_BOOKING_HORIZON_DAYS = 730;
// The most one option or resource line may ask for (fixed at the 2026-10-27 spec review: 1e9 was
// accepted, priced and printed). One unit per guest per hour of the stay, counting the departure day:
// above any real need — hours of a resource, portions, sessions — and still bounded by the party.
const HOURS_PER_DAY = 24;
function maxLineQuantity({ persons, nights }) {
  return Math.max(1, persons) * (Math.max(0, nights) + 1) * HOURS_PER_DAY;
}

function isValidIsoDate(value) {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function toNonNegativeInt(value, fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) return NaN;
  return n;
}

function daysBetween(fromIso, toIso) {
  const from = new Date(`${fromIso}T00:00:00Z`);
  const to = new Date(`${toIso}T00:00:00Z`);
  return Math.round((to - from) / 86400000);
}

/**
 * Validate an availability query: optional `from`/`to`. Defaults to today … today+12 months
 * (the `today` ISO string is injected so the function stays pure/testable). Caps the window at
 * 365 days and rejects inverted ranges.
 */
function validateAvailabilityQuery({ from, to, todayIso }) {
  const errors = [];
  const start = from === undefined || from === '' ? todayIso : from;
  let end = to === undefined || to === '' ? null : to;

  if (!isValidIsoDate(start)) errors.push({ field: 'from', issue: 'must be an ISO date (YYYY-MM-DD)' });
  if (end !== null && !isValidIsoDate(end)) errors.push({ field: 'to', issue: 'must be an ISO date (YYYY-MM-DD)' });
  if (errors.length) return { ok: false, errors };

  if (end === null) {
    const d = new Date(`${start}T00:00:00Z`);
    d.setUTCFullYear(d.getUTCFullYear() + 1);
    end = d.toISOString().slice(0, 10);
  }
  if (end <= start) errors.push({ field: 'to', issue: 'must be after from' });
  else if (daysBetween(start, end) > MAX_AVAILABILITY_DAYS) {
    errors.push({ field: 'to', issue: `range must not exceed ${MAX_AVAILABILITY_DAYS} days` });
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { from: start, to: end } };
}

/**
 * One line per option / resource: the same id twice is refused here, at the boundary (fixed at the
 * 2026-10-27 audit — it reached the booking lines' UNIQUE index and answered a 500). The quantity says
 * how many.
 */
function pushDuplicates(errors, lines, field, key) {
  const seen = new Set();
  lines.forEach((line, i) => {
    if (!Number.isFinite(line[key])) return;
    if (seen.has(line[key])) errors.push({ field: `${field}[${i}].${key}`, issue: 'duplicate id: send one line with a quantity' });
    seen.add(line[key]);
  });
}

/**
 * Validate the shared stay shape used by both /quote and /booking-requests (dates, times, guest
 * counts, options). `platform` is intentionally ignored — the public path always forces 'direct'
 * (specs/public-api.md Q8). Returns a sanitized value with only the whitelisted fields.
 *
 * `todayIso` (the accommodations' day, injected to keep this pure) refuses a stay starting in the
 * past or ending beyond MAX_BOOKING_HORIZON_DAYS; the stay length is capped at MAX_STAY_NIGHTS
 * whatever the day. Both public controllers pass it.
 */
function validateStayInput(body = {}, { todayIso } = {}) {
  const errors = [];
  const propertyId = toNonNegativeInt(body.propertyId, NaN);
  if (!Number.isFinite(propertyId) || propertyId <= 0) errors.push({ field: 'propertyId', issue: 'required positive integer' });

  if (!isValidIsoDate(body.startDate)) errors.push({ field: 'startDate', issue: 'must be an ISO date (YYYY-MM-DD)' });
  if (!isValidIsoDate(body.endDate)) errors.push({ field: 'endDate', issue: 'must be an ISO date (YYYY-MM-DD)' });
  if (isValidIsoDate(body.startDate) && isValidIsoDate(body.endDate)) {
    if (body.endDate <= body.startDate) {
      errors.push({ field: 'endDate', issue: 'must be after startDate' });
    } else if (daysBetween(body.startDate, body.endDate) > MAX_STAY_NIGHTS) {
      errors.push({ field: 'endDate', issue: `stay must not exceed ${MAX_STAY_NIGHTS} nights` });
    }
    if (isValidIsoDate(todayIso)) {
      if (body.startDate < todayIso) errors.push({ field: 'startDate', issue: 'must not be in the past' });
      if (daysBetween(todayIso, body.endDate) > MAX_BOOKING_HORIZON_DAYS) {
        errors.push({ field: 'endDate', issue: `must be within ${MAX_BOOKING_HORIZON_DAYS} days from today` });
      }
    }
  }

  if (body.checkInTime !== undefined && body.checkInTime !== '' && !ISO_TIME.test(body.checkInTime)) {
    errors.push({ field: 'checkInTime', issue: 'must be HH:MM' });
  }
  if (body.checkOutTime !== undefined && body.checkOutTime !== '' && !ISO_TIME.test(body.checkOutTime)) {
    errors.push({ field: 'checkOutTime', issue: 'must be HH:MM' });
  }

  const counts = {};
  for (const field of ['adults', 'children', 'teens', 'babies']) {
    const n = toNonNegativeInt(body[field], field === 'adults' ? 1 : 0);
    if (Number.isNaN(n)) errors.push({ field, issue: 'must be a non-negative integer' });
    else counts[field] = n;
  }
  if (Number.isFinite(counts.adults) && counts.adults < 1) errors.push({ field: 'adults', issue: 'at least 1 adult required' });

  // Baby beds (couchage) — a non-negative integer, defaulted to 0. Routed to the devis `babyBeds`
  // field (not a resource line) so it shows in the operator's "Couchage" section
  // (specs/site-booking-notifications.md §3 rule 16). Capped at the number of babies.
  let babyBeds = toNonNegativeInt(body.babyBeds, 0);
  if (Number.isNaN(babyBeds)) { errors.push({ field: 'babyBeds', issue: 'must be a non-negative integer' }); babyBeds = 0; }
  if (Number.isFinite(counts.babies) && babyBeds > counts.babies) babyBeds = counts.babies;

  let options = [];
  if (body.options !== undefined) {
    if (!Array.isArray(body.options)) {
      errors.push({ field: 'options', issue: 'must be an array' });
    } else {
      options = body.options.map((o, i) => {
        const optionId = toNonNegativeInt(o && o.optionId, NaN);
        const quantity = toNonNegativeInt(o && o.quantity, 1);
        if (!Number.isFinite(optionId) || optionId <= 0) errors.push({ field: `options[${i}].optionId`, issue: 'required positive integer' });
        if (Number.isNaN(quantity) || quantity < 1) errors.push({ field: `options[${i}].quantity`, issue: 'must be a positive integer' });
        return { optionId, quantity: Number.isNaN(quantity) ? 1 : quantity };
      });
      pushDuplicates(errors, options, 'options', 'optionId');
    }
  }

  // Resources mirror options: reduced to { resourceId, quantity } only — no price/offered/inComplement
  // can be injected from the public client (the per-property effective price is resolved server-side).
  let resources = [];
  if (body.resources !== undefined) {
    if (!Array.isArray(body.resources)) {
      errors.push({ field: 'resources', issue: 'must be an array' });
    } else {
      resources = body.resources.map((r, i) => {
        const resourceId = toNonNegativeInt(r && r.resourceId, NaN);
        const quantity = toNonNegativeInt(r && r.quantity, 1);
        if (!Number.isFinite(resourceId) || resourceId <= 0) errors.push({ field: `resources[${i}].resourceId`, issue: 'required positive integer' });
        if (Number.isNaN(quantity) || quantity < 1) errors.push({ field: `resources[${i}].quantity`, issue: 'must be a positive integer' });
        return { resourceId, quantity: Number.isNaN(quantity) ? 1 : quantity };
      });
      pushDuplicates(errors, resources, 'resources', 'resourceId');
    }
  }

  // A line asking for more than the stay could ever use (see maxLineQuantity).
  if (isValidIsoDate(body.startDate) && isValidIsoDate(body.endDate) && body.endDate > body.startDate
    && ['adults', 'children', 'teens', 'babies'].every((k) => Number.isFinite(counts[k]))) {
    const cap = maxLineQuantity({
      persons: counts.adults + counts.children + counts.teens + counts.babies,
      nights: daysBetween(body.startDate, body.endDate),
    });
    [['options', options], ['resources', resources]].forEach(([field, list]) => list.forEach((line, i) => {
      if (line.quantity > cap) errors.push({ field: `${field}[${i}].quantity`, issue: `must not exceed ${cap} for this stay` });
    }));
  }

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      propertyId,
      startDate: body.startDate,
      endDate: body.endDate,
      checkInTime: body.checkInTime || undefined,
      checkOutTime: body.checkOutTime || undefined,
      adults: counts.adults,
      children: counts.children,
      teens: counts.teens,
      babies: counts.babies,
      babyBeds,
      options,
      resources,
    },
  };
}

/**
 * Validate the guest contact block + message for a booking request. Honeypot (`_hp`) is checked
 * by the controller (it intentionally returns a fake success), not here.
 *
 * Each error carries a `reason` (`required` | `emailInvalid` | `phoneInvalid` | `tooLong`) next to its unchanged `issue`: the
 * reason picks the visitor-facing sentence (`fieldErrors` in publicLabels), so an empty address
 * reads « Champ requis. » and `jo@` reads « Adresse e-mail incomplète. »
 * (specs/wordpress-plugin.md rule 28).
 */
const GUEST_MAX = Object.freeze({ firstName: 100, lastName: 100, phone: 40, email: 254 });

// Bidi overrides and zero-width characters let a name read backwards or pass for another; the joiners stay for Persian/Indic names.
const withoutFormatChars = (v) => String(v || '').replace(/(?![\u200C\u200D])\p{Cf}/gu, '').trim();

function validateGuest(guest = {}) {
  const errors = [];
  const firstName = withoutFormatChars(guest.firstName);
  const lastName = withoutFormatChars(guest.lastName);
  const email = String(guest.email || '').trim();
  const phone = String(guest.phone || '').trim();
  if (!firstName) errors.push({ field: 'guest.firstName', issue: 'required', reason: 'required' });
  if (!lastName) errors.push({ field: 'guest.lastName', issue: 'required', reason: 'required' });
  if (email.length <= GUEST_MAX.email && !isValidGuestEmail(email)) {
    errors.push({ field: 'guest.email', issue: 'must be a valid email', reason: email ? 'emailInvalid' : 'required' });
  }
  if (!phone) errors.push({ field: 'guest.phone', issue: 'required', reason: 'required' });
  else if (phone.length <= GUEST_MAX.phone && !isValidPhone(phone)) errors.push({ field: 'guest.phone', issue: 'must be a valid phone number', reason: 'phoneInvalid' });
  const tooLong = (field, text) => text.length > GUEST_MAX[field]
    && errors.every((e) => e.field !== `guest.${field}`)
    && errors.push({ field: `guest.${field}`, issue: `must be at most ${GUEST_MAX[field]} characters`, reason: 'tooLong' });
  tooLong('firstName', firstName);
  tooLong('lastName', lastName);
  tooLong('email', email);
  tooLong('phone', phone);
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { firstName, lastName, email, phone } };
}

/**
 * The guest errors with their sentence in the visitor's language, added as `message`
 * (specs/wordpress-plugin.md rule 28). `messages` is `labels(lang).fieldErrors`; the language is
 * resolved by the caller so this stays pure.
 */
function withFieldMessages(errors, messages) {
  return (errors || []).map((e) => (e.reason && messages[e.reason] ? { ...e, message: messages[e.reason] } : e));
}

const ATTRIBUTION_MAX = 200;
const ATTRIBUTION_TEXT_KEYS = ['utmSource', 'utmMedium', 'utmCampaign', 'utmContent', 'utmTerm'];
const HOSTNAME = /^(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/**
 * Clean the optional `attribution` record of a booking request (specs/site-traffic-analytics.md
 * rule 15). Unlike every other validator here it never refuses: analytics metadata must not cost a
 * guest their booking, so a bad field is dropped and a hopeless record becomes `null`.
 */
function validateAttribution(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const text = (v) => (typeof v === 'string' ? v.trim().slice(0, ATTRIBUTION_MAX) : '');
  const out = {};
  for (const k of ATTRIBUTION_TEXT_KEYS) {
    const v = text(raw[k]);
    if (v) out[k] = v;
  }
  const referrer = text(raw.referrer).toLowerCase();
  if (HOSTNAME.test(referrer)) out.referrer = referrer;
  const landingPath = text(raw.landingPath);
  if (landingPath.startsWith('/')) out.landingPath = landingPath;
  const firstSeenAt = text(raw.firstSeenAt);
  if (firstSeenAt && !Number.isNaN(Date.parse(firstSeenAt))) out.firstSeenAt = new Date(firstSeenAt).toISOString();
  return Object.keys(out).length ? out : null;
}

module.exports = {
  maxLineQuantity,
  MAX_AVAILABILITY_DAYS,
  MAX_STAY_NIGHTS,
  MAX_BOOKING_HORIZON_DAYS,
  validateAttribution,
  isValidIsoDate,
  toNonNegativeInt,
  daysBetween,
  validateAvailabilityQuery,
  validateStayInput,
  validateGuest,
  withFieldMessages,
};
