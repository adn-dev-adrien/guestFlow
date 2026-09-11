/**
 * Enriched stay-line label for a Qonto payment link (specs/qonto-payment-link-reference.md).
 *
 * Pure — everything it needs is passed in. Builds the title `Séjour <Bien> — <Réf> — <Prénom Nom>`
 * (rule 1, order property/reference/name, « — » separator) and a description
 * `[<Type> · ]Séjour du <JJ/MM/AAAA> au <JJ/MM/AAAA> · <N> nuit(s) · réf <Réf>` (rule 2). Missing
 * pieces are dropped cleanly — never an empty « —  — » segment nor a `null`/`undefined` (rule 7). The
 * title is truncated on a word boundary to a safe length (rule 8); the description keeps the full
 * detail. No amount, e-mail or phone in either (rule 9).
 */

const TITLE_MAX = 120;

// « Prénom Nom », trimmed, empty parts dropped.
function guestName(guest = {}) {
  return [guest && guest.firstName, guest && guest.lastName]
    .map((s) => String(s == null ? '' : s).trim())
    .filter(Boolean)
    .join(' ');
}

// Truncate to `max` chars, cutting on the last word boundary when that keeps most of the string.
function truncate(text, max = TITLE_MAX) {
  const s = String(text || '');
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(' ');
  const body = lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut;
  return body.replace(/[\s—·-]+$/, '') + '…';
}

// 'YYYY-MM-DD' → 'DD/MM/YYYY' (null on anything else).
function frDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : null;
}

// Whole nights between two ISO dates (null when not a positive span).
function nightsBetween(startIso, endIso) {
  const a = Date.parse(`${startIso}T00:00:00Z`);
  const b = Date.parse(`${endIso}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return null;
  return Math.round((b - a) / 86400000);
}

const KIND_LABELS = { deposit: 'Acompte', balance: 'Solde', full: null };

/**
 * @param {object} p
 * @param {string} [p.propertyName]  property name (« La Granja »)
 * @param {string} [p.reference]     booking reference (`devisNumber`, « 2026-09-002 »)
 * @param {object} [p.guest]         { firstName, lastName }
 * @param {string} [p.startDate]     ISO 'YYYY-MM-DD'
 * @param {string} [p.endDate]       ISO 'YYYY-MM-DD'
 * @param {string} [p.kind]          'deposit' | 'balance' | 'full' — noted in the description
 * @returns {{ title: string, description: (string|undefined) }}
 */
function buildStayLineLabel({ propertyName, reference, guest, startDate, endDate, kind } = {}) {
  const prop = String(propertyName == null ? '' : propertyName).trim();
  const ref = String(reference == null ? '' : reference).trim();
  const name = guestName(guest);

  const titleSegments = [`Séjour${prop ? ` ${prop}` : ''}`, ref || null, name || null].filter(Boolean);
  const title = truncate(titleSegments.join(' — '), TITLE_MAX);

  const d1 = frDate(startDate);
  const d2 = frDate(endDate);
  const nights = nightsBetween(startDate, endDate);
  const descSegments = [];
  if (KIND_LABELS[kind]) descSegments.push(KIND_LABELS[kind]);
  if (d1 && d2) descSegments.push(`Séjour du ${d1} au ${d2}`);
  if (nights) descSegments.push(`${nights} nuit${nights > 1 ? 's' : ''}`);
  if (ref) descSegments.push(`réf ${ref}`);
  const description = descSegments.length ? descSegments.join(' · ') : undefined;

  return { title, description };
}

module.exports = { buildStayLineLabel, guestName, truncate, frDate, nightsBetween };
