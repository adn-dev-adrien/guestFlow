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

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_AVAILABILITY_DAYS = 365;

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
 * Validate the shared stay shape used by both /quote and /booking-requests (dates, times, guest
 * counts, options). `platform` is intentionally ignored — the public path always forces 'direct'
 * (specs/public-api.md Q8). Returns a sanitized value with only the whitelisted fields.
 */
function validateStayInput(body = {}) {
  const errors = [];
  const propertyId = toNonNegativeInt(body.propertyId, NaN);
  if (!Number.isFinite(propertyId) || propertyId <= 0) errors.push({ field: 'propertyId', issue: 'required positive integer' });

  if (!isValidIsoDate(body.startDate)) errors.push({ field: 'startDate', issue: 'must be an ISO date (YYYY-MM-DD)' });
  if (!isValidIsoDate(body.endDate)) errors.push({ field: 'endDate', issue: 'must be an ISO date (YYYY-MM-DD)' });
  if (isValidIsoDate(body.startDate) && isValidIsoDate(body.endDate) && body.endDate <= body.startDate) {
    errors.push({ field: 'endDate', issue: 'must be after startDate' });
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
    }
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
      options,
      resources,
    },
  };
}

/**
 * Validate the guest contact block + message for a booking request. Honeypot (`_hp`) is checked
 * by the controller (it intentionally returns a fake success), not here.
 */
function validateGuest(guest = {}) {
  const errors = [];
  const firstName = String(guest.firstName || '').trim();
  const lastName = String(guest.lastName || '').trim();
  const email = String(guest.email || '').trim();
  const phone = String(guest.phone || '').trim();
  if (!firstName) errors.push({ field: 'guest.firstName', issue: 'required' });
  if (!lastName) errors.push({ field: 'guest.lastName', issue: 'required' });
  if (!EMAIL.test(email)) errors.push({ field: 'guest.email', issue: 'must be a valid email' });
  if (!phone) errors.push({ field: 'guest.phone', issue: 'required' });
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { firstName, lastName, email, phone } };
}

module.exports = {
  MAX_AVAILABILITY_DAYS,
  isValidIsoDate,
  toNonNegativeInt,
  daysBetween,
  validateAvailabilityQuery,
  validateStayInput,
  validateGuest,
};
