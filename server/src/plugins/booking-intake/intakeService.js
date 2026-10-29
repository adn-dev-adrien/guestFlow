/**
 * What happens to a page the userscript sent (specs/booking-extranet-intake.md rules 12–20):
 *
 *   parse → match the property and the fiche → fill an untouched iCal placeholder, or compare and
 *   propose when the fiche is already filled.
 *
 * Every write goes through `core.updateReservation` / `core.updateClient` — the fiche's own save path.
 * Nothing here sends an e-mail, and the raw page never reaches this file's storage.
 *
 * The guest gets a client of their own (rule 27): the iCal import used to hand one placeholder client to
 * every stay of a feed, so writing the guest onto the fiche's client renamed every other stay too.
 */

const { parseBookingPage } = require('./pageParser');

const pad = (n) => String(n).padStart(2, '0');
const frDate = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const isEmpty = (v) => v === null || v === undefined || v === '';
const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
const sameAmount = (a, b) => (isEmpty(a) && isEmpty(b))
  || (!isEmpty(a) && !isEmpty(b) && Math.abs(Number(a) - Number(b)) < 0.005);
// 06 12 34 56 78 = +33 6 12 34 56 78 = 0033612345678
const phoneKey = (p) => {
  const d = String(p || '').replace(/\D/g, '');
  if (d.startsWith('0033')) return `0${d.slice(4)}`;
  if (d.startsWith('33') && d.length === 11) return `0${d.slice(2)}`;
  return d;
};

