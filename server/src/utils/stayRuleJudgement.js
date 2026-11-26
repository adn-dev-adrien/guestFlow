/**
 * Which stay rules the fiche still judges, and what it says about the ones it lets through
 * (specs/reservations/platform-stays-always-saveable.md rules 1-8).
 *
 * Pure — no DB. The controller feeds it the quote's breaches, the channel and the stored row; it
 * answers which breaches block (409) and the French notes shown on the fiche.
 *
 *   - A platform stay (any channel but `direct`, Lodgify included) is never blocked by the minimum,
 *     the maximum, the changeover days or the guest capacity: the platform sold it, GuestFlow records it.
 *   - Whatever the channel, a save that moves neither the dates, the property nor the party never
 *     re-judges those rules (rule 8).
 *   - Overlap, beds, resource availability, typed counts, trop-perçu and the past-stay lock are not
 *     decided here and stay blocking.
 */
const { isNamedChannel } = require('./saleChannel');
const { platformDisplayName } = require('./attributionChannel');

const sameNum = (a, b) => Number(a || 0) === Number(b || 0);
const sameStr = (a, b) => String(a == null ? '' : a) === String(b == null ? '' : b);

/**
 * What a save moves against the stored row. No stored row (a creation) moves everything.
 * `placement` = property or dates; `party` = property or any head count.
 */
function stayMovement(stored, posted) {
  if (!stored) return { datesMoved: true, propertyMoved: true, partyMoved: true };
  return {
    datesMoved: !(sameStr(stored.startDate, posted.startDate) && sameStr(stored.endDate, posted.endDate)),
    propertyMoved: !sameNum(stored.propertyId, posted.propertyId),
    partyMoved: !(sameNum(stored.adults, posted.adults) && sameNum(stored.children, posted.children)
      && sameNum(stored.teens, posted.teens) && sameNum(stored.babies, posted.babies)),
  };
}

const dayMonth = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return m ? `${m[3]}/${m[2]}` : null;
};
const nightsLabel = (n) => `${n} nuit${Number(n) > 1 ? 's' : ''}`;

// « Très haute » dès le 10/07 — the first night of the stay that sits in the season asking for the most.
function strictestSeason(quote) {
  const rule = (quote.minNightsRules || []).find((r) => Number(r.minNights) === Number(quote.requiredMinNights));
  if (!rule) return '';
  const nights = quote.nightlyBreakdown || [];
  const first = nights.find((n) => n.seasonLabel === rule.label);
  const from = first && nights[0] && first.date !== nights[0].date ? dayMonth(first.date) : null;
  return ` (« ${rule.label} »${from ? ` dès le ${from}` : ''})`;
}

function stayRuleNotes({ quote, platform, capacityBreach }) {
  const name = platformDisplayName(platform);
  const fix = `À corriger sur ${name} pour les prochaines réservations.`;
  const notes = [];
  if (quote.minNightsBreached) {
    notes.push(`${name} a vendu ${nightsLabel(quote.nights)} ; ces dates en demandent ${quote.requiredMinNights}${strictestSeason(quote)}. ${fix}`);
  }
  if (quote.maxNightsBreached) {
    notes.push(`${name} a vendu ${nightsLabel(quote.nights)} ; ces dates en autorisent ${quote.requiredMaxNights} au plus. ${fix}`);
  }
  if (quote.changeoverBreached) {
    const parts = [];
    if (quote.changeoverArrivalBreached) parts.push(`une arrivée le ${quote.requiredArrivalDayLabel}`);
    if (quote.changeoverDepartureBreached) parts.push(`un départ le ${quote.requiredDepartureDayLabel}`);
    notes.push(`${name} a vendu ces dates ; elles imposent ${parts.join(' et ')}. ${fix}`);
  }
  if (capacityBreach) notes.push(`${capacityBreach.message} ${fix}`);
  return notes;
}

/**
 * @param {object} p
 * @param {object} p.quote            the engine quote (breach flags + their facts)
 * @param {string} p.platform         the stay's channel
 * @param {{datesMoved:boolean, propertyMoved:boolean, partyMoved:boolean}} p.movement
 * @param {{message:string}|null} [p.capacityBreach]  `checkGuestCapacity`'s answer for the party
 * @returns {{ platformStay: boolean, shapeJudged: boolean, capacityJudged: boolean,
 *             blocks: {minNights:boolean, maxNights:boolean, changeover:boolean}, notes: string[] }}
 */
function judgeStayRules({ quote, platform, movement, capacityBreach = null }) {
  const platformStay = isNamedChannel(platform);
  const occupancyMoved = movement.propertyMoved || movement.partyMoved;
  const shapeJudged = !platformStay && (movement.datesMoved || occupancyMoved);
  const capacityJudged = !platformStay && occupancyMoved;
  return {
    platformStay,
    shapeJudged,
    capacityJudged,
    blocks: {
      minNights: shapeJudged && Boolean(quote.minNightsBreached),
      maxNights: shapeJudged && Boolean(quote.maxNightsBreached),
      changeover: shapeJudged && Boolean(quote.changeoverBreached),
    },
    notes: platformStay ? stayRuleNotes({ quote, platform, capacityBreach }) : [],
  };
}

/** The quote as the fiche reads it: a breach that does not block is reported as none. */
function quoteWithJudgement(quote, judgement) {
  return {
    ...quote,
    minNightsBreached: judgement.blocks.minNights,
    maxNightsBreached: judgement.blocks.maxNights,
    changeoverBreached: judgement.blocks.changeover,
    capacityJudged: judgement.capacityJudged,
    stayRuleNotes: judgement.notes,
  };
}

module.exports = { judgeStayRules, quoteWithJudgement, stayMovement, stayRuleNotes };
