/**
 * The recipient's use of a composed voucher on « Mon bain » (specs/gift-voucher-campaigns.md rules 12-15, 23-32, 44-45, 51): what the voucher holds, the free slots tagged by what they
 * cost the recipient, the recap of a choice, and the confirmation — which books at once when nothing is due, and otherwise holds the slot and the voucher for 15 minutes while the
 * remainder is paid.
 *
 *   open({ code, visitor })                           → the contents, the names, the validity, the add-ons and extra time on offer, each step
 *                                                       priced like the offer prices it (rule 64), the horizon (rule 24)
 *   slots({ code, from, to, extraMinutes?, visitor }) → `{ days: [{ date, slots: [{ start, end, tag: 'in' | 'supplement', supplementCents, dueCents, evening }] }] }` (rules 25, 14; `dueCents` is what the start costs above the voucher, extra time included, and `evening` whether
 *                                                       part of it is in the evening band: specs/site-outside-resource-booking.md rule 10)
 *   quote({ code, start, extraMinutes?, addOns?, visitor }) → the recap: included, supplement, extras (and `extrasCents`, their sum, and `extraTimePrices`, the extra-time steps priced at that start, rule 64), what is still due, the VAT (rules 26-27)
 *   confirm({ code, start, extraMinutes?, addOns?, email, phone, firstName?, lastName?, name?, people?, termsVersionId, visitor, returnUrl? }) → `{ booked: true }` | `{ payUrl, heldUntil }` (rules 28-29)
 *   paid({ ref, linkId, amountCents })                the bank confirmed the remainder: book and settle in one transaction, or say the money is owed back (rule 29)
 *   lapseDue()                                        the job: 15 minutes ended unpaid, the slot and the voucher are free again
 *   lapseVoucher(voucherId)                           a voucher was cancelled: its pending uses end with it
 *   traceUnused({ ref, label, valueCents })           the arrival SAS marked an element « non pris »: the unused value is traced (rule 15)
 *
 * Nothing is booked, held or created before the bank confirms the payment — except the slot hold and the voucher hold of a remainder being paid, which lapse by themselves. Every price is the
 * engine's (through the booking offer of the resource's plugin and the core's sale quote); the recipient's browser computes nothing. The one place that books is the resource plugin's
 * `bookOutside`, which writes the booking, the sale, the tenders and the history in one transaction; this service wraps it with the voucher's own movements in the same transaction.
 */

const rules = require('./voucherRules');
const campaignRules = require('./campaignRules');
const { renderUseMail } = require('./useMail');
const { createExtrasPricing } = require('./extrasPricing');
const { refundNotice } = require('./voucherNotices');

const HOLD_MINUTES = 15;
const MAX_SPAN_DAYS = 62;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE = /^[0-9+().\s-]{6,30}$/;
const MAX_PEOPLE = 100;
const START = /^(\d{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const BAND_WORDS = Object.freeze({ day: 'journée', evening: 'soirée' });

const refuse = (code, message, status = 400, extra = {}) => ({
  ok: false, status, code, message, ...extra,
});

/** `14 février 2027` — a Paris-neutral ISO day as the French write it. */
const longDate = (iso) => new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
}).format(new Date(`${iso}T12:00:00Z`));

const asInt = (v) => (typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v) : v);
const clockOf = (start) => start.slice(11, 16);

