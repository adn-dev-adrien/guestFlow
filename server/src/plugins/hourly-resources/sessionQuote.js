/**
 * The price of a session with no date, for a customer with no stay (specs/gift-voucher-campaigns.md rules 4, 5, 43-44): « 2 h in the day band »,
 * « 1 h in the evening band, after 2 h already covered ». The band fixes the rate pair and the clock the slot walk starts from — the day band
 * opens at `openTime`, the evening band at `hourlyEveningStart` — so the answer is the one a booking of those hours would get from
 * `priceBookingLines`: the external rate of the band, the rate of the following hours after the first one (specs/hourly-extra-hour-rates.md), whole slots. `rankOffsetMinutes` is the
 * time already covered before this slice: the ranks continue from it.
 *
 *   sessionModesOf(resource)           → [{ key, band, label, rateCents, from, to, lengthMinutes, followingRateCents, followingText, slotMinutes, minimumMinutes, sellable, reason? }]
 *   quoteSession(config, session)      → { line } (the shape of a fulfilled line of the core's sale document) | { refusal: { code, message } }
 *
 * Pure: no DB, no clock. A refusal is a French sentence that names the resource and the value.
 */

const sdk = require('../sdk');
const { priceSessions, toMinutes, normalizeConfig } = require('./hourlyPricing');
const { rateGridOf, bandLineOf, duration } = require('./bookingPricing');

const { toCentsOrZero: toCents } = sdk.coreModule('money');

const BANDS = Object.freeze({
  day: { label: 'Extérieur · journée', word: 'la journée' },
  evening: { label: 'Extérieur · soirée', word: 'la soirée' },
});
const PLACEHOLDER_DATE = '2000-01-01';
const CLOCK_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** « 40 € », « 37,50 € ». */
const centsText = (cents) => `${(cents / 100).toLocaleString('fr-FR', { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })} €`;

const formatTime = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/** Whether the resource is the banded kind a session can be quoted on: an hourly resource shown on the planning. */
const isBanded = (resource) => resource && resource.priceType === 'per_hour' && Number(resource.showsPlanningCard || 0) === 1;

function sessionModesOf(resource) {
  if (!isBanded(resource)) return [];
  const grid = rateGridOf(resource, { external: true });
  const open = toMinutes(resource.openTime || '00:00');
  const close = toMinutes(resource.closeTime || '23:59');
  const eveningStart = resource.hourlyEveningStart ? toMinutes(resource.hourlyEveningStart) : null;
  const hasEvening = eveningStart !== null && eveningStart > open && eveningStart < close;
  const norm = normalizeConfig({ ...grid, eveningStart: hasEvening ? resource.hourlyEveningStart : null, slotMinutes: resource.slotDuration });
  const slotMinutes = norm.slotMinutes;
  const minimumMinutes = Math.max(slotMinutes, Number(resource.minimumUsageMinutes) || 0);
  const windows = [
    { band: 'day', from: open, to: hasEvening ? eveningStart : close, rate: grid.dayRate, next: norm.dayNextRate },
    ...(hasEvening ? [{ band: 'evening', from: eveningStart, to: close, rate: grid.eveningRate, next: norm.eveningNextRate }] : []),
  ];
  return windows.map(({ band, from, to, rate, next }) => {
    const rateCents = toCents(rate);
    const followingRateCents = toCents(next);
    return {
      key: `outside-${band}`,
      band,
      label: BANDS[band].label,
      rateCents,
      from: formatTime(from),
      to: formatTime(to),
      lengthMinutes: to - from,
      followingRateCents,
      followingText: followingRateCents === rateCents ? null : `puis ${centsText(followingRateCents)}/h`,
      slotMinutes,
      minimumMinutes,
      sellable: rateCents > 0,
      ...(rateCents > 0 ? {} : { reason: `« ${resource.name} » n’a pas de tarif extérieur pour ${BANDS[band].word}.` }),
    };
  });
}

const refuse = (code, message) => ({ refusal: { code, message } });

