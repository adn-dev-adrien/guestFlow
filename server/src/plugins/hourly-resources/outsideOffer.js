/**
 * What another plugin may ask of the outside bookings of an hourly resource (rules 25, 29, 44-45, 53 of the campaigns spec), declared with
 * `ctx.resourceBookingOffer` and handed out as `ctx.core.resourceBookingOffer()`. It names no instrument of payment: a session is paid, in whole or in
 * part, by a prepaid tender some plugin holds, and what remains by a link.
 *
 *   freeSlots({ resourceId, from, to, minutes, band?, includeTaken?, now? })  → { horizonUntil, days: [{ date, slots: [{ start, end, taken? }] }] }
 *       the starts of a session of `minutes` the resource can take, inside its opening days and hours, on its grid, with its capacity, turnover, thermal readiness,
 *       existing bookings and active holds, never past the resource's booking horizon; `band` keeps the starts before (`day`) or from (`evening`) the evening switch;
 *       `includeTaken` also lists, marked `taken: true`, the starts that fit the opening hours but are taken by a booking or a hold (specs/site/site-outside-resource-booking.md rule 6)
 *   quote({ resourceId, date, start, coveredBand, coveredMinutes, extraMinutes, excludeHoldRef?, memo?, now? }) → { ok: true, endTime, session, extra } | { ok: false, code, message }
 *       the engine's price of a session placed at `start`: `coveredMinutes` first (already paid for in `coveredBand`, at the rank they take), then `extraMinutes` after
 *       them, their ranks continuing; `session.supplementCents` is what the covered slices cost above their band's price (a covered day session run into the evening, rule 45); `excludeHoldRef` is the buyer's own hold, which does not count against the doubled block (rule 17); `memo` is a Map a caller pricing a long list of starts hands in so the same figure is asked of the engine once
 *   hold({ resourceId, date, start, end, ref, minutes?, now? }) → { ok: true, expiresAt } | { ok: false, code: 'SLOT_TAKEN', message }
 *   release(ref)
 *   limits({ resourceId }) → { ok: true, stepMinutes, minMinutes, maxMinutes, maxPeople } | { ok: false, code, message }   what a session of the resource may ask: the step and the shortest of its grid, the longest the opening hours hold, the party (20 when none is set)
 *   bookOutside({ resourceId, date, start, end, customer, people?, fulfilments, lines, tenders, holdRef?, channel, terms?, actor?, acceptedTotalCents?, now? })
 *       → { ok: true, bookingId, saleId } | { ok: false, code, message }   everything in one transaction, or nothing; `people` is the party declared, for information
 *       (specs/site/site-outside-resource-booking.md rule 26); a booking of the channel `site` or `mon-bain` tells the operator once it is written (rule 23) — called
 *       inside the caller's own transaction it tells nobody, and returns `announce()` for the caller to run after its outermost transaction has committed
 *
 * Priced lines are the engine's: `fulfilments` are the lines `quote` answered (`role: 'session' | 'extra'`), `lines` are `{ articleRef, quantity }` options. `tenders` are
 * `{ method: 'prepaid', source, ref, label, covers: [{ role | articleRef, amountCents }] }` — which line each prepaid cent pays — and `{ method: 'card', amountCents, source }`,
 * what a card payment of the remainder brought (a payment link).
 */

const sdk = require('../sdk');
const { eachDate } = require('./schedulingModel');
const {
  buildDays, validateBlock, toAbsMinutes, MINUTES_PER_DAY,
} = require('./availability');
const { toMinutes, periodOf } = require('./hourlyPricing');
const { sessionModesOf, isBanded } = require('./sessionQuote');
const { rateGridOf } = require('./bookingPricing');
const { horizonUntil } = require('./horizon');
const { HOLD_MINUTES } = require('./holdsModel');
const { bookedNotice } = require('./sessionNotices');

const { toParisIso } = sdk.coreModule('stayWindow');

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
const CHANNELS = Object.freeze({ 'mon-bain': 'Mon bain', site: 'site', 'guest-app': 'appli du séjour' });
const ANNOUNCED_CHANNELS = Object.freeze(['site', 'mon-bain']);
const DEFAULT_MAX_PEOPLE = 20;
const SLOT_TAKEN = 'Ce créneau n’est plus libre.';
const LINE_FIELDS = Object.freeze(['label', 'detail', 'quantity', 'unitCents', 'totalCents', 'catalogueCents', 'offered', 'vatClass', 'components', 'fulfilmentRef']);

