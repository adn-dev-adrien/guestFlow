/**
 * Phase P one-shot migration `productisation_v1` (specs/plugins-phase-p-productisation.md §3.E rules
 * 24–25): an existing database keeps, as data, every sentence the code wrote before phase P.
 *
 * This file is the only place in the product that knows Solio's wording, its catering seed keys and
 * its option names. It runs once, on a database that already holds properties or reservations, and
 * only ever adds: a text, a mention, a resource sentence or a setting is written where none exists.
 *
 * Also applies the phase's columns (`applyProductisationSchema`), idempotent, on every boot.
 */

const { CATALOGUE } = require('./stayTextCatalogue');
const { normalizeOptionName, isCleaningOption } = require('./cleaningOption');

const MIGRATION = 'productisation_v1';

function applyProductisationSchema(db) {
  const addColumns = (table, columns) => {
    const existing = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
    if (existing.length === 0) return;
    for (const [name, definition] of columns) {
      if (!existing.includes(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
    }
  };
  addColumns('platforms', [['countsAsDirect', 'INTEGER NOT NULL DEFAULT 0']]);
  addColumns('app_settings', [
    ['onboardingCompletedAt', 'TEXT'],
    ['vapidSubject', "TEXT NOT NULL DEFAULT ''"],
  ]);
}

/* eslint-disable max-len */
// The wording composed by utils/stayContentContext.js and utils/emailContextBuilder.js until phase P.
const SOLIO_TEXTS = {
  'beds.made': {
    fr: 'Nous préparerons les lits ainsi : {{bedConfig}}. Si une autre installation vous convient mieux, dites-le nous simplement : l\'essentiel est que chacun dorme bien.',
    en: 'We will make up the beds as follows: {{bedConfig}}. If another arrangement suits you better, just let us know: what matters is that everyone sleeps well.',
  },
  'beds.linenNotIncluded': {
    fr: 'Les lits seront installés ainsi : {{bedConfig}}. Le linge de lit n\'étant pas compris, pensez à prendre draps et taies d\'oreiller{{#if linenOffered}}, ou laissez-nous les préparer si vous préférez voyager plus léger ({{price}} par personne){{/if}}.',
    en: 'The beds will be set up as follows: {{bedConfig}}. Bed linen is not included, so remember to bring sheets and pillowcases{{#if linenOffered}}, or let us prepare them if you would rather travel lighter ({{price}} per person){{/if}}.',
  },
  'baby.booked': {
    fr: 'Le lit bébé sera installé avant votre arrivée, avec son linge : vous n\'aurez rien à apporter pour lui.',
    en: 'The baby cot will be set up before you arrive, with its linen: nothing to bring for it.',
  },
  'baby.offer': {
    fr: 'Pour le plus petit, nous pouvons installer un lit bébé avec son linge ({{price}} pour le séjour) : de quoi laisser le lit parapluie à la maison et gagner un peu de place dans le coffre.',
    en: 'For the little one, we can set up a baby cot with its linen ({{price}} for the stay): you can leave the travel cot at home and free some space in the boot.',
  },
  'bag.items': {
    fr: '- Maillots de bain et serviettes pour le bain nordique{{#if stayOverlapsPool}}, et pour la piscine{{/if}}\n- Des chaussures fermées pour les sentiers du domaine',
    en: '- Swimsuits and towels for the nordic bath{{#if stayOverlapsPool}} and the pool{{/if}}\n- Closed shoes for the paths of the domain',
  },
  'bag.towels': { fr: '- Vos serviettes de toilette', en: '- Your bath towels' },
  'bag.towelsOffer': {
    fr: '- Vos serviettes de toilette. Si vous préférez voyager plus léger, et ne pas rentrer avec une machine à lancer, nous pouvons aussi les préparer pour vous ({{price}} par personne).',
    en: '- Your bath towels. If you would rather travel lighter, and not come home to a load of washing, we can also prepare them for you ({{price}} per person).',
  },
  travelLight: {
    fr: 'Un conseil pour les valises : voyagez léger. Le parking se trouve à {{distance}} mètres {{propertyFrom}}, et le dernier bout se fait à pied, à travers la prairie. Un sac souple se porte bien mieux qu\'une grosse valise à roulettes.',
    en: 'A tip for packing: travel light. The car park is {{distance}} metres from {{propertyName}}, and the last stretch is on foot, across the meadow. A soft bag is much easier to carry than a large suitcase on wheels.',
  },
  noWifi: {
    fr: '{{PropertyWith}}, pas de wifi : c\'est un choix, pour mieux profiter du reste. Le réseau mobile est en revanche disponible sur l\'ensemble du domaine.',
    en: 'There is no wifi at {{propertyName}}: it is a choice, to make the most of everything else. Mobile network, on the other hand, is available across the whole domain.',
  },
  'offers.localIntro': {
    fr: 'Pour alléger les courses, nous travaillons avec des producteurs locaux : {{list}}. Nous vous les proposons à leur prix de vente en magasin, et ils peuvent vous attendre au frais à votre arrivée.',
    en: 'To lighten your shopping, we work with local producers: {{list}}. We offer them at their shop price, and they can be waiting for you, chilled, when you arrive.',
  },
  'offers.extrasIntro': {
    fr: 'Pour alléger les courses, nous pouvons prévoir {{list}}.',
    en: 'To lighten your shopping, we can arrange {{list}}.',
  },
  'offers.extrasAfterLocal': {
    fr: 'De la même façon, nous pouvons prévoir {{list}}.',
    en: 'In the same way, we can arrange {{list}}.',
  },
  'offers.deadline': {
    fr: 'Il suffit de nous le dire d\'ici le {{date}}.',
    en: 'Just let us know by {{date}}.',
  },
  parkingLine: {
    fr: '- Garez-vous au parking, à {{distance}} mètres {{propertyFrom}} : le reste du chemin se fait à pied.',
    en: '- Park in the car park, {{distance}} metres from {{propertyName}}: the rest of the way is on foot.',
  },
  house: {
    fr: 'Dans le logement, une machine Nespresso à capsules vous attend pour le café du matin.',
    en: 'A Nespresso capsule machine is waiting for you for your morning coffee.',
  },
  'cleaning.included': {
    fr: 'Le ménage de fin de séjour est pour nous : profitez de votre dernière matinée sans y penser.',
    en: 'End-of-stay cleaning is on us: enjoy your last morning without a thought for it.',
  },
  'cleaning.booked': {
    fr: 'Vous avez choisi l\'option ménage : profitez de votre dernière matinée, nous nous occupons du reste.',
    en: 'You chose the cleaning option: enjoy your last morning, we take care of the rest.',
  },
  'cleaning.notBooked': {
    fr: 'Pour rappel, vous n\'avez pas choisi l\'option ménage : nous vous demanderons donc de rendre le logement comme vous l\'avez trouvé. Rien de compliqué, un petit panneau dans le logement vous indique ce qui est attendu. Et si, une fois sur place, vous préférez garder votre dernière matinée pour vous, l\'option reste possible : il suffit de nous le dire.',
    en: 'As a reminder, you did not choose the cleaning option, so we will ask you to leave the accommodation as you found it. Nothing complicated: a small sign inside tells you what is expected. And if, once there, you would rather keep your last morning for yourselves, the option is still possible: just let us know.',
  },
  'complement.atArrival': {
    fr: 'Un complément de {{amount}} reste à régler sur place à votre arrivée.',
    en: 'A balance of {{amount}} remains to be paid on site when you arrive.',
  },
  'complement.atDeparture': {
    fr: 'Un complément de {{amount}} reste à régler sur place à votre départ.',
    en: 'A balance of {{amount}} remains to be paid on site when you leave.',
  },
  'booked.babyBed': {
    fr: 'Le lit bébé sera installé avant votre arrivée, avec son linge.',
    en: 'The baby cot will be set up before you arrive, with its linen.',
  },
  'booked.towels': {
    fr: 'Vos serviettes de toilette seront prêtes, vous n\'aurez qu\'à poser vos sacs.',
    en: 'Your bath towels will be ready: you will only have to put your bags down.',
  },
  'review.direct': {
    fr: 'Si vous en avez envie, quelques mots sur notre page Google nous aideraient beaucoup : {{link}}. C\'est souvent grâce à ces avis que d\'autres familles osent venir jusqu\'ici.',
    en: 'If you feel like it, a few words on our Google page would help us a lot: {{link}}. It is often thanks to these reviews that other families dare to come all the way here.',
  },
  'review.platform': {
    fr: 'Si ce n\'est pas déjà fait, quelques mots sur {{platform}} nous aideraient beaucoup : c\'est souvent grâce à ces avis que d\'autres familles osent venir jusqu\'ici.{{#if hasGoogleReview}} Et si vous avez envie d\'en dire un peu plus, votre message est aussi le bienvenu sur notre page Google : {{link}}{{/if}}',
    en: 'If you have not done so already, a few words on {{platform}} would help us a lot: it is often thanks to these reviews that other families dare to come all the way here.{{#if hasGoogleReview}} And if you would like to say a little more, your message is also welcome on our Google page: {{link}}{{/if}}',
  },
  instagram: {
    fr: 'Si vous êtes nostalgiques de votre séjour, n\'hésitez pas à nous suivre sur les réseaux sociaux : {{link}}',
    en: 'If you miss your stay, feel free to follow us on social media: {{link}}',
  },
  quietSinceDeparture: {
    fr: '{{PropertyWith}}, tout semble bien silencieux depuis votre départ, et les animaux ont l\'air de se demander où sont passés leurs visiteurs.',
    en: 'At {{propertyName}}, everything seems very quiet since you left, and the animals seem to wonder where their visitors have gone.',
  },
  'gift.list': { fr: 'une ou plusieurs nuits {{list}}', en: 'one or more nights {{list}}' },
  'gift.offer': {
    fr: '{{propertyWith}}, à partir de {{price}} la nuit',
    en: 'at {{propertyName}}, from {{price}} a night',
  },
  'gift.fallback': { fr: 'une ou plusieurs nuits au domaine', en: 'one or more nights at the domain' },
};

// The « cafetière familiale » variant, written on the properties that had the box ticked.
const HOUSE_WITH_FILTER_COFFEE = {
  fr: 'Dans la maison, vous trouverez une machine Nespresso à capsules, et aussi une grande cafetière familiale pour le café moulu.',
  en: 'In the house you will find a Nespresso capsule machine, and also a large family coffee maker for ground coffee.',
};

const NORDIC_BATH = {
  fr: 'Vous avez réservé le bain nordique : un véritable moment de détente vous attend !{{#if slots}} Votre créneau est réservé {{slots}}.{{/if}} Pour en profiter pleinement, pensez à emporter votre maillot de bain, un peignoir ou une serviette, ainsi qu\'une paire de tongs — ces équipements ne sont pas fournis sur place.',
  en: 'You have booked the nordic bath: a real moment of relaxation awaits you!{{#if slots}} Your slot is reserved {{slots}}.{{/if}} To make the most of it, remember to bring your swimsuit, a bathrobe or a towel, and a pair of flip-flops — these items are not provided on site.',
};

// The option roles the engine recognised until phase P, in the order they were proposed, with the
// section, the price they quoted and their two sentences.
const BEER_SEED_KEYS = new Set(['drink_blonde_pilat_75', 'drink_biscanna_75', 'drink_madmax_75']);
const MENTIONS = [
  {
    role: 'juice', section: 'local', priceSeedKey: 'drink_jus_pomme_1l',
    offerFr: 'les jus du Pressoir du Pilat ({{price}} le litre)', offerEn: 'juices from the Pressoir du Pilat ({{price}} a litre)',
    bookedFr: 'Les jus du Pressoir du Pilat vous attendront au frais.', bookedEn: 'The Pressoir du Pilat juices will be waiting for you, chilled.',
  },
  {
    role: 'beer', section: 'local',
    offerFr: 'les bières de la Brasserie du Pilat ({{price}} la bouteille)', offerEn: 'beers from the Brasserie du Pilat ({{price}} a bottle)',
    bookedFr: 'Les bières de la Brasserie du Pilat vous attendront au frais.', bookedEn: 'The Brasserie du Pilat beers will be waiting for you, chilled.',
  },
  {
    role: 'board', section: 'extras',
    offerFr: 'une planche du terroir pour le premier apéritif (à partir de {{price}})', offerEn: 'a local platter for your first apéritif (from {{price}})',
    bookedFr: 'Votre planche du terroir sera prête pour un premier apéritif sur la terrasse.', bookedEn: 'Your local platter will be ready for a first apéritif on the terrace.',
  },
  {
    role: 'trapperMeal', section: 'extras',
    offerFr: 'le repas des trappeurs ({{price}} par personne)', offerEn: 'the trappers\' dinner ({{price}} per person)',
    bookedFr: 'Pour le repas des trappeurs, nous conviendrons du soir ensemble à votre arrivée.', bookedEn: 'For the trappers\' dinner, we will agree on the evening together when you arrive.',
  },
  {
    role: 'breakfast', section: 'extras',
    offerFr: 'le petit-déjeuner, à retirer chaque matin au bâtiment d\'accueil ({{price}} par personne et par jour)', offerEn: 'breakfast, to collect each morning at the reception building ({{price}} per person per day)',
    bookedFr: 'Le petit-déjeuner vous attendra chaque matin au bâtiment d\'accueil.', bookedEn: 'Breakfast will be waiting for you every morning at the reception building.',
  },
  {
    role: 'animation', section: 'kids',
    offerFr: 'Et si vos enfants aiment les animaux, il y a aussi quelques beaux moments à partager avec ceux du domaine : nous vous en parlerons sur place.',
    offerEn: 'And if your children love animals, there are some lovely moments to share with those of the domain: we will tell you about them on site.',
    bookedFr: 'Pour le moment avec les animaux, nous choisirons l\'heure ensemble sur place.', bookedEn: 'For the time with the animals, we will choose the hour together on site.',
  },
];
/* eslint-enable max-len */

// The J-2 confirmed the booked options in this order, whatever the J-7 proposed first (rule 9).
const CONFIRMATION_ORDER = ['breakfast', 'babyBed', 'towels', 'board', 'juice', 'beer', 'trapperMeal', 'animation'];

/** The role pre-phase-P `roleOf` gave an option — the same precedence, kept here and only here. */
function legacyRoleOf(option) {
  const seed = String(option.seedKey || '');
  const type = String(option.autoOptionType || '');
  const title = normalizeOptionName(option.title);
  const category = normalizeOptionName(option.category);
  if (type === 'bed_linen' || type === 'bathroom_linen' || isCleaningOption(option)) return null;
  if (type === 'baby_bed' || title.includes('lit bebe')) return null;
  if (type === 'breakfast') return 'breakfast';
  if (seed.startsWith('drink_jus')) return 'juice';
  if (BEER_SEED_KEYS.has(seed)) return 'beer';
  if (seed.startsWith('board_')) return 'board';
  if (title.includes('trappeur')) return 'trapperMeal';
  if (category.includes('animation')) return 'animation';
  return null;
}

function hasData(db) {
  const any = (table) => { try { return Boolean(db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get()); } catch { return false; } };
  return any('properties') || any('reservations');
}

function columns(db, table) {
  try { return db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name); } catch { return []; }
}

function writeTexts(db) {
  const exists = db.prepare('SELECT 1 FROM stay_texts WHERE key = ? AND propertyId = ?');
  const insert = db.prepare('INSERT INTO stay_texts (key, propertyId, fr, en) VALUES (?, ?, ?, ?)');
  const defaults = Object.fromEntries(CATALOGUE.map((e) => [e.key, e]));
  let written = 0;
  for (const [key, text] of Object.entries(SOLIO_TEXTS)) {
    const d = defaults[key];
    if (d && d.fr === text.fr && d.en === text.en) continue;
    if (exists.get(key, 0)) continue;
    insert.run(key, 0, text.fr, text.en);
    written += 1;
  }
  if (columns(db, 'properties').includes('hasFilterCoffeeMaker')) {
    for (const { id } of db.prepare('SELECT id FROM properties WHERE hasFilterCoffeeMaker = 1').all()) {
      if (exists.get('house', id)) continue;
      insert.run('house', id, HOUSE_WITH_FILTER_COFFEE.fr, HOUSE_WITH_FILTER_COFFEE.en);
      written += 1;
    }
  }
  return written;
}

/**
 * The mentions today's options call for, in proposal order, and the confirmation order — pure, so
 * the tests build the same wording the migration writes.
 */
function solioMentionsFor(options) {
  const mentions = [];
  MENTIONS.forEach((m, index) => {
    const covered = options.filter((o) => legacyRoleOf(o) === m.role);
    if (!covered.length) return;
    const priced = m.priceSeedKey ? covered.find((o) => o.seedKey === m.priceSeedKey) : null;
    mentions.push({
      role: m.role, section: m.section, offerFr: m.offerFr, offerEn: m.offerEn, bookedFr: m.bookedFr, bookedEn: m.bookedEn,
      priceSource: priced ? 'option' : 'min', priceOptionId: priced ? Number(priced.id) : null, sortOrder: index + 1,
      optionIds: covered.map((o) => Number(o.id)),
    });
  });
  return mentions;
}

function confirmationOrderFor(idByRole) {
  return CONFIRMATION_ORDER
    .map((role) => (role === 'babyBed' || role === 'towels' ? role : (idByRole[role] ? `mention:${idByRole[role]}` : null)))
    .filter(Boolean);
}

function writeMentions(db) {
  if (db.prepare('SELECT 1 FROM email_mentions LIMIT 1').get()) return 0;
  const insert = db.prepare(`
    INSERT INTO email_mentions (section, offerFr, offerEn, bookedFr, bookedEn, priceSource, priceOptionId, sortOrder)
    VALUES (@section, @offerFr, @offerEn, @bookedFr, @bookedEn, @priceSource, @priceOptionId, @sortOrder)
  `);
  const link = db.prepare('INSERT INTO email_mention_options (mentionId, optionId) VALUES (?, ?)');
  const idByRole = {};
  for (const m of solioMentionsFor(db.prepare('SELECT * FROM options').all())) {
    const { role, optionIds, ...row } = m;
    const id = Number(insert.run(row).lastInsertRowid);
    for (const optionId of optionIds) link.run(id, optionId);
    idByRole[role] = id;
  }
  db.prepare('UPDATE app_settings SET bookedConfirmationOrder = ? WHERE COALESCE(bookedConfirmationOrder, \'[]\') = \'[]\'')
    .run(JSON.stringify(confirmationOrderFor(idByRole)));
  return Object.keys(idByRole).length;
}

function writeResourceSentences(db) {
  let written = 0;
  const update = db.prepare('UPDATE resources SET emailBookedText = ?, emailBookedTextEn = ? WHERE id = ?');
  for (const r of db.prepare("SELECT id, name FROM resources WHERE COALESCE(emailBookedText, '') = '' AND COALESCE(emailBookedTextEn, '') = ''").all()) {
    if (!normalizeOptionName(r.name).includes('nordique')) continue;
    update.run(NORDIC_BATH.fr, NORDIC_BATH.en, r.id);
    written += 1;
  }
  return written;
}

function writeSettings(db, env) {
  // Lodgify was hard-coded as a direct channel (specs/plugins-phase-p-productisation.md rule 19).
  const lodgifyUsed = db.prepare("SELECT 1 FROM reservations WHERE LOWER(TRIM(platform)) = 'lodgify' LIMIT 1").get()
    || db.prepare("SELECT 1 FROM platforms WHERE name = 'lodgify'").get();
  if (lodgifyUsed) {
    db.prepare("INSERT OR IGNORE INTO platforms (name) VALUES ('lodgify')").run();
    db.prepare("UPDATE platforms SET countsAsDirect = 1 WHERE name = 'lodgify'").run();
  }
  // The VAPID subject fell back to Solio's address (rule 18).
  if (!String((env && env.VAPID_SUBJECT) || '').trim()) {
    db.prepare("UPDATE app_settings SET vapidSubject = 'mailto:contact@domainesolio.com' WHERE COALESCE(vapidSubject, '') = ''").run();
  }
  // The extinguisher check was asked by every SAS (rule 16).
  const sasActive = (() => {
    try { return Boolean(db.prepare("SELECT 1 FROM plugins WHERE id = 'sas' AND enabled = 1").get()); } catch { return false; }
  })();
  if (sasActive) {
    db.prepare("INSERT OR IGNORE INTO plugin_settings (plugin_id, key, value) VALUES ('sas', 'extinguisherCheck', '1')").run();
  }
}

/**
 * Runs `productisation_v1` once. Returns a tag for the boot log: `skipped` (already ran),
 * `fresh` (a new database: nothing to keep, recorded so it never runs later), or what it wrote.
 */
function runProductisationMigration(db, { env = process.env } = {}) {
  if (db.prepare('SELECT 1 FROM migrations WHERE name = ?').get(MIGRATION)) return { action: 'skipped' };
  const record = () => db.prepare('INSERT INTO migrations (name) VALUES (?)').run(MIGRATION);
  if (!hasData(db)) {
    record();
    return { action: 'fresh' };
  }
  return db.transaction(() => {
    const texts = writeTexts(db);
    const mentions = writeMentions(db);
    const resources = writeResourceSentences(db);
    writeSettings(db, env);
    db.prepare("UPDATE app_settings SET onboardingCompletedAt = datetime('now') WHERE onboardingCompletedAt IS NULL").run();
    record();
    return { action: 'migrated', texts, mentions, resources };
  })();
}

module.exports = {
  applyProductisationSchema,
  runProductisationMigration,
  MIGRATION,
  // The wording, for the tests that render Solio's emails without a database.
  SOLIO_TEXTS,
  HOUSE_WITH_FILTER_COFFEE,
  NORDIC_BATH,
  legacyRoleOf,
  solioMentionsFor,
  confirmationOrderFor,
};
