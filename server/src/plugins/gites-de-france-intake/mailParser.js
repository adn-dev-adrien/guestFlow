/**
 * The Gîtes de France « nouvelle réservation » mail → a structured booking (specs/gites-de-france-mail-intake.md
 * rules 4–6). Pure. Works on the text of the mail, whatever its layout: the text is flattened to one
 * line first, so line breaks, tabs and the « picto » alt texts of the HTML version do not matter.
 *
 * Returns `{ ok: true, booking }` or `{ ok: false, error }` — never a half-read booking.
 */

const FR_MONEY = '(\\d[\\d  ]*(?:[.,]\\d{1,2})?)';

function flatten(text) {
  return String(text || '').replace(/[  \t\r\n]+/g, ' ').replace(/’/g, "'").trim();
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
  const t = flatten(text);
  const fail = (error) => ({ ok: false, error });
  const pick = (re) => t.match(re);

  if (!/nouvelle réservation/i.test(t)) return fail('Ce mail n’est pas une nouvelle réservation');
  const state = pick(/État\s*:\s*([^:]+?)\s+Gîte\s+\d/i);
  if (state && !/confirm/i.test(state[1])) return fail(`Réservation dans l’état « ${state[1].trim()} »`);

  const dossier = pick(/Réservation n°\s*(\d+)(?:-(\d{4}))?/i);
  if (!dossier) return fail('Numéro de dossier introuvable');
  const gite = pick(/Gîte\s+(\d{3,})/i) || pick(/logement\s+(\d{3,})/i);
  if (!gite) return fail('Numéro de gîte introuvable');

  const arrival = pick(/du\s+(\d\d\/\d\d\/\d{4})\s+à partir de\s+(\d{1,2})\s*h\s*(\d\d)/i);
  const departure = pick(/au\s+(\d\d\/\d\d\/\d{4})\s+avant\s+(\d{1,2})\s*h\s*(\d\d)/i);
  if (!arrival || !departure) return fail('Dates du séjour introuvables');

  const guest = pick(/effectuée par\s*:\s*(.+?)\s+(?:picto\s+\S+\s+)?\d+\s+adultes?/i);
  if (!guest) return fail('Nom du client introuvable');
  const afterGuest = t.slice(t.indexOf(guest[0]));
  const count = (re) => { const m = afterGuest.match(re); return m ? Number(m[1]) : 0; };
  const adults = count(/(\d+)\s+adultes?/i);
  if (adults < 1) return fail('Nombre d’adultes introuvable');

  const email = afterGuest.match(/([\w.+-]+@[\w-]+(?:\.[\w-]+)+)/);
  const phone = afterGuest.match(/((?:\+33|0033|0)\s*[1-9](?:[\s.]*\d{2}){4})/);

  const suppSection = (t.match(/Détail des suppléments(.*?)Détail des crédits/i) || [])[1] || '';
  const supplements = [];
  const suppRe = new RegExp(`([^()€]+?)\\s*\\(\\s*(\\d+)\\s*\\)\\s*x\\s*(\\d+)\\s+${FR_MONEY}\\s*€`, 'gi');
  for (let m = suppRe.exec(suppSection); m; m = suppRe.exec(suppSection)) {
    supplements.push({ label: m[1].trim(), quantity: Number(m[2]), times: Number(m[3]), amount: money(m[4]) });
  }

  const netRent = pick(new RegExp(`Montant net de la location\\s*${FR_MONEY}\\s*€`, 'i'));
  const optionsTotal = pick(new RegExp(`Total des options\\s*${FR_MONEY}\\s*€`, 'i'));
  const totalNet = pick(new RegExp(`Total net\\s*:\\s*${FR_MONEY}\\s*€`, 'i'));
  const tax = pick(new RegExp(`taxe de séjour d'un montant de\\s*${FR_MONEY}\\s*€`, 'i'));
  if (!netRent) return fail('Montant net de la location introuvable');
  if (!totalNet) return fail('Total net introuvable');
  if (!tax) return fail('Taxe de séjour introuvable');

  const booking = {
    dossierNumber: dossier[1],
    giteNumber: gite[1],
    startDate: isoDate(arrival[1]),
    checkInTime: hhmm(arrival[2], arrival[3]),
    endDate: isoDate(departure[1]),
    checkOutTime: hhmm(departure[2], departure[3]),
    ...splitName(guest[1]),
    email: email ? email[1] : '',
    phone: phone ? frenchPhone(phone[1]) : '',
    adults,
    children: count(/(\d+)\s+enfants?/i),
    babies: count(/(\d+)\s+bébés?/i),
    supplements,
    netRent: money(netRent[1]),
    optionsTotal: optionsTotal ? money(optionsTotal[1]) : 0,
    totalNet: money(totalNet[1]),
    touristTax: money(tax[1]),
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
