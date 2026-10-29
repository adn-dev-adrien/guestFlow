/**
 * The intake pass and the operator's actions on an intake (specs/airbnb-mail-intake.md §3).
 *
 *   read the mailbox → parse each new « Réservation confirmée » mail → match it to the iCal fiche of the
 *   listing's property → fill the fiche (untouched placeholder) or propose (fiche already edited).
 *
 * Every write to a reservation goes through `core.updateReservation` — the fiche's own save path.
 * Nothing here sends an e-mail.
 */

const { parseAirbnbMail, isBookingMail } = require('./mailParser');
const { paymentBlock } = require('./paymentBlock');
const { listingIdOf } = require('./listings');

const isAirbnb = (platform) => /airbnb/.test(String(platform || '').toLowerCase().replace(/[^a-z]/g, ''));
const isCleaning = (o) => o.autoOptionType === 'cleaning' || /ménage/i.test(String(o.title || ''));
const pad = (n) => String(n).padStart(2, '0');
const frDate = (iso) => { const d = new Date(iso); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`; };
const frDay = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const localDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const MAX_MAILS_PER_PASS = 200;
const SINCE_DAYS = 30;

function createIntakeService(deps) {
  const { intakes, settings, readMails, findReservations, propertyOptions, getReservation, core, parserVersion = null, now = () => new Date() } = deps;
  // The accommodations' day: the process runs in their time zone (utils/localDate.js).
  const today = deps.today || (() => localDay(now()));

  // `settings.listings()` is `[[propertyId, listingId]]`: detected from the iCal feeds, overridable (rule 11).
  function propertyIdsForListing(listingId) {
    return settings.listings().filter(([, id]) => id === String(listingId)).map(([propertyId]) => propertyId);
  }

  // Rule 11 — one reservation: Airbnb, the listing's property, same dates, not cancelled. An unmapped
  // listing waits (`pending`) and reaches the dashboard after a day, with its id to copy.
  function match(booking) {
    const propertyIds = propertyIdsForListing(booking.listingId);
    if (propertyIds.length === 0) return { reservation: null };
    const rows = findReservations({ propertyIds, startDate: booking.startDate, endDate: booking.endDate })
      .filter((r) => r.kind === 'reservation' && !r.cancelledAt && isAirbnb(r.platform));
    if (rows.length > 1) return { error: 'Plusieurs fiches Airbnb sur ces dates' };
    return { reservation: rows[0] || null };
  }

  // Rule 12 — the iCal placeholder nobody has saved yet: a manual save locks the iCal sync.
  function isUntouched(r) {
    return r.sourceType === 'ical' && Number(r.icalSyncLocked || 0) !== 1
      && (r.platformGrossAmount == null || r.platformGrossAmount === '');
  }

  // Rule 12 — the guest's message, appended once under a dated line.
  function notesWith(existing, booking, receivedAt) {
    if (!booking.message) return existing || '';
    if (String(existing || '').toLowerCase().includes(booking.message.toLowerCase())) return existing || '';
    const block = `Airbnb, ${frDate(receivedAt)} :\n${booking.message}`;
    return existing && existing.trim() ? `${existing.trim()}\n\n${block}` : block;
  }

  // The fiche as the operator fills it by hand: a client of the guest's own, party, booking number,
  // message, the cleaning fee paid to the platform, and the payment block.
  function fullPatch(intake, reservation) {
    const booking = intake.parsed;
    const details = getReservation(reservation.id);
    const catalogue = propertyOptions(reservation.propertyId);
    const autoIds = new Set(catalogue.filter((o) => Number(o.autoEnabled || 0) === 1).map((o) => Number(o.id)));
    const cleaning = catalogue.find(isCleaning);

    const options = (details.options || []).filter((o) => !o.isCustom && !autoIds.has(Number(o.optionId)))
      .map((o) => ({ optionId: o.optionId, quantity: o.quantity, inComplement: Number(o.inComplement || 0) === 1 ? 1 : 0 }));
    const customOptions = (details.options || []).filter((o) => o.isCustom).map((o, i) => ({
      customKey: String(o.customOptionId || `custom_${i + 1}`),
      customOptionId: o.customOptionId,
      description: o.title || o.description,
      amount: Number(o.originalTotalPrice ?? o.totalPrice ?? 0),
      offered: Boolean(o.offered),
      inComplement: Number(o.inComplement || 0) === 1 ? 1 : 0,
    }));
    let offered = (details.options || []).filter((o) => !o.isCustom && o.offered).map((o) => Number(o.optionId));

    if (booking.cleaningFee > 0) {
      if (cleaning && Number(cleaning.price) === booking.cleaningFee) {
        const existing = options.find((o) => Number(o.optionId) === Number(cleaning.id));
        if (existing) Object.assign(existing, { quantity: 1, inComplement: 0 });
        else options.push({ optionId: cleaning.id, quantity: 1, inComplement: 0 });
        offered = offered.filter((id) => id !== Number(cleaning.id));
      } else {
        customOptions.push({ customKey: `airbnb_${booking.code}_cleaning`, description: 'Frais de ménage (Airbnb)', amount: booking.cleaningFee, offered: false, inComplement: 0 });
      }
    }

    const payment = paymentBlock(booking, { withholds: core.withholdsTouristTax(reservation.propertyId, reservation.platform) });
    if (!payment.ok) return { error: payment.error };
    const commission = core.platformCommission({
      gross: payment.block.platformGrossAmount,
      payout: payment.block.platformPayoutAmount,
      touristTax: payment.block.platformTouristTaxAmount || 0,
    });

    const beds = core.suggestBeds(reservation.propertyId, { adults: booking.adults, children: booking.children, teens: 0 });

    return {
      // Created by the core in the same transaction as the update: a refused fiche leaves no client behind.
      client: { firstName: booking.firstName, lastName: booking.lastName },
      patch: {
        reservationNumber: booking.code,
        adults: booking.adults,
        children: booking.children,
        teens: 0,
        babies: booking.babies,
        singleBeds: beds.singleBeds,
        doubleBeds: beds.doubleBeds,
        babyBeds: booking.babies,
        options,
        customOptions,
        offeredOptionIds: offered,
        notes: notesWith(details.notes, booking, intake.receivedAt),
        ...payment.block,
        platformCommissionAmount: commission,
      },
    };
  }

  function apply(intake, reservation) {
    // Rule 18 — the core refuses a started stay (PAST_RESERVATION); asking first keeps fullPatch from
    // creating a client record that no fiche would ever point to.
    if (String(intake.parsed.startDate) <= today()) {
      const error = 'Séjour commencé : fiche à saisir à la main';
      intakes.setStatus(intake.id, { status: 'error', reservationId: reservation.id, error });
      return { status: 'error', error };
    }
    const planned = fullPatch(intake, reservation);
    if (planned.error) {
      intakes.setStatus(intake.id, { status: 'error', reservationId: reservation.id, error: planned.error });
      return { status: 'error', error: planned.error };
    }
    const result = core.updateReservation(reservation.id, planned.patch, { label: `Mail Airbnb du ${frDate(intake.receivedAt)}`, client: planned.client });
    if (result.status !== 200) {
      const error = (result.body && result.body.error) || `Erreur ${result.status}`;
      intakes.setStatus(intake.id, { status: 'error', reservationId: reservation.id, error });
      return { status: 'error', error };
    }
    intakes.setStatus(intake.id, { status: 'applied', reservationId: reservation.id, applied: true });
    return { status: 'applied' };
  }

  function process(intake) {
    if (intakes.codeAlreadyHandled(intake.confirmationCode, intake.id)) {
      intakes.setStatus(intake.id, { status: 'ignored', error: 'Réservation déjà traitée par un mail précédent' });
      return 'ignored';
    }
    const m = match(intake.parsed);
    if (m.error) { intakes.setStatus(intake.id, { status: 'error', error: m.error }); return 'error'; }
    if (!m.reservation) return 'pending';
    // Rule 22 — a mail whose sender is not authenticated is never applied on its own.
    if (!intake.senderVerified || !settings.autoApply() || !isUntouched(m.reservation)) {
      intakes.setStatus(intake.id, { status: 'proposed', reservationId: m.reservation.id });
      return 'proposed';
    }
    return apply(intake, m.reservation).status;
  }

  // Rule 31 — one pass at a time: a second call (job tick + « Lire maintenant ») joins the one running.
  let running = null;
  function runPass() {
    if (!running) running = readPass().finally(() => { running = null; });
    return running;
  }

  async function readPass() {
    const mailbox = settings.mailbox();
    if (!mailbox.host || !mailbox.user || !mailbox.password) return { skipped: 'Boîte mail non configurée' };
    // Rule 17 — installed with every plugin: nothing is read until a property is tied to a listing.
    if (settings.listings().length === 0) {
      return { skipped: 'Aucun logement relié à une annonce Airbnb' };
    }
    intakes.purgeIgnored(new Date(now().getTime() - (SINCE_DAYS + 1) * 24 * 3600 * 1000).toISOString());
    let read = 0;
    // Rule 30 — mails arrive one by one: known ones are never downloaded, the others are all remembered
    // (an intake, or `ignored`), and a pass reads at most MAX_MAILS_PER_PASS of them, newest first.
    const take = (mail) => {
      const senderVerified = mail.authenticated === true;
      // A pass counts the rows it really wrote: a mail another pass stored first is not read twice.
      const add = (row, counts = true) => { if (intakes.insert(row) !== null && counts) read += 1; };
      const remember = (error, counts = false) => add({ messageId: mail.messageId, receivedAt: mail.receivedAt, status: 'ignored', error, senderVerified, parserVersion }, counts);
      if (mail.skipped) { remember('Mail trop volumineux'); return; }
      // Rule 2 — messages, reminders, payouts and reviews from the same sender are not intakes at all.
      if (!isBookingMail(mail.subject, mail.text)) { remember('Autre type de mail'); return; }
      const parsed = parseAirbnbMail({ subject: mail.subject, text: mail.text, sentAt: mail.sentAt || mail.receivedAt });
      if (!parsed.ok) {
        // Rule 26 — a forged mail that does not parse is noise for the operator, but it is remembered
        // (`ignored`, out of every list) so the next pass does not read it again.
        add({ messageId: mail.messageId, receivedAt: mail.receivedAt, status: senderVerified ? 'error' : 'ignored', error: parsed.error, senderVerified, parserVersion });
        return;
      }
      add({ messageId: mail.messageId, receivedAt: mail.receivedAt, confirmationCode: parsed.booking.code, parsed: parsed.booking, status: 'pending', senderVerified });
    };
    await readMails(
      { ...mailbox, sender: settings.sender(), ...(settings.authentication ? settings.authentication() : {}) },
      { seen: (messageId) => intakes.has(messageId, parserVersion), onMail: take, limit: MAX_MAILS_PER_PASS },
    );
    const outcome = {};
    for (const intake of intakes.listOpen()) {
      // Rule 19 — one intake that throws is recorded and left behind: it would stay `pending`, first in
      // listOpen, and stop every later pass before the intakes behind it.
      let status;
      try {
        status = process(intake);
      } catch (err) {
        intakes.setStatus(intake.id, { status: 'error', error: `Erreur inattendue : ${err.message}` });
        status = 'error';
      }
      outcome[status] = (outcome[status] || 0) + 1;
    }
    return { read, ...outcome };
  }

  // What the fiche's banner renders (rule 14) — ready to display.
  function blockFor(reservationId) {
    const intake = intakes.latestForReservation(reservationId);
    if (!intake) return null;
    const booking = intake.parsed || {};
    return {
      id: intake.id,
      status: intake.status,
      error: intake.error,
      receivedLabel: frDate(intake.receivedAt),
      code: intake.confirmationCode,
      senderUnverified: !intake.senderVerified,
      airbnbUrl: intake.senderVerified ? booking.reservationUrl || null : null,
      taxLeftEmpty: intake.status === 'applied' && booking.code ? (() => {
        const r = getReservation(reservationId) || {};
        return !core.withholdsTouristTax(r.propertyId, r.platform);
      })() : false,
    };
  }

  // Dashboard (rule 15): one ready-to-print line per mail in error or still without a fiche after a day.
  function attention() {
    return intakes.listAttention(now().toISOString()).map((intake) => {
      const booking = intake.parsed || {};
      let text = intake.error;
      if (intake.status === 'proposed') text = 'Expéditeur non vérifié';
      if (intake.status === 'pending') {
        text = propertyIdsForListing(booking.listingId).length === 0
          ? `Annonce inconnue : ${booking.listingTitle || 'sans titre'} (${booking.listingId})`
          : `Aucune fiche Airbnb du ${frDay(booking.startDate)} au ${frDay(booking.endDate)}`;
      }
      return {
        id: intake.id,
        reservationId: intake.reservationId || null,
        receivedLabel: frDate(intake.receivedAt),
        code: intake.confirmationCode,
        guest: booking.firstName ? `${booking.firstName} ${booking.lastName}` : null,
        text,
      };
    });
  }

  function applyFromBanner(intakeId) {
    const intake = intakes.get(intakeId);
    if (!intake || !intake.parsed) return { status: 'error', error: 'Saisie introuvable' };
    const m = match(intake.parsed);
    if (m.error || !m.reservation) return { status: 'error', error: m.error || 'Fiche introuvable' };
    return apply(intake, m.reservation);
  }

  return { runPass, blockFor, applyFromBanner, dismiss: (id) => intakes.dismiss(id), attention };
}

module.exports = { createIntakeService, isAirbnb };
