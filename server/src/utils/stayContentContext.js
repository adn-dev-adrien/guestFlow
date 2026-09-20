/**
 * Stay content of the guest email sequence — pure (specs/guest-email-sequence.md §3.5 + §6.1).
 *
 * Decides, for ONE reservation, what its property includes, what the guest booked and what may still
 * be proposed (rule 20), then composes every conditional paragraph of the six emails in French and
 * English. The template engine has no nesting and no loops, so each paragraph arrives here already
 * written and the templates only place it: `{{#if hasX}}{{x}}{{/if}}`.
 *
 * Inputs are plain rows; `facts` is loaded by `models/stayFactsModel.js`:
 *   facts.defaults       [{ optionId, offered }]            property_option_defaults
 *   facts.available      [option rows with the property's effective `price`]
 *   facts.optionMeta     { [optionId]: { seedKey, category, autoOptionType, title } }
 *   facts.bathFreeMinutes number — nordic-bath minutes included for this property
 *   facts.properties     [{ id, name, nameArticle, minNightlyPrice }]  for the November email
 */

const { formatDateLong } = require('./dateFr');
const { isCleaningOption, normalizeOptionName } = require('./cleaningOption');
const { isClientVisibleOption } = require('./optionVisibility');
const { isDirectChannel } = require('./platformNameFormat');

