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

const isAirbnb = (platform) => /airbnb/.test(String(platform || '').toLowerCase().replace(/[^a-z]/g, ''));
const isCleaning = (o) => o.autoOptionType === 'cleaning' || /ménage/i.test(String(o.title || ''));
const pad = (n) => String(n).padStart(2, '0');
const frDate = (iso) => { const d = new Date(iso); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`; };
const frDay = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

// The settings field takes the listing id or a pasted `airbnb.fr/rooms/<id>` link (rule 11).
function listingIdOf(value) {
  const s = String(value || '').trim();
  const fromUrl = s.match(/\/rooms\/(\d+)/);
  if (fromUrl) return fromUrl[1];
  return /^\d+$/.test(s) ? s : '';
}

function createIntakeService(deps) {
  const { intakes, settings, readMails, findReservations, propertyOptions, getReservation, core, now = () => new Date() } = deps;

  function propertyIdsForListing(listingId) {
    return Object.entries(settings.listings())
      .filter(([, value]) => listingIdOf(value) === String(listingId))
      .map(([propertyId]) => Number(propertyId));
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

    const payment = paymentBlock(booking, { withholds: core.withholdsTouristTax(reservation.propertyId) });
    if (!payment.ok) return { error: payment.error };
    const commission = core.platformCommission({
      gross: payment.block.platformGrossAmount,
      payout: payment.block.platformPayoutAmount,
      touristTax: payment.block.platformTouristTaxAmount || 0,
    });

    const client = core.findOrCreateClient({ firstName: booking.firstName, lastName: booking.lastName });
    const beds = core.suggestBeds(reservation.propertyId, { adults: booking.adults, children: booking.children, teens: 0 });

    return {
      patch: {
        clientId: client.id,
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
    const planned = fullPatch(intake, reservation);
    if (planned.error) {
      intakes.setStatus(intake.id, { status: 'error', reservationId: reservation.id, error: planned.error });
      return { status: 'error', error: planned.error };
    }
    const result = core.updateReservation(reservation.id, planned.patch, { label: `Mail Airbnb du ${frDate(intake.receivedAt)}` });
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
    if (!settings.autoApply() || !isUntouched(m.reservation)) {
      intakes.setStatus(intake.id, { status: 'proposed', reservationId: m.reservation.id });
      return 'proposed';
    }
    return apply(intake, m.reservation).status;
  }

  async function runPass() {
    const mailbox = settings.mailbox();
    if (!mailbox.host || !mailbox.user || !mailbox.password) return { skipped: 'Boîte mail non configurée' };
    // Rule 17 — installed with every plugin: nothing is read until a property is tied to a listing.
    if (Object.values(settings.listings()).every((v) => !listingIdOf(v))) {
      return { skipped: 'Aucun logement relié à une annonce Airbnb' };
    }
    const mails = await readMails({ ...mailbox, sender: settings.sender() });
    let read = 0;
    for (const mail of mails) {
      if (intakes.has(mail.messageId)) continue;
      // Rule 2 — messages, reminders, payouts and reviews from the same sender are not intakes at all.
      if (!isBookingMail(mail.subject, mail.text)) continue;
      read += 1;
      const parsed = parseAirbnbMail({ subject: mail.subject, text: mail.text, sentAt: mail.sentAt || mail.receivedAt });
      if (!parsed.ok) {
        intakes.insert({ messageId: mail.messageId, receivedAt: mail.receivedAt, status: 'error', error: parsed.error });
        continue;
      }
      intakes.insert({ messageId: mail.messageId, receivedAt: mail.receivedAt, confirmationCode: parsed.booking.code, parsed: parsed.booking, status: 'pending' });
    }
    const outcome = {};
    for (const intake of intakes.listOpen()) {
      const status = process(intake);
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
      airbnbUrl: booking.reservationUrl || null,
      taxLeftEmpty: intake.status === 'applied' && booking.code ? !core.withholdsTouristTax((getReservation(reservationId) || {}).propertyId) : false,
    };
  }

  // Dashboard (rule 15): one ready-to-print line per mail in error or still without a fiche after a day.
  function attention() {
    return intakes.listAttention(now().toISOString()).map((intake) => {
      const booking = intake.parsed || {};
      let text = intake.error;
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

module.exports = { createIntakeService, listingIdOf, isAirbnb };
