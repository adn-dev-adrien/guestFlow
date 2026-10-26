/**
 * Airbnb « Réservation confirmée » mail → structured booking (specs/airbnb-mail-intake.md rules 5–8).
 * Pure: reads the plain-text part only, returns `{ ok: true, booking }` or `{ ok: false, error }` with a
 * French reason, never a partial booking.
 */

const MONTHS = { janv: 1, févr: 2, mars: 3, avr: 4, mai: 5, juin: 6, juil: 7, août: 8, sept: 9, oct: 10, nov: 11, déc: 12 };
const WEEKDAYS = { dim: 0, lun: 1, mar: 2, mer: 3, jeu: 4, ven: 5, sam: 6 };
const DATE_RE = /\b(lun|mar|mer|jeu|ven|sam|dim)\.\s+(\d{1,2})\s+(janv|févr|mars|avr|mai|juin|juil|août|sept|oct|nov|déc)\.?/gi;
const AMOUNT_LINE_RE = /^(.+?)\s{2,}(-?\d[\d ]*,\d{2})\s*€\s*$/;

// Rule 8 — the raw mail writes « 4 nuits », « 15,5 % », « 1 154,60 » with non-breaking spaces.
const normalizeSpaces = (s) => String(s || '').replace(/[   ]/g, ' ');
const cents = (amount) => Math.round(Number(String(amount).replace(/ /g, '').replace(',', '.')) * 100);
const euros = (c) => c / 100;
const sentenceCase = (s) => { const low = s.toLocaleLowerCase('fr-FR'); return low.charAt(0).toLocaleUpperCase('fr-FR') + low.slice(1); };
const titleCase = (s) => s.toLocaleLowerCase('fr-FR').replace(/(^|[\s'-])(\p{L})/gu, (m, sep, ch) => sep + ch.toLocaleUpperCase('fr-FR'));
const stripQuery = (url) => (url ? url.split('?')[0] : null);

function isBookingMail(subject, text) {
  const t = normalizeSpaces(text).toUpperCase();
  return /^\s*réservation confirmée\s*:/i.test(normalizeSpaces(subject))
    && t.includes('CODE DE CONFIRMATION') && t.includes('VOUS GAGNEZ');
}

const isoOf = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

// Rule 6 — the first date on or after `fromIso` whose weekday is the one printed.
function resolveDate({ weekday, day, month }, fromIso) {
  const startYear = Number(fromIso.slice(0, 4));
  for (const y of [startYear, startYear + 1]) {
    const date = new Date(Date.UTC(y, month - 1, day));
    if (date.getUTCMonth() !== month - 1) continue;
    const iso = isoOf(y, month, day);
    if (iso >= fromIso && date.getUTCDay() === weekday) return iso;
  }
  return null;
}

const nextDay = (iso) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };
const nightsBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

function section(lines, startRe, endRe) {
  const start = lines.findIndex((l) => startRe.test(l));
  if (start < 0) return null;
  const rel = lines.slice(start + 1).findIndex((l) => endRe.test(l));
  return lines.slice(start + 1, rel < 0 ? undefined : start + 1 + rel + 1);
}

const amountLines = (lines) => lines.map((l) => AMOUNT_LINE_RE.exec(l.trim())).filter(Boolean)
  .map((m) => ({ label: m[1].trim(), cents: cents(m[2]) }));

// The guest's free text: between « Sur Airbnb depuis … » and « Envoyer un message à … ». The plain part
// wraps at ~60 columns, so lines are joined; a blank line keeps a paragraph break.
function guestMessage(lines) {
  const from = lines.findIndex((l) => /^Sur Airbnb depuis/i.test(l.trim()));
  if (from < 0) return '';
  const to = lines.findIndex((l, i) => i > from && /^Envoyer un message à/i.test(l.trim()));
  const body = lines.slice(from + 1, to < 0 ? from + 1 : to).map((l) => l.trim());
  return body.join('\n').split(/\n{2,}/).map((p) => p.replace(/\n/g, ' ').replace(/\s+([!?;:])/g, ' $1').trim())
    .filter(Boolean).join('\n');
}

function parseAirbnbMail({ subject, text, sentAt }) {
  const plain = normalizeSpaces(text);
  if (!isBookingMail(subject, plain)) return { ok: false, error: 'Ce mail n’est pas une confirmation de réservation Airbnb' };
  const lines = plain.split(/\r?\n/);
  const fail = (error) => ({ ok: false, error });

  const code = (plain.match(/CODE DE CONFIRMATION\s+([A-Z0-9]{6,})/) || [])[1];
  if (!code) return fail('Code de confirmation introuvable');

  const fullName = ((normalizeSpaces(subject).match(/:\s*(.+?)\s+arrive le/i) || [])[1] || '').trim();
  if (!fullName) return fail('Nom du voyageur introuvable');
  const heading = (plain.match(/CONFIRMÉE\s*!\s*(.+?)\s+ARRIVERA/i) || [])[1] || '';
  const firstWords = heading.trim().split(/\s+/).length || 1;
  const words = fullName.split(/\s+/);
  const firstName = titleCase(words.slice(0, firstWords).join(' '));
  const lastName = titleCase(words.slice(firstWords).join(' '));
  if (!lastName) return fail('Nom du voyageur incomplet');

  const listingId = (plain.match(/airbnb\.[a-z.]+\/rooms\/(\d+)/i) || [])[1];
  if (!listingId) return fail('Annonce introuvable');
  const roomsLine = lines.findIndex((l) => /\/rooms\/\d+/.test(l));
  const titleLine = lines.slice(roomsLine + 1).find((l) => l.trim() && !/^\[?https?:/.test(l.trim()));
  const listingTitle = titleLine ? sentenceCase(titleLine.trim()) : '';
  const reservationUrl = stripQuery((plain.match(/https:\/\/www\.airbnb\.[a-z.]+\/hosting\/reservations\/details\/[A-Z0-9]+[^\s\]]*/) || [])[0]);
  const threadUrl = stripQuery((plain.match(/https:\/\/www\.airbnb\.[a-z.]+\/hosting\/thread\/\d+[^\s\]]*/) || [])[0]);

  const afterArrival = plain.slice(Math.max(0, plain.search(/Arrivée/)));
  const dates = [...afterArrival.matchAll(DATE_RE)].slice(0, 2).map((m) => ({
    weekday: WEEKDAYS[m[1].toLowerCase()], day: Number(m[2]), month: MONTHS[m[3].toLowerCase()],
  }));
  if (dates.length < 2) return fail('Dates du séjour introuvables');
  const sentIso = String(sentAt || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sentIso)) return fail('Date du mail inconnue');
  const startDate = resolveDate(dates[0], sentIso);
  const endDate = startDate && resolveDate(dates[1], nextDay(startDate));
  if (!startDate || !endDate) return fail('Aucune date ne correspond aux jours du séjour');
  const times = afterArrival.match(/\b\d{1,2}:\d{2}\b/g) || [];

  const partyLine = (plain.match(/VOYAGEURS\s*\n+\s*(\d[^\n]*)/) || [])[1] || '';
  const count = (re) => Number((partyLine.match(re) || [])[1] || 0);
  const adults = count(/(\d+)\s+adultes?/i);
  if (adults < 1) return fail('Composition du groupe introuvable');
  const children = count(/(\d+)\s+enfants?/i);
  const babies = count(/(\d+)\s+bébés?/i);

  const guestLines = section(lines, /^\s*LE VOYAGEUR A PAYÉ/i, /^\s*TOTAL \(EUR\)/i);
  const hostLines = section(lines, /^\s*VERSEMENT DE L.H[ÔO]TE/i, /^\s*VOUS GAGNEZ/i);
  if (!guestLines || !hostLines) return fail('Détail des montants introuvable');

  const guest = { nights: null, nightly: 0, nightsTotal: 0, cleaning: 0, serviceFee: 0, taxes: 0, other: 0, total: null };
  for (const { label, cents: c } of amountLines(guestLines)) {
    const n = label.match(/^(-?\d[\d ]*,\d{2})\s*€\s*x\s*(\d+)\s*nuits?/i);
    if (n) { guest.nights = Number(n[2]); guest.nightly = cents(n[1]); guest.nightsTotal = c; } else if (/^TOTAL/i.test(label)) guest.total = c;
    else if (/ménage/i.test(label)) guest.cleaning = c;
    else if (/service voyageur/i.test(label)) guest.serviceFee = c;
    else if (/^Taxes/i.test(label)) guest.taxes = c;
    else guest.other += c;
  }
  const host = { taxes: 0, rooms: null, roomNights: null, cleaning: 0, adjustments: 0, fee: null, feePercent: null, payout: null };
  for (const { label, cents: c } of amountLines(hostLines)) {
    const rooms = label.match(/Frais de chambre pour\s+(\d+)\s+nuits?/i);
    const fee = label.match(/Frais de service hôte\s*\(([\d,]+)\s*%\)/i);
    if (rooms) { host.rooms = c; host.roomNights = Number(rooms[1]); } else if (fee) { host.fee = Math.abs(c); host.feePercent = Number(fee[1].replace(',', '.')); } else if (/VOUS GAGNEZ/i.test(label)) host.payout = c;
    else if (/^Taxes/i.test(label)) host.taxes = c;
    else if (/ménage/i.test(label)) host.cleaning = c;
    else host.adjustments += c;
  }
  if (guest.total == null || guest.nights == null || host.rooms == null || host.fee == null || host.payout == null) {
    return fail('Détail des montants incomplet');
  }

  // Rule 7 — both columns to the cent, before anything is written.
  const nights = nightsBetween(startDate, endDate);
  if (guest.nights !== nights || host.roomNights !== nights) return fail('Le nombre de nuits ne correspond pas aux dates');
  if (guest.nightsTotal + guest.cleaning + guest.serviceFee + guest.taxes + guest.other !== guest.total) {
    return fail('Les montants payés par le voyageur ne tombent pas juste');
  }
  const stayBase = host.rooms + host.adjustments + host.cleaning;
  if (stayBase + host.taxes - host.fee !== host.payout) return fail('Les montants du versement ne tombent pas juste');
  if (Math.round((stayBase * Math.round(host.feePercent * 10)) / 1000) !== host.fee) {
    return fail(`Les frais de service ne font pas ${String(host.feePercent).replace('.', ',')} %`);
  }
  if (host.rooms + host.adjustments !== guest.nightsTotal) return fail('Le prix des nuits diffère entre les deux colonnes');

  return {
    ok: true,
    booking: {
      code, firstName, lastName, listingId, listingTitle, reservationUrl, threadUrl,
      startDate, endDate, checkInTime: times[0] || null, checkOutTime: times[1] || null,
      adults, children, babies, message: guestMessage(lines),
      nights, nightlyPrice: euros(guest.nightly), cleaningFee: euros(guest.cleaning),
      guestServiceFee: euros(guest.serviceFee), guestTaxes: euros(guest.taxes), total: euros(guest.total),
      hostTaxes: euros(host.taxes), roomFees: euros(host.rooms), adjustments: euros(host.adjustments),
      hostFee: euros(host.fee), hostFeePercent: host.feePercent, payout: euros(host.payout),
    },
  };
}

module.exports = { parseAirbnbMail, isBookingMail, normalizeSpaces };
