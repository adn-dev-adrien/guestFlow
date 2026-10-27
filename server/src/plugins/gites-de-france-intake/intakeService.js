/**
 * The intake pass and the operator's actions on an intake (specs/gites-de-france-mail-intake.md §3).
 *
 *   read the mailbox → parse each new mail → match it to the iCal fiche → fill the fiche (untouched
 *   placeholder) or propose (fiche already edited) → wait for the rent when two rents fit the net.
 *
 * Every write to a reservation goes through `core.updateReservation` — the fiche's own save path.
 * Nothing here sends an e-mail.
 */

const { parseGitesDeFranceMail } = require('./mailParser');
const { rentCandidates } = require('./rentFromNet');

const isGitesDeFrance = (platform) => /gites?defrance/.test(String(platform || '').normalize('NFD')
  .replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, ''));
const isCleaning = (o) => o.autoOptionType === 'cleaning' || /ménage/i.test(String(o.title || ''));
const round2 = (n) => Math.round(n * 100) / 100;
const frDate = (iso) => { const d = new Date(iso); return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`; };

const localDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function createIntakeService(deps) {
  const { intakes, settings, readMails, findReservations, commissionPercent, propertyOptions, getReservation, core, now = () => new Date() } = deps;
  // The accommodations' day: the process runs in their time zone (utils/localDate.js).
  const today = deps.today || (() => localDay(now()));

  function propertyIdsForGite(giteNumber) {
    return Object.entries(settings.giteNumbers())
      .filter(([, gite]) => String(gite).trim() === String(giteNumber))
      .map(([propertyId]) => Number(propertyId));
  }

  // Rule 9 — one reservation: Gîtes de France, the gîte's property, same dates, not cancelled. A gîte no
  // property is tied to yet waits (`pending`, its reason kept) until the operator maps it (rule 18).
  function match(booking) {
    const propertyIds = propertyIdsForGite(booking.giteNumber);
    if (propertyIds.length === 0) return { reservation: null, unmapped: `Aucun logement n’est relié au gîte n°${booking.giteNumber}` };
    const rows = findReservations({ propertyIds, startDate: booking.startDate, endDate: booking.endDate })
      .filter((r) => r.kind === 'reservation' && isGitesDeFrance(r.platform));
    if (rows.length > 1) return { error: 'Plusieurs fiches Gîtes de France sur ces dates' };
    return { reservation: rows[0] || null };
  }

  // Rule 10 — the iCal placeholder nobody has saved yet: a manual save locks the iCal sync.
  function isUntouched(r) {
    return r.sourceType === 'ical' && Number(r.icalSyncLocked || 0) !== 1
      && (r.platformGrossAmount == null || r.platformGrossAmount === '');
  }

  function candidatesFor(booking, reservation) {
    return rentCandidates(booking.netRent, commissionPercent(reservation.platform));
  }

  function paymentPatch(booking, rent) {
    return {
      platformGrossAmount: round2(rent + booking.optionsTotal + booking.touristTax),
      platformTouristTaxAmount: booking.touristTax,
      platformPayoutAmount: booking.totalNet,
      platformCommissionAmount: round2(rent - booking.netRent),
    };
  }

  // The fiche as the operator fills it by hand (skill reference gites-de-france.md): guest, party,
  // booking number, the centrale's supplements paid to the platform (« Forcer en complément » off).
  function stayPatch(booking, reservation) {
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
    const asCustomLines = [];

    booking.supplements.forEach((s, i) => {
      if (cleaning && /ménage/i.test(s.label) && Number(cleaning.price) === s.amount) {
        const existing = options.find((o) => Number(o.optionId) === Number(cleaning.id));
        if (existing) Object.assign(existing, { quantity: 1, inComplement: 0 });
        else options.push({ optionId: cleaning.id, quantity: 1, inComplement: 0 });
        offered = offered.filter((id) => id !== Number(cleaning.id));
      } else {
        customOptions.push({ customKey: `gdf_${booking.dossierNumber}_${i + 1}`, description: s.label, amount: s.amount, offered: false, inComplement: 0 });
        asCustomLines.push(s.label);
      }
    });

    const beds = core.suggestBeds(reservation.propertyId, { adults: booking.adults, children: booking.children, teens: 0 });

    return {
      // Created by the core in the same transaction as the update: a refused fiche leaves no client behind.
      client: {
        firstName: booking.firstName, lastName: booking.lastName, email: booking.email, phone: booking.phone, emailLanguage: 'fr',
      },
      patch: {
        reservationNumber: booking.dossierNumber,
        checkInTime: booking.checkInTime,
        checkOutTime: booking.checkOutTime,
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
      },
      asCustomLines,
    };
  }

  function apply(intake, reservation, { rent } = {}) {
    const booking = intake.parsed;
    const candidates = candidatesFor(booking, reservation);
    if (candidates.length === 0) {
      intakes.setStatus(intake.id, { status: 'error', reservationId: reservation.id,
        error: `Aucun loyer ne donne ${booking.netRent} € net avec la commission de la plateforme : vérifier son taux` });
      return { status: 'error' };
    }
    const chosen = rent != null ? Number(rent) : (candidates.length === 1 ? candidates[0] : null);
    if (chosen != null && !candidates.includes(chosen)) return { status: 'error', error: 'Loyer hors des valeurs possibles' };
    // The core refuses a started stay (PAST_RESERVATION); asking first keeps stayPatch from creating
    // a client record that no fiche would ever point to.
    if (String(booking.startDate) <= today()) {
      const error = 'Séjour commencé : fiche à saisir à la main';
      intakes.setStatus(intake.id, { status: 'error', reservationId: reservation.id, error });
      return { status: 'error', error };
    }

    const { patch, client } = stayPatch(booking, reservation);
    const full = chosen != null ? { ...patch, ...paymentPatch(booking, chosen) } : patch;
    const result = core.updateReservation(reservation.id, full, { label: `Mail Gîtes de France du ${frDate(intake.receivedAt)}`, client });
    if (result.status !== 200) {
      intakes.setStatus(intake.id, { status: 'error', reservationId: reservation.id, error: (result.body && result.body.error) || `Erreur ${result.status}` });
      return { status: 'error', error: result.body && result.body.error };
    }
    const status = chosen != null ? 'applied' : 'needs_rent';
    intakes.setStatus(intake.id, { status, reservationId: reservation.id, applied: true });
    return { status };
  }

  // The rent chosen on the banner: only the payment block moves, whatever the fiche became since.
  function chooseRent(intake, rent) {
    const reservation = getReservation(intake.reservationId);
    if (!reservation) return { status: 'error', error: 'Réservation introuvable' };
    const candidates = candidatesFor(intake.parsed, reservation);
    if (!candidates.includes(Number(rent))) return { status: 'error', error: 'Loyer hors des valeurs possibles' };
    const result = core.updateReservation(reservation.id, paymentPatch(intake.parsed, Number(rent)), { label: `Loyer Gîtes de France : ${rent} €` });
    if (result.status !== 200) return { status: 'error', error: (result.body && result.body.error) || `Erreur ${result.status}` };
    intakes.setStatus(intake.id, { status: 'applied', applied: true });
    return { status: 'applied' };
  }

  function process(intake) {
    if (intakes.dossierAlreadyHandled(intake.dossierNumber, intake.id)) {
      intakes.setStatus(intake.id, { status: 'ignored', error: 'Dossier déjà traité par un mail précédent' });
      return 'ignored';
    }
    const m = match(intake.parsed);
    if (m.error) { intakes.setStatus(intake.id, { status: 'error', error: m.error }); return 'error'; }
    if (!m.reservation) {
      const reason = m.unmapped || null;
      if ((intake.error || null) !== reason) intakes.setStatus(intake.id, { status: 'pending', error: reason });
      return 'pending';
    }
    if (!settings.autoApply() || !isUntouched(m.reservation)) {
      intakes.setStatus(intake.id, { status: 'proposed', reservationId: m.reservation.id });
      return 'proposed';
    }
    return apply(intake, m.reservation).status;
  }

  async function runPass() {
    const mailbox = settings.mailbox();
    if (!mailbox.host || !mailbox.user || !mailbox.password) return { skipped: 'Boîte mail non configurée' };
    // Installed with every plugin on an existing base: nothing is read until a property is tied to a gîte.
    if (Object.values(settings.giteNumbers()).every((g) => !String(g || '').trim())) {
      return { skipped: 'Aucun logement relié à un numéro de gîte' };
    }
    const mails = await readMails({ ...mailbox, sender: settings.sender() });
    let read = 0;
    for (const mail of mails) {
      if (intakes.has(mail.messageId)) continue;
      read += 1;
      const parsed = parseGitesDeFranceMail(mail.text);
      if (!parsed.ok) {
        // Another kind of mail from the centrale (invoice, newsletter) is not an intake at all.
        if (!/nouvelle réservation/i.test(`${mail.subject || ''} ${mail.text}`)) continue;
        intakes.insert({ messageId: mail.messageId, receivedAt: mail.receivedAt, status: 'error', error: parsed.error });
        continue;
      }
      intakes.insert({ messageId: mail.messageId, receivedAt: mail.receivedAt, dossierNumber: parsed.booking.dossierNumber, parsed: parsed.booking, status: 'pending' });
    }
    const outcome = {};
    for (const intake of intakes.listOpen()) {
      // One intake that throws is recorded and left behind: it stays `pending` otherwise, first in
      // listOpen, and stops every later pass before the intakes behind it.
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

  // What the fiche's banner renders (rule 12) — ready to display, nothing to compute client-side.
  function blockFor(reservationId) {
    const intake = intakes.latestForReservation(reservationId);
    if (!intake) return null;
    const booking = intake.parsed || {};
    const reservation = getReservation(reservationId);
    const rents = reservation && booking.netRent != null ? candidatesFor(booking, reservation) : [];
    const catalogue = reservation ? propertyOptions(reservation.propertyId) : [];
    const cleaning = catalogue.find(isCleaning);
    return {
      id: intake.id,
      status: intake.status,
      error: intake.error,
      receivedAt: intake.receivedAt,
      receivedLabel: `${frDate(intake.receivedAt)} à ${new Date(intake.receivedAt).toTimeString().slice(0, 5)}`,
      dossierNumber: intake.dossierNumber,
      netRent: booking.netRent,
      rentCandidates: rents.map((rent) => ({ rent, commission: round2(rent - booking.netRent) })),
      customLines: (booking.supplements || [])
        .filter((s) => !(cleaning && /ménage/i.test(s.label) && Number(cleaning.price) === s.amount))
        .map((s) => ({ label: s.label, amount: s.amount })),
      iteaUrl: intake.dossierNumber ? `https://prop.itea.fr/v5/liste_resas.php?goto=${String(booking.startDate || '').slice(0, 4)}_${intake.dossierNumber}_centrale_${booking.giteNumber}` : null,
    };
  }

  function applyFromBanner(intakeId, { rent } = {}) {
    const intake = intakes.get(intakeId);
    if (!intake || !intake.parsed) return { status: 'error', error: 'Saisie introuvable' };
    if (intake.status === 'needs_rent' || (intake.status === 'applied' && rent != null)) return chooseRent(intake, rent);
    const m = match(intake.parsed);
    if (m.error || !m.reservation) return { status: 'error', error: m.error || m.unmapped || 'Fiche introuvable' };
    return apply(intake, m.reservation, { rent });
  }

  return { runPass, blockFor, applyFromBanner, dismiss: (id) => intakes.dismiss(id), attention: () => intakes.listAttention(now().toISOString()), isGitesDeFrance };
}

module.exports = { createIntakeService };