function createIntakeService(deps) {
  const { intakes, hotelIds, findReservations, getReservation, clientShared, core, today, now = () => new Date() } = deps;

  const propertyIdFor = (hotelId) => {
    const found = Object.entries(hotelIds()).find(([, h]) => String(h).trim() === String(hotelId).trim());
    return found ? Number(found[0]) : null;
  };

  // Rule 15 — the guest's requests, appended under a dated line, once.
  function notesWith(existing, booking) {
    if (booking.requests.length === 0) return existing || '';
    // Free text keeps the operator's capitals except its first letter (free-text-keeps-case.md).
    const stored = String(existing || '').toLowerCase();
    const already = booking.requests.every((line) => stored.includes(line.toLowerCase()));
    if (already) return existing || '';
    const d = now();
    const block = [`Booking, ${pad(d.getDate())}/${pad(d.getMonth() + 1)} :`, ...booking.requests].join('\n');
    return existing && existing.trim() ? `${existing.trim()}\n\n${block}` : block;
  }

  // Rule 29 — « Taxe de séjour retenue » is the tax Booking keeps to pay the commune itself. When Booking
  // collects it and reverses it to us, the payout already holds it: nothing is withheld, and « Commission
  // et frais » is the whole commission.
  function withheldTouristTax(booking, reservation) {
    return core.withholdsTouristTax(reservation.propertyId) ? booking.touristTax : null;
  }

  function plan(booking, reservation) {
    const beds = core.suggestBeds(reservation.propertyId, { adults: booking.adults, children: booking.children, teens: booking.teens });
    const withheldTax = withheldTouristTax(booking, reservation);
    const commission = core.platformCommission({ gross: booking.total, payout: booking.payout, touristTax: withheldTax || 0 });
    const { guest } = booking;
    return {
      client: {
        firstName: guest.firstName,
        lastName: guest.lastName,
        email: guest.email,
        ...(guest.phone ? { phone: guest.phone } : {}),
        emailLanguage: booking.emailLanguage,
      },
      reservation: {
        platform: 'Booking',
        reservationNumber: booking.resId,
        adults: booking.adults,
        children: booking.children,
        teens: booking.teens,
        babies: booking.babies,
        singleBeds: beds.singleBeds,
        doubleBeds: beds.doubleBeds,
        babyBeds: booking.babies,
        ...(booking.arrivalTime ? { checkInTime: booking.arrivalTime } : {}),
        platformGrossAmount: booking.total,
        platformTouristTaxAmount: withheldTax,
        platformPayoutAmount: booking.payout,
        platformCommissionAmount: commission,
        notes: notesWith(reservation.notes, booking),
      },
    };
  }

  // Rule 17 — what the page says that the fiche does not: [{ field, label, from, to }].
  function differences(booking, reservation) {
    const out = [];
    const add = (field, label, from, to) => out.push({ field, label, from: isEmpty(from) ? null : from, to });
    const { guest } = booking;
    if (!same(reservation.firstName, guest.firstName)) add('firstName', 'Prénom', reservation.firstName, guest.firstName);
    if (!same(reservation.lastName, guest.lastName)) add('lastName', 'Nom', reservation.lastName, guest.lastName);
    if (!same(reservation.email, guest.email)) add('email', 'E-mail', reservation.email, guest.email);
    if (guest.phone && phoneKey(reservation.phone) !== phoneKey(guest.phone)) add('phone', 'Téléphone', reservation.phone, guest.phone);
    if (!same(reservation.platform, 'Booking')) add('platform', 'Canal', reservation.platform, 'Booking');
    if (String(reservation.reservationNumber || '') !== booking.resId) add('reservationNumber', 'N° de réservation', reservation.reservationNumber, booking.resId);
    [['adults', 'Adultes'], ['teens', 'Ados'], ['children', 'Enfants'], ['babies', 'Bébés']].forEach(([key, label]) => {
      if (Number(reservation[key] || 0) !== booking[key]) add(key, label, reservation[key], booking[key]);
    });
    if (booking.arrivalTime && String(reservation.checkInTime || '') !== booking.arrivalTime) {
      add('checkInTime', 'Heure d’arrivée', reservation.checkInTime, booking.arrivalTime);
    }
    [['platformGrossAmount', 'Montant total payé par le client', booking.total],
      ['platformTouristTaxAmount', 'Taxe de séjour retenue', withheldTouristTax(booking, reservation)],
      ['platformPayoutAmount', 'Virement reçu', booking.payout]].forEach(([key, label, value]) => {
      if (!sameAmount(reservation[key], value)) add(key, label, reservation[key], value);
    });
    if (notesWith(reservation.notes, booking) !== (reservation.notes || '')) add('notes', 'Notes', null, booking.requests.join(' / '));
    return out;
  }

  // Rule 27 — a client another reservation also uses says nothing about this fiche: its e-mail may be
  // another guest's, written there by an earlier intake.
  const isShared = (r) => Boolean(r.clientId) && clientShared(r.clientId, r.id);
  const isUntouched = (r) => isEmpty(r.platformGrossAmount) && ((isEmpty(r.email) && isEmpty(r.phone)) || isShared(r));

  // Rule 27 — the guest's own client, found by e-mail or created, never the one the fiche shares. Its
  // fields are refreshed only while no other reservation uses it.
  function write(booking, reservation) {
    const { client, reservation: patch } = plan(booking, reservation);
    // The core finds or creates the client in the same transaction as the update: a refused fiche leaves
    // no client behind.
    const result = core.updateReservation(reservation.id, patch, { label: `Rempli depuis l’extranet Booking (réservation ${booking.resId})`, client });
    if (result.status !== 200) {
      return { ok: false, message: (result.body && result.body.error) || `Erreur ${result.status}`, code: result.body && result.body.code };
    }
    if (!clientShared(result.clientId, reservation.id)) core.updateClient(result.clientId, client);
    return { ok: true };
  }

  function refuse(base, message, code) {
    intakes.insert({ ...base, status: 'refused', error: message });
    return { status: 'refused', message, code };
  }

  // The userscript's request (rules 3–4). `base` = { resId, hotelId } as the URL gave them.
  function handlePage({ hotelId, resId, text }) {
    const base = { resId: String(resId || ''), hotelId: String(hotelId || '') };
    const parsed = parseBookingPage(text, { resId });
    if (!parsed.ok) return refuse(base, parsed.message, parsed.code);
    const { booking } = parsed;

    const propertyId = propertyIdFor(hotelId);
    if (propertyId == null) return refuse(base, `Établissement Booking ${hotelId} non relié à un logement`, 'HOTEL_NOT_MAPPED');

    const rows = findReservations({ propertyId, startDate: booking.arrival, endDate: booking.departure });
    if (rows.length === 0) {
      return refuse(base, `Aucune fiche du ${frDate(booking.arrival)} au ${frDate(booking.departure)} : la synchro iCal ne l’a pas encore importée`, 'NO_FICHE');
    }
    if (rows.length > 1) {
      return refuse(base, `Plusieurs fiches Booking du ${frDate(booking.arrival)} au ${frDate(booking.departure)} : à saisir à la main`, 'AMBIGUOUS_FICHE');
    }
    const reservation = getReservation(rows[0].id);
    const withFiche = { ...base, reservationId: reservation.id };
    if (String(reservation.startDate) <= today()) return refuse(withFiche, 'Séjour commencé : fiche à saisir à la main', 'PAST_RESERVATION');

    if (isUntouched(reservation)) {
      const done = write(booking, reservation);
      if (!done.ok) return refuse(withFiche, done.message, done.code || 'UPDATE_REFUSED');
      intakes.insert({ ...withFiche, status: 'applied', parsed: { booking }, guestMessagePending: booking.guestMessagePending });
      const noPhone = booking.guest.phone ? '' : ' (téléphone non communiqué)';
      return { status: 'applied', message: `GuestFlow : fiche ${reservation.id} remplie ✓${noPhone}`, reservationId: reservation.id };
    }

    const diffs = differences(booking, reservation);
    intakes.setGuestMessagePending(reservation.id, booking.guestMessagePending);
    if (diffs.length === 0) {
      intakes.insert({ ...withFiche, status: 'same' });
      return { status: 'same', message: 'GuestFlow : déjà à jour', reservationId: reservation.id };
    }
    intakes.insert({ ...withFiche, status: 'proposed', parsed: { booking, differences: diffs }, guestMessagePending: booking.guestMessagePending });
    return {
      status: 'proposed',
      message: `GuestFlow : fiche déjà remplie, ${diffs.length} champ${diffs.length > 1 ? 's' : ''} diffère${diffs.length > 1 ? 'nt' : ''} — à valider dans GuestFlow`,
      reservationId: reservation.id,
    };
  }

  // « Appliquer » on a proposal: the operator accepted Booking's values for this fiche.
  function applyProposal(intakeId) {
    const intake = intakes.get(intakeId);
    if (!intake || intake.status !== 'proposed' || !intake.parsed) return { status: 'error', error: 'Proposition introuvable' };
    const reservation = intake.reservationId ? getReservation(intake.reservationId) : null;
    if (!reservation || reservation.kind !== 'reservation') return { status: 'error', error: 'Fiche introuvable' };
    const done = write(intake.parsed.booking, reservation);
    if (!done.ok) return { status: 'error', error: done.message };
    intakes.setStatus(intake.id, 'applied');
    return { status: 'applied' };
  }

  const ignoreProposal = (intakeId) => intakes.setStatus(intakeId, 'ignored');
  const hide = (intakeId) => intakes.dismiss(intakeId);

  // What the fiche's banner renders (rules 17–18), ready to display.
  function blockFor(reservationId) {
    const intake = intakes.latestForReservation(reservationId);
    if (!intake) return null;
    const at = new Date(`${String(intake.createdAt).replace(' ', 'T')}Z`);
    return {
      id: intake.id,
      status: intake.status,
      resId: intake.resId,
      appliedLabel: `${pad(at.getDate())}/${pad(at.getMonth() + 1)} à ${pad(at.getHours())}:${pad(at.getMinutes())}`,
      differences: (intake.parsed && intake.parsed.differences) || [],
      guestMessagePending: intake.guestMessagePending,
    };
  }

  return { handlePage, applyProposal, ignoreProposal, hide, blockFor };
}

module.exports = { createIntakeService };
