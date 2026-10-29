/**
 * The Gîtes de France « nouvelle réservation » mail → a structured booking (specs/gites-de-france-mail-intake.md
 * rules 4–6, 23). Pure. Field by field: every value is read on the line its label opens (the « picto »
 * alt texts of the HTML version may prefix it), never by a first match across the whole text — the guest
 * types his own name, which comes before the party, the contact and the money lines (rule 23).
 *
 * Returns `{ ok: true, booking }` or `{ ok: false, error }` — never a half-read booking.
 */

const FR_MONEY = '(\\d[\\d  ]*(?:[.,]\\d{1,2})?)';

function flatten(text) {
  return String(text || '').replace(/[  \t\r\n]+/g, ' ').replace(/’/g, "'").trim();
}

const MAX_TEXT = 262144;
const MAX_LINE = 600;
const MAX_NAME = 80;
const MAX_NIGHTS = 120;
const PREFIX = '(?:picto\\s+\\S+\\s+)*';

// Real calendar dates only (31/02 is not one), the departure after the arrival, a stay of a sane length.
function validStay(startIso, endIso) {
  const valid = (iso) => { const d = new Date(`${iso}T00:00:00Z`); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso; };
  if (!valid(startIso) || !valid(endIso) || endIso <= startIso) return false;
  return (Date.parse(`${endIso}T00:00:00Z`) - Date.parse(`${startIso}T00:00:00Z`)) / 86400000 <= MAX_NIGHTS;
}

function money(raw) {
  return Math.round(Number(String(raw).replace(/[  ]/g, '').replace(',', '.')) * 100) / 100;
}

function isoDate(ddmmyyyy) {
  const [d, m, y] = ddmmyyyy.split('/');
  return `${y}-${m}-${d}`;
}

function hhmm(h, m) {
  return `${String(h).padStart(2, '0')}:${m}`;
}

function titleCase(s) {
  return String(s).toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_, sep, ch) => sep + ch.toUpperCase());
}

// « ROUX Lucie » → last name in capitals first, then the first name. « DE LA TOUR Marie-Anne » too.
function splitName(full) {
  const words = full.trim().split(/\s+/);
  const isUpper = (w) => w === w.toUpperCase() && /\p{L}/u.test(w);
  let i = 0;
  while (i < words.length - 1 && isUpper(words[i])) i += 1;
  if (i === 0) return { lastName: titleCase(words.slice(-1).join(' ')), firstName: titleCase(words.slice(0, -1).join(' ')) };
  return { lastName: titleCase(words.slice(0, i).join(' ')), firstName: titleCase(words.slice(i).join(' ')) };
}

function frenchPhone(raw) {
  let digits = String(raw).replace(/[^\d+]/g, '');
  if (digits.startsWith('+33')) digits = `0${digits.slice(3)}`;
  if (digits.startsWith('0033')) digits = `0${digits.slice(4)}`;
  return /^0\d{9}$/.test(digits) ? digits.replace(/(\d{2})(?=\d)/g, '$1 ') : String(raw).trim();
}

