/**
 * The text of a Booking extranet reservation page → a structured booking, or a typed refusal
 * (specs/booking-extranet-intake.md rules 8–11). Pure: no clock, no I/O.
 *
 * The page is read by label then next non-empty line, after replacing the characters Booking sprinkles in
 * (no-break spaces before every « : », zero-width spaces between the children's ages). The consistency
 * gate (rule 9) refuses the page rather than guess: a label Booking renamed ends as « Taxe de séjour
 * introuvable », never as a wrong amount.
 */

const MONTHS = { jan: 1, fev: 2, mar: 3, avr: 4, mai: 5, juin: 6, juil: 7, aou: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

const round2 = (n) => Math.round(n * 100) / 100;
const strip = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const fail = (code, message) => ({ ok: false, code, message });
const eur = (n) => `${n.toFixed(2).replace('.', ',')} €`;

function normalise(text) {
  return String(text || '')
    .replace(/[  ]/g, ' ')
    .replace(/​/g, '')
    .replace(/[’‘]/g, "'")
    .replace(/\r/g, '');
}

function toLines(text) {
  return normalise(text).split('\n').map((l) => l.trim());
}

// The next non-empty line after the first line that IS the label (an optional « : » closes it).
function valueAfter(lines, label) {
  const re = new RegExp(`^${label}\\s*:?$`, 'i');
  const at = lines.findIndex((l) => re.test(l));
  if (at < 0) return null;
  for (let i = at + 1; i < lines.length; i += 1) if (lines[i]) return lines[i];
  return null;
}

// « € 1 283,34 », « 1.283,34 € », « € 721,82 » → 1283.34
function parseAmount(raw) {
  if (raw == null) return null;
  const m = String(raw).match(/-?\d[\d .]*(?:,\d{1,2})?|-?\d+\.\d{1,2}(?!\d)/);
  if (!m) return null;
  let s = m[0].replace(/ /g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? round2(n) : null;
}

// « ven. 6 nov. 2026 » → 2026-11-06
function parseDate(raw) {
  if (!raw) return null;
  const m = strip(raw).match(/(\d{1,2})\s+([a-z]+)\.?\s+(\d{4})/);
  if (!m) return null;
  const key = Object.keys(MONTHS).find((k) => m[2].startsWith(k));
  if (!key) return null;
  return `${m[3]}-${String(MONTHS[key]).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

const dayDiff = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

// « 4 adultes et 6 enfants (3, 6, 8, 10, 15 et 15 ans) » → { adults, children, ages }
function parseParty(raw) {
  if (!raw) return null;
  const adults = Number((raw.match(/(\d+)\s+adulte/i) || [])[1]);
  const children = Number((raw.match(/(\d+)\s+enfant/i) || [])[1] || 0);
  if (!Number.isFinite(adults) || adults < 1) return null;
  const inParens = (raw.match(/\(([^)]*)\)/) || [])[1] || '';
  const ages = (inParens.match(/\d+/g) || []).map(Number);
  return { adults, children, ages };
}

// Booking's « Prénom Nom »; the line may end with « Identité vérifiée ».
function splitName(raw) {
  const clean = String(raw || '').replace(/identité vérifiée/i, '').replace(/\s+/g, ' ').trim();
  const [first, ...rest] = clean.split(' ');
  return { firstName: first || '', lastName: rest.join(' ') };
}

// The guest's contact block: name, then country code, relay e-mail and — once revealed — a phone.
function readGuest(lines) {
  const at = lines.findIndex((l) => /^Nom du client\s*:?$/i.test(l));
  if (at < 0) return null;
  let name = '';
  let country = '';
  let email = '';
  let phone = '';
  for (let i = at + 1, seen = 0; i < lines.length && seen < 14; i += 1) {
    const line = lines[i];
    if (!line) continue;
    seen += 1;
    if (/^Langue préférée/i.test(line)) break;
    if (!name) { name = line; continue; }
    if (!country && /^[a-z]{2}$/i.test(line)) { country = line.toLowerCase(); continue; }
    if (!email && /^\S+@\S+\.\S+$/.test(line)) { email = line.toLowerCase(); continue; }
    // Rule 28 — Booking prints the revealed number on its own line or at the end of « Un simple appel
    // suffit : … ».
    const number = !phone && line.match(/(?:^|\s)(\+\d[\d ]{7,}\d)$/);
    if (number) phone = number[1].replace(/ /g, '');
  }
  return { ...splitName(name), country, email, phone };
}

// « Entre 20:00 et 21:00 » → « 20:00 »
function arrivalTime(raw) {
  const m = String(raw || '').match(/(\d{1,2})[:h](\d{2})/);
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null;
}

// Only what the guest wrote or asked for, verbatim: the « Informations importantes » note and the
// « Demandes des clients » lines other than the arrival time (kept in `arrivalTime`).
function readRequests(lines) {
  const out = [];
  const note = lines.findIndex((l) => /^Informations importantes sur ce client$/i.test(l));
  if (note >= 0) {
    const next = lines.slice(note + 1).find(Boolean);
    if (next && !/^Heure d'arrivée/i.test(next)) out.push(next);
  }
  const head = lines.findIndex((l) => /^Demandes des clients\b/i.test(l));
  if (head >= 0) {
    for (let i = head + 1; i < lines.length; i += 1) {
      const line = lines[i];
      if (!line) continue;
      if (/^(Répondre|Conversation avec le client)/i.test(line)) break;
      if (/^Demande relative à l'arrivée/i.test(line) || /^(Confirmé|Refusé)/i.test(line)) continue;
      if (/^Demande[^:]*:/i.test(line)) out.push(line);
    }
  }
  return out;
}

// The last mark of the conversation decides: « Répondre » ends a guest message, « Envoyé » one of ours.
function guestMessagePending(lines) {
  const at = lines.findIndex((l) => /^Conversation avec le client$/i.test(l));
  if (at < 0) return false;
  let last = null;
  let noReplyNeeded = false;
  for (let i = at + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^(Protégez la sécurité|En savoir plus)/i.test(line)) break;
    if (/^Envoyé$/i.test(line)) { last = 'host'; noReplyNeeded = false; }
    else if (/^Répondre$/i.test(line)) last = 'guest';
    else if (/^Aucune réponse requise$/i.test(line)) noReplyNeeded = true;
  }
  return last === 'guest' && !noReplyNeeded;
}

function findAmount(lines, labelRe) {
  const line = lines.find((l) => labelRe.test(l));
  if (!line) return null;
  const all = [...line.matchAll(/€\s*[\d .,]+|[\d .,]+\s*€/g)];
  return all.length ? parseAmount(all[all.length - 1][0]) : null;
}

function parseBookingPage(text, { resId } = {}) {
  const lines = toLines(text);
  if (!lines.some((l) => /^Numéro de réservation\s*:?$/i.test(l))) {
    return fail('NOT_A_RESERVATION_PAGE', 'Page Booking non reconnue : « Numéro de réservation » introuvable');
  }
  if (lines.some((l) => /^Annulée$/i.test(l))) {
    return fail('CANCELLED', 'Réservation annulée sur Booking — l’annulation passe par la synchro iCal');
  }

  const bookingNumber = (valueAfter(lines, 'Numéro de réservation') || '').replace(/\D/g, '');
  const arrival = parseDate(valueAfter(lines, "Date d'arrivée"));
  const departure = parseDate(valueAfter(lines, 'Date de départ'));
  if (!arrival || !departure) return fail('DATES_NOT_FOUND', 'Dates d’arrivée ou de départ introuvables');
  const nights = Number((valueAfter(lines, 'Durée de séjour') || '').match(/\d+/));
  if (nights !== dayDiff(arrival, departure)) {
    return fail('NIGHTS_MISMATCH', `Durée de séjour (${nights || '?'} nuits) ≠ dates (${dayDiff(arrival, departure)} nuits)`);
  }
  if (resId != null && String(resId) !== bookingNumber) {
    return fail('RESERVATION_MISMATCH', `Numéro de réservation de la page (${bookingNumber || '?'}) ≠ adresse (${resId})`);
  }

  const rooms = Number((valueAfter(lines, "Nombre d'hébergements") || '1').match(/\d+/));
  if (rooms > 1) return fail('MULTIPLE_ROOMS', 'Plusieurs hébergements dans une réservation : fiche à saisir à la main');

  const party = parseParty(valueAfter(lines, 'Nombre de personnes'));
  if (!party) return fail('PARTY_NOT_FOUND', 'Nombre de personnes introuvable');
  if (party.ages.length !== party.children) {
    return fail('AGES_MISSING', `${party.children} enfant(s) mais ${party.ages.length} âge(s) : fiche à saisir à la main`);
  }

  const total = parseAmount(valueAfter(lines, 'Montant total'));
  const commissionable = parseAmount(valueAfter(lines, 'Montant soumis à commission'));
  const fees = parseAmount(valueAfter(lines, 'Commission et frais'));
  const subtotal = findAmount(lines, /^Sous-total\b/i);
  const touristTax = findAmount(lines, /^Taxe de séjour\b/i);
  const missing = [['Montant total', total], ['Montant soumis à commission', commissionable],
    ['Commission et frais', fees], ['Sous-total', subtotal], ['Taxe de séjour', touristTax]].find(([, v]) => v == null);
  if (missing) return fail('AMOUNT_NOT_FOUND', `${missing[0]} introuvable`);
  if (Math.abs(subtotal + touristTax - total) > 0.011) {
    return fail('TOTAL_MISMATCH', `Montants incohérents : Sous-total ${eur(subtotal)} + taxe ${eur(touristTax)} ≠ total ${eur(total)}`);
  }
  if (Math.abs(subtotal - commissionable) > 0.011) {
    return fail('COMMISSIONABLE_MISMATCH', `Montants incohérents : Sous-total ${eur(subtotal)} ≠ montant soumis à commission ${eur(commissionable)}`);
  }

  const guest = readGuest(lines);
  if (!guest || !guest.firstName) return fail('GUEST_NOT_FOUND', 'Nom du client introuvable');

  const language = valueAfter(lines, 'Langue préférée') || '';
  return {
    ok: true,
    booking: {
      resId: bookingNumber,
      arrival,
      departure,
      nights,
      adults: party.adults,
      // GuestFlow's bands (rule 10): Ados 12–17, Enfants 2–11, Bébés 0–1.
      teens: party.ages.filter((a) => a >= 12).length,
      children: party.ages.filter((a) => a >= 2 && a < 12).length,
      babies: party.ages.filter((a) => a < 2).length,
      guest,
      emailLanguage: /^fran/i.test(strip(language)) ? 'fr' : 'en',
      total,
      commissionable,
      fees,
      subtotal,
      touristTax,
      payout: round2(total - fees),
      arrivalTime: arrivalTime(valueAfter(lines, "Heure d'arrivée approximative")),
      requests: readRequests(lines),
      guestMessagePending: guestMessagePending(lines),
    },
  };
}

module.exports = { parseBookingPage, parseAmount, parseDate, normalise };
