/**
 * The website's booking of a session outside a stay (specs/site-outside-resource-booking.md rules 1-13, 16-17, §4.4): which resources are on offer, the free starts of a duration with what
 * each would cost, the recap of a choice, and the confirmation — which holds the slot for 15 minutes and sends the visitor to the bank. Nothing is booked before the bank confirms (`paid`).
 *
 *   resources()                                         → [{ id, name, blurb, fromCents, minMinutes, stepMinutes, maxMinutes, maxPeople, horizonUntil, termsVersionId, addOns: [{ articleRef, label, maxQty, unitLabel, linear, prices }] }]
 *   slots({ resourceId, from, to, minutes })            → { horizonUntil, days: [{ date, slots: [{ start, end, dueCents, evening } | { start, end, taken: true }] }] }, the days with a free start only (rules 5, 6)
 *   quote({ resourceId, start, minutes, addOns? })      → { date, start, end, parts, extras, dueCents, vat }
 *   confirm({ resourceId, start, minutes, addOns?, people, firstName, lastName, email, phone, termsVersionId, visitor, returnUrl? }) → { payUrl, heldUntil, dueCents }
 *   paid({ ref, linkId, amountCents })                  the bank confirmed: book the session, or flag the money « à rembourser » (rule 13)
 *   status(ref)                                         → { state, resourceName, date, start, end, people, recap } for the return page (rule 16)
 *   lapseDue()                                          the job: 15 minutes ended unpaid, the slot is free again
 *
 * Every price is the engine's (the booking offer's quote, then the core's sale quote): the visitor's browser computes nothing. The one place that books is `bookOutside`.
 */

const sdk = require('../sdk');
const { sessionModesOf, quoteSession, isBanded } = require('./sessionQuote');
const { toMinutes } = require('./hourlyPricing');
const { horizonUntil } = require('./horizon');
const { HOLD_MINUTES } = require('./holdsModel');
const { refundNotice } = require('./sessionNotices');
const { renderSessionMail } = require('./sessionMail');

const MAX_SPAN_DAYS = 62;
const DEFAULT_MAX_PEOPLE = 20;
const MAX_ADDON_QTY = 10;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE = /^[0-9+().\s-]{6,30}$/;
const START = /^(\d{4}-\d{2}-\d{2})T((?:[01]\d|2[0-3]):[0-5]\d)$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const BAND_WORDS = Object.freeze({ day: 'journée', evening: 'soirée' });
const CLOCK_RANGE = /(\d{2}:\d{2})–(\d{2}:\d{2})/;
const UNAVAILABLE = 'Cette activité ne se réserve pas en ligne pour le moment.';

const refuse = (code, message, status = 400, extra = {}) => ({
  ok: false, status, code, message, ...extra,
});

const longDate = (iso) => new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
}).format(new Date(`${iso}T12:00:00Z`));

const longDay = (iso) => new Intl.DateTimeFormat('fr-FR', {
  weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC',
}).format(new Date(`${iso}T12:00:00Z`));

const asInt = (v) => (typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v) : v);

