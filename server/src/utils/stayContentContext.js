/**
 * Stay content of the guest email sequence — pure (specs/guest-email-sequence.md §3.5 + §6.1,
 * specs/plugins-phase-p-productisation.md §3.A–3.B).
 *
 * Decides, for ONE reservation, what its property includes, what the guest booked and what may still
 * be proposed (rule 20), then fills every conditional paragraph of the six emails. It holds no
 * wording: each paragraph is a stay text (utils/stayTextCatalogue.js) or a mention, chosen and filled
 * here. The template engine has no nesting and no loops, so each paragraph arrives here already
 * written and the templates only place it: `{{#if hasX}}{{x}}{{/if}}`.
 *
 * Inputs are plain rows; `facts` is loaded by `models/stayFactsModel.js`:
 *   facts.defaults          [{ optionId, offered }]            property_option_defaults
 *   facts.available         [option rows with the property's effective `price`]
 *   facts.optionMeta        { [optionId]: { category, autoOptionType, title } }
 *   facts.bathFreeMinutes   number — hourly-resource minutes included for this property
 *   facts.properties        [{ id, name, nameArticle, minNightlyPrice }]  for the November email
 *   facts.texts             { global, property } — stored stay texts (models/stayTextsModel.js)
 *   facts.mentions          [{ id, section, offerFr, offerEn, bookedFr, bookedEn, priceSource,
 *                              priceOptionId, optionIds }]  in proposal order
 *   facts.confirmationOrder ['mention:<id>' | 'babyBed' | 'towels']
 */

const { formatDateLong } = require('./dateFr');
const { isCleaningOption, normalizeOptionName } = require('./cleaningOption');
const { isClientVisibleOption } = require('./optionVisibility');
const { isDirectChannel } = require('./platformNameFormat');
const { renderStayText, renderText } = require('./stayTextCatalogue');

