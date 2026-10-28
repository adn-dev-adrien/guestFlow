/**
 * The pure rules of the VAT regime (specs/vat-optional-mode.md): the two legal mentions, which period a
 * sale falls under, and the bounds of a switch. No database here: `models/vatRegimeModel.js` reads and
 * writes, this decides. The assignment predicate has a SQL twin (the trigger of `vatRegimeMigration.js`);
 * `vat-regime-assignment.unit.test.js` runs both on the same matrix.
 */

const crypto = require('crypto');
const { localIsoDate, todayIso } = require('./localDate');

const REGIMES = Object.freeze({ SUBJECT: 'subject', NOT_SUBJECT: 'not_subject' });
const BASES = Object.freeze({ ALL: 'all', BOOKING: 'booking', ARRIVAL: 'arrival' });

// Rule 2 — chosen, not typed. FR and EN, server constants.
const MENTIONS = Object.freeze({
  art_293_b: {
    short: 'Franchise en base — art. 293 B',
    fr: 'TVA non applicable, art. 293 B du CGI',
    en: 'VAT not applicable, art. 293 B of the French General Tax Code',
  },
  art_261_d_4: {
    short: 'Location meublée exonérée — art. 261 D 4°',
    fr: 'Exonération de TVA, art. 261 D 4° du CGI',
    en: 'VAT exempt, art. 261 D 4° of the French General Tax Code',
  },
});
const DEFAULT_MENTION = 'art_293_b';

const isMentionKey = (key) => Object.prototype.hasOwnProperty.call(MENTIONS, key);

function mentionText(key, lang = 'fr') {
  if (!isMentionKey(key)) return null;
  return String(lang).toLowerCase() === 'en' ? MENTIONS[key].en : MENTIONS[key].fr;
}

/**
 * The calendar day in the server's time zone of a stored timestamp: SQLite writes `datetime('now')` in
 * UTC, so this is the JS twin of `date(createdAt, 'localtime')`. A bare date is already a day.
 */
function bookingDayOf(value) {
  const text = String(value == null ? '' : value).trim();
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const hasZone = /([zZ]|[+-]\d{2}:?\d{2})$/.test(text);
  const date = new Date(hasZone ? text.replace(' ', 'T') : `${text.replace(' ', 'T')}Z`);
  return Number.isNaN(date.getTime()) ? null : localIsoDate(date);
}

/** Rule 5 — whether a period applies to a sale. */
function appliesTo(period, { bookingDay, startDate }) {
  if (period.basis === BASES.ALL) return true;
  if (period.basis === BASES.BOOKING) return Boolean(bookingDay) && bookingDay >= period.effectiveFrom;
  if (period.basis === BASES.ARRIVAL) return Boolean(startDate) && String(startDate) >= period.effectiveFrom;
  return false;
}

/** Rule 5 — the latest period (highest id) that applies; the first one when none does. */
function pickPeriod(periods, sale) {
  const ordered = [...periods].sort((a, b) => b.id - a.id);
  return ordered.find((p) => appliesTo(p, sale)) || ordered[ordered.length - 1] || null;
}

/** The regime object every reader receives (rule 8). */
function toRegime(period) {
  if (!period) return null;
  return {
    periodId: period.id,
    regime: period.regime,
    rate: Number(period.rate),
    legalMention: period.legalMention || null,
    legalMentionText: mentionText(period.legalMention, 'fr'),
    legalMentionTextEn: mentionText(period.legalMention, 'en'),
  };
}

const addDays = (iso, days) => {
  const [y, m, d] = iso.split('-').map(Number);
  return localIsoDate(new Date(y, m - 1, d + days));
};

const isIsoDate = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

const frDate = (iso) => iso.split('-').reverse().join('/');

/** The rate of a switch's target: asked for under VAT (10 by default), always 0 without. */
function targetRate(input) {
  if (input.regime !== REGIMES.SUBJECT) return 0;
  return input.rate == null ? 10 : parseRate(input.rate);
}

/** A rate as an operator types it: « 5,5 » is 5.5. NaN when it is not a number. */
function parseRate(value) {
  if (typeof value === 'number') return value;
  const text = String(value).trim().replace(',', '.');
  return text === '' ? NaN : Number(text);
}