function createPublicSessionService({
  db, offer, orders, terms, payments, engine, suggest, notify, sendMail, address, companyName, basketSource, now = () => new Date(), transaction = (fn) => db.transaction(fn)(),
}) {
  const resourceOf = (id) => db.prepare('SELECT * FROM resources WHERE id = ?').get(Number(id)) || null;
  const isOffered = (resource) => Boolean(resource) && Number(resource.sellableExternally) === 1 && isBanded(resource) && sessionModesOf(resource).some((mode) => mode.sellable);
  const maxPeopleOf = (resource) => (Number(resource.sessionMaxPeople) > 0 ? Number(resource.sessionMaxPeople) : DEFAULT_MAX_PEOPLE);
  const configOf = (resource) => ({ id: resource.id, label: resource.name, resource });
  const bandAt = (resource, clock) => (sessionModesOf(resource).some((m) => m.band === 'evening') && toMinutes(clock) >= toMinutes(resource.hourlyEveningStart) ? 'evening' : 'day');

  // ── what the page reads first ────────────────────────────────────────────────────────────────────────────────────────

  /** What the visitor may add to the session, each with the price the engine gives for 1 … n units (the page multiplies nothing); one the engine cannot price at all is left out. */
  function addOnsOffered(resource) {
    return suggest(resource.id).map((entry) => {
      const prices = [];
      for (let qty = 1; qty <= Math.min(entry.max || MAX_ADDON_QTY, MAX_ADDON_QTY); qty += 1) {
        const answer = engine.quote({ lines: [{ articleRef: entry.articleRef, quantity: qty }] });
        if (answer.status !== 200 || answer.refusals.length || answer.document.lines.length !== 1) break;
        prices.push({ qty, cents: answer.document.lines[0].totalCents });
      }
      return {
        articleRef: entry.articleRef,
        label: entry.label,
        maxQty: prices.length,
        unitLabel: 'l’unité',
        linear: prices.every((price) => price.cents === price.qty * prices[0].cents),
        prices,
      };
    }).filter((entry) => entry.prices.length > 0);
  }

  function resources() {
    const rows = db.prepare("SELECT * FROM resources WHERE priceType = 'per_hour' AND showsPlanningCard = 1 AND sellableExternally = 1 ORDER BY name, id").all().filter(isOffered);
    const version = terms.current('resource');
    return rows.map((resource) => {
      const modes = sessionModesOf(resource).filter((mode) => mode.sellable);
      return {
        id: resource.id,
        name: resource.name,
        blurb: resource.note || '',
        fromCents: Math.min(...modes.map((mode) => mode.rateCents)),
        minMinutes: modes[0].minimumMinutes,
        stepMinutes: modes[0].slotMinutes,
        maxMinutes: toMinutes(resource.closeTime || '23:59') - toMinutes(resource.openTime || '00:00'),
        maxPeople: maxPeopleOf(resource),
        horizonUntil: horizonUntil(resource, now()),
        termsVersionId: version ? version.id : null,
        addOns: addOnsOffered(resource),
      };
    });
  }

  /** The resource a request names, or the refusal; and the duration judged by the session rules (step, minimum, close). */
  function sessionOf(resourceId, minutes) {
    const resource = resourceOf(resourceId);
    if (!isOffered(resource)) return refuse('RESOURCE_UNAVAILABLE', UNAVAILABLE, 409);
    const length = asInt(minutes);
    if (!Number.isInteger(length) || length <= 0) return refuse('SESSION_MINUTES_INVALID', 'Durée invalide.');
    const checked = quoteSession(configOf(resource), { band: bandAt(resource, resource.openTime || '00:00'), start: resource.openTime || '00:00', minutes: length });
    if (checked.refusal && checked.refusal.code !== 'SESSION_AFTER_CLOSE') return refuse(checked.refusal.code, checked.refusal.message);
    return { ok: true, resource, minutes: length };
  }

  const crossesEvening = (line) => line.components.some((part) => part.key.startsWith('band:evening'));

  function slots({
    resourceId, from, to, minutes,
  }) {
    const found = sessionOf(resourceId, minutes);
    if (!found.ok) return found;
    if (!ISO_DATE.test(String(from)) || !ISO_DATE.test(String(to)) || to < from) return refuse('PERIOD_INVALID', 'Période invalide.');
    if (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`) > (MAX_SPAN_DAYS - 1) * 86400000) return refuse('PERIOD_TOO_LONG', `Période trop longue : ${MAX_SPAN_DAYS} jours au plus.`);
    const { resource } = found;
    const free = offer.freeSlots({
      resourceId: resource.id, from, to, minutes: found.minutes, includeTaken: true, now: now(),
    });
    if (!free.ok) return refuse(free.code, free.message, 409);
    if (from > free.horizonUntil) return refuse('BEYOND_HORIZON', `Réservable jusqu’au ${longDate(free.horizonUntil)}.`, 409, { horizonUntil: free.horizonUntil });
    // Quotes are kept per day and start, and only the ones that succeeded: a start whose quote failed is left out of that day alone.
    const priced = new Map();
    const priceOf = (start, date) => {
      const key = `${date}T${start}`;
      if (!priced.has(key)) {
        const answer = offer.quote({
          resourceId: resource.id, date, start, coveredBand: bandAt(resource, start), coveredMinutes: found.minutes, extraMinutes: 0,
        });
        if (!answer.ok) return null;
        priced.set(key, { dueCents: answer.session.totalCents, evening: crossesEvening(answer.session.line) });
      }
      return priced.get(key);
    };
    const days = free.days.filter((day) => day.slots.some((slot) => !slot.taken)).map((day) => ({
      date: day.date,
      slots: day.slots.flatMap((slot) => {
        if (slot.taken) return [slot];
        const price = priceOf(slot.start, day.date);
        return price ? [{ ...slot, ...price }] : [];
      }),
    })).filter((day) => day.slots.some((slot) => !slot.taken));
    return { ok: true, data: { horizonUntil: free.horizonUntil, days } };
  }

  // ── the recap ─────────────────────────────────────────────────────────────────────────────────────────────────────────

  function addOnsOf(resource, asked) {
    if (asked === undefined || asked === null) return { value: [] };
    if (!Array.isArray(asked)) return { problem: refuse('ADDONS_INVALID', 'Options choisies : une liste est attendue.') };
    const offered = new Map(suggest(resource.id).map((entry) => [entry.articleRef, entry]));
    const value = [];
    for (const entry of asked) {
      const articleRef = entry && entry.articleRef;
      const qty = Number(asInt(entry && entry.qty === undefined ? 1 : entry && entry.qty));
      const known = offered.get(articleRef);
      if (!known) return { problem: refuse('ADDON_NOT_OFFERED', 'Une option choisie n’est pas proposée.') };
      if (!Number.isInteger(qty) || qty < 1 || qty > Math.min(known.max || MAX_ADDON_QTY, MAX_ADDON_QTY)) return { problem: refuse('ADDON_QTY_INVALID', `Option choisie : la quantité de « ${known.label} » est invalide.`) };
      if (value.some((v) => v.articleRef === articleRef)) return { problem: refuse('ADDON_DUPLICATE', `Option choisie : « ${known.label} » figure deux fois.`) };
      value.push({ articleRef, label: known.label, qty });
    }
    return { value };
  }

  const partOf = (component) => {
    const [, band] = component.key.split(':');
    const range = CLOCK_RANGE.exec(component.label);
    return {
      label: `${range ? `${range[1]} – ${range[2]}` : component.label} · ${BAND_WORDS[band] || band}`, band, cents: component.amountCents,
    };
  };

  /**
   * The composition of a choice, priced by the engine. `checkSlot: false` is the confirmation of a payment, where the slot is judged by the booking itself.
   * → `{ ok: true, resource, date, time, endTime, fulfilments, lines, dueCents, view }` | a refusal.
   */
  function compose(request, { checkSlot = true } = {}) {
    const parts = START.exec(String(request.start || ''));
    if (!parts) return refuse('SLOT_INVALID', 'Créneau invalide.');
    const [, date, time] = parts;
    const found = sessionOf(request.resourceId, request.minutes);
    if (!found.ok) return found;
    const { resource, minutes } = found;
    const added = addOnsOf(resource, request.addOns);
    if (added.problem) return added.problem;
    const priced = offer.quote({
      resourceId: resource.id, date, start: time, coveredBand: bandAt(resource, time), coveredMinutes: minutes, extraMinutes: 0,
    });
    if (!priced.ok) return refuse(priced.code, priced.message, 409);
    if (checkSlot) {
      const free = offer.freeSlots({
        resourceId: resource.id, from: date, to: date, minutes, now: now(),
      });
      if (date > free.horizonUntil) return refuse('BEYOND_HORIZON', `Réservable jusqu’au ${longDate(free.horizonUntil)}.`, 409, { horizonUntil: free.horizonUntil });
      if (!free.days.some((day) => day.date === date && day.slots.some((slot) => slot.start === time))) return refuse('SLOT_TAKEN', 'Ce créneau n’est plus libre.', 409);
    }
    const fulfilments = [{ role: 'session', ...priced.session.line }];
    const lines = added.value.map((o) => ({ articleRef: o.articleRef, quantity: o.qty }));
    const answer = engine.quote({ lines, fulfilments: fulfilments.map(({ role, ...line }) => ({ ...line, fulfilmentRef: `site:${role}` })) });
    if (answer.status !== 200) return refuse('PRICE_UNAVAILABLE', answer.body && answer.body.error ? answer.body.error : 'Prix indisponible.', 409);
    if (answer.refusals.length) return refuse('PRICE_UNAVAILABLE', answer.refusals[0].message, 409);
    const free = answer.document.lines.slice();
    const take = (predicate) => { const index = free.findIndex(predicate); return index < 0 ? null : free.splice(index, 1)[0]; };
    const sessionRow = take((r) => r.fulfilmentRef === 'site:session');
    const boughtRows = lines.map((o) => take((r) => r.articleKey === o.articleRef && !r.fulfilmentRef));
    if (!sessionRow || boughtRows.includes(null)) return refuse('PRICE_UNAVAILABLE', 'Prix indisponible.', 409);
    const dueCents = answer.document.totals.totalCents;
    return {
      ok: true,
      resource,
      minutes,
      date,
      time,
      endTime: priced.endTime,
      fulfilments,
      lines,
      addOns: added.value,
      dueCents,
      totalCents: dueCents,
      view: {
        date,
        start: time,
        end: priced.endTime,
        parts: priced.session.line.components.map(partOf),
        extras: boughtRows.map((row) => ({
          label: row.label, detail: row.detail || null, qty: row.quantity, cents: row.totalCents,
        })),
        dueCents,
        vat: answer.document.vatByRate.map((row) => ({ rate: row.rate, cents: row.vatCents })),
      },
    };
  }

  function quote(request) {
    const composed = compose(request);
    return composed.ok ? { ok: true, data: composed.view } : composed;
  }

  // ── holding and linking ──────────────────────────────────────────────────────────────────────────────────────────────

  const holdRefOf = (order) => `site-session:${order.ref}`;

  /** The 15 minutes ended (or the link could not be made): the slot is free again; an order already booked is never touched. */
  function lapse(order, reason) {
    transaction(() => {
      if (!orders.setState(order.ref, 'lapsed', reason)) return;
      offer.release(holdRefOf(order));
    });
    if (order.linkId && payments.withdrawLink) payments.withdrawLink(order.linkId).catch(() => {});
  }

  function judged(request) {
    const firstName = typeof request.firstName === 'string' ? request.firstName.trim().slice(0, 80) : '';
    const lastName = typeof request.lastName === 'string' ? request.lastName.trim().slice(0, 80) : '';
    const email = typeof request.email === 'string' ? request.email.trim() : '';
    const phone = typeof request.phone === 'string' ? request.phone.trim() : '';
    const people = asInt(request.people);
    if (!firstName) return refuse('NAME_REQUIRED', 'Le prénom est demandé.', 400, { field: 'firstName' });
    if (!lastName) return refuse('NAME_REQUIRED', 'Le nom est demandé.', 400, { field: 'lastName' });
    if (!EMAIL.test(email) || email.length > 254) return refuse('EMAIL_INVALID', 'Adresse e-mail invalide : vérifiez le @ et le domaine.', 400, { field: 'email' });
    if (!PHONE.test(phone)) return refuse('PHONE_INVALID', 'Numéro de téléphone invalide.', 400, { field: 'phone' });
    if (terms.current('resource') === null) return refuse('TERMS_UNPUBLISHED', 'Les conditions ne sont pas encore publiées : la réservation n’est pas ouverte.', 409, { field: 'terms' });
    const owed = terms.requireAccepted({ activity: 'resource', versionId: request.termsVersionId, subjectType: 'outsideBooking' });
    if (owed) return refuse(owed, owed === 'TERMS_OUTDATED' ? 'Les conditions ont changé : relire et accepter la dernière version.' : 'Les conditions doivent être acceptées.', 400, { field: 'terms' });
    return {
      ok: true, firstName, lastName, email, phone, people,
    };
  }

  async function confirm(request) {
    const resource = resourceOf(request.resourceId);
    if (!isOffered(resource)) return refuse('RESOURCE_UNAVAILABLE', UNAVAILABLE, 409);
    const who = judged(request);
    if (!who.ok) return who;
    if (!Number.isInteger(who.people) || who.people < 1 || who.people > maxPeopleOf(resource)) {
      return refuse('PEOPLE_INVALID', `Nombre de personnes : de 1 à ${maxPeopleOf(resource)}.`, 400, { field: 'people' });
    }
    const composed = compose(request);
    if (!composed.ok) return composed;
    if (composed.dueCents <= 0) return refuse('PRICE_UNAVAILABLE', 'Prix indisponible.', 409);
    const visitor = request.visitor || {};
    const heldUntil = new Date(now().getTime() + HOLD_MINUTES * 60 * 1000);
    let created;
    try {
      created = transaction(() => {
        const order = orders.insert({
          resourceId: resource.id,
          date: composed.date,
          startTime: composed.time,
          endTime: composed.endTime,
          minutes: composed.minutes,
          people: who.people,
          addOns: composed.addOns,
          recap: composed.view,
          firstName: who.firstName,
          lastName: who.lastName,
          email: who.email,
          phone: who.phone,
          termsVersionId: terms.current('resource').id,
          userAgent: visitor.userAgent || null,
          ip: visitor.ip || null,
          dueCents: composed.dueCents,
          heldUntil,
        });
        const slot = offer.hold({
          resourceId: resource.id, date: order.date, start: order.startTime, end: order.endTime, ref: holdRefOf(order), minutes: HOLD_MINUTES, now: now(),
        });
        if (!slot.ok) throw Object.assign(new Error(slot.code), { refusal: refuse(slot.code, slot.message, 409) });
        return order;
      });
    } catch (error) {
      if (error && error.refusal) return error.refusal;
      throw error;
    }
    let link;
    try {
      link = await payments.saleLink({
        source: basketSource, ref: created.ref, title: `${resource.name} · ${longDay(composed.view.date)}`, amountCents: composed.dueCents, validityMinutes: HOLD_MINUTES,
      }, { redirectUrl: request.returnUrl ? `${request.returnUrl}${request.returnUrl.includes('?') ? '&' : '?'}gf_session=${created.ref}` : null });
    } catch (error) {
      lapse(created, 'link-failed');
      if (error && error.error === 'NO_PAYMENT_PROVIDER') return refuse('ONLINE_SALE_UNAVAILABLE', 'Le paiement en ligne n’est pas disponible pour le moment.', 409);
      return refuse('PAYMENT_PROVIDER_ERROR', 'Le paiement n’a pas pu être préparé, réessayer.', 502);
    }
    orders.setLink(created.ref, link.linkId);
    return { ok: true, data: { payUrl: link.url, heldUntil: heldUntil.toISOString(), dueCents: composed.dueCents } };
  }

  // ── the bank's word ───────────────────────────────────────────────────────────────────────────────────────────────────

  const nameOf = (order) => `${order.firstName} ${order.lastName}`;

  /** The money the plugin keeps nothing for: the core flags it « à rembourser » on its link, and the operator is told. */
  function unhonoured(order, reason) {
    orders.setState(order.ref, 'refund_owed', reason);
    offer.release(holdRefOf(order));
    const resource = resourceOf(order.resourceId);
    notify(refundNotice({
      resourceName: resource ? resource.name : 'Séance', date: order.date, start: order.startTime, end: order.endTime, name: nameOf(order), amountCents: order.dueCents, reason,
    }));
    return sdk.coreModule('basketRefundOutcome').notHonoured(reason);
  }

  function sendConfirmation(order, view) {
    const resource = resourceOf(order.resourceId);
    const mail = renderSessionMail({
      companyName: companyName(),
      address: address(),
      resourceName: resource ? resource.name : 'Séance',
      date: order.date,
      start: order.startTime,
      end: order.endTime,
      people: order.people,
      parts: view.parts,
      extras: view.extras,
      dueCents: order.dueCents,
    });
    Promise.resolve().then(() => sendMail({
      to: order.email, subject: mail.subject, text: mail.text, html: mail.html, key: `session-booking:${order.ref}`,
    })).catch(() => {});
  }

  /** The payment arrived — on time or late. Books the session in one transaction, or says the money is owed back (rule 13). */
  function paid({ ref, linkId, amountCents }) {
    const order = orders.find(ref);
    if (!order) return sdk.coreModule('basketRefundOutcome').notHonoured('séance introuvable');
    if (order.state === 'booked') return { effect: 'session-already-booked' };
    if (Number(amountCents) !== order.dueCents) return unhonoured(order, 'montant payé différent du prix de la séance');
    const composed = compose({
      resourceId: order.resourceId, start: `${order.date}T${order.startTime}`, minutes: order.minutes, addOns: JSON.parse(order.addOns || '[]'),
    }, { checkSlot: false });
    if (!composed.ok) return unhonoured(order, composed.message);
    if (composed.dueCents !== order.dueCents) return unhonoured(order, 'prix modifié depuis la commande');
    const stillHeld = order.state === 'held';
    let done;
    try {
      done = transaction(() => {
        const booked = offer.bookOutside({
          resourceId: order.resourceId,
          date: order.date,
          start: order.startTime,
          end: order.endTime,
          customer: {
            name: nameOf(order), email: order.email, phone: order.phone,
          },
          people: order.people,
          fulfilments: composed.fulfilments,
          lines: composed.lines,
          tenders: [{ method: 'card', amountCents: order.dueCents, source: `payment-link:${linkId}` }],
          holdRef: stillHeld ? holdRefOf(order) : null,
          channel: 'site',
          terms: order.termsVersionId ? { versionId: order.termsVersionId, ip: order.ip, userAgent: order.userAgent } : null,
          acceptedTotalCents: composed.totalCents,
          actor: 'public',
          now: now(),
        });
        if (!booked.ok) throw Object.assign(new Error(booked.code), { refusal: booked });
        orders.setBooked(order.ref, { bookingId: booked.bookingId, saleId: booked.saleId });
        return booked;
      });
    } catch (error) {
      if (!error || !error.refusal) {
        const failure = unhonoured(order, 'réservation impossible');
        console.error('[hourly-resources] a paid session could not be booked:', error && error.message);
        return failure;
      }
      return unhonoured(order, error.refusal.code === 'SLOT_TAKEN' ? 'créneau pris entre-temps' : error.refusal.message);
    }
    // The operator is told once the booking is committed, never from inside the transaction.
    if (done.announce) done.announce();
    sendConfirmation(order, composed.view);
    return { effect: 'session-booked' };
  }

  async function status(ref) {
    let order = typeof ref === 'string' && /^[0-9a-f]{32}$/.test(ref) ? orders.find(ref) : null;
    if (!order) return refuse('ORDER_NOT_FOUND', 'Réservation introuvable.', 404);
    // The visitor waits on the return page: the open link is read now rather than at the next poll, and a paid one books the session on the spot.
    if (order.state === 'held' && order.linkId && payments.refreshLink) {
      await payments.refreshLink(order.linkId).catch(() => {});
      order = orders.find(ref);
    }
    const resource = resourceOf(order.resourceId);
    return {
      ok: true,
      data: {
        state: { held: 'held', booked: 'booked', lapsed: 'lapsed', refund_owed: 'refundOwed' }[order.state],
        resourceName: resource ? resource.name : '',
        date: order.date,
        start: order.startTime,
        end: order.endTime,
        people: order.people,
        recap: JSON.parse(order.recap || '{}'),
      },
    };
  }

  /** The job: every order whose 15 minutes ended unpaid gives its slot back. → how many. */
  function lapseDue() {
    const due = orders.dueLapsed(now());
    due.forEach((order) => lapse(order, 'lapsed'));
    return due.length;
  }

  return {
    resources, slots, quote, confirm, paid, status, lapseDue,
  };
}

module.exports = { createPublicSessionService };
