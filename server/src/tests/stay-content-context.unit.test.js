// specs/guest-email-sequence.md §3.5 rules 20-29 — what each property includes, what is booked, what
// may still be proposed, and the paragraphs composed from it.

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildStayContent, classifyOptions, roleOf } = require('../utils/stayContentContext');

const META = {
  3: { id: 3, title: 'Ménage', autoOptionType: 'cleaning' },
  6: { id: 6, title: 'Petit déjeuner', autoOptionType: 'breakfast' },
  7: { id: 7, title: 'Ménage', autoOptionType: 'cleaning' },
  8: { id: 8, title: 'Linge de lit', autoOptionType: 'bed_linen' },
  9: { id: 9, title: 'Linge de toilette', autoOptionType: 'bathroom_linen' },
  16: { id: 16, title: 'Le repas des trappeurs', category: 'Restauration' },
  18: { id: 18, title: 'Blonde du Pilat 75cl', seedKey: 'drink_blonde_pilat_75', category: 'Boissons' },
  21: { id: 21, title: 'Jus de pomme 1L', seedKey: 'drink_jus_pomme_1l', category: 'Boissons' },
  24: { id: 24, title: 'Jus de pomme 25cl', seedKey: 'drink_jus_pomme_25cl', category: 'Boissons' },
  27: { id: 27, title: 'Planche S', seedKey: 'board_s', category: 'Restauration' },
  33: { id: 33, title: 'Lit bébé', autoOptionType: 'baby_bed' },
  11: { id: 11, title: 'Animation-visite animaux', category: 'Animations' },
};
const priced = (id, price) => ({ ...META[id], price });
const GRANJA = {
  optionMeta: META,
  defaults: [{ optionId: 8, offered: 1 }],
  available: [priced(3, 80), priced(9, 8), priced(6, 8), priced(18, 6.5), priced(21, 5), priced(24, 3), priced(27, 17), priced(33, 5), priced(11, 30)],
  bathFreeMinutes: 90,
  properties: [{ id: 1, name: 'La Granja', nameArticle: 'à', minNightlyPrice: 319 }, { id: 2, name: 'L\'Estiva', nameArticle: 'à', minNightlyPrice: 179 }],
};
const ESTIVA = {
  optionMeta: META,
  defaults: [{ optionId: 7, offered: 1 }, { optionId: 8, offered: 1 }, { optionId: 9, offered: 1 }],
  available: [priced(6, 8), priced(16, 25), priced(18, 6.5), priced(21, 5), priced(27, 17), priced(33, 5)],
  bathFreeMinutes: 60,
};
const RES = { id: 1, startDate: '2027-07-10', endDate: '2027-07-17', adults: 2, children: 2, doubleBeds: 1, singleBeds: 2, platform: 'direct' };

function content({ reservation = {}, property = {}, options = [], facts = GRANJA, settings = {}, lang = 'fr', sequence = {} } = {}) {
  return buildStayContent({
    reservation: { ...RES, ...reservation },
    client: { id: 1, email: 'c@x.fr' },
    property: { name: 'La Granja', nameArticle: 'à', ...property },
    options, facts, settings, lang, sequence,
  });
}

test('roles come from seed keys and tags first, the name only for hand-made options', () => {
  assert.equal(roleOf(META[21]), 'juice');
  assert.equal(roleOf(META[18]), 'beer');
  assert.equal(roleOf(META[27]), 'board');
  assert.equal(roleOf(META[16]), 'trapperMeal');
  assert.equal(roleOf(META[9]), 'towels');
  assert.equal(roleOf({ title: 'Ménage fin de séjour' }), 'cleaning');
});

test('included = the property defaults — even on an iCal booking with no option line', () => {
  const estiva = classifyOptions([], ESTIVA);
  assert.deepEqual([...estiva.included].sort(), ['bedLinen', 'cleaning', 'towels']);
  const granja = classifyOptions([], GRANJA);
  assert.deepEqual([...granja.included], ['bedLinen']);
});

