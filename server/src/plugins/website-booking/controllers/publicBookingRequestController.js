/**
 * Public booking-request controller (specs/public-api.md). The only public write. Creates a
 * PENDING record — a draft devis flagged requestOrigin='public' — never a confirmed reservation.
 *
 * Flow: validate → honeypot → option applicability → property/capacity → server-side availability +
 * min-nights re-check (via the pricing engine) → resolve-or-create client by email → create the
 * draft devis (reuses devisModel, which reruns the engine for the persisted pricing) → mark origin.
 *
 * CGV (specs/terms-acceptance-record.md §3.4): the request must carry the CURRENT published version the
 * guest ticked; the acceptance is written in the same transaction as the client and the devis, with the
 * server clock and the visitor the proxy relayed (req.visitor, ../visitorContext.js).
 */

const sdk = require('../../sdk');

const db = sdk.coreModule('database');
const clientsModel = sdk.coreModule('clientsModel');
const devisModel = sdk.coreModule('devisModel');
const notificationService = sdk.coreModule('notificationService');
const settings = require('../settings');
const termsModel = sdk.coreModule('termsModel');
const { validateStayInput, validateGuest, validateAttribution, withFieldMessages } = require('../publicInputValidation');
const { classifyAttribution } = sdk.coreModule('attributionChannel');
const { checkGuestCapacity, publicGuestCap } = sdk.coreModule('capacity');
const { generateToken } = sdk.coreModule('publicDevisToken');
const { computeBlockedDates, rangeHasBlockedNight } = require('./publicCatalogController');
const { buildEngineQuote, checkOptionApplicability, checkResourceApplicability } = require('./publicQuoteController');
const { stayRuleBreach, hasUnpricedNights } = require('../publicProjections');
const optionsModel = sdk.coreModule('optionsModel');
const { isPerPersonCardOption, portionCap, portionWording } = sdk.coreModule('mealPortions');
const { ok, fail, failT, langOf, langStated } = sdk.coreModule('publicHttp');
const { labels } = sdk.coreModule('publicLabels');
const requestStore = require('../requestStore');

// specs/public-request-abuse-and-grouping.md rule 7 — new quotes per e-mail address per 24 h.
const NEW_DEVIS_PER_EMAIL_PER_DAY = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

const normalisedEmail = (email) => String(email || '').trim().toLowerCase();
// `createdAt` of a devis row is SQLite's `YYYY-MM-DD HH:MM:SS`, in UTC.
const sqliteUtc = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

/**
 * Rule 12 — the open website quote of the same stay: same normalised e-mail, same property, same
 * dates, neither converted nor paid. Only a request from the site is ever updated this way: a quote
 * the operator typed is theirs.
 */
function findOpenSameStay(email, { propertyId, startDate, endDate }) {
  return db.prepare(`
    SELECT r.id, r.devisNumber, r.publicToken, r.createdAt, r.finalPrice
      FROM reservations r
      JOIN clients c ON c.id = r.clientId
     WHERE r.kind = 'devis' AND r.requestOrigin = 'public'
       AND lower(trim(c.email)) = ?
       AND r.propertyId = ? AND r.startDate = ? AND r.endDate = ?
       AND COALESCE(r.devisStatus, 'draft') IN ('draft', 'sent', 'accepted')
       AND r.convertedReservationId IS NULL
       AND NOT EXISTS (SELECT 1 FROM payment_links p WHERE p.reservationId = r.id AND p.status = 'paid')
     ORDER BY r.id DESC
     LIMIT 1
  `).get(normalisedEmail(email), Number(propertyId), startDate, endDate) || null;
}

/** Rule 7 — new website quotes for this e-mail in the last 24 h (an update is not one). */
function newDevisLastDay(email, now = Date.now()) {
  return Number((db.prepare(`
    SELECT COUNT(*) AS n FROM reservations r JOIN clients c ON c.id = r.clientId
     WHERE r.kind = 'devis' AND r.requestOrigin = 'public' AND lower(trim(c.email)) = ? AND r.createdAt >= ?
  `).get(normalisedEmail(email), sqliteUtc(now - DAY_MS)) || {}).n || 0);
}

/**
 * What a request asks for, beyond who and when: two requests with the same fingerprint are the same
 * request (a double click, edge case of rule 13), and the second changes nothing.
 */