function quoteSession(config, session) {
  const resource = config.resource || {};
  const name = config.label || resource.name || 'Ressource';
  if (!session || typeof session !== 'object') return refuse('SESSION_INVALID', `« ${name} » : séance à préciser (tranche et durée).`);
  const modes = sessionModesOf(resource);
  if (!modes.length) return refuse('SESSION_UNAVAILABLE', `« ${name} » ne se réserve pas par tranche horaire.`);
  const placed = session.start !== undefined && session.start !== null;
  if (placed && !CLOCK_TIME.test(String(session.start))) return refuse('SESSION_START_INVALID', `« ${name} » : heure de début invalide.`);
  const mode = placed ? (modes.find((m) => m.band === session.band) || modes[0]) : modes.find((m) => m.band === session.band);
  if (!mode) {
    return refuse('SESSION_BAND_UNKNOWN', session.band === 'evening' ? `« ${name} » n’a pas de tranche du soir.` : `« ${name} » : tranche « ${session.band} » inconnue (journée ou soirée).`);
  }
  if (!placed && !mode.sellable) return refuse('SESSION_BAND_NOT_SOLD', mode.reason);
  if (placed && !modes.some((m) => m.sellable)) return refuse('SESSION_BAND_NOT_SOLD', mode.reason);
  const minutes = Number(session.minutes);
  const offset = session.rankOffsetMinutes === undefined ? 0 : Number(session.rankOffsetMinutes);
  if (!Number.isInteger(minutes) || minutes <= 0) return refuse('SESSION_MINUTES_INVALID', `« ${name} » : durée de ${session.minutes} min invalide.`);
  if (!Number.isInteger(offset) || offset < 0 || offset % mode.slotMinutes !== 0) {
    return refuse('SESSION_OFFSET_INVALID', `« ${name} » : le temps déjà couvert (${session.rankOffsetMinutes} min) doit être un multiple de ${mode.slotMinutes} min.`);
  }
  if (minutes % mode.slotMinutes !== 0) {
    return refuse('SESSION_STEP', `« ${name} » se réserve par tranches de ${mode.slotMinutes} min : ${minutes} min ne convient pas.`);
  }
  if (offset + minutes < mode.minimumMinutes) {
    return refuse('SESSION_TOO_SHORT', `« ${name} » se réserve pour ${mode.minimumMinutes} min au moins : ${minutes} min est trop court.`);
  }
  if (placed) {
    const close = toMinutes(resource.closeTime || '23:59');
    if (toMinutes(session.start) + offset + minutes > close) return refuse('SESSION_AFTER_CLOSE', `« ${name} » : la séance se termine après ${formatTime(close)}, l’heure de fermeture.`);
  } else if (offset + minutes > mode.lengthMinutes) {
    return refuse('SESSION_OUT_OF_BAND', `« ${name} » : ${duration(offset + minutes)} ne tiennent pas dans ${BANDS[session.band].word} (${mode.from}–${mode.to}).`);
  }
  const start = (placed ? toMinutes(session.start) : toMinutes(mode.from)) + offset;
  const priced = priceSessions([{ date: PLACEHOLDER_DATE, start: formatTime(start), end: formatTime(start + minutes) }], {
    ...rateGridOf(resource, { external: true }),
    eveningStart: resource.hourlyEveningStart,
    slotMinutes: mode.slotMinutes,
    rankOffsetMinutes: offset,
  });
  if (!priced.validSessions.length) return refuse('SESSION_OFF_GRID', `« ${name} » : la tranche ne tombe pas sur la grille des créneaux (${mode.slotMinutes} min).`);
  const totalCents = toCents(priced.totalPrice);
  const parts = priced.bands.map((band) => bandLineOf(band, { clock: placed })).map((part) => ({
    key: part.key, label: part.label, detail: part.detail, amountCents: toCents(part.amount),
  }));
  return {
    line: {
      articleRef: `resource:${Number(config.id)}`,
      family: 'hourly',
      label: name,
      detail: parts.map((part) => [part.label, part.detail].filter(Boolean).join(' · ')).join(' ; ') || null,
      quantity: 1,
      unitCents: totalCents,
      totalCents,
      catalogueCents: totalCents,
      offered: false,
      vatClass: config.vatClass,
      components: parts,
      fulfilmentRef: `session:resource:${Number(config.id)}:${session.band}:${offset}`,
    },
  };
}

module.exports = { sessionModesOf, quoteSession, isBanded };