test('a booked or included option is never proposed again', () => {
  const booked = content({ options: [{ optionId: 18, offered: 0, title: 'Blonde du Pilat 75cl' }, { optionId: 27, offered: 0, title: 'Planche S' }] });
  assert.doesNotMatch(booked.vars.localProductsParagraph, /bières/);
  assert.doesNotMatch(booked.vars.localProductsParagraph, /planche/);
  assert.match(booked.vars.localProductsParagraph, /jus du Pressoir du Pilat/);
  const estiva = content({ property: { name: 'L\'Estiva' }, facts: ESTIVA });
  assert.doesNotMatch(estiva.vars.bagList, /serviettes de toilette/);
  assert.match(estiva.vars.cleaningParagraph, /est pour nous/);
});

test('unit prices only: juice per litre from the 1 L bottle, towels per person, never a total', () => {
  const c = content();
  assert.match(c.vars.localProductsParagraph, /\(5 € le litre\)/);
  assert.match(c.vars.localProductsParagraph, /\(6,50 € la bouteille\)/);
  assert.match(c.vars.localProductsParagraph, /à leur prix de vente en magasin/);
  assert.match(c.vars.bagList, /\(8 € par personne\)\./);
  for (const value of Object.values(c.vars)) assert.doesNotMatch(String(value), /Total/);
});

test('trappers\' dinner and breakfast are proposed where the property offers them', () => {
  const estiva = content({ property: { name: 'L\'Estiva' }, facts: ESTIVA });
  assert.match(estiva.vars.localProductsParagraph, /le repas des trappeurs \(25 € par personne\)/);
  assert.match(estiva.vars.localProductsParagraph, /le petit-déjeuner, à retirer chaque matin/);
  assert.doesNotMatch(content().vars.localProductsParagraph, /trappeurs/, 'not available at La Granja');
});

test('baby cot: confirmed with its linen when booked, proposed when not, silent without a baby', () => {
  assert.match(content({ reservation: { babies: 1 }, options: [{ optionId: 33, offered: 0, title: 'Lit bébé' }] }).vars.babyParagraph, /installé avant votre arrivée, avec son linge/);
  assert.match(content({ reservation: { babies: 1 } }).vars.babyParagraph, /\(5 € pour le séjour\)/);
  assert.equal(content().vars.babyParagraph, '');
});

test('bed configuration and the included nordic-bath duration', () => {
  const granja = content();
  assert.match(granja.vars.bedsParagraph, /1 lit double et 2 lits simples/);
  assert.equal(granja.vars.bathIncluded, '1 h 30');
  assert.equal(content({ facts: ESTIVA }).vars.bathIncluded, '1 h');
  assert.equal(content({ facts: { ...GRANJA, bathFreeMinutes: 0 } }).flags.hasBathIncluded, false);
});

test('pool: mentioned only when the stay overlaps the season set in Réglages', () => {
  assert.equal(content().flags.stayOverlapsPool, true);
  assert.equal(content({ reservation: { startDate: '2027-10-02', endDate: '2027-10-04' } }).flags.stayOverlapsPool, false);
  assert.equal(content({ settings: { poolSeasonStart: '07-15', poolSeasonEnd: '08-15' } }).flags.stayOverlapsPool, true);
  assert.equal(content({ settings: { poolSeasonStart: '07-20', poolSeasonEnd: '08-15' } }).flags.stayOverlapsPool, false);
});