function requestFingerprint(value, message) {
  const lines = (list, key) => (list || []).map((l) => [Number(l[key]), Number(l.quantity || 1)]).sort((a, b) => a[0] - b[0]);
  return require('crypto').createHash('sha256').update(JSON.stringify({
    adults: value.adults, teens: value.teens, children: value.children, babies: value.babies, babyBeds: value.babyBeds,
    checkInTime: value.checkInTime || null, checkOutTime: value.checkOutTime || null,
    options: lines(value.options, 'optionId'), resources: lines(value.resources, 'resourceId'),
    message: String(message || '').trim(),
  })).digest('hex');
}

/** The dated line a request updated in place appends to the notes (rule 13). */
function updateNote(message, identityNote, todayIso) {
  const [y, m, d] = String(todayIso).split('-');
  const head = `Demande mise à jour depuis le site le ${d}/${m}/${y}`;
  const text = String(message || '').trim();
  return [text ? `${head} :\n${text}` : `${head}.`, identityNote].filter(Boolean).join('\n\n');
}

/**
 * Per-person card options asked for beyond `persons × servings` (specs/site-meal-portions.md rule 3).
 * Returns the refusal, written in the visitor's language, + the usual `details` shape, or null when
 * everything fits.
 */
function checkPortionCaps(input, engineQuote, lang = 'fr') {
  const asked = new Map((input.options || []).map((o) => [Number(o.optionId), Number(o.quantity || 0)]));
  if (!asked.size) return null;
  const options = optionsModel.listForProperty(Number(input.propertyId)).filter(isPerPersonCardOption);
  for (const option of options) {
    const quantity = asked.get(Number(option.id));
    if (!(quantity > 0)) continue;
    const limit = portionCap({
      option,
      persons: Number(engineQuote.persons || 0),
      nights: Number(engineQuote.nights || 0),
      checkInTime: input.checkInTime,
      checkOutTime: input.checkOutTime,
      property: { defaultCheckIn: engineQuote.defaultCheckIn, defaultCheckOut: engineQuote.defaultCheckOut },
    });
    if (quantity > limit.cap) {
      return {
        message: portionWording(option, lang).refusal({ ...limit, nights: Number(engineQuote.nights || 0) }),
        details: [{ field: 'options', issue: `option ${option.id} quantity ${quantity} exceeds ${limit.cap}` }],
      };
    }
  }
  return null;
}

const sameText = (a, b) => String(a || '').trim().toLocaleLowerCase('fr') === String(b || '').trim().toLocaleLowerCase('fr');
const sameDigits = (a, b) => String(a || '').replace(/\D/g, '') === String(b || '').replace(/\D/g, '');

/**
 * The note filed on the devis when the e-mail matched an existing client but the visitor typed
 * another identity (specs/public-api.md rule 13). Empty when everything typed matches the record.
 * `statedLang` is null when the request stated no language: silence is not a different language.
 */
function submittedIdentityNote(client, guest, statedLang) {
  const langDiffers = statedLang && String(client.emailLanguage || 'fr') !== statedLang;
  if (sameText(client.firstName, guest.firstName) && sameText(client.lastName, guest.lastName)
    && sameDigits(client.phone, guest.phone) && !langDiffers) return '';
  const typed = [`${guest.firstName} ${guest.lastName}`.trim(), guest.phone, statedLang ? `langue ${statedLang}` : '']
    .filter(Boolean).join(', ');
  return `Client existant reconnu par l'e-mail — identité saisie : ${typed}. La fiche client n'a pas été modifiée.`;
}

