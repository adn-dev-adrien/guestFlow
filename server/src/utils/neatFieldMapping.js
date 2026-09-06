/**
 * Neat contract-field mapping (specs/neat-cancellation-insurance-subscription.md §3.1 rule 4).
 *
 * A Neat contract declares its own `serviceFields` (id, name, type, required, options) — they are
 * only knowable through the API, so nothing here hardcodes a payload shape. The operator binds each
 * required field to a GuestFlow source; this module validates that binding and builds the
 * `serviceFieldValues` array from a reservation snapshot. Pure functions, no I/O.
 *
 * Mapping JSON shape: { [serviceFieldId]: { source: '<catalogue key>', constant?: '...' } }
 */

// What each GuestFlow source yields (drives type compatibility). `constant` matches any field
// type: the typed value is validated/coerced against the target field instead.
const SOURCES = {
  startDate: { type: 'datetime', label: "Date d'arrivée" },
  endDate: { type: 'datetime', label: 'Date de départ' },
  nights: { type: 'number', label: 'Nombre de nuits' },
  guests: { type: 'number', label: 'Voyageurs (adultes + enfants)' },
  accommodationAmount: { type: 'number', label: 'Montant hébergement' },
  insuranceAmount: { type: 'number', label: "Montant de la ligne assurance" },
  totalAmount: { type: 'number', label: 'Montant total du séjour (hors assurance)' },
  propertyName: { type: 'string', label: 'Nom du logement' },
  reservationRef: { type: 'string', label: 'Référence de la réservation' },
  constant: { type: 'any', label: 'Valeur fixe' },
};

// The serviceFields of a ContractDto live under product.Garanties[].serviceFields; flatten them,
// first occurrence of an id wins (a field shared by two garanties is one input, not two).
function contractServiceFields(contract) {
  const out = [];
  const seen = new Set();
  const garanties = (contract && contract.product && contract.product.Garanties) || [];
  for (const g of garanties) {
    for (const f of g.serviceFields || []) {
      if (!f || !f.id || seen.has(f.id)) continue;
      seen.add(f.id);
      out.push({
        id: String(f.id),
        title: String(f.title || f.name || f.id),
        name: String(f.name || ''),
        type: String(f.type || 'string'),
        required: Boolean(f.required),
        options: Array.isArray(f.options) ? f.options.map(String) : [],
      });
    }
  }
  return out;
}

function parseMappingJson(json) {
  if (!json) return {};
  try {
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

// A string source can feed a string field; numbers feed number fields; datetimes feed datetime
// fields. String fields also accept any non-constant source (everything stringifies losslessly).
function sourceFitsField(sourceKey, field) {
  if (sourceKey === 'constant') return true;
  const src = SOURCES[sourceKey];
  if (!src) return false;
  if (field.type === 'string') return true;
  if (field.type === 'number') return src.type === 'number';
  if (field.type === 'datetime') return src.type === 'datetime';
  // dropdown/checkbox values cannot be derived from stay data — only a constant fits.
  return false;
}

/**
 * Validates a mapping against a contract's fields. Returns { ok, errors: [{ fieldId, error }] }.
 * `errors` uses stable codes the client renders in French: REQUIRED_UNMAPPED, UNKNOWN_SOURCE,
 * TYPE_MISMATCH, CONSTANT_REQUIRED, CONSTANT_NOT_IN_OPTIONS, CONSTANT_NOT_NUMERIC.
 */
function validateMapping(mapping, fields) {
  const errors = [];
  for (const field of fields) {
    const entry = mapping[field.id];
    if (!entry || !entry.source) {
      if (field.required) errors.push({ fieldId: field.id, error: 'REQUIRED_UNMAPPED' });
      continue;
    }
    if (!SOURCES[entry.source]) {
      errors.push({ fieldId: field.id, error: 'UNKNOWN_SOURCE' });
      continue;
    }
    if (!sourceFitsField(entry.source, field)) {
      errors.push({ fieldId: field.id, error: 'TYPE_MISMATCH' });
      continue;
    }
    if (entry.source === 'constant') {
      const constant = entry.constant == null ? '' : String(entry.constant);
      if (constant === '' && field.type !== 'checkbox') {
        errors.push({ fieldId: field.id, error: 'CONSTANT_REQUIRED' });
        continue;
      }
      if (field.type === 'dropdown' && field.options.length > 0 && !field.options.includes(constant)) {
        errors.push({ fieldId: field.id, error: 'CONSTANT_NOT_IN_OPTIONS' });
        continue;
      }
      if (field.type === 'number' && !Number.isFinite(Number(constant))) {
        errors.push({ fieldId: field.id, error: 'CONSTANT_NOT_NUMERIC' });
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

// 'YYYY-MM-DD' → ISO datetime (midnight UTC); anything else is passed through as-is.
function toDatetimeValue(value) {
  const s = String(value || '');
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00.000Z` : s;
}

function snapshotValue(sourceKey, snapshot) {
  switch (sourceKey) {
    case 'startDate': return snapshot.startDate;
    case 'endDate': return snapshot.endDate;
    case 'nights': return snapshot.nights;
    case 'guests': return snapshot.guests;
    case 'accommodationAmount': return snapshot.accommodationAmount;
    case 'insuranceAmount': return snapshot.insuranceAmount;
    case 'totalAmount': return snapshot.totalAmount;
    case 'propertyName': return snapshot.propertyName;
    case 'reservationRef': return snapshot.reservationRef;
    default: return undefined;
  }
}

/**
 * Builds the `serviceFieldValues` array for /price and /subscriptions from a validated mapping and
 * a stay snapshot ({ startDate, endDate, nights, guests, accommodationAmount, insuranceAmount,
 * totalAmount, propertyName, reservationRef }). Unmapped optional fields are simply omitted.
 */
function buildServiceFieldValues(mapping, fields, snapshot) {
  const values = [];
  for (const field of fields) {
    const entry = mapping[field.id];
    if (!entry || !entry.source || !SOURCES[entry.source]) continue;
    const raw = entry.source === 'constant' ? entry.constant : snapshotValue(entry.source, snapshot);
    if (raw === undefined || raw === null || raw === '') continue;
    let value;
    if (field.type === 'number') value = Number(raw);
    else if (field.type === 'checkbox') value = raw === true || String(raw).toLowerCase() === 'true';
    else if (field.type === 'datetime') value = toDatetimeValue(raw);
    else value = String(raw);
    values.push({ id: field.id, type: field.type, value });
  }
  return values;
}

/**
 * Neat `customers[0]` from a GuestFlow client row (rule 5). Fields GuestFlow does not hold
 * (birthdate, birthplace…) are omitted on purpose — a contract requiring them fails with Neat's
 * 400, which lands in the job's lastError instead of being silently faked.
 */
function buildCustomerPayload(client = {}) {
  const out = {
    firstName: String(client.firstName || '').trim(),
    lastName: String(client.lastName || '').trim(),
    email: String(client.email || '').trim(),
  };
  const phone = String(client.phone || '').trim();
  if (phone) out.phone = phone;
  const street = [String(client.streetNumber || '').trim(), String(client.street || '').trim()]
    .filter(Boolean).join(' ');
  const postalCode = String(client.postalCode || '').trim();
  const city = String(client.city || '').trim();
  if (street || postalCode || city) {
    out.address = { ...(street ? { street } : {}), ...(postalCode ? { postalCode } : {}), ...(city ? { city } : {}) };
  }
  return out;
}

module.exports = {
  SOURCES,
  contractServiceFields,
  parseMappingJson,
  validateMapping,
  buildServiceFieldValues,
  buildCustomerPayload,
};