/**
 * Rules 14 and 15 — the inputs of a switch against the stored periods. → { errors: { field: message } },
 * empty when valid. `today` is injected for tests.
 */
function validateSwitch(input, periods, { today = todayIso() } = {}) {
  const errors = {};
  const body = input || {};
  // Rule 15 (restated by rule 28): the target is compared with the LATEST period — the one a switch
  // would replace — not with today's: a future-dated change must be reversible.
  const latest = [...periods].sort((a, b) => b.id - a.id)[0] || null;

  if (body.regime !== REGIMES.SUBJECT && body.regime !== REGIMES.NOT_SUBJECT) errors.regime = 'Régime invalide';
  if (!Object.values(BASES).includes(body.basis)) errors.basis = 'Portée invalide';

  if (body.regime === REGIMES.SUBJECT) {
    const rate = targetRate(body);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) errors.rate = 'Taux entre 0 et 100';
  }
  if (body.regime === REGIMES.NOT_SUBJECT && body.legalMention != null && body.legalMention !== '' && !isMentionKey(body.legalMention)) {
    errors.legalMention = 'Mention inconnue';
  }

  if (body.basis === BASES.BOOKING || body.basis === BASES.ARRIVAL) {
    const from = body.effectiveFrom;
    const latestDated = [...periods].filter((p) => p.effectiveFrom).sort((a, b) => b.id - a.id)[0] || null;
    if (!isIsoDate(from)) errors.effectiveFrom = 'Date invalide';
    else if (latestDated && from < latestDated.effectiveFrom) errors.effectiveFrom = `Date antérieure au dernier changement (${frDate(latestDated.effectiveFrom)})`;
    else if (from < addDays(today, -366)) errors.effectiveFrom = 'Au plus un an en arrière, sinon correction';
    else if (from > addDays(today, 366)) errors.effectiveFrom = "Au plus un an à l'avance";
  }

  if (!errors.regime && !errors.rate && latest && latest.regime === body.regime
    && (body.regime === REGIMES.NOT_SUBJECT || Number(latest.rate) === targetRate(body))) {
    errors.regime = 'Régime déjà en vigueur';
  }
  return { errors };
}

/** The row a switch inserts (rule 14), from validated inputs. */
function periodFromInput(input) {
  const subject = input.regime === REGIMES.SUBJECT;
  return {
    regime: input.regime,
    rate: targetRate(input),
    legalMention: subject ? null : (input.legalMention || DEFAULT_MENTION),
    basis: input.basis,
    effectiveFrom: input.basis === BASES.ALL ? null : input.effectiveFrom,
  };
}

/** Rule 17 — what the switch must still find true when it is confirmed: the set it moves and the rates it starts from (rule 27). */
function fingerprint({ input, reassignedIds, periods, settingsRate }) {
  const sources = periods.map((p) => [p.id, p.regime, Number(p.rate), p.legalMention, p.basis, p.effectiveFrom]);
  const normalized = { ...periodFromInput(input), reassigned: [...reassignedIds].sort((a, b) => a - b), sources, settingsRate: Number(settingsRate) };
  return crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex').slice(0, 32);
}

/** The server's sentence for a period of the history (§4.3). */
function periodLabel(period) {
  if (period.basis === BASES.ALL) return period.note === 'initial' ? 'Depuis toujours' : 'Toutes les réservations (correction)';
  const scope = period.basis === BASES.BOOKING ? 'réservations prises à partir de cette date' : 'séjours qui commencent à partir de cette date';
  return `Depuis le ${frDate(period.effectiveFrom)} · ${scope}`;
}

/** « Assujetti 10 % » / « Sans TVA » — the regime in a history entry. */
function regimeLabel(period) {
  if (period.regime === REGIMES.NOT_SUBJECT) return 'Sans TVA';
  return `Assujetti ${String(Number(period.rate)).replace('.', ',')} %`;
}

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;
const euros = (n) => `${Math.abs(n).toFixed(2).replace('.', ',')} €`;

function monthLabel(ym) {
  const [year, month] = ym.split('-');
  return `${MONTHS[Number(month) - 1]} ${year}`;
}

