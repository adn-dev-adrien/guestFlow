/**
 * The home's bath card and the « à la suite » blocks (specs/guest-app-bath-home-scheduling.md rules 1-5, 10). Pure: the
 * instant, the stay's lines and the planning's days are arguments.
 *
 * What a guest owns on an hourly resource is what the order places at no charge (ordersController `requestsOf`, rule 82):
 * the hours the stay holds and has not placed (`heldHours`), then the offered minutes no line carries yet.
 */

const sdk = require('../sdk');
const { clockLabel } = require('./homeHighlight');

const { hoursLabel } = sdk.coreModule('publicCatalogProjection');

const minutesOf = (time) => {
  const [h, m] = String(time || '').split(':').map(Number);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
};

/** Rule 1 — `{ offeredMinutes, heldMinutes, totalMinutes }`, whole minutes. */
function ownedOf({ freeMinutesLeft = 0, heldHours = 0 }) {
  const offeredMinutes = Math.max(0, Math.round(Number(freeMinutesLeft) || 0));
  const heldMinutes = Math.max(0, Math.round((Number(heldHours) || 0) * 60));
  return { offeredMinutes, heldMinutes, totalMinutes: offeredMinutes + heldMinutes };
}

/** Rule 2 — the resource's sessions on the stay's lines that have not ended at `nowIso` (`YYYY-MM-DDTHH:MM`, Paris), in time order. */
function upcomingSessions(resourceLines, resourceId, nowIso) {
  return (resourceLines || [])
    .filter((line) => Number(line.resourceId) === Number(resourceId))
    .flatMap((line) => (Array.isArray(line.sessions) ? line.sessions : []))
    .filter((s) => s && s.date && `${s.date}T${s.end}` > nowIso)
    .map(({ date, start, end }) => ({ date, start, end }))
    .sort((a, b) => `${a.date}T${a.start}`.localeCompare(`${b.date}T${b.start}`));
}

/** Rule 5 — the card's state, or null when the card does not show (rule 4). */
function cardState({ ownedMinutes, upcoming, bookable }) {
  if (ownedMinutes > 0) return 'toSchedule';
  if (upcoming.length) return 'scheduled';
  return bookable ? 'offer' : null;
}

const WORDS = Object.freeze({
  fr: Object.freeze({
    eyebrow: 'Bien-être',
    offeredOne: (h) => `${h} offerte à programmer`,
    toSchedule: (h) => `${h} à programmer`,
    offered: (h) => `${h} offerte${h === '1 h' ? '' : 's'}`,
    held: (h) => `${h} comprise${h === '1 h' ? '' : 's'} dans le séjour`,
    choose: 'À la suite ou réparties sur le séjour',
    eveningNote: (supplement) => `En journée, ou en soirée avec ${supplement} de supplément`,
    scheduled: 'Vos séances',
    offerTitle: 'Un bain nordique pendant le séjour ?',
    offerToday: 'Un bain nordique aujourd’hui ?',
    offerTonight: 'Un bain nordique ce soir ?',
    firstSlot: (time) => `Premier créneau libre à ${time}`,
    perHour: (day, evening) => (evening ? `${day} l’heure · ${evening} en soirée` : `${day} l’heure`),
    schedule: 'Programmer',
    addHour: 'Ajouter une heure',
    change: 'Changer une séance',
    book: 'Réserver',
  }),
  en: Object.freeze({
    eyebrow: 'Wellness',
    offeredOne: (h) => `${h} free, to schedule`,
    toSchedule: (h) => `${h} to schedule`,
    offered: (h) => `${h} free`,
    held: (h) => `${h} included in the stay`,
    choose: 'In a row or spread over your stay',
    eveningNote: (supplement) => `In the day, or in the evening for ${supplement} more`,
    scheduled: 'Your sessions',
    offerTitle: 'A nordic bath during your stay?',
    offerToday: 'A nordic bath today?',
    offerTonight: 'A nordic bath tonight?',
    firstSlot: (time) => `First free slot at ${time}`,
    perHour: (day, evening) => (evening ? `${day} an hour · ${evening} in the evening` : `${day} an hour`),
    schedule: 'Schedule',
    addHour: 'Add an hour',
    change: 'Change a session',
    book: 'Book',
  }),
});

// « aujourd'hui » while the first free slot starts before the evening, « ce soir » from it (the former home highlight's words).
const EVENING = '18:00';