const WEEKDAYS = { fr: ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'], en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] };
const MONTHS = { fr: ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'], en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] };
const BEER_SEED_KEYS = new Set(['drink_blonde_pilat_75', 'drink_biscanna_75', 'drink_madmax_75']);

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

/** What an option IS for the emails — stable seed keys first, the name only as a last resort. */
function roleOf(option) {
  if (!option) return null;
  const seed = safe(option.seedKey);
  const type = safe(option.autoOptionType);
  const title = normalizeOptionName(option.title);
  const category = normalizeOptionName(option.category);
  if (type === 'bed_linen') return 'bedLinen';
  if (type === 'bathroom_linen') return 'towels';
  if (isCleaningOption(option)) return 'cleaning';
  if (type === 'baby_bed' || title.includes('lit bebe')) return 'babyBed';
  if (type === 'breakfast') return 'breakfast';
  if (seed.startsWith('drink_jus')) return 'juice';
  if (BEER_SEED_KEYS.has(seed)) return 'beer';
  if (seed.startsWith('board_')) return 'board';
  if (title.includes('trappeur')) return 'trapperMeal';
  if (category.includes('animation')) return 'animation';
  return null;
}

/**
 * Rule 20 — included / booked / proposable, per role.
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

  const available = ((facts && facts.available) || [])
    .map(withMeta)
    .filter(isClientVisibleOption);
  const byRole = (role) => available.filter((o) => roleOf(o) === role);
  const priceOf = (role) => {
    const opts = byRole(role);
    if (!opts.length) return null;
    if (role === 'juice') {
      const litre = opts.find((o) => safe(o.seedKey) === 'drink_jus_pomme_1l');
      if (litre) return Number(litre.price || 0);
    }
    return Math.min(...opts.map((o) => Number(o.price || 0)));
  };
  const proposable = (role) => byRole(role).length > 0 && !included.has(role) && !booked.has(role);

  return {
    included,
    booked,
    bookedTitles: bookedLines.map((o) => safe(o.title).trim()).filter(Boolean),
    proposable,
    priceOf,
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

  const propertyWith = withArticle(p.name, p.nameArticle, L);
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
    bedsParagraph = t(
      `Nous préparerons les lits ainsi : ${bedConfigLabel}. Si une autre installation vous convient mieux, dites-le nous simplement : l'essentiel est que chacun dorme bien.`,
      `We will make up the beds as follows: ${bedConfigLabel}. If another arrangement suits you better, just let us know: what matters is that everyone sleeps well.`,
    );
  } else if (bedConfigLabel) {
    const linenPrice = cls.proposable('bedLinen') ? cls.priceOf('bedLinen') : null;
    bedsParagraph = t(
      `Les lits seront installés ainsi : ${bedConfigLabel}. Le linge de lit n'étant pas compris, pensez à prendre draps et taies d'oreiller${linenPrice != null ? `, ou laissez-nous les préparer si vous préférez voyager plus léger (${euro(linenPrice, L)} par personne)` : ''}.`,
      `The beds will be set up as follows: ${bedConfigLabel}. Bed linen is not included, so remember to bring sheets and pillowcases${linenPrice != null ? `, or let us prepare them if you would rather travel lighter (${euro(linenPrice, L)} per person)` : ''}.`,
    );
  }

  let babyParagraph = '';
  if (babies && cls.booked.has('babyBed')) {
    babyParagraph = t(
      'Le lit bébé sera installé avant votre arrivée, avec son linge : vous n\'aurez rien à apporter pour lui.',
      'The baby cot will be set up before you arrive, with its linen: nothing to bring for it.',
    );
  } else if (babies && cls.proposable('babyBed')) {
    babyParagraph = t(
      `Pour le plus petit, nous pouvons installer un lit bébé avec son linge (${euro(cls.priceOf('babyBed'), L)} pour le séjour) : de quoi laisser le lit parapluie à la maison et gagner un peu de place dans le coffre.`,
      `For the little one, we can set up a baby cot with its linen (${euro(cls.priceOf('babyBed'), L)} for the stay): you can leave the travel cot at home and free some space in the boot.`,
    );
  }

  // --- pool season (settings, MM-DD) overlapping the stay
  const stayOverlapsPool = (() => {
    const start = safe(settings.poolSeasonStart || '06-15');
    const end = safe(settings.poolSeasonEnd || '08-31');
    const year = safe(r.startDate).slice(0, 4);
    if (!year || !/^\d{2}-\d{2}$/.test(start) || !/^\d{2}-\d{2}$/.test(end)) return false;
    return safe(r.startDate).slice(0, 10) <= `${year}-${end}` && safe(r.endDate).slice(0, 10) > `${year}-${start}`;
  })();

  // --- J-7 bag + property facts
  const bagLines = [
    t(`- Maillots de bain et serviettes pour le bain nordique${stayOverlapsPool ? ', et pour la piscine' : ''}`,
      `- Swimsuits and towels for the nordic bath${stayOverlapsPool ? ' and the pool' : ''}`),
    t('- Des chaussures fermées pour les sentiers du domaine', '- Closed shoes for the paths of the domain'),
  ];
  if (!towelsCovered) {
    const towelPrice = cls.proposable('towels') ? cls.priceOf('towels') : null;
    bagLines.push(towelPrice != null
      ? t(`- Vos serviettes de toilette. Si vous préférez voyager plus léger, et ne pas rentrer avec une machine à lancer, nous pouvons aussi les préparer pour vous (${euro(towelPrice, L)} par personne).`,
        `- Your bath towels. If you would rather travel lighter, and not come home to a load of washing, we can also prepare them for you (${euro(towelPrice, L)} per person).`)
      : t('- Vos serviettes de toilette', '- Your bath towels'));
  }
  const parking = Number(p.parkingDistanceMeters || 0);
  const travelLightParagraph = parking > 0 ? t(
    `Un conseil pour les valises : voyagez léger. Le parking se trouve à ${parking} mètres ${propertyWith.replace(/^à /, 'de ').replace(/^au /, 'du ').replace(/^aux /, 'des ')}, et le dernier bout se fait à pied, à travers la prairie. Un sac souple se porte bien mieux qu'une grosse valise à roulettes.`,
    `A tip for packing: travel light. The car park is ${parking} metres from ${safe(p.name)}, and the last stretch is on foot, across the meadow. A soft bag is much easier to carry than a large suitcase on wheels.`,
  ) : '';
  const wifiParagraph = Number(p.hasWifi == null ? 1 : p.hasWifi) === 0 ? t(
    `${propertyWith.charAt(0).toUpperCase()}${propertyWith.slice(1)}, pas de wifi : c'est un choix, pour mieux profiter du reste. Le réseau mobile est en revanche disponible sur l'ensemble du domaine.`,
    `There is no wifi at ${safe(p.name)}: it is a choice, to make the most of everything else. Mobile network, on the other hand, is available across the whole domain.`,
  ) : '';

  // --- J-7 local products, worded as lightening the load (rule 24)
  const deadlineIso = r.startDate ? new Date(Date.parse(`${safe(r.startDate).slice(0, 10)}T00:00:00Z`) - 3 * 86400000).toISOString().slice(0, 10) : '';
  const local = [];
  if (cls.proposable('juice')) local.push(t(`les jus du Pressoir du Pilat (${euro(cls.priceOf('juice'), L)} le litre)`, `juices from the Pressoir du Pilat (${euro(cls.priceOf('juice'), L)} a litre)`));
  if (cls.proposable('beer')) local.push(t(`les bières de la Brasserie du Pilat (${euro(cls.priceOf('beer'), L)} la bouteille)`, `beers from the Brasserie du Pilat (${euro(cls.priceOf('beer'), L)} a bottle)`));
  const extras = [];
  if (cls.proposable('board')) extras.push(t(`une planche du terroir pour le premier apéritif (à partir de ${euro(cls.priceOf('board'), L)})`, `a local platter for your first apéritif (from ${euro(cls.priceOf('board'), L)})`));
  if (cls.proposable('trapperMeal')) extras.push(t(`le repas des trappeurs (${euro(cls.priceOf('trapperMeal'), L)} par personne)`, `the trappers' dinner (${euro(cls.priceOf('trapperMeal'), L)} per person)`));
  if (cls.proposable('breakfast')) extras.push(t(`le petit-déjeuner, à retirer chaque matin au bâtiment d'accueil (${euro(cls.priceOf('breakfast'), L)} par personne et par jour)`, `breakfast, to collect each morning at the reception building (${euro(cls.priceOf('breakfast'), L)} per person per day)`));
  let localProductsParagraph = '';
  if (local.length || extras.length) {
    const parts = [];
    if (local.length) {
      parts.push(t(
        `Pour alléger les courses, nous travaillons avec des producteurs locaux : ${joinList(local, L)}. Nous vous les proposons à leur prix de vente en magasin, et ils peuvent vous attendre au frais à votre arrivée.`,
        `To lighten your shopping, we work with local producers: ${joinList(local, L)}. We offer them at their shop price, and they can be waiting for you, chilled, when you arrive.`,
      ));
    }
    if (extras.length) {
      parts.push(local.length
        ? t(`De la même façon, nous pouvons prévoir ${joinList(extras, L)}.`, `In the same way, we can arrange ${joinList(extras, L)}.`)
        : t(`Pour alléger les courses, nous pouvons prévoir ${joinList(extras, L)}.`, `To lighten your shopping, we can arrange ${joinList(extras, L)}.`));
    }
    parts.push(t(`Il suffit de nous le dire d'ici le ${weekdayDate(deadlineIso, L)}.`, `Just let us know by ${weekdayDate(deadlineIso, L)}.`));
    localProductsParagraph = parts.join(' ');
  }
  const kidsParagraph = kids && ((facts.available || []).some((o) => roleOf({ ...((facts.optionMeta || {})[o.id] || {}), ...o }) === 'animation')) ? t(
    'Et si vos enfants aiment les animaux, il y a aussi quelques beaux moments à partager avec ceux du domaine : nous vous en parlerons sur place.',
    'And if your children love animals, there are some lovely moments to share with those of the domain: we will tell you about them on site.',
  ) : '';

  // --- J-2
  const parkingLine = parking > 0 ? t(
    `- Garez-vous au parking, à ${parking} mètres ${propertyWith.replace(/^à /, 'de ').replace(/^au /, 'du ').replace(/^aux /, 'des ')} : le reste du chemin se fait à pied.`,
    `- Park in the car park, ${parking} metres from ${safe(p.name)}: the rest of the way is on foot.`,
  ) : '';
  const notedSentences = {
    breakfast: t('Le petit-déjeuner vous attendra chaque matin au bâtiment d\'accueil.', 'Breakfast will be waiting for you every morning at the reception building.'),
    babyBed: t('Le lit bébé sera installé avant votre arrivée, avec son linge.', 'The baby cot will be set up before you arrive, with its linen.'),
    towels: t('Vos serviettes de toilette seront prêtes, vous n\'aurez qu\'à poser vos sacs.', 'Your bath towels will be ready: you will only have to put your bags down.'),
    board: t('Votre planche du terroir sera prête pour un premier apéritif sur la terrasse.', 'Your local platter will be ready for a first apéritif on the terrace.'),
    juice: t('Les jus du Pressoir du Pilat vous attendront au frais.', 'The Pressoir du Pilat juices will be waiting for you, chilled.'),
    beer: t('Les bières de la Brasserie du Pilat vous attendront au frais.', 'The Brasserie du Pilat beers will be waiting for you, chilled.'),
    trapperMeal: t('Pour le repas des trappeurs, nous conviendrons du soir ensemble à votre arrivée.', 'For the trappers\' dinner, we will agree on the evening together when you arrive.'),
    animation: t('Pour le moment avec les animaux, nous choisirons l\'heure ensemble sur place.', 'For the time with the animals, we will choose the hour together on site.'),
  };
  const bookedOptionsParagraph = ['breakfast', 'babyBed', 'towels', 'board', 'juice', 'beer', 'trapperMeal', 'animation']
    .filter((role) => cls.booked.has(role))
    .map((role) => notedSentences[role])
    .join('\n');
  const coffeeParagraph = Number(p.hasFilterCoffeeMaker || 0) === 1
    ? t('Dans la maison, vous trouverez une machine Nespresso à capsules, et aussi une grande cafetière familiale pour le café moulu.', 'In the house you will find a Nespresso capsule machine, and also a large family coffee maker for ground coffee.')
    : t('Dans le logement, une machine Nespresso à capsules vous attend pour le café du matin.', 'A Nespresso capsule machine is waiting for you for your morning coffee.');
  let cleaningParagraph;
  if (cleaningIncluded) {
    cleaningParagraph = t('Le ménage de fin de séjour est pour nous : profitez de votre dernière matinée sans y penser.', 'End-of-stay cleaning is on us: enjoy your last morning without a thought for it.');
  } else if (cleaningBooked) {
    cleaningParagraph = t('Vous avez choisi l\'option ménage : profitez de votre dernière matinée, nous nous occupons du reste.', 'You chose the cleaning option: enjoy your last morning, we take care of the rest.');
  } else {
    cleaningParagraph = t(
      'Pour rappel, vous n\'avez pas choisi l\'option ménage : nous vous demanderons donc de rendre le logement comme vous l\'avez trouvé. Rien de compliqué, un petit panneau dans le logement vous indique ce qui est attendu. Et si, une fois sur place, vous préférez garder votre dernière matinée pour vous, l\'option reste possible : il suffit de nous le dire.',
      'As a reminder, you did not choose the cleaning option, so we will ask you to leave the accommodation as you found it. Nothing complicated: a small sign inside tells you what is expected. And if, once there, you would rather keep your last morning for yourselves, the option is still possible: just let us know.',
    );
  }
  const complementDue = Number(r.complementAmount || 0) > 0 && Number(r.complementPaid || 0) !== 1;
  const complementLine = complementDue ? (Number(r.complementDeferredToCheckout || 0) === 1
    ? t(`Un complément de ${euro(r.complementAmount, L)} reste à régler sur place à votre départ.`, `A balance of ${euro(r.complementAmount, L)} remains to be paid on site when you leave.`)
    : t(`Un complément de ${euro(r.complementAmount, L)} reste à régler sur place à votre arrivée.`, `A balance of ${euro(r.complementAmount, L)} remains to be paid on site when you arrive.`)) : '';

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
    if (googleReviewUrl) {
      reviewParagraph = t(
        `Si vous en avez envie, quelques mots sur notre page Google nous aideraient beaucoup : ${googleReviewUrl}. C'est souvent grâce à ces avis que d'autres familles osent venir jusqu'ici.`,
        `If you feel like it, a few words on our Google page would help us a lot: ${googleReviewUrl}. It is often thanks to these reviews that other families dare to come all the way here.`,
      );
    }
  } else {
    reviewParagraph = t(
      `Si ce n'est pas déjà fait, quelques mots sur ${platformName} nous aideraient beaucoup : c'est souvent grâce à ces avis que d'autres familles osent venir jusqu'ici.${googleReviewUrl ? ` Et si vous avez envie d'en dire un peu plus, votre message est aussi le bienvenu sur notre page Google : ${googleReviewUrl}` : ''}`,
      `If you have not done so already, a few words on ${platformName} would help us a lot: it is often thanks to these reviews that other families dare to come all the way here.${googleReviewUrl ? ` And if you would like to say a little more, your message is also welcome on our Google page: ${googleReviewUrl}` : ''}`,
    );
  }
  const lostItems = safe(r.lostItems).trim();
  const lostItemsParagraph = lostItems
    ? t(`Nous avons retrouvé ${lostItems} après votre départ : dites-nous si nous vous le renvoyons.`, `We found ${lostItems} after you left: let us know if you would like us to send it back.`)
    : t('Un objet oublié ? Dites-le nous, nous mettons tout de côté.', 'Forgotten something? Let us know, we set everything aside.');
  const instagramUrl = safe(settings.instagramUrl).trim();
  const instagramParagraph = instagramUrl ? t(
    `Si vous êtes nostalgiques de votre séjour, n'hésitez pas à nous suivre sur les réseaux sociaux : ${instagramUrl}`,
    `If you miss your stay, feel free to follow us on social media: ${instagramUrl}`,
  ) : '';

  // --- season emails
  const offers = (facts.properties || [])
    .filter((prop) => Number(prop.minNightlyPrice || 0) > 0)
    .map((prop) => t(
      `${withArticle(prop.name, prop.nameArticle, 'fr')}, à partir de ${euro(prop.minNightlyPrice, 'fr')} la nuit`,
      `at ${safe(prop.name)}, from ${euro(prop.minNightlyPrice, 'en')} a night`,
    ));
  const giftVoucherOffer = offers.length
    ? t(`une ou plusieurs nuits ${offers.join(', ou ')}`, `one or more nights ${offers.join(', or ')}`)
    : t('une ou plusieurs nuits au domaine', 'one or more nights at the domain');
  const sendDate = safe(sequence.sendDate);
  const giftDeadlineLabel = sequence.giftDeadline ? weekdayDate(sequence.giftDeadline, L) : '';
  const lastStayLabel = r.startDate
    ? t(`${propertyWith} en ${MONTHS.fr[Number(safe(r.startDate).slice(5, 7)) - 1]} ${safe(r.startDate).slice(0, 4)}`,
      `at ${safe(p.name)} in ${MONTHS.en[Number(safe(r.startDate).slice(5, 7)) - 1]} ${safe(r.startDate).slice(0, 4)}`)
    : '';

  // J+1 opening — built on the article, so it reads right whatever the name's gender (« Au Gite »,
  // « À La Granja »).
  const quietSinceDeparture = t(
    `${propertyWith.charAt(0).toUpperCase()}${propertyWith.slice(1)}, tout semble bien silencieux depuis votre départ, et les animaux ont l'air de se demander où sont passés leurs visiteurs.`,
    `At ${safe(p.name)}, everything seems very quiet since you left, and the animals seem to wonder where their visitors have gone.`,
  );

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
      bagList: bagLines.join('\n'),
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
      lostItemsParagraph,
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
      hasTravelLight: Boolean(travelLightParagraph),
      hasWifiParagraph: Boolean(wifiParagraph),
      hasLocalProducts: Boolean(localProductsParagraph),
      hasKidsParagraph: Boolean(kidsParagraph),
      hasParkingLine: Boolean(parkingLine),
      hasComplementLine: Boolean(complementLine),
      hasBookedOptionsParagraph: Boolean(bookedOptionsParagraph),
      hasReservedOptionsLabel: cls.bookedTitles.length > 0,
      hasReviewParagraph: Boolean(reviewParagraph),
      hasInstagram: Boolean(instagramParagraph),
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