/** « juin, août et octobre 2026 », « décembre 2025 et janvier 2026 » — the months, never a range that hides a gap. */
function monthList(months) {
  const byYear = new Map();
  months.forEach((ym) => {
    const [year, month] = ym.split('-');
    byYear.set(year, [...(byYear.get(year) || []), MONTHS[Number(month) - 1]]);
  });
  const parts = [...byYear.entries()].map(([year, names]) => {
    const head = names.length > 1 ? `${names.slice(0, -1).join(', ')} et ${names[names.length - 1]}` : names[0];
    return `${head} ${year}`;
  });
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(', ')} et ${parts[parts.length - 1]}`;
}

/**
 * Rule 17 — the 2 to 8 short lines of « Ce qui change », phrased here (French, plurals, month range) so
 * the dialog only prints them. Only the non-zero effects are told.
 */
function previewLines(input, preview, { accountingExportActive = false, today = todayIso(), fromRegime = null } = {}) {
  const toNo = input.regime === REGIMES.NOT_SUBJECT;
  const rateChange = !toNo && fromRegime === REGIMES.SUBJECT;
  const rateText = String(targetRate(input)).replace('.', ',');
  const verb = (many) => {
    if (toNo) return many ? 'passent sans TVA' : 'passe sans TVA';
    if (rateChange) return many ? `passent à ${rateText} % de TVA` : `passe à ${rateText} % de TVA`;
    return many ? 'passent à la TVA' : 'passe à la TVA';
  };
  const lines = [];
  if (preview.reassigned === 0) {
    const dated = input.basis !== BASES.ALL && input.effectiveFrom > today;
    const who = !dated ? 'Les prochaines'
      : `${input.basis === BASES.BOOKING ? 'Les réservations prises' : 'Les séjours qui commencent'} à partir du ${frDate(input.effectiveFrom)}`;
    lines.push(`Aucune réservation existante. ${who} ${verb(true)}.`);
  } else {
    const collected = preview.collected ? `, dont ${plural(preview.collected, 'déjà encaissée', 'déjà encaissées')}` : '';
    lines.push(`${plural(preview.reassigned, 'réservation', 'réservations')} ${verb(preview.reassigned > 1)}${collected}.`);
  }
  lines.push(`Prix inchangés.${!toNo && fromRegime === REGIMES.NOT_SUBJECT && targetRate(input) > 0 ? ' Le chiffre d’affaires HT baisse d’autant.' : ''}`);
  if (preview.touristTaxChanged) {
    lines.push(`Taxe de séjour recalculée sur ${plural(preview.touristTaxChanged, 'séjour', 'séjours')} (${preview.touristTaxDelta >= 0 ? '+' : '−'}${euros(preview.touristTaxDelta)}).`);
  }
  if (preview.touristTaxKept) {
    lines.push(`${plural(preview.touristTaxKept, 'taxe de séjour figée inchangée', 'taxes de séjour figées inchangées')}.`);
  }
  if (preview.openLinks) {
    lines.push(preview.openLinks === 1
      ? '1 lien de paiement ouvert garde son montant.'
      : `${preview.openLinks} liens de paiement ouverts gardent leur montant.`);
  }
  if (preview.linksReplaced) {
    lines.push(preview.linksReplaced === 1
      ? '1 lien de paiement ouvert est abandonné : son montant change.'
      : `${preview.linksReplaced} liens de paiement ouverts sont abandonnés : leur montant change.`);
  }
  if (preview.notRepriced) {
    lines.push(preview.notRepriced === 1
      ? '1 séjour garde sa taxe de séjour enregistrée : le recalcul changerait aussi son prix.'
      : `${preview.notRepriced} séjours gardent leur taxe de séjour enregistrée : le recalcul changerait aussi leur prix.`);
  }
  if (accountingExportActive && preview.exportMonths.length) {
    lines.push(`Écritures comptables modifiées : ${monthList(preview.exportMonths)}.`);
  }
  const target = periodFromInput(input);
  lines.push(toNo
    ? 'Devis et résumés : la mention légale remplace la TVA.'
    : `Devis et résumés : TVA ${String(target.rate).replace('.', ',')} %.`);
  return lines;
}

module.exports = {
  previewLines,
  REGIMES, BASES, MENTIONS, DEFAULT_MENTION,
  isMentionKey, mentionText, bookingDayOf, appliesTo, pickPeriod, toRegime,
  validateSwitch, parseRate, periodFromInput, fingerprint, periodLabel, regimeLabel, frDate, addDays,
};