function create(req, res) {
  // Honeypot: a filled `_hp` means a bot. Respond like a success WITHOUT persisting anything, so a
  // spammer can't tell a block from a pass (specs/public-api.md §3 edge cases).
  if (String(req.body._hp || '').trim() !== '') {
    return ok(res, { status: 'pending' }, 201);
  }

  const v = validateStayInput(req.body, { todayIso: sdk.coreModule('reservationHelpers').getTodayIsoDate() });
  if (!v.ok) return failT(res, req, 422, 'VALIDATION_FAILED', 'requestInvalid', v.errors);

  const g = validateGuest(req.body.guest);
  // Each refused field carries its own sentence, so the site can print it under that field
  // (specs/wordpress-plugin.md rule 28). `details` only gains keys: older plugins read `message`.
  if (!g.ok) {
    return failT(res, req, 422, 'VALIDATION_FAILED', 'clientInvalid', withFieldMessages(g.errors, labels(langOf(req)).fieldErrors));
  }

  const terms = checkTermsAcceptance(req.body.termsVersion);
  if (terms.error) return fail(res, terms.status, terms.code, terms.message, terms.details);

  const optErrors = checkOptionApplicability(v.value.propertyId, v.value.options);
  if (optErrors) return failT(res, req, 422, 'VALIDATION_FAILED', 'optionUnavailable', optErrors);

  const resErrors = checkResourceApplicability(v.value.propertyId, v.value.resources);
  if (resErrors) return failT(res, req, 422, 'VALIDATION_FAILED', 'resourceUnavailable', resErrors);

  const property = db.prepare('SELECT maxGuests, maxBabies, basePriceIncludedGuests FROM properties WHERE id = ?').get(v.value.propertyId);
  if (!property) return failT(res, req, 404, 'PROPERTY_NOT_FOUND', 'propertyNotFound');

  // Same rule as the back-office (utils/capacity.js), but with NO force override on the public path
  // and no « unconfigured = uncapped » tolerance (specs/site-extra-guest-line.md rule 6).
  if (checkGuestCapacity({ ...property, maxGuests: publicGuestCap(property) }, v.value)) {
    return failT(res, req, 409, 'OVER_CAPACITY', 'overCapacity');
  }

  // Server-side availability re-check (the proxy's quote may be stale).
  const blocked = computeBlockedDates(v.value.propertyId, v.value.startDate, v.value.endDate);
  if (rangeHasBlockedNight(v.value.startDate, v.value.endDate, blocked)) {
    return failT(res, req, 409, 'DATES_UNAVAILABLE', 'datesUnavailable');
  }

  // Run the engine to enforce the stay rules and to surface the price for the receipt.
  const engineQuote = buildEngineQuote(v.value);
  if (engineQuote.error) {
    if (engineQuote.status === 404) return failT(res, req, 404, 'PROPERTY_NOT_FOUND', 'propertyNotFound');
    // The engine writes for the back-office, in French. The visitor reads our sentence; the
    // engine's own wording travels in `details`, where a diagnostic belongs.
    return failT(res, req, 422, 'VALIDATION_FAILED', 'quoteRefused', [{ field: 'quote', issue: engineQuote.error }]);
  }
  // Minimum stay, maximum stay, changeover days — every rule the back-office enforces, none of them
  // forceable from the site (specs/tariff-recipes/spec.md §3.4 rule 23).
  // A night no season prices is not for sale (specs/booking-drawer-friction.md rule 10), whatever the
  // engine's fallback rate would make of it (`unpricedNights`, fixed at the 2026-10-27 audit).
  if (hasUnpricedNights(engineQuote)) return failT(res, req, 409, 'DATES_UNAVAILABLE', 'datesUnavailable');
  const breach = stayRuleBreach(engineQuote);
  if (breach) return failT(res, req, 409, breach.code, breach.key, undefined, ...breach.args);

  // Portions over what the stay can serve are REFUSED here, where the live quote only clamps
  // (specs/site-meal-portions.md rule 3): this request becomes the devis the guest pays, so it is
  // never quietly altered.
  const portionError = checkPortionCaps(v.value, engineQuote, langOf(req));
  if (portionError) {
    return fail(res, 422, 'VALIDATION_FAILED', portionError.message, portionError.details);
  }

  const visitor = req.visitor || {};
  const message = String(req.body.message || '').trim();
  const fingerprint = requestFingerprint(v.value, message);

  // Rules 12-16 — the same stay as an open website quote updates that quote instead of creating one.
  const sameStay = findOpenSameStay(g.value.email, v.value);
  if (sameStay) {
    return updateSameStay(req, res, { sameStay, value: v.value, guest: g.value, message, fingerprint, terms, visitor });
  }
  // Rule 7 — a per-address cap on NEW quotes; never shared with any other visitor (rule 8).
  if (newDevisLastDay(g.value.email) >= NEW_DEVIS_PER_EMAIL_PER_DAY) {
    return failT(res, req, 429, 'TOO_MANY_REQUESTS', 'requestsPendingForEmail');
  }

  // The language the guest was actually reading when they asked (specs/site-english-version.md
  // rules 11-13). Two columns need it, not one: a guest email resolves from the CLIENT and the
  // quote PDF from the DEVIS, so setting one alone ships an English email with a French PDF.
  const lang = langOf(req);
  const langWasStated = langStated(req);
  // Where the visitor came from (specs/site-traffic-analytics.md rules 15-17). Never a reason to
  // refuse: an invalid record is already reduced to `null` by its validator.
  const attribution = validateAttribution(req.body.attribution);
  const origin = classifyAttribution(attribution);

  const persist = db.transaction(() => {
    // Resolve-or-create the client by normalized email. An anonymous request never changes a stored
    // client field — name, phone or language (fixed at the 2026-10-27 audit: anyone knowing a guest's
    // address could rewrite their email language). What the visitor typed, when it differs, is kept on
    // the devis notes for the operator to read and apply by hand.
    let client = clientsModel.findByEmail(g.value.email);
    let identityNote = '';
    let createdClientId = null;
    if (!client) {
      client = clientsModel.insert({
        firstName: g.value.firstName, lastName: g.value.lastName,
        email: g.value.email, phone: g.value.phone,
        emailLanguage: lang,
      });
      createdClientId = client.id;
    } else {
      identityNote = submittedIdentityNote(client, g.value, langWasStated ? lang : null);
    }

    const result = devisModel.create({
      propertyId: v.value.propertyId,
      clientId: client.id,
      startDate: v.value.startDate,
      endDate: v.value.endDate,
      checkInTime: v.value.checkInTime,
      checkOutTime: v.value.checkOutTime,
      adults: v.value.adults,
      children: v.value.children,
      teens: v.value.teens,
      babies: v.value.babies,
      // Baby beds are couchage, not a resource line — persisting them on the devis `babyBeds` field
      // makes them visible in the operator's Couchage section (the "Lit bébé" resource is filtered
      // out of the supplements list). specs/site-booking-notifications.md §3 rule 16.
      babyBeds: v.value.babyBeds,
      selectedOptions: v.value.options.map((o) => ({ optionId: o.optionId, quantity: o.quantity })),
      selectedResources: (v.value.resources || []).map((r) => ({ resourceId: r.resourceId, quantity: r.quantity })),
      platform: 'direct',
      // Public/site devis: planning-card options are billed by quantity + left unscheduled for the
      // operator to arrange (specs/public-planning-options.md); a per-person one counts portions,
      // already checked against the stay's cap above (specs/site-meal-portions.md).
      planningCardAsQuantity: true,
      notes: [message, identityNote].filter(Boolean).join('\n\n'),
      // The quote PDF reads this column and no other (utils/devisPdf.js), and it becomes the
      // reservation's language at conversion (devisModel.convertToReservation).
      pdfLanguage: lang,
    });
    // Throwing rolls the client creation back with it; the error is answered below.
    if (result.error) throw Object.assign(new Error(result.error), { devisError: result });

    const devis = result.data;
    // Mark the row as a public-origin request so the admin can filter/badge it, and mint the per-devis
    // capability token that authorises the public /pay + /status routes (specs/public-online-payment.md
    // §7).
    const publicToken = generateToken();
    db.prepare("UPDATE reservations SET requestOrigin = 'public', publicToken = ? WHERE id = ?").run(publicToken, devis.id);
    if (attribution) {
      db.prepare('UPDATE reservations SET attributionChannel = ?, attributionLabel = ?, attribution = ?, attributionAt = ? WHERE id = ?')
        .run(origin.channel, origin.label, JSON.stringify(attribution), new Date().toISOString(), devis.id);
    }

    if (terms.version) {
      termsModel.insertAcceptance({
        reservationId: devis.id,
        termsVersionId: terms.version.id,
        version: terms.version.version,
        acceptedAt: new Date().toISOString(),
        ip: visitor.ip,
        userAgent: visitor.userAgent,
        pluginVersion: visitor.pluginVersion,
      });
    }
    requestStore.recordStay(devis.id, fingerprint, { createdClientId });
    return { devis, publicToken };
  });

  let persisted;
  try {
    persisted = persist();
  } catch (e) {
    if (e.devisError) {
      // Same reasoning as the engine above: the model's French wording is a diagnostic.
      return failT(res, req, e.devisError.status || 400, 'BOOKING_REQUEST_FAILED', 'quoteRefused',
        [{ field: 'devis', issue: String(e.devisError.error || '') }]);
    }
    throw e;
  }
  const { devis, publicToken } = persisted;
  if (visitor.pluginVersion) settings.recordPluginVersion(visitor.pluginVersion);

  // Best-effort admin notification (specs/site-booking-notifications.md §3 rule 6). Fire-and-forget:
  // the service swallows its own errors, so a failed/disabled/unconfigured email never affects the
  // visitor's 201 response.
  Promise.resolve(notificationService.notifyNewSiteDevis(devis.id)).catch(() => {});

  return ok(res, {
    requestId: devis.id,
    // Capability token the proxy must echo back on /pay + /status for this devis (never guessable).
    publicToken,
    status: 'pending',
    reference: devis.devisNumber || null,
    propertyId: v.value.propertyId,
    startDate: v.value.startDate,
    endDate: v.value.endDate,
    finalPrice: Number(devis.finalPrice || 0),
    currency: 'EUR',
    updated: false,
    requestedOn: String(devis.createdAt || '').slice(0, 10) || null,
  }, 201);
}