const refuse = (code, message) => ({ ok: false, code, message });
const timeOf = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
const sessionRefOf = (bookingId) => `hourly-slot:${Number(bookingId)}`;
const extraRefOf = (bookingId) => `${sessionRefOf(bookingId)}:extra`;
const offeredRefOf = (bookingId) => `${sessionRefOf(bookingId)}:offered`;
const FULFILMENT_REFS = Object.freeze({ session: sessionRefOf, extra: extraRefOf, offered: offeredRefOf });
const REASONS = Object.freeze({
  taken: SLOT_TAKEN, closed: 'Ce créneau est hors des horaires de la ressource.', past: 'Ce créneau est passé.', heating: 'Ce créneau est trop proche pour chauffer la ressource.',
  duration: 'Durée ou heure de début invalide pour cette ressource.', staff: SLOT_TAKEN,
});

function createOutsideOffer({
  db, bookings, occupancy, holds, standaloneSale = () => sdk.coreModule('standaloneSale'), terms = null, notify = () => {}, now = () => new Date(),
}) {
  const resourceOf = (resourceId) => db.prepare('SELECT * FROM resources WHERE id = ?').get(Number(resourceId)) || null;
  const offerable = (resourceId) => {
    const resource = resourceOf(resourceId);
    return resource && isBanded(resource) ? resource : null;
  };
  const clockOf = (at) => (at instanceof Date ? at : now());
  const absNow = (at) => {
    const paris = toParisIso(at) || '';
    return toAbsMinutes(paris.slice(0, 10), paris.slice(11, 16));
  };
  const todayOf = (at) => (toParisIso(at) || '').slice(0, 10);

  // The bounds every read and the commit judge a block by: not before now, never past the resource's horizon.
  const boundsOf = (resource, at) => ({ notBefore: absNow(at), notAfter: toAbsMinutes(horizonUntil(resource, at), '00:00') + MINUTES_PER_DAY });

  const eveningStartOf = (resource) => (resource.hourlyEveningStart ? toMinutes(resource.hourlyEveningStart) : null);

  function freeSlots({
    resourceId, from, to, minutes, band = null, includeTaken = false, now: at,
  }) {
    const resource = offerable(resourceId);
    if (!resource) return refuse('RESOURCE_UNAVAILABLE', 'Cette ressource ne se réserve pas à l’heure.');
    const clock = clockOf(at);
    const horizon = horizonUntil(resource, clock);
    const lo = from > todayOf(clock) ? from : todayOf(clock);
    const hi = to < horizon ? to : horizon;
    const result = { ok: true, horizonUntil: horizon, days: [] };
    if (!ISO_DATE.test(String(from)) || !ISO_DATE.test(String(to)) || !Number.isInteger(minutes) || minutes <= 0 || lo > hi) return result;
    const dates = eachDate(lo, hi);
    const taken = occupancy.listForStay({ resourceId: resource.id, startDate: lo, endDate: dates[dates.length - 1] });
    const bounds = boundsOf(resource, clock);
    const evening = eveningStartOf(resource);
    const days = buildDays({
      resource, dayRate: resource.price, stayDates: dates, occupancy: taken, ...bounds,
    });
    days.forEach((day) => {
      const slots = day.slots
        .filter((slot) => !slot.afterReset)
        .filter((slot) => {
          if (!band || evening === null) return true;
          return band === 'evening' ? toMinutes(slot.start) >= evening : toMinutes(slot.start) < evening;
        })
        .map((slot) => ({ start: slot.start, end: timeOf(toMinutes(slot.start) + minutes) }))
        .flatMap((slot) => {
          const verdict = validateBlock({
            resource, block: { date: day.date, start: slot.start, end: slot.end }, occupancy: taken, ...bounds,
          });
          if (verdict.ok) return [slot];
          return includeTaken && (verdict.reason === 'taken' || verdict.reason === 'staff') ? [{ ...slot, taken: true }] : [];
        });
      if (slots.length) result.days.push({ date: day.date, slots });
    });
    return result;
  }

  function limits({ resourceId }) {
    const resource = offerable(resourceId);
    const modes = resource ? sessionModesOf(resource, { period: 'any' }).filter((mode) => mode.sellable) : [];
    if (!modes.length) return refuse('RESOURCE_UNAVAILABLE', 'Cette ressource ne se réserve pas à l’heure.');
    return {
      ok: true,
      stepMinutes: modes[0].slotMinutes,
      minMinutes: modes[0].minimumMinutes,
      maxMinutes: toMinutes(resource.closeTime || '23:59') - toMinutes(resource.openTime || '00:00'),
      maxPeople: Number(resource.sessionMaxPeople) > 0 ? Number(resource.sessionMaxPeople) : DEFAULT_MAX_PEOPLE,
    };
  }

  // The engine's price of one session of the resource, for the outside customer (week-weekend-and-print spec rule 30): the standalone sale's
  // quote asks the hourly family, with the date (or the period of a dateless session). The answer is the fulfilled line the sale takes.
  function priceSession(resource, session, memo = null) {
    const key = memo ? memoKeyOf(resource, session) : null;
    if (key !== null && memo.has(key)) return memo.get(key);
    const answer = standaloneSale().quote({ lines: [{ articleRef: `resource:${resource.id}`, session }] });
    let priced;
    if (answer.status !== 200) priced = refuse('PRICE_UNAVAILABLE', answer.body && answer.body.error ? answer.body.error : 'Prix indisponible.');
    else if (answer.refusals.length) priced = refuse(answer.refusals[0].code, answer.refusals[0].message);
    else if (!answer.document.lines[0]) priced = refuse('PRICE_UNAVAILABLE', 'Prix indisponible.');
    else {
      const line = answer.document.lines[0];
      priced = {
        ok: true,
        line: { articleRef: line.articleKey, family: 'hourly', ...Object.fromEntries(LINE_FIELDS.filter((field) => line[field] !== undefined).map((field) => [field, line[field]])) },
      };
    }
    if (key !== null) memo.set(key, priced);
    return priced;
  }

  // Everything a session's price depends on: the resource, the band, the minutes and their ranks, and — for a dated session — the period of each of its slices, never the date itself
  // (a list of 62 days asks the same few figures again and again).
  function memoKeyOf(resource, session) {
    let periods = session.period || null;
    if (session.date && session.start !== undefined) {
      const step = Math.max(1, Number(resource.slotDuration) || 30);
      const from = toMinutes(session.start) + (Number(session.rankOffsetMinutes) || 0);
      const evening = resource.hourlyEveningStart || null;
      periods = '';
      for (let t = from; t < from + Number(session.minutes); t += step) periods += periodOf(session.date, t, evening) === 'weekend' ? 'e' : 'w';
    }
    return JSON.stringify([resource.id, session.band, session.start || null, session.minutes, session.rankOffsetMinutes || 0, periods]);
  }

  // Which parts of its price a placed session owes above its reference (rule 15): the evening band, the weekend period, or both.
  function placedOf(resource, date, line) {
    const evening = eveningStartOf(resource);
    const parts = (line.components || []).map((part) => String(part.key || '').split(':')).filter((bits) => bits[0] === 'band');
    const band = parts.some((bits) => bits[1] === 'evening') ? 'evening' : 'day';
    const period = parts.some((bits) => periodOf(date, `${bits[2]}:${bits[3]}`, evening === null ? null : timeOf(evening)) === 'weekend') ? 'weekend' : 'week';
    return { band, period };
  }

  // What the supplement is named by (rule 15): the evening when the slot's band costs more than the voucher's at that period, the weekend when its period costs more than the
  // voucher's in that band, both for « soirée week-end », neither (an odd grid) for the plain « créneau ».
  const SUPPLEMENT_CAUSES = Object.freeze({
    evening: 'evening', weekend: 'weekend', eveningWeekend: 'eveningWeekend', slot: 'slot',
  });
  const firstHourOf = (resource, band, period) => {
    const grid = rateGridOf(resource, { external: true, period });
    return band === 'evening' ? grid.eveningRate : grid.dayRate;
  };
  function causeOf(resource, { coveredBand, period, slot }) {
    const bandUp = slot.band !== coveredBand && firstHourOf(resource, slot.band, slot.period) > firstHourOf(resource, coveredBand, slot.period);
    const periodUp = slot.period !== period && firstHourOf(resource, slot.band, slot.period) > firstHourOf(resource, slot.band, period);
    if (bandUp && periodUp) return SUPPLEMENT_CAUSES.eveningWeekend;
    if (bandUp) return SUPPLEMENT_CAUSES.evening;
    return periodUp ? SUPPLEMENT_CAUSES.weekend : SUPPLEMENT_CAUSES.slot;
  }

  function quote({
    resourceId, date, start, coveredBand, coveredMinutes, coveredPeriod = 'week', extraMinutes = 0, excludeHoldRef = null, memo = null, now: at,
  }) {
    const resource = offerable(resourceId);
    if (!resource) return refuse('RESOURCE_UNAVAILABLE', 'Cette ressource ne se réserve pas à l’heure.');
    if (!ISO_DATE.test(String(date)) || !CLOCK.test(String(start))) return refuse('SLOT_INVALID', 'Créneau invalide.');
    const covered = Number(coveredMinutes);
    const extra = Number(extraMinutes) || 0;
    const period = coveredPeriod === 'weekend' ? 'weekend' : 'week';
    const placed = priceSession(resource, { band: coveredBand, start, minutes: covered, date }, memo);
    if (placed.code) return placed;
    const reference = priceSession(resource, { band: coveredBand, minutes: covered, period }, memo);
    if (reference.code) return reference;
    const referenceCents = reference.line.totalCents;
    const coveredCents = Math.min(referenceCents, placed.line.totalCents);
    const supplementCents = placed.line.totalCents - coveredCents;
    const slot = placedOf(resource, date, placed.line);
    const result = {
      ok: true,
      endTime: timeOf(toMinutes(start) + covered + extra),
      session: {
        line: placed.line,
        totalCents: placed.line.totalCents,
        coveredCents,
        supplementCents,
        leftoverCents: Math.max(0, referenceCents - placed.line.totalCents),
        supplementCause: supplementCents > 0 ? causeOf(resource, { coveredBand, period, slot }) : null,
        // The supplement is « soirée » only for an evening slot against a day voucher.
        eveningOverDay: slot.band === 'evening' && coveredBand === 'day',
        slot,
      },
      twoHours: null,
      extra: null,
    };
    // Rule 17 — a covered evening-weekend session starting on a day-week slot (its band and period are those of its start): the session is doubled when the doubled block is free and
    // ends by closing time. The offered hour is decided first; extra time is offered only within what fits after the doubled block, never by giving the hour up.
    const clock = clockOf(at);
    const eveningStart = eveningStartOf(resource);
    const startBand = eveningStart !== null && toMinutes(start) >= eveningStart ? 'evening' : 'day';
    const startPeriod = periodOf(date, start, eveningStart === null ? null : timeOf(eveningStart));
    const blockFree = (endsAt) => {
      if (endsAt > toMinutes(resource.closeTime || '23:59')) return false;
      const taken = occupancy.listForStay({
        resourceId: resource.id, startDate: date, endDate: date, excludeHoldRef,
      });
      return validateBlock({
        resource, block: { date, start, end: timeOf(endsAt) }, occupancy: taken, ...boundsOf(resource, clock),
      }).ok;
    };
    if (coveredBand === 'evening' && period === 'weekend' && startBand === 'day' && startPeriod === 'week') {
      const free = blockFree(toMinutes(start) + 2 * covered);
      result.twoHours = {
        free, minutes: covered, endTime: timeOf(toMinutes(start) + 2 * covered), line: null,
      };
      if (free) {
        // The added time is priced like any other (so its value is the line's struck figure) and given away: a 0 € line of the booking.
        const added = priceSession(resource, {
          band: startBand, start, minutes: covered, rankOffsetMinutes: covered, date,
        }, memo);
        if (added.code) return added;
        result.twoHours.line = {
          ...added.line, label: 'Heure offerte', unitCents: 0, totalCents: 0, offered: true, catalogueCents: added.line.totalCents,
        };
        result.endTime = timeOf(toMinutes(start) + 2 * covered + extra);
        if (extra > 0 && !blockFree(toMinutes(start) + 2 * covered + extra)) {
          return refuse('EXTRA_TIME_UNAVAILABLE', 'Le temps supplémentaire ne tient pas après l’heure offerte à ce créneau.');
        }
      }
    }
    if (extra > 0) {
      const offered = result.twoHours && result.twoHours.free ? covered : 0;
      const added = priceSession(resource, {
        band: coveredBand, start, minutes: extra, rankOffsetMinutes: covered + offered, date,
      }, memo);
      if (added.code) return added;
      result.extra = { line: added.line, totalCents: added.line.totalCents };
      result.endTime = timeOf(toMinutes(start) + covered + offered + extra);
    }
    return result;
  }

  // The commit's own check of a block, the slot walk the reads use: a hold of `holdRef` is the buyer's own and does not count.
  function blockRefusal(resource, { date, start, end }, { holdRef = null, at }) {
    const taken = occupancy.listForStay({
      resourceId: resource.id, startDate: date, endDate: date, excludeHoldRef: holdRef,
    });
    const verdict = validateBlock({ resource, block: { date, start, end }, occupancy: taken, ...boundsOf(resource, at) });
    return verdict.ok ? null : refuse(verdict.reason === 'taken' || verdict.reason === 'staff' ? 'SLOT_TAKEN' : 'SLOT_UNAVAILABLE', REASONS[verdict.reason] || SLOT_TAKEN);
  }

  function hold({
    resourceId, date, start, end, ref, minutes = HOLD_MINUTES, now: at,
  }) {
    const resource = offerable(resourceId);
    if (!resource) return refuse('RESOURCE_UNAVAILABLE', 'Cette ressource ne se réserve pas à l’heure.');
    const clock = clockOf(at);
    const refusal = blockRefusal(resource, { date, start, end }, { holdRef: ref, at: clock });
    if (refusal) return refusal;
    return { ok: true, ...holds.hold({ resourceId: resource.id, date, start, end, ref, minutes }) };
  }

  const release = (ref) => holds.release(ref);

  function termsHistory(saleId, row) {
    standaloneSale().recordHistory(saleId, `Conditions générales du bain acceptées (version ${row.version}, ${CHANNELS[row.channel] || row.channel})`, 'public');
  }

  function recordTerms(bookingId, saleId, request, channel) {
    if (!terms || !request || request.versionId == null || !terms.current('resource')) return;
    try {
      terms.accept({
        activity: 'resource',
        versionId: request.versionId,
        subjectType: 'outsideBooking',
        subjectRef: bookingId,
        channel,
        ip: request.ip || null,
        userAgent: request.userAgent || null,
        onAccepted: (row) => termsHistory(saleId, row),
      });
    } catch (err) {
      if (!err || err.code !== 'TERMS_OUTDATED') throw err;
      standaloneSale().recordHistory(saleId, 'Conditions générales : la version a changé avant la confirmation, aucune acceptation enregistrée.', 'public');
    }
  }

  // The sale of the booking, priced lines first (the session under the name the visit model reads it by), then the options.
  function saleRequestOf({
    bookingId, customer, fulfilments, lines, acceptedTotalCents,
  }) {
    return {
      fulfilments: fulfilments.map(({ role, ...line }) => ({ ...line, fulfilmentRef: (FULFILMENT_REFS[role] || sessionRefOf)(bookingId) })),
      lines,
      customer: { name: customer.name, email: customer.email },
      originRef: `resource-booking:${bookingId}`,
      source: 'visit',
      acceptedTotalCents,
    };
  }

  const coverOf = (bookingId, cover) => (cover.role
    ? { fulfilmentRef: (FULFILMENT_REFS[cover.role] || sessionRefOf)(bookingId), amountCents: cover.amountCents }
    : { articleRef: cover.articleRef, amountCents: cover.amountCents });

  function applyTenders({ saleId, bookingId, tenders, day }) {
    const core = standaloneSale();
    for (const tender of tenders.filter((t) => t.method === 'prepaid')) {
      const taken = core.takePrepaid(saleId, {
        tender: { source: tender.source, ref: tender.ref, label: tender.label }, covers: tender.covers.map((cover) => coverOf(bookingId, cover)), paidAt: day, actor: 'public',
      });
      if (taken.status !== 200) return refuse('PRICE_CHANGED', 'Prix modifié : recommencer.');
    }
    for (const tender of tenders.filter((t) => t.method === 'card')) {
      core.receive(saleId, {
        method: 'card', amountCents: tender.amountCents, paidAt: day, source: tender.source, surplus: { paymentLinkId: null, reason: 'Paiement en ligne supérieur au reste' },
      });
    }
    return null;
  }

  function bookOutside({
    resourceId, date, start, end, customer = {}, people = null, fulfilments = [], lines = [], tenders = [], holdRef = null, channel = 'mon-bain', terms: termsRequest = null, actor = 'public',
    acceptedTotalCents, now: at,
  }) {
    const resource = offerable(resourceId);
    if (!resource) return refuse('RESOURCE_UNAVAILABLE', 'Cette ressource ne se réserve pas à l’heure.');
    const clock = clockOf(at);
    const day = todayOf(clock);
    const nested = db.inTransaction;
    let outcome = null;
    const stop = (refusal) => { outcome = refusal; throw Object.assign(new Error(refusal.code), { refusal }); };
    try {
      db.transaction(() => {
        const blocked = blockRefusal(resource, { date, start, end }, { holdRef, at: clock });
        if (blocked) stop(blocked);
        const held = holdRef ? holds.find(holdRef) : null;
        const created = bookings().createBooking({
          resourceId: resource.id, date, startTime: start, endTime: end, clientName: customer.name || null, clientPhone: customer.phone || null, notes: '',
        }, { excludeHoldRef: holdRef });
        if (created.error) stop(created.status === 409 ? refuse('SLOT_TAKEN', SLOT_TAKEN) : refuse('BOOKING_REFUSED', created.error));
        const bookingId = Number(created.id);
        if (people) db.prepare('UPDATE resource_bookings SET people = ? WHERE id = ?').run(Number(people), bookingId);
        const core = standaloneSale();
        const sold = core.sell(saleRequestOf({
          bookingId, customer, fulfilments, lines, acceptedTotalCents,
        }), { actor, now: clock });
        if (sold.status !== 200) stop(refuse(sold.body && sold.body.code === 'PRICE_CHANGED' ? 'PRICE_CHANGED' : 'SALE_REFUSED', sold.body && sold.body.error ? sold.body.error : 'Vente refusée.'));
        const saleId = Number(sold.document.document.id);
        const sessionTotal = fulfilments.reduce((sum, line) => sum + line.totalCents, 0);
        db.prepare("UPDATE resource_bookings SET saleRef = ?, totalPrice = ?, updatedAt = datetime('now') WHERE id = ?").run(`standalone:${saleId}`, sessionTotal / 100, bookingId);
        core.recordHistory(saleId, `Séance réservée par ${customer.name || 'le client'} (canal : ${CHANNELS[channel] || channel})`, actor);
        if (held) core.recordHistory(saleId, `Créneau retenu de ${held.startTime} à ${held.endTime} le temps du paiement (jusqu’à ${(toParisIso(new Date(held.expiresAt)) || '').slice(11, 16)})`, actor);
        const refusal = applyTenders({
          saleId, bookingId, tenders, day,
        });
        if (refusal) stop(refusal);
        recordTerms(bookingId, saleId, termsRequest, channel);
        if (holdRef) holds.release(holdRef);
        outcome = { ok: true, bookingId, saleId };
      })();
    } catch (err) {
      if (!err || !err.refusal) throw err;
      return err.refusal;
    }
    if (!ANNOUNCED_CHANNELS.includes(channel)) return outcome;
    const notice = bookedNotice({
      resourceName: resource.name, date, start, end, customer, people, tenders, bookingId: outcome.bookingId,
    });
    if (nested) return { ...outcome, announce: () => notify(notice) };
    notify(notice);
    return outcome;
  }

  return {
    freeSlots, quote, hold, release, bookOutside, limits,
  };
}

module.exports = {
  createOutsideOffer, sessionRefOf, extraRefOf, offeredRefOf, SLOT_TAKEN,
};