test('L\'Estiva facts: travel light (parking distance), no wifi; La Granja: family coffee maker', () => {
  const estiva = content({ property: { name: 'L\'Estiva', parkingDistanceMeters: 300, hasWifi: 0 }, facts: ESTIVA });
  assert.match(estiva.vars.travelLightParagraph, /Le parking se trouve à 300 mètres de L'Estiva/);
  assert.match(estiva.vars.wifiParagraph, /^À L'Estiva, pas de wifi/);
  assert.match(estiva.vars.parkingLine, /à 300 mètres de L'Estiva/);
  const granja = content({ property: { hasFilterCoffeeMaker: 1 } });
  assert.equal(granja.vars.travelLightParagraph, '');
  assert.match(granja.vars.coffeeParagraph, /grande cafetière familiale/);
});

test('J-2 cleaning: included, booked, or the gentle reminder with the sign in the lodging', () => {
  assert.match(content({ facts: ESTIVA }).vars.cleaningParagraph, /est pour nous/);
  assert.match(content({ options: [{ optionId: 3, offered: 0, title: 'Ménage' }] }).vars.cleaningParagraph, /Vous avez choisi l'option ménage/);
  const reminder = content().vars.cleaningParagraph;
  assert.match(reminder, /rendre le logement comme vous l'avez trouvé/);
  assert.match(reminder, /un petit panneau/);
  assert.match(reminder, /l'option reste possible/);
});

test('J-2 booked options are said one warm sentence each, never as a list', () => {
  const c = content({ options: [{ optionId: 6, offered: 0, title: 'Petit déjeuner' }, { optionId: 33, offered: 0, title: 'Lit bébé' }], reservation: { babies: 1 } });
  assert.equal(c.vars.bookedOptionsParagraph, [
    'Le petit-déjeuner vous attendra chaque matin au bâtiment d\'accueil.',
    'Le lit bébé sera installé avant votre arrivée, avec son linge.',
  ].join('\n'));
  assert.doesNotMatch(c.vars.bookedOptionsParagraph, /Nous avons bien noté/);
});

test('J+1 review: Google only in direct; the platform first, Google as an extra, otherwise', () => {
  const settings = { googleReviewUrl: 'https://g.page/r/solio/review' };
  const direct = content({ settings }).vars.reviewParagraph;
  assert.match(direct, /notre page Google/);
  assert.doesNotMatch(direct, /Airbnb|Gîtes/);
  const gdf = content({ settings, reservation: { platform: 'GitesDeFrance' } }).vars.reviewParagraph;
  assert.match(gdf, /^Si ce n'est pas déjà fait, quelques mots sur votre espace Gîtes de France/);
  assert.match(gdf, /aussi le bienvenu sur notre page Google/);
  assert.match(content({ settings, reservation: { platform: 'Airbnb' } }).vars.reviewParagraph, /quelques mots sur Airbnb/);
  assert.equal(content().vars.reviewParagraph, '', 'no Google link configured → no direct solicitation');
});

test('J+1 lost items and Instagram', () => {
  assert.match(content({ reservation: { lostItems: 'un doudou lapin bleu' } }).vars.lostItemsParagraph, /Nous avons retrouvé un doudou lapin bleu/);
  assert.match(content().vars.lostItemsParagraph, /nous mettons tout de côté/);
  assert.match(content({ settings: { instagramUrl: 'https://www.instagram.com/domainesolio' } }).vars.instagramParagraph, /nostalgiques de votre séjour.*instagram\.com\/domainesolio/);
  assert.equal(content().flags.hasInstagram, false);
});

test('season: « à partir de » prices per property, deadline with its weekday, last stay', () => {
  const c = content({ sequence: { sendDate: '2027-11-15', giftDeadline: '2027-12-15' } });
  assert.equal(c.vars.giftVoucherOffer, 'une ou plusieurs nuits à La Granja, à partir de 319 € la nuit, ou à L\'Estiva, à partir de 179 € la nuit');
  assert.equal(c.vars.giftDeadlineLabel, 'mercredi 15 décembre 2027');
  assert.equal(c.vars.lastStayLabel, 'à La Granja en juillet 2027');
  assert.equal(c.vars.seasonYear, '2027');
});

test('English: same decisions, English wording', () => {
  const c = content({ lang: 'en', reservation: { babies: 1 } });
  assert.match(c.vars.babyParagraph, /baby cot with its linen \(€5 for the stay\)/);
  assert.match(c.vars.localProductsParagraph, /at their shop price/);
  assert.equal(c.vars.arrivalDateLabel, 'Saturday 10 July 2027');
});