/**
 * Rules 13-16 — the open quote of the same stay takes the new request: party, times, options and
 * resources, priced by the engine as a creation; the message appended; number, token and earlier CGV
 * acceptances kept, the new acceptance recorded. The same request twice (a double click) changes
 * nothing and answers the same quote. The response is a creation's, with the same ids and
 * `updated: true`.
 */
function updateSameStay(req, res, { sameStay, value, guest, message, fingerprint, terms, visitor }) {
  const respond = (row, updated) => ok(res, {
    requestId: row.id,
    publicToken: row.publicToken,
    status: 'pending',
    reference: row.devisNumber || null,
    propertyId: value.propertyId,
    startDate: value.startDate,
    endDate: value.endDate,
    finalPrice: Number(row.finalPrice || 0),
    currency: 'EUR',
    updated,
    // The date the guest first asked, for « Votre demande du <date> a été mise à jour. »
    requestedOn: String(sameStay.createdAt || '').slice(0, 10) || null,
  }, 201);

  const stay = requestStore.getStay(sameStay.id);
  if (stay && stay.fingerprint === fingerprint) return respond(sameStay, false);

  const client = clientsModel.findByEmail(guest.email);
  const identityNote = client ? submittedIdentityNote(client, guest, langStated(req) ? langOf(req) : null) : '';
  const todayIso = sdk.coreModule('reservationHelpers').getTodayIsoDate();

  const persist = db.transaction(() => {
    const result = devisModel.updateFromPublicRequest(sameStay.id, {
      adults: value.adults,
      children: value.children,
      teens: value.teens,
      babies: value.babies,
      babyBeds: value.babyBeds,
      checkInTime: value.checkInTime,
      checkOutTime: value.checkOutTime,
      selectedOptions: value.options.map((o) => ({ optionId: o.optionId, quantity: o.quantity })),
      selectedResources: (value.resources || []).map((r) => ({ resourceId: r.resourceId, quantity: r.quantity })),
      planningCardAsQuantity: true,
    }, { note: updateNote(message, identityNote, todayIso) });
    if (result.error) throw Object.assign(new Error(result.error), { devisError: result });
    if (terms.version) {
      termsModel.insertAcceptance({
        reservationId: sameStay.id,
        termsVersionId: terms.version.id,
        version: terms.version.version,
        acceptedAt: new Date().toISOString(),
        ip: visitor.ip,
        userAgent: visitor.userAgent,
        pluginVersion: visitor.pluginVersion,
      });
    }
    requestStore.recordStay(sameStay.id, fingerprint);
    return result.data;
  });

  let devis;
  try {
    devis = persist();
  } catch (e) {
    if (e.devisError) {
      return failT(res, req, e.devisError.status || 400, 'BOOKING_REQUEST_FAILED', 'quoteRefused',
        [{ field: 'devis', issue: String(e.devisError.error || '') }]);
    }
    throw e;
  }
  if (visitor.pluginVersion) settings.recordPluginVersion(visitor.pluginVersion);
  Promise.resolve(notificationService.notifyNewSiteDevis(sameStay.id, { updated: true })).catch(() => {});
  return respond({ ...sameStay, finalPrice: devis.finalPrice }, true);
}