function createUseService({
  vouchers, campaigns, redemption, uses, unused, catalogue, engine, resources, terms, payments, sendMail, address, companyName, durationText,
  basketSource, prepaidSource, prepaidLabel, notify = () => {}, now = () => new Date(), transaction,
}) {
  const hook = () => resources();
  const extrasPricing = createExtrasPricing({ engine, catalogue });

  // ── the voucher ───────────────────────────────────────────────────────────────────────────────────────────────────────

  /** Rule 32 — a voucher expired or used says its date. */
  function explained(failure) {
    if (failure.code === 'VOUCHER_EXPIRED') return { ...failure, message: `Ce bon a expiré le ${rules.formatFrDate(failure.expiresOn)}.` };
    const booked = failure.code === 'VOUCHER_EXHAUSTED' && failure.voucherId ? uses.bookedOf(failure.voucherId) : null;
    if (booked) return { ...failure, message: `Ce bon a déjà été utilisé le ${rules.formatFrDate(rules.parisDate(new Date(booked.settledAt)))}.` };
    return failure;
  }

  /** The voucher a code opens, judged with the per-visitor limits; a lodging voucher is told what it is for. → `{ ok, voucher, contents }` | a refusal. */
  function voucherOf(input, visitor, { lodgingOk = false } = {}) {
    const code = input && typeof input.code === 'string' ? input.code : '';
    const judged = redemption.judgeCode({ code }, visitor, { forUse: true });
    if (!judged.ok) return explained(judged);
    const contents = rules.contentsOf(judged.voucher);
    if (contents.kind === 'lodging') {
      return lodgingOk
        ? { ok: true, voucher: judged.voucher, contents }
        : refuse('VOUCHER_WRONG_KIND', 'Ce bon est valable pour un séjour dans nos logements, pas pour une séance.', 409);
    }
    return { ok: true, voucher: judged.voucher, contents };
  }

  const elementOf = (contents) => catalogue.element(`resource:${contents.resource.id}`);
  const modeOf = (contents) => {
    const element = elementOf(contents);
    return element ? element.modes.find((m) => m.band === contents.resource.band) : null;
  };

  /** What a voucher holds, the way the page lists it under « Votre bon comprend » (rule 24). */
  function contentLines(contents) {
    const { resource } = contents;
    const mode = modeOf(contents);
    const hours = mode ? ` · de ${mode.from} à ${mode.to}` : '';
    const given = resource.extraMinutes > 0 ? ` + ${durationText(resource.extraMinutes)} de temps supplémentaire` : '';
    return [
      { kind: 'session', label: resource.name, detail: `${durationText(resource.includedMinutes)} en ${BAND_WORDS[resource.band]}${given}${hours}`, qty: 1 },
      ...contents.options.map((o) => ({ kind: 'option', label: o.label, detail: null, qty: o.qty })),
      ...contents.addOns.map((o) => ({ kind: 'addOn', label: o.label, detail: null, qty: o.qty })),
    ];
  }

  /** The add-ons of the campaign the recipient may still add: those the voucher does not hold already — whatever the engine can price (a price change is judged by the quote itself). */
  function offeredAddOnRefs(voucher, contents) {
    const campaign = voucher.campaignId ? campaigns.find(voucher.campaignId) : null;
    const held = new Set([...contents.options, ...contents.addOns].map((o) => o.articleRef));
    return (campaign ? campaign.addOns : []).filter((ref) => !held.has(ref));
  }

  /** Rule 64 — what « Mon bain » shows under « Ajouter au bon »: the offered add-ons with their price tables, built on the opening call only. */
  const offeredAddOns = (voucher, contents) => extrasPricing.priced(offeredAddOnRefs(voucher, contents)
    .map((articleRef) => ({ articleRef, label: (catalogue.element(articleRef) || {}).label || articleRef, maxQty: campaignRules.MAX_QTY })));

  /** What a session of the resource may ask — the step, the longest, the party — as the booking offer says it; the page asks nothing of the resource beyond this and the voucher. */
  function limitsOf(resourceId) {
    const limits = hook() && hook().limits({ resourceId });
    return limits && limits.ok ? { stepMinutes: limits.stepMinutes, maxMinutes: limits.maxMinutes, maxPeople: limits.maxPeople } : {};
  }

  const minutesOfClock = (clock) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5));

  /**
   * Rules 27, 63 — the extra time a recipient may add (any step the resource's slot duration allows, whatever the campaign offered, and on a one-shot voucher too), each step priced
   * like the offer prices it: the voucher's band, its ranks continuing after the minutes it covers. The steps run up to the longest the band could ever hold; the slot's close
   * time is judged by the server at each slot, so no maximum is stated here. A step the dateless pricing cannot price (past the band's end) is listed with `cents: null`: the
   * slot's own quote prices it (`extraTimePrices`).
   */
  function offeredExtraTime(contents, mode) {
    if (!mode) return null;
    const closes = Math.max(...elementOf(contents).modes.map((m) => minutesOfClock(m.to)));
    const longest = closes - minutesOfClock(mode.from) - contents.resource.minutes;
    return {
      stepMinutes: mode.slotMinutes,
      prices: extrasPricing.extraTime({
        resourceId: contents.resource.id,
        band: contents.resource.band,
        rankOffsetMinutes: contents.resource.minutes,
        stepMinutes: mode.slotMinutes,
        maxMinutes: longest,
        keepUnpriced: true,
      }),
    };
  }

  /**
   * Rule 64 — the price of each extra-time step at the chosen start, through the very path the recap's extra line takes (the booking offer's quote, then the engine), so the figure
   * of the fold equals the line of the recap for the same minutes. Steps run until the slot no longer holds the longer session (the close time, the next booking) or the engine
   * cannot price one.
   */
  function extraTimePricesAt(contents, date, time, stepMinutes) {
    const { resource } = contents;
    const prices = [];
    for (let minutes = stepMinutes; ; minutes += stepMinutes) {
      const free = hook().freeSlots({
        resourceId: resource.id, from: date, to: date, minutes: resource.minutes + minutes, band: resource.band, now: now(),
      });
      if (!free.days.some((day) => day.date === date && day.slots.some((slot) => slot.start === time))) break;
      const priced = hook().quote({
        resourceId: resource.id, date, start: time, coveredBand: resource.band, coveredMinutes: resource.minutes, extraMinutes: minutes,
      });
      if (!priced.ok || !priced.extra) break;
      const answer = engine.quote({ lines: [], fulfilments: [{ ...priced.extra.line, fulfilmentRef: 'use:extra' }] });
      if (answer.status !== 200 || answer.refusals.length || !answer.document.lines.length) break;
      prices.push({ minutes, cents: answer.document.lines[0].totalCents });
    }
    return prices;
  }

  // ── what the page reads first ────────────────────────────────────────────────────────────────────────────────────────

  function open({ code, visitor }) {
    const found = voucherOf({ code }, visitor, { lodgingOk: true });
    if (!found.ok) return found;
    const { voucher, contents } = found;
    if (contents.kind === 'lodging') return { ok: true, data: { kind: 'lodging' } };
    const mode = modeOf(contents);
    const probe = hook() && hook().freeSlots({
      resourceId: contents.resource.id, from: rules.parisDate(now()), to: rules.parisDate(now()), minutes: contents.resource.minutes, now: now(),
    });
    const used = uses.bookedOf(voucher.id);
    return {
      ok: true,
      data: {
        kind: 'resource',
        title: contents.title,
        number: voucher.number,
        resource: { id: contents.resource.id, name: contents.resource.name, band: contents.resource.band, minutes: contents.resource.minutes, ...limitsOf(contents.resource.id) },
        contents: contentLines(contents),
        recipientName: voucher.recipientName || '',
        senderName: voucher.senderName || '',
        message: voucher.message || '',
        expiresOn: voucher.expiresOn,
        usedOn: used ? rules.parisDate(new Date(used.settledAt)) : null,
        addOns: offeredAddOns(voucher, contents),
        extraTime: offeredExtraTime(contents, mode),
        horizonUntil: probe && probe.ok ? probe.horizonUntil : null,
        termsVersionId: (terms.current('resource') || {}).id || null,
        termsVersion: (terms.current('resource') || {}).version || null,
      },
    };
  }

  function slots({
    code, from, to, extraMinutes, visitor,
  }) {
    const found = voucherOf({ code }, visitor);
    if (!found.ok) return found;
    if (!hook()) return refuse('BOOKING_UNAVAILABLE', 'Les réservations en ligne ne sont pas disponibles pour le moment.', 409);
    if (!ISO_DATE.test(String(from)) || !ISO_DATE.test(String(to)) || to < from) return refuse('PERIOD_INVALID', 'Période invalide.');
    if (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`) > (MAX_SPAN_DAYS - 1) * 86400000) return refuse('PERIOD_TOO_LONG', `Période trop longue : ${MAX_SPAN_DAYS} jours au plus.`);
    const extra = extraMinutes === undefined || extraMinutes === null ? 0 : asInt(extraMinutes);
    if (!Number.isInteger(extra) || extra < 0) return refuse('EXTRA_TIME_INVALID', 'Temps supplémentaire : un nombre entier de minutes est attendu.');
    const { contents } = found;
    const { resource } = contents;
    const free = hook().freeSlots({
      resourceId: resource.id, from, to, minutes: resource.minutes + extra, band: resource.band, now: now(),
    });
    if (!free.ok) return refuse(free.code, free.message, 409);
    if (from > free.horizonUntil) return refuse('BEYOND_HORIZON', `Réservable jusqu’au ${longDate(free.horizonUntil)}.`, 409, { horizonUntil: free.horizonUntil });
    const element = elementOf(contents);
    const evening = element ? element.modes.find((m) => m.band === 'evening') : null;
    // What a start costs the recipient above the voucher: the evening supplement of the covered session and the extra time, each hour at the band it falls in (rules 9-10). The price of
    // a start is the same on every date, so one quote per start.
    const priced = new Map();
    const priceOf = (date, start) => {
      if (!priced.has(start)) {
        const answer = hook().quote({
          resourceId: resource.id, date, start, coveredBand: resource.band, coveredMinutes: resource.minutes, extraMinutes: extra,
        });
        const supplementCents = answer.ok ? answer.session.supplementCents : 0;
        const extraCents = answer.ok && answer.extra ? answer.extra.totalCents : 0;
        const extraInEvening = answer.ok && answer.extra ? answer.extra.line.components.some((part) => part.key.startsWith('band:evening')) : false;
        priced.set(start, { supplementCents, dueCents: supplementCents + extraCents, evening: supplementCents > 0 || (extraCents > 0 && extraInEvening) });
      }
      return priced.get(start);
    };
    const tagged = free.days.map((day) => ({
      date: day.date,
      slots: day.slots.map((slot) => {
        const crossesEvening = resource.band === 'day' && evening && slot.end > evening.from;
        if (!crossesEvening && extra === 0) return { ...slot, tag: 'in', supplementCents: 0, dueCents: 0, evening: false };
        const { supplementCents, dueCents, evening: inEvening } = priceOf(day.date, slot.start);
        return {
          ...slot, tag: supplementCents > 0 ? 'supplement' : 'in', supplementCents, dueCents, evening: inEvening,
        };
      }),
    }));
    return { ok: true, data: { horizonUntil: free.horizonUntil, days: tagged } };
  }

  // ── the recap ─────────────────────────────────────────────────────────────────────────────────────────────────────────

  function addOnsOf(voucher, contents, asked) {
    if (asked === undefined || asked === null) return { value: [] };
    if (!Array.isArray(asked)) return { problem: refuse('ADDONS_INVALID', 'Options choisies : une liste est attendue.') };
    const offered = new Set(offeredAddOnRefs(voucher, contents));
    const value = [];
    for (const entry of asked) {
      const articleRef = entry && entry.articleRef;
      const qty = Number(asInt(entry && entry.qty === undefined ? 1 : entry && entry.qty));
      const label = (catalogue.element(articleRef) || {}).label || articleRef;
      if (!offered.has(articleRef)) return { problem: refuse('ADDON_NOT_OFFERED', `Option choisie : « ${label} » n’est pas proposée.`) };
      if (!Number.isInteger(qty) || qty < 1 || qty > campaignRules.MAX_QTY) return { problem: refuse('ADDON_QTY_INVALID', `Option choisie : la quantité de « ${label} » va de 1 à ${campaignRules.MAX_QTY}.`) };
      if (value.some((v) => v.articleRef === articleRef)) return { problem: refuse('ADDON_DUPLICATE', `Option choisie : « ${label} » figure deux fois.`) };
      value.push({ articleRef, label, qty });
    }
    return { value };
  }

  const lineOf = (row) => ({
    label: row.label, detail: row.detail || null, qty: row.quantity, valueCents: row.totalCents, vatRate: row.vatRate,
  });

  /**
   * The composition of a choice, priced by the engine: the session at the slot (what the voucher covers, what the evening costs above it), the extra time with its ranks
   * continuing, the options the voucher holds and the add-ons added. `checkSlot: false` is the confirmation of a payment, where the slot is judged by the booking itself.
   * → `{ ok: true, …, covers, fulfilments, lines, dueCents }` | a refusal.
   */
  function compose(voucher, contents, request, { checkSlot = true } = {}) {
    const asked = String(request.start || '');
    const parts = START.exec(asked);
    if (!parts) return refuse('SLOT_INVALID', 'Créneau invalide.');
    const date = parts[1];
    const time = clockOf(asked);
    const extra = request.extraMinutes === undefined || request.extraMinutes === null ? 0 : asInt(request.extraMinutes);
    if (!Number.isInteger(extra) || extra < 0) return refuse('EXTRA_TIME_INVALID', 'Temps supplémentaire : un nombre entier de minutes est attendu.');
    const added = addOnsOf(voucher, contents, request.addOns);
    if (added.problem) return added.problem;
    if (!hook()) return refuse('BOOKING_UNAVAILABLE', 'Les réservations en ligne ne sont pas disponibles pour le moment.', 409);
    const { resource } = contents;
    const priced = hook().quote({
      resourceId: resource.id, date, start: time, coveredBand: resource.band, coveredMinutes: resource.minutes, extraMinutes: extra,
    });
    if (!priced.ok) return refuse(priced.code, priced.message, 409);
    if (checkSlot) {
      const free = hook().freeSlots({
        resourceId: resource.id, from: date, to: date, minutes: resource.minutes + extra, band: resource.band, now: now(),
      });
      if (date > free.horizonUntil) return refuse('BEYOND_HORIZON', `Réservable jusqu’au ${longDate(free.horizonUntil)}.`, 409, { horizonUntil: free.horizonUntil });
      if (!free.days.some((day) => day.date === date && day.slots.some((slot) => slot.start === time))) return refuse('SLOT_TAKEN', 'Ce créneau n’est plus libre.', 409);
    }
    const fulfilments = [{ role: 'session', ...priced.session.line }, ...(priced.extra ? [{ role: 'extra', ...priced.extra.line }] : [])];
    const held = [...contents.options, ...contents.addOns].map((o) => ({ articleRef: o.articleRef, quantity: o.qty }));
    const bought = added.value.map((o) => ({ articleRef: o.articleRef, quantity: o.qty }));
    const answer = engine.quote({
      lines: [...held, ...bought],
      fulfilments: fulfilments.map(({ role, ...line }) => ({ ...line, fulfilmentRef: `use:${role}` })),
    });
    if (answer.status !== 200) return refuse('PRICE_UNAVAILABLE', answer.body && answer.body.error ? answer.body.error : 'Prix indisponible.', 409);
    if (answer.refusals.length) return refuse('PRICE_UNAVAILABLE', answer.refusals[0].message, 409);
    const rows = answer.document.lines;
    const free = rows.slice();
    const take = (predicate) => { const index = free.findIndex(predicate); return index < 0 ? null : free.splice(index, 1)[0]; };
    const sessionRow = take((r) => r.fulfilmentRef === 'use:session');
    const extraRow = priced.extra ? take((r) => r.fulfilmentRef === 'use:extra') : null;
    const heldRows = held.map((o) => take((r) => r.articleKey === o.articleRef && !r.fulfilmentRef));
    const boughtRows = bought.map((o) => take((r) => r.articleKey === o.articleRef && !r.fulfilmentRef));
    if (!sessionRow || heldRows.includes(null) || boughtRows.includes(null)) return refuse('PRICE_UNAVAILABLE', 'Prix indisponible.', 409);
    const covers = [
      { role: 'session', amountCents: priced.session.coveredCents },
      ...heldRows.map((row, i) => ({ articleRef: held[i].articleRef, amountCents: row.totalCents })),
    ].filter((cover) => cover.amountCents > 0);
    const coveredCents = covers.reduce((sum, cover) => sum + cover.amountCents, 0);
    const supplementCents = priced.session.supplementCents;
    const extrasRows = [...(extraRow ? [extraRow] : []), ...boughtRows];
    const dueCents = supplementCents + extrasRows.reduce((sum, row) => sum + row.totalCents, 0);
    return {
      ok: true,
      date,
      time,
      endTime: priced.endTime,
      fulfilments,
      lines: [...held, ...bought],
      covers,
      coveredCents,
      supplementCents,
      dueCents,
      totalCents: answer.document.totals.totalCents,
      view: {
        date,
        start: time,
        end: priced.endTime,
        included: [
          { ...lineOf(sessionRow), valueCents: priced.session.coveredCents, label: `${resource.name} · ${durationText(resource.minutes)}`, detail: sessionRow.detail },
          ...heldRows.map(lineOf),
        ],
        supplement: supplementCents > 0 ? { label: 'Supplément soirée', cents: supplementCents } : null,
        extras: [
          ...(extraRow ? [{ label: `Temps supplémentaire · ${durationText(extra)}`, detail: extraRow.detail || null, qty: 1, cents: extraRow.totalCents }] : []),
          ...boughtRows.map((row) => ({ label: row.label, detail: row.detail || null, qty: row.quantity, cents: row.totalCents })),
        ],
        extrasCents: extrasRows.reduce((sum, row) => sum + row.totalCents, 0),
        dueCents,
        totalCents: answer.document.totals.totalCents,
        vat: answer.document.vatByRate.map((row) => ({ rate: row.rate, cents: row.vatCents })),
      },
    };
  }

  function quote(request) {
    const found = voucherOf(request, request.visitor);
    if (!found.ok) return found;
    const composed = compose(found.voucher, found.contents, request);
    if (!composed.ok) return composed;
    const mode = modeOf(found.contents);
    const extraTimePrices = mode ? extraTimePricesAt(found.contents, composed.date, composed.time, mode.slotMinutes) : [];
    return { ok: true, data: { ...composed.view, extraTimePrices } };
  }

  // ── booking and holding ──────────────────────────────────────────────────────────────────────────────────────────────

  const tenderOf = (voucher, composed) => ({
    method: 'prepaid', source: prepaidSource, ref: voucher.number, label: prepaidLabel, covers: composed.covers,
  });

  function bookingRequest(voucher, use, composed, { holdRef = null, channel = 'mon-bain', onlyPrepaid = false, linkId = null } = {}) {
    const customer = { name: use.name || 'Bénéficiaire du bon cadeau', email: use.email, phone: use.phone };
    return {
      resourceId: use.resourceId,
      date: use.date,
      start: use.startTime,
      end: use.endTime,
      customer,
      people: use.people,
      fulfilments: composed.fulfilments,
      lines: composed.lines,
      tenders: [
        tenderOf(voucher, composed),
        ...(!onlyPrepaid && composed.dueCents > 0 ? [{ method: 'card', amountCents: composed.dueCents, source: `payment-link:${linkId}` }] : []),
      ],
      holdRef,
      channel,
      terms: use.termsVersionId ? { versionId: use.termsVersionId, ip: use.ip, userAgent: use.userAgent } : null,
      acceptedTotalCents: composed.totalCents,
      actor: 'public',
      now: now(),
    };
  }

  /** Throws the refusal `fn` returns, so the transaction around it rolls back every write. */
  const orThrow = (refusal) => { throw Object.assign(new Error(refusal.code), { refusal }); };
  const attempt = (work) => {
    try {
      return { ok: true, value: transaction(work) };
    } catch (error) {
      if (error && error.refusal) return error.refusal;
      throw error;
    }
  };

  function sendConfirmation(use, voucher, contents, composed) {
    const mail = renderUseMail({
      companyName: companyName(),
      address: address(),
      title: contents.title,
      resourceName: contents.resource.name,
      date: use.date,
      start: use.startTime,
      end: use.endTime,
      people: use.people,
      included: composed.view.included,
      supplement: composed.view.supplement,
      extras: composed.view.extras,
      dueCents: composed.dueCents,
      number: voucher.number,
    });
    Promise.resolve().then(() => sendMail({
      to: use.email, subject: mail.subject, text: mail.text, html: mail.html, key: `gift-voucher-use:${use.id}`,
    })).catch(() => {});
  }

  function bookNow(voucher, contents, composed, fields) {
    const booked = attempt(() => {
      const use = uses.insert({ ...fields, dueCents: 0, heldUntil: now() });
      const held = redemption.holdForUse({ useId: use.id, voucherId: voucher.id });
      if (!held.ok) orThrow(held);
      const done = hook().bookOutside(bookingRequest(voucher, use, composed));
      if (!done.ok) orThrow(refuse(done.code, done.message, 409));
      redemption.settleUse({ useId: use.id, bookingId: done.bookingId });
      uses.setBooked(use.id, { bookingId: done.bookingId, saleId: done.saleId });
      return { use: uses.find(use.id), done };
    });
    if (!booked.ok) return booked;
    sendConfirmation(booked.value.use, voucher, contents, composed);
    // The operator is told once the booking is committed, never from inside the transaction.
    if (booked.value.done.announce) booked.value.done.announce();
    return { ok: true, data: { booked: true, bookingId: booked.value.done.bookingId, date: composed.date, start: composed.time, end: composed.endTime } };
  }

  async function holdAndLink(voucher, contents, composed, fields, returnUrl) {
    const heldUntil = new Date(now().getTime() + HOLD_MINUTES * 60 * 1000);
    const created = attempt(() => {
      const use = uses.insert({ ...fields, dueCents: composed.dueCents, heldUntil });
      const slot = hook().hold({
        resourceId: use.resourceId, date: use.date, start: use.startTime, end: use.endTime, ref: use.holdRef, minutes: HOLD_MINUTES, now: now(),
      });
      if (!slot.ok) orThrow(refuse(slot.code, slot.message, 409));
      const held = redemption.holdForUse({ useId: use.id, voucherId: voucher.id });
      if (!held.ok) orThrow(held);
      return use;
    });
    if (!created.ok) return created;
    const use = created.value;
    let link;
    try {
      link = await payments.saleLink({
        source: basketSource, ref: use.id, title: `${contents.title} · reste à payer`, amountCents: composed.dueCents, validityMinutes: HOLD_MINUTES,
      }, { redirectUrl: returnUrl ? `${returnUrl}${returnUrl.includes('?') ? '&' : '?'}gf_ref=${use.ref}` : null });
    } catch (error) {
      lapse(use, 'link-failed');
      if (error && error.error === 'NO_PAYMENT_PROVIDER') return refuse('ONLINE_SALE_UNAVAILABLE', 'Le paiement en ligne n’est pas disponible pour le moment.', 409);
      return refuse('PAYMENT_PROVIDER_ERROR', 'Le paiement n’a pas pu être préparé, réessayer.', 502);
    }
    uses.setLink(use.id, link.linkId);
    return { ok: true, data: { payUrl: link.url, heldUntil: heldUntil.toISOString(), dueCents: composed.dueCents } };
  }

  /** The 15 minutes ended (or the use was replaced): the slot and the voucher are free again; a use already booked is never touched. */
  function lapse(use, reason) {
    transaction(() => {
      if (!uses.setState(use.id, 'lapsed', reason)) return;
      hook() && hook().release(use.holdRef);
      redemption.releaseUse(use.id, reason);
    });
    if (use.linkId && payments.withdrawLink) payments.withdrawLink(use.linkId).catch(() => {});
  }

  async function confirm(request) {
    const found = voucherOf(request, request.visitor);
    if (!found.ok) return found;
    const { voucher, contents } = found;
    const email = typeof request.email === 'string' ? request.email.trim() : '';
    const phone = typeof request.phone === 'string' ? request.phone.trim() : '';
    if (!EMAIL.test(email) || email.length > 254) return refuse('EMAIL_INVALID', 'Adresse e-mail invalide.');
    if (!PHONE.test(phone)) return refuse('PHONE_INVALID', 'Numéro de téléphone invalide.');
    const text = (value) => (typeof value === 'string' ? value.trim().slice(0, 80) : '');
    const given = text(request.firstName) || text(request.lastName) ? `${text(request.firstName)} ${text(request.lastName)}`.trim() : text(request.name);
    const people = request.people === undefined || request.people === null ? null : asInt(request.people);
    const maxPeople = limitsOf(contents.resource.id).maxPeople || MAX_PEOPLE;
    if (people !== null && !(Number.isInteger(people) && people >= 1 && people <= maxPeople)) return refuse('PEOPLE_INVALID', `Nombre de personnes : de 1 à ${maxPeople}.`, 400, { field: 'people' });
    const unpublished = terms.current('resource') === null;
    if (unpublished) return refuse('TERMS_UNPUBLISHED', 'Les conditions du bain ne sont pas encore publiées : la réservation n’est pas ouverte.', 409);
    const owed = terms.requireAccepted({ activity: 'resource', versionId: request.termsVersionId, subjectType: 'outsideBooking' });
    if (owed) return refuse(owed, owed === 'TERMS_OUTDATED' ? 'Les conditions ont changé : relire et accepter la dernière version.' : 'Les conditions doivent être acceptées.', 400);
    uses.heldOf(voucher.id).forEach((previous) => lapse(previous, 'replaced'));
    const composed = compose(voucher, contents, request);
    if (!composed.ok) return composed;
    const visitor = request.visitor || {};
    const fields = {
      voucherId: voucher.id,
      resourceId: contents.resource.id,
      date: composed.date,
      startTime: composed.time,
      endTime: composed.endTime,
      extraMinutes: Number(asInt(request.extraMinutes)) || 0,
      addOns: composed.lines.slice(contents.options.length + contents.addOns.length).map((l) => ({ articleRef: l.articleRef, qty: l.quantity })),
      name: given || voucher.recipientName || '',
      people,
      recap: composed.view,
      email,
      phone,
      termsVersionId: terms.current('resource').id,
      userAgent: visitor.userAgent || null,
      ip: visitor.ip || null,
    };
    return composed.dueCents === 0
      ? bookNow(voucher, contents, composed, fields)
      : holdAndLink(voucher, contents, composed, fields, request.returnUrl || null);
  }

  // ── the bank's word ───────────────────────────────────────────────────────────────────────────────────────────────────

  // The core flags the payment « à rembourser » on the answer's `refundOwed`.
  const owedBack = (reason) => {
    const outcome = { reason };
    outcome.refundOwed = true;
    return outcome;
  };
  const unhonoured = (use, reason) => {
    uses.setState(use.id, 'refund_owed', reason);
    const element = catalogue.element(`resource:${use.resourceId}`);
    notify(refundNotice({
      resourceName: (element && element.label) || 'Séance', date: use.date, start: use.startTime, end: use.endTime, name: use.name, amountCents: use.dueCents, reason,
    }));
    return owedBack(reason);
  };

  /**
   * The remainder was paid — on time or late. Books the session and settles the voucher in one transaction. When the slot was taken after the hold lapsed, or the voucher was used
   * meanwhile, the money is flagged « à rembourser » on its payment link — the core's own refund line for a payment a basket cannot honour, which its journal already lists —
   * and the voucher stays intact.
   */
  function paid({ ref, linkId, amountCents }) {
    const use = uses.find(ref);
    if (!use) return owedBack('réservation de bain introuvable');
    if (use.state === 'booked') return { effect: 'bath-already-booked' };
    const voucher = vouchers.find(use.voucherId);
    const contents = rules.contentsOf(voucher);
    if (!voucher || voucher.cancelledAt || contents.kind !== 'resource') return unhonoured(use, 'bon cadeau annulé');
    const composed = compose(voucher, contents, {
      start: `${use.date}T${use.startTime}`, extraMinutes: use.extraMinutes, addOns: JSON.parse(use.addOns || '[]'),
    }, { checkSlot: false });
    if (!composed.ok) return unhonoured(use, composed.message);
    if (Number(amountCents) !== composed.dueCents) return unhonoured(use, 'montant payé différent du reste à payer');
    const stillHeld = use.state === 'held';
    const booked = attempt(() => {
      if (!stillHeld) {
        const held = redemption.holdForUse({ useId: use.id, voucherId: voucher.id });
        if (!held.ok) orThrow(refuse('VOUCHER_UNAVAILABLE', 'bon cadeau déjà utilisé', 409));
      }
      const done = hook().bookOutside(bookingRequest(voucher, use, composed, { holdRef: stillHeld ? use.holdRef : null, linkId }));
      if (!done.ok) orThrow(refuse(done.code, done.code === 'SLOT_TAKEN' ? 'créneau pris entre-temps' : done.message, 409));
      redemption.settleUse({ useId: use.id, bookingId: done.bookingId });
      uses.setBooked(use.id, { bookingId: done.bookingId, saleId: done.saleId });
      return done;
    });
    if (!booked.ok) return unhonoured(use, booked.message);
    if (booked.value.announce) booked.value.announce();
    sendConfirmation(uses.find(use.id), voucher, contents, composed);
    return { effect: 'bath-booked' };
  }

  /** Rule 16 — what the return page of a remainder reads: by the use's unguessable ref, no name, no e-mail. */
  async function status(ref) {
    let use = typeof ref === 'string' && /^[0-9a-f]{32}$/.test(ref) ? uses.findByRef(ref) : null;
    if (!use) return refuse('ORDER_NOT_FOUND', 'Réservation introuvable.', 404);
    // The visitor waits on the return page: the open link is read now rather than at the next poll, and a paid one books the session on the spot.
    if (use.state === 'held' && use.linkId && payments.refreshLink) {
      await payments.refreshLink(use.linkId).catch(() => {});
      use = uses.find(use.id);
    }
    const element = catalogue.element(`resource:${use.resourceId}`);
    return {
      ok: true,
      data: {
        state: { held: 'held', booked: 'booked', lapsed: 'lapsed', refund_owed: 'refundOwed' }[use.state],
        resourceName: (element && element.label) || '',
        date: use.date,
        start: use.startTime,
        end: use.endTime,
        people: use.people,
        recap: JSON.parse(use.recap || '{}'),
      },
    };
  }

  /** The job: every use whose 15 minutes ended unpaid gives its slot and its voucher back. → how many. */
  function lapseDue() {
    const due = uses.dueLapsed(now());
    due.forEach((use) => lapse(use, 'lapsed'));
    return due.length;
  }

  /** A voucher was cancelled: what its uses held goes back with it, the money paid for one later is owed back by the payment's own path. */
  function lapseVoucher(voucherId) {
    uses.heldOf(voucherId).forEach((use) => lapse(use, 'voucher-cancelled'));
  }

  /** Rule 15 — what a voucher paid for and the client did not take: traced on the voucher, shown in its detail as « Écart non utilisé ». */
  function traceUnused({ ref, label, valueCents }) {
    const voucher = vouchers.findByNumber(ref);
    if (!voucher) return;
    unused.record({ voucherId: voucher.id, label, valueCents });
  }

  return {
    open, slots, quote, confirm, paid, status, lapseDue, lapseVoucher, traceUnused,
  };
}

module.exports = { createUseService, HOLD_MINUTES };