/**
 * Rules 4-6 — one card ready to render. `rates`: `{ day, evening }` in euros (evening 0 when the resource has no evening band);
 * `firstSlotToday`: `HH:MM` of the first slot still bookable today, or null; `priceLabel(amount)` and `sessionLabel(session)` are the
 * shop's own words.
 */
function cardView({
  resource, owned, upcoming, bookable, rates, priceLabel, sessionLabel, firstSlotToday = null, maxQuantity = 1, lang = 'fr',
}) {
  const state = cardState({ ownedMinutes: owned.totalMinutes, upcoming, bookable });
  if (!state) return null;
  const W = WORDS[lang] || WORDS.fr;
  const evening = rates.evening > rates.day ? rates.evening : 0;
  const prices = W.perHour(priceLabel(rates.day), evening ? priceLabel(evening) : null);
  const base = {
    resourceId: Number(resource.id),
    name: resource.name,
    state,
    eyebrow: W.eyebrow,
    ownedMinutes: owned.totalMinutes,
    offeredMinutes: owned.offeredMinutes,
    heldMinutes: owned.heldMinutes,
    // Rule 13 — the stepper « Heures en plus » never goes beyond what the shop sells in one order.
    maxExtraHours: Math.max(1, Number(maxQuantity) || 1),
    priceLine: prices,
    upcoming: upcoming.map((s) => ({ ...s, label: sessionLabel(s) })),
  };
  if (state === 'toSchedule') {
    const total = hoursLabel(owned.totalMinutes);
    const onlyOffered = owned.heldMinutes === 0;
    const parts = [
      owned.offeredMinutes ? W.offered(hoursLabel(owned.offeredMinutes)) : null,
      owned.heldMinutes ? W.held(hoursLabel(owned.heldMinutes)) : null,
    ].filter(Boolean);
    const single = owned.totalMinutes <= 60;
    let detail;
    if (!single) detail = `${parts.join(', ')} · ${W.choose}`;
    else if (evening) detail = W.eveningNote(priceLabel(evening - rates.day));
    else detail = parts.join(', ');
    return {
      ...base,
      title: onlyOffered && single ? W.offeredOne(total) : W.toSchedule(total),
      detail,
      actions: [{ key: 'schedule', label: W.schedule }],
    };
  }
  if (state === 'scheduled') {
    return {
      ...base,
      title: W.scheduled,
      detail: null,
      actions: [{ key: 'add', label: W.addHour }, { key: 'change', label: W.change }],
    };
  }
  if (firstSlotToday) {
    return {
      ...base,
      title: firstSlotToday < EVENING ? W.offerToday : W.offerTonight,
      detail: `${W.firstSlot(clockLabel(firstSlotToday, lang))} · ${prices}`,
      firstSlotToday,
      actions: [{ key: 'add', label: W.book }],
    };
  }
  return {
    ...base,
    title: W.offerTitle,
    detail: prices,
    actions: [{ key: 'add', label: W.book }],
  };
}

/**
 * Rule 10 — per day, the starts of `hours` consecutive bookable slots: each slot ends where the next one starts. `days` is the
 * planning's (`[{ date, slots: [{ start, end, band }] }]`, bookable slots only). The candidates still go to the scheduler's
 * own judgement of the whole session.
 */
function consecutiveBlocks(days, hours) {
  const wanted = Math.round(Number(hours) * 60);
  return (days || []).map((day) => {
    const slots = (day.slots || []).slice().sort((a, b) => minutesOf(a.start) - minutesOf(b.start));
    const starts = [];
    slots.forEach((first, i) => {
      let reach = minutesOf(first.end);
      let evening = first.band === 'evening' ? reach - minutesOf(first.start) : 0;
      let j = i;
      while (reach - minutesOf(first.start) < wanted && j + 1 < slots.length && minutesOf(slots[j + 1].start) === reach) {
        j += 1;
        reach = minutesOf(slots[j].end);
        if (slots[j].band === 'evening') evening += minutesOf(slots[j].end) - minutesOf(slots[j].start);
      }
      if (reach - minutesOf(first.start) === wanted) {
        starts.push({ start: first.start, end: slots[j].end, eveningMinutes: evening });
      }
    });
    return { date: day.date, starts };
  }).filter((day) => day.starts.length);
}

module.exports = {
  cardState, cardView, consecutiveBlocks, ownedOf, upcomingSessions,
};