/**
 * Rules 13, 15-17. `version` is the current published version when the guest accepted it, null when
 * the emergency switch is off and nothing (valid) was sent.
 */
function checkTermsAcceptance(termsVersion) {
  const { requireTermsAcceptance } = settings.termsSettings();
  const current = termsModel.getCurrent();
  const sent = termsVersion === undefined || termsVersion === null || termsVersion === '' ? null : Number(termsVersion);
  if (requireTermsAcceptance) {
    if (!current) {
      return { error: true, status: 503, code: 'TERMS_NOT_CONFIGURED', message: 'Les réservations en ligne sont momentanément indisponibles.' };
    }
    if (sent === null) {
      return { error: true, status: 422, code: 'TERMS_NOT_ACCEPTED', message: 'Vous devez accepter les conditions générales de location.' };
    }
  }
  if (sent === null || !current) return { version: null };
  if (sent !== current.version) {
    return {
      error: true,
      status: 409,
      code: 'TERMS_OUTDATED',
      message: 'Les conditions générales ont été mises à jour. Merci de les relire et de les accepter à nouveau.',
      details: [{ field: 'termsVersion', issue: 'outdated', currentVersion: current.version }],
    };
  }
  return { version: current };
}

module.exports = { create, checkTermsAcceptance, submittedIdentityNote, requestFingerprint, NEW_DEVIS_PER_EMAIL_PER_DAY };