const WEEKDAYS = { fr: ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'], en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] };
const MONTHS = { fr: ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'], en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] };

const safe = (v) => (v == null ? '' : String(v));

// ---------------------------------------------------------------- formatting

function euro(amount, lang) {
  const n = Math.round(Number(amount || 0) * 100) / 100;
  const whole = Number.isInteger(n);
  if (lang === 'en') return `€${whole ? n : n.toFixed(2)}`;
  return `${whole ? n : n.toFixed(2).replace('.', ',')} €`;
}

function weekdayDate(iso, lang) {
  if (!iso) return '';
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  const wd = WEEKDAYS[lang][new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  if (lang === 'en') return `${wd} ${formatDateLong(iso, 'en')}`;
  return `${wd} ${d === 1 ? '1er' : d} ${MONTHS.fr[m - 1]} ${y}`;
}

function weekdayOf(iso, lang) {
  if (!iso) return '';
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  return WEEKDAYS[lang][new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

function hourLabel(time, lang) {
  const match = safe(time).match(/^(\d{1,2}):(\d{2})/);
  if (!match) return '';
  const h = Number(match[1]);
  const min = Number(match[2]);
  if (lang === 'en') return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
  return min ? `${h} h ${String(min).padStart(2, '0')}` : `${h} h`;
}

function durationLabel(minutes, lang) {
  const total = Math.max(0, Math.round(Number(minutes || 0)));
  const h = Math.floor(total / 60);
  const min = total % 60;
  if (lang === 'en') {
    if (!h) return `${min} minutes`;
    return min ? `${h} h ${min}` : `${h} hour${h > 1 ? 's' : ''}`;
  }
  if (!h) return `${min} min`;
  return min ? `${h} h ${min}` : `${h} h`;
}

function joinList(items, lang) {
  if (items.length <= 1) return items[0] || '';
  const and = lang === 'en' ? ' and ' : ' et ';
  return `${items.slice(0, -1).join(', ')}${and}${items[items.length - 1]}`;
}

function withArticle(name, article, lang) {
  const n = safe(name).trim();
  if (!n) return '';
  if (lang === 'en') return n;
  const a = safe(article).trim() || 'au';
  return a.endsWith("'") ? `${a}${n}` : `${a} ${n}`;
}

// ---------------------------------------------------------------- option roles

/**
 * The options the engine itself knows, by their product tag — linen, towels, cleaning, baby bed.
 * Every other option reaches the emails through a mention (rule 10).
 */
function roleOf(option) {
  if (!option) return null;
  const type = safe(option.autoOptionType);
  if (type === 'bed_linen') return 'bedLinen';
  if (type === 'bathroom_linen') return 'towels';
  if (isCleaningOption(option)) return 'cleaning';
  if (type === 'baby_bed' || normalizeOptionName(option.title).includes('lit bebe')) return 'babyBed';
  return null;
}

/**
 * Rule 20 — included / booked / proposable, per typed role and per mention.
 * `lines` are the reservation's option rows (`optionId`, `offered`, title…); `facts` as documented above.
 */
function classifyOptions(lines, facts) {
  const meta = (facts && facts.optionMeta) || {};
  const withMeta = (o) => ({ ...(meta[o.optionId != null ? o.optionId : o.id] || {}), ...o });

  const offeredDefaultIds = new Set(((facts && facts.defaults) || [])
    .filter((d) => Number(d.offered) === 1)
    .map((d) => Number(d.optionId)));

  const included = new Set();
  for (const id of offeredDefaultIds) {
    const role = roleOf(meta[id] || {});
    if (role) included.add(role);
  }

  const bookedLines = (lines || [])
    .map(withMeta)
    .filter(isClientVisibleOption)
    .filter((o) => !offeredDefaultIds.has(Number(o.optionId)));
  const booked = new Set(bookedLines.map(roleOf).filter(Boolean));
  const bookedIds = new Set(bookedLines.map((o) => Number(o.optionId)));

  const available = ((facts && facts.available) || [])
    .map(withMeta)
    .filter(isClientVisibleOption);
  const byRole = (role) => available.filter((o) => roleOf(o) === role);
  const priceOf = (role) => {
    const opts = byRole(role);
    return opts.length ? Math.min(...opts.map((o) => Number(o.price || 0))) : null;
  };
  const proposable = (role) => byRole(role).length > 0 && !included.has(role) && !booked.has(role);

  // Rules 7–8: a mention is proposed while one of its options is available, none is included and
  // none is booked; it quotes its chosen option's price, else the lowest.
  const covers = (mention, ids) => (mention.optionIds || []).some((id) => ids.has(Number(id)));
  const availableOf = (mention) => available.filter((o) => (mention.optionIds || []).map(Number).includes(Number(o.id)));
  const mentionBooked = (mention) => covers(mention, bookedIds);
  const mentionProposable = (mention) => availableOf(mention).length > 0
    && !covers(mention, offeredDefaultIds) && !mentionBooked(mention);
  const mentionPrice = (mention) => {
    const opts = availableOf(mention);
    if (!opts.length) return null;
    if (mention.priceSource === 'option') {
      const chosen = opts.find((o) => Number(o.id) === Number(mention.priceOptionId));
      if (chosen) return Number(chosen.price || 0);
    }
    return Math.min(...opts.map((o) => Number(o.price || 0)));
  };

  return {
    included,
    booked,
    bookedTitles: bookedLines.map((o) => safe(o.title).trim()).filter(Boolean),
    proposable,
    priceOf,
    mentionBooked,
    mentionProposable,
    mentionPrice,
  };
}

// ---------------------------------------------------------------- the composed context

/**
 * @returns {{ vars: object, flags: object }} merged over emailContextBuilder's context.
 */
function buildStayContent({ reservation, client, property, options = [], facts = {}, settings = {}, lang = 'fr', sequence = {} }) {
  const L = lang === 'en' ? 'en' : 'fr';
  const en = L === 'en';
  const r = reservation || {};
  const p = property || {};
  const c = client || {};
  const cls = classifyOptions(options, facts);
  const t = (fr, e) => (en ? e : fr);
  const say = (key, tokens = {}, flags = {}) => renderStayText(key, L, tokens, flags, facts.texts);
  const priced = (amount) => ({ price: amount == null ? '' : euro(amount, L) });
  const hasPrice = (amount) => Number(amount || 0) > 0;
  const mentions = facts.mentions || [];
  const mentionText = (m, side, tokens = {}, flags = {}) => renderText(safe(en ? m[`${side}En`] : m[`${side}Fr`]), tokens, flags);
  const offerOf = (m) => {
    const price = cls.mentionPrice(m);
    return mentionText(m, 'offer', priced(price), { hasPrice: hasPrice(price) });
  };

  const propertyWith = withArticle(p.name, p.nameArticle, L);
  const PropertyWith = `${propertyWith.charAt(0).toUpperCase()}${propertyWith.slice(1)}`;
  const propertyFrom = en ? safe(p.name) : propertyWith.replace(/^à /, 'de ').replace(/^au /, 'du ').replace(/^aux /, 'des ');
  const propertyName = safe(p.name);
  const adults = Number(r.adults || 0);
  const kids = Number(r.children || 0) + Number(r.teens || 0);
  const babies = Number(r.babies || 0);

  // --- guests + beds
  const guests = [];
  if (adults) guests.push(t(`${adults} adulte${adults > 1 ? 's' : ''}`, `${adults} adult${adults > 1 ? 's' : ''}`));
  if (kids) guests.push(t(`${kids} enfant${kids > 1 ? 's' : ''}`, `${kids} child${kids > 1 ? 'ren' : ''}`));
  if (babies) guests.push(t(`${babies} bébé${babies > 1 ? 's' : ''}`, `${babies} bab${babies > 1 ? 'ies' : 'y'}`));
  const doubles = Number(r.doubleBeds || 0);
  const singles = Number(r.singleBeds || 0);
  const beds = [];
  if (doubles) beds.push(t(`${doubles} lit${doubles > 1 ? 's' : ''} double${doubles > 1 ? 's' : ''}`, `${doubles} double bed${doubles > 1 ? 's' : ''}`));
  if (singles) beds.push(t(`${singles} lit${singles > 1 ? 's' : ''} simple${singles > 1 ? 's' : ''}`, `${singles} single bed${singles > 1 ? 's' : ''}`));
  const bedConfigLabel = joinList(beds, L);

  const bedsMade = cls.included.has('bedLinen') || cls.booked.has('bedLinen');
  const towelsIncluded = cls.included.has('towels');
  const towelsCovered = towelsIncluded || cls.booked.has('towels');
  const cleaningIncluded = cls.included.has('cleaning');
  const cleaningBooked = cls.booked.has('cleaning');

  let bedsParagraph = '';
  if (bedConfigLabel && bedsMade) {
    bedsParagraph = say('beds.made', { bedConfig: bedConfigLabel });
  } else if (bedConfigLabel) {
    const linenOffered = cls.proposable('bedLinen');
    const linenPrice = linenOffered ? cls.priceOf('bedLinen') : null;
    bedsParagraph = say('beds.linenNotIncluded', { bedConfig: bedConfigLabel, ...priced(linenPrice) }, { linenOffered, hasPrice: hasPrice(linenPrice) });
  }

  let babyParagraph = '';
  if (babies && cls.booked.has('babyBed')) {
    babyParagraph = say('baby.booked');
  } else if (babies && cls.proposable('babyBed')) {
    const babyPrice = cls.priceOf('babyBed');
    babyParagraph = say('baby.offer', priced(babyPrice), { hasPrice: hasPrice(babyPrice) });
  }

  // --- pool season (settings, MM-DD) overlapping the stay; empty means no pool (rule 14)
  const stayOverlapsPool = (() => {
    const start = safe(settings.poolSeasonStart);
    const end = safe(settings.poolSeasonEnd);
    const year = safe(r.startDate).slice(0, 4);
    if (!year || !/^\d{2}-\d{2}$/.test(start) || !/^\d{2}-\d{2}$/.test(end)) return false;
    return safe(r.startDate).slice(0, 10) <= `${year}-${end}` && safe(r.endDate).slice(0, 10) > `${year}-${start}`;
  })();

  // --- J-7 bag + property facts
  const bagLines = [say('bag.items', {}, { stayOverlapsPool })];
  if (!towelsCovered) {
    const towelPrice = cls.proposable('towels') ? cls.priceOf('towels') : null;
    bagLines.push(towelPrice != null
      ? say('bag.towelsOffer', priced(towelPrice), { hasPrice: hasPrice(towelPrice) })
      : say('bag.towels'));
  }
  const parking = Number(p.parkingDistanceMeters || 0);
  const placeTokens = { distance: parking, propertyFrom, propertyName };
  const travelLightParagraph = parking > 0 ? say('travelLight', placeTokens) : '';
  const wifiParagraph = Number(p.hasWifi == null ? 1 : p.hasWifi) === 0 ? say('noWifi', { PropertyWith, propertyName }) : '';

  // --- J-7 offers: the proposable mentions of each section, in their order (rules 8, 24)
  const deadlineIso = r.startDate ? new Date(Date.parse(`${safe(r.startDate).slice(0, 10)}T00:00:00Z`) - 3 * 86400000).toISOString().slice(0, 10) : '';
  const offersIn = (section) => mentions
    .filter((m) => m.section === section && cls.mentionProposable(m))
    .map(offerOf)
    .filter(Boolean);
  const local = offersIn('local');
  const extras = offersIn('extras');
  let localProductsParagraph = '';
  if (local.length || extras.length) {
    const parts = [];
    if (local.length) parts.push(say('offers.localIntro', { list: joinList(local, L) }));
    if (extras.length) parts.push(say(local.length ? 'offers.extrasAfterLocal' : 'offers.extrasIntro', { list: joinList(extras, L) }));
    parts.push(say('offers.deadline', { date: weekdayDate(deadlineIso, L) }));
    localProductsParagraph = parts.filter(Boolean).join(' ');
  }
  // « Enfants »: shown with children while one of its options is offered by the property, booked or
  // not (rule 8).
  const offeredIds = new Set((facts.available || []).map((o) => Number(o.id)));
  const kidsParagraph = kids
    ? mentions
      .filter((m) => m.section === 'kids' && (m.optionIds || []).some((id) => offeredIds.has(Number(id))))
      .map(offerOf)
      .filter(Boolean)
      .join(' ')
    : '';

  // --- J-2
  const parkingLine = parking > 0 ? say('parkingLine', placeTokens) : '';
  // Rule 9: the confirmations follow their own order; anything it does not name goes last.
  const order = (facts.confirmationOrder || []).map(String);
  const confirmations = [
    ...order,
    ...['babyBed', 'towels'].filter((item) => !order.includes(item)),
    ...mentions.map((m) => `mention:${m.id}`).filter((item) => !order.includes(item)),
  ];
  const bookedOptionsParagraph = confirmations
    .map((item) => {
      if (item === 'babyBed') return cls.booked.has('babyBed') ? say('booked.babyBed') : '';
      if (item === 'towels') return cls.booked.has('towels') ? say('booked.towels') : '';
      const mention = mentions.find((m) => `mention:${m.id}` === item);
      return mention && cls.mentionBooked(mention) ? mentionText(mention, 'booked') : '';
    })
    .filter(Boolean)
    .join('\n');
  const coffeeParagraph = say('house');
  let cleaningParagraph;
  if (cleaningIncluded) cleaningParagraph = say('cleaning.included');
  else if (cleaningBooked) cleaningParagraph = say('cleaning.booked');
  else cleaningParagraph = say('cleaning.notBooked');
  const complementDue = Number(r.complementAmount || 0) > 0 && Number(r.complementPaid || 0) !== 1;
  const complementLine = complementDue
    ? say(Number(r.complementDeferredToCheckout || 0) === 1 ? 'complement.atDeparture' : 'complement.atArrival', { amount: euro(r.complementAmount, L) })
    : '';

  // --- J+1
  const googleReviewUrl = safe(settings.googleReviewUrl).trim();
  const platformName = (() => {
    const pf = safe(r.platform).toLowerCase().replace(/[^a-z]/g, '');
    if (pf.startsWith('gitesdefrance') || pf.startsWith('gite')) return t('votre espace Gîtes de France', 'your Gîtes de France account');
    if (pf.startsWith('airbnb')) return 'Airbnb';
    if (pf.startsWith('booking')) return 'Booking';
    return safe(r.platform).trim();
  })();
  let reviewParagraph = '';
  if (isDirectChannel(r.platform)) {
    if (googleReviewUrl) reviewParagraph = say('review.direct', { link: googleReviewUrl });
  } else {
    reviewParagraph = say('review.platform', { platform: platformName, link: googleReviewUrl }, { hasGoogleReview: Boolean(googleReviewUrl) });
  }
  const instagramUrl = safe(settings.instagramUrl).trim();
  const instagramParagraph = instagramUrl ? say('instagram', { link: instagramUrl }) : '';

  // --- season emails
  const offers = (facts.properties || [])
    .filter((prop) => Number(prop.minNightlyPrice || 0) > 0)
    .map((prop) => say('gift.offer', {
      propertyWith: withArticle(prop.name, prop.nameArticle, L), propertyName: safe(prop.name), ...priced(prop.minNightlyPrice),
    }, { hasPrice: true }));
  const giftVoucherOffer = offers.length
    ? say('gift.list', { list: offers.join(t(', ou ', ', or ')) })
    : say('gift.fallback');
  const sendDate = safe(sequence.sendDate);
  const giftDeadlineLabel = sequence.giftDeadline ? weekdayDate(sequence.giftDeadline, L) : '';
  const lastStayLabel = r.startDate
    ? t(`${propertyWith} en ${MONTHS.fr[Number(safe(r.startDate).slice(5, 7)) - 1]} ${safe(r.startDate).slice(0, 4)}`,
      `at ${safe(p.name)} in ${MONTHS.en[Number(safe(r.startDate).slice(5, 7)) - 1]} ${safe(r.startDate).slice(0, 4)}`)
    : '';

  // J+1 opening — built on the article, so it reads right whatever the name's gender (« Au Gite »,
  // « À La Granja »).
  const quietSinceDeparture = say('quietSinceDeparture', { PropertyWith, propertyWith, propertyName });

  const bathMinutes = Number(facts.bathFreeMinutes || 0);
  const lastMinute = Boolean(sequence.lastMinute);

  return {
    vars: {
      guestCount: joinList(guests, L),
      arrivalDateLabel: weekdayDate(r.startDate, L),
      departureDateLabel: weekdayDate(r.endDate, L),
      arrivalWeekday: weekdayOf(r.startDate, L),
      checkInLabel: hourLabel(r.checkInTime || p.defaultCheckIn, L),
      checkOutLabel: hourLabel(r.checkOutTime || p.defaultCheckOut, L),
      propertyHook: safe(en ? (p.emailHookEn || '') : (p.emailHook || '')).trim(),
      bathIncluded: durationLabel(bathMinutes, L),
      bedsParagraph,
      babyParagraph,
      bagList: bagLines.filter(Boolean).join('\n'),
      travelLightParagraph,
      wifiParagraph,
      localProductsParagraph,
      kidsParagraph,
      parkingLine,
      complementLine,
      bookedOptionsParagraph,
      coffeeParagraph,
      cleaningParagraph,
      reviewParagraph,
      instagramParagraph,
      quietSinceDeparture,
      reservedOptionsLabel: cls.bookedTitles.join(', '),
      giftVoucherOffer,
      giftDeadlineLabel,
      seasonYear: sendDate.slice(0, 4),
      lastStayLabel,
      unsubscribeUrl: safe(sequence.unsubscribeUrl),
    },
    flags: {
      hasBedsMade: bedsMade,
      hasTowelsIncluded: towelsIncluded,
      hasBathIncluded: bathMinutes > 0,
      stayOverlapsPool,
      hasPropertyHook: Boolean(safe(en ? p.emailHookEn : p.emailHook).trim()),
      hasBedsParagraph: Boolean(bedsParagraph),
      hasBabyParagraph: Boolean(babyParagraph),
      hasBagList: bagLines.some(Boolean),
      hasTravelLight: Boolean(travelLightParagraph),
      hasWifiParagraph: Boolean(wifiParagraph),
      hasLocalProducts: Boolean(localProductsParagraph),
      hasKidsParagraph: Boolean(kidsParagraph),
      hasParkingLine: Boolean(parkingLine),
      hasComplementLine: Boolean(complementLine),
      hasBookedOptionsParagraph: Boolean(bookedOptionsParagraph),
      hasCoffeeParagraph: Boolean(coffeeParagraph),
      hasCleaningParagraph: Boolean(cleaningParagraph),
      hasReservedOptionsLabel: cls.bookedTitles.length > 0,
      hasReviewParagraph: Boolean(reviewParagraph),
      hasInstagram: Boolean(instagramParagraph),
      hasQuietSinceDeparture: Boolean(quietSinceDeparture),
      isLastMinute: lastMinute,
      hasUnsubscribeUrl: Boolean(safe(sequence.unsubscribeUrl)),
      clientHasEmail: Boolean(safe(c.email).trim()),
    },
  };
}

module.exports = {
  buildStayContent,
  classifyOptions,
  roleOf,
  __test: { euro, weekdayDate, hourLabel, durationLabel, joinList, withArticle },
};