function parseGitesDeFranceMail(text) {
  const fail = (error) => ({ ok: false, error });
  if (String(text || '').length > MAX_TEXT) return fail('Mail trop volumineux');
  const lines = String(text || '').replace(/’/g, "'").split(/\r?\n/)
    .map((l) => l.replace(/[  \t]+/g, ' ').trim()).filter((l) => l && l.length <= MAX_LINE);
  const startsWith = (re) => lines.map((l, i) => (re.test(l) ? i : -1)).filter((i) => i >= 0);
  const find = (re) => { const i = lines.findIndex((l) => re.test(l)); return i < 0 ? null : lines[i].match(re); };

  if (!/nouvelle réservation/i.test(lines.join(' '))) return fail('Ce mail n’est pas une nouvelle réservation');

  const LABELS = [`^${PREFIX}Réservation effectuée par`, '^Détail des suppléments', '^Détail des crédits', '^Montant net de la location',
    '^Total des options', '^Total net\\s*:', '^Réservation n°', `^${PREFIX}du\\s+\\d\\d/\\d\\d/\\d{4}\\s+à partir de`, `^${PREFIX}au\\s+\\d\\d/\\d\\d/\\d{4}\\s+avant`];
  if (LABELS.some((label) => startsWith(new RegExp(label, 'i')).length > 1)) return fail('Mail ambigu : un libellé apparaît plusieurs fois');

  const state = find(/^État\s*:\s*(.+?)(?:\s+Gîte\s+\d.*)?$/i);
  if (state && !/confirm/i.test(state[1])) return fail(`Réservation dans l’état « ${state[1].trim()} »`);

  const dossier = find(/^Réservation n°\s*(\d+)(?:-(\d{4}))?/i);
  if (!dossier) return fail('Numéro de dossier introuvable');
  const gite = find(/^Gîte\s+(\d{3,})/i) || find(/^Une nouvelle réservation.*logement\s+(\d{3,})/i);
  if (!gite) return fail('Numéro de gîte introuvable');

  const arrival = find(new RegExp(`^${PREFIX}du\\s+(\\d\\d/\\d\\d/\\d{4})\\s+à partir de\\s+(\\d{1,2})\\s*h\\s*(\\d\\d)`, 'i'));
  const departure = find(new RegExp(`^${PREFIX}au\\s+(\\d\\d/\\d\\d/\\d{4})\\s+avant\\s+(\\d{1,2})\\s*h\\s*(\\d\\d)`, 'i'));
  if (!arrival || !departure) return fail('Dates du séjour introuvables');
  const startDate = isoDate(arrival[1]);
  const endDate = isoDate(departure[1]);
  if (!validStay(startDate, endDate)) return fail('Dates du séjour invalides');

  const guestAt = lines.findIndex((l) => new RegExp(`^${PREFIX}Réservation effectuée par\\s*:`, 'i').test(l));
  if (guestAt < 0) return fail('Nom du client introuvable');
  const name = lines[guestAt].replace(new RegExp(`^${PREFIX}Réservation effectuée par\\s*:\\s*`, 'i'), '').trim();
  if (!name || name.length > MAX_NAME || /[\d€@:<>]/.test(name)) return fail('Nom du client introuvable');

  // The party, the contact and the money come after the name, each on a line of its own.
  const rest = lines.slice(guestAt + 1);
  const partyLine = (rest.find((l) => new RegExp(`^${PREFIX}\\d+\\s+adultes?\\b`, 'i').test(l)) || '');
  const count = (re) => { const m = partyLine.match(re); return m ? Number(m[1]) : 0; };
  const adults = count(/(\d+)\s+adultes?/i);
  if (adults < 1) return fail('Nombre d’adultes introuvable');
  const detailAt = rest.findIndex((l) => /^Détail des (?:suppléments|crédits)/i.test(l));
  const contact = detailAt < 0 ? rest : rest.slice(0, detailAt);
  const email = (contact.map((l) => l.match(new RegExp(`^${PREFIX}([\\w.+-]+@[\\w-]+(?:\\.[\\w-]+)+)$`))).find(Boolean) || [])[1] || '';
  const phone = (contact.map((l) => l.match(new RegExp(`^${PREFIX}((?:\\+33|0033|0)\\s*[1-9](?:[\\s.]*\\d{2}){4})$`))).find(Boolean) || [])[1] || '';

  const supplementsAt = lines.findIndex((l) => /^Détail des suppléments/i.test(l));
  const creditsAt = lines.findIndex((l) => /^Détail des crédits/i.test(l));
  if (creditsAt < 0) return fail('Détail des crédits introuvable');
  const suppSection = supplementsAt >= 0 && supplementsAt < creditsAt ? lines.slice(supplementsAt + 1, creditsAt).join(' ') : '';
  const supplements = [];
  // Linear: the section is cut after each « € » and every chunk is short, so no pattern backtracks across the mail.
  const suppRe = new RegExp(`^\\s*([^()€]{1,200}?)\\s*\\(\\s*(\\d+)\\s*\\)\\s*x\\s*(\\d+)\\s+${FR_MONEY}\\s*$`, 'i');
  for (const chunk of suppSection.split('€')) {
    if (chunk.length > 300) continue;
    const m = suppRe.exec(chunk);
    if (m) supplements.push({ label: m[1].trim(), quantity: Number(m[2]), times: Number(m[3]), amount: money(m[4]) });
  }

  const credits = lines.slice(creditsAt + 1);
  const amountAfter = (labelRe) => {
    const i = credits.findIndex((l) => labelRe.test(l));
    if (i < 0) return null;
    const same = credits[i].replace(labelRe, '');
    const m = new RegExp(`^\\s*${FR_MONEY}\\s*€`).exec(same) || new RegExp(`^\\s*${FR_MONEY}\\s*€`).exec(credits[i + 1] || '');
    return m;
  };
  const netRent = amountAfter(/^Montant net de la location/i);
  const optionsTotal = amountAfter(/^Total des options/i);
  const totalNet = amountAfter(/^Total net\s*:/i);
  const taxLine = credits.map((l) => l.match(new RegExp(`taxe de séjour d'un montant de\\s*${FR_MONEY}\\s*€`, 'i'))).find(Boolean);
  if (!netRent) return fail('Montant net de la location introuvable');
  if (!totalNet) return fail('Total net introuvable');
  if (!taxLine) return fail('Taxe de séjour introuvable');

  const booking = {
    dossierNumber: dossier[1],
    giteNumber: gite[1],
    startDate,
    checkInTime: hhmm(arrival[2], arrival[3]),
    endDate,
    checkOutTime: hhmm(departure[2], departure[3]),
    ...splitName(name),
    email,
    phone: phone ? frenchPhone(phone) : '',
    adults,
    children: count(/(\d+)\s+enfants?/i),
    babies: count(/(\d+)\s+bébés?/i),
    supplements,
    netRent: money(netRent[1]),
    optionsTotal: optionsTotal ? money(optionsTotal[1]) : 0,
    totalNet: money(totalNet[1]),
    touristTax: money(taxLine[1]),
  };

  const cents = (n) => Math.round(n * 100);
  if (cents(booking.netRent) + cents(booking.optionsTotal) !== cents(booking.totalNet)) {
    return fail(`Location nette ${booking.netRent} € + options ${booking.optionsTotal} € ≠ total net ${booking.totalNet} €`);
  }
  const suppSum = supplements.reduce((sum, s) => sum + cents(s.amount), 0);
  if (suppSum !== cents(booking.optionsTotal)) {
    return fail(`Suppléments ${suppSum / 100} € ≠ total des options ${booking.optionsTotal} €`);
  }
  return { ok: true, booking };
}

module.exports = { parseGitesDeFranceMail, flatten };
