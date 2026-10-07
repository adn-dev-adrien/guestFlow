/**
 * The Solio-shaped database of the golden test (specs/plugins-phase-p-productisation.md rule 26).
 * Not a test file.
 *
 * Every row a guest email reads is written here, with fixed ids, so the fixture never depends on
 * what a boot seeds: the catering list and the six sequence templates are frozen copies of what
 * Solio's database holds (`fixtures/productisation/*.json`), taken before phase P removed them from
 * the core.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const FIXTURES = path.join(__dirname, 'fixtures', 'productisation');
const TEMPLATES = require('./fixtures/productisation/solio-sequence-templates.json');
const CATERING = require('./fixtures/productisation/solio-catering.json');

const GRANJA = 1;
const ESTIVA = 2;

// Options: the typed ones, the catering list from id 20, then the two hand-made ones.
const TYPED = [
  { id: 1, title: 'Linge de lit', autoOptionType: 'bed_linen', price: 12, priceType: 'per_person' },
  { id: 2, title: 'Linge de toilette', autoOptionType: 'bathroom_linen', price: 8, priceType: 'per_person' },
  { id: 3, title: 'Ménage', autoOptionType: 'cleaning', price: 80, priceType: 'per_stay' },
  { id: 4, title: 'Petit déjeuner', autoOptionType: 'breakfast', price: 12, priceType: 'per_person_per_night', category: 'Restauration' },
  { id: 5, title: 'Lit bébé', autoOptionType: 'baby_bed', price: 5, priceType: 'per_stay' },
  { id: 6, title: 'Cadeau de bienvenue', price: 15, priceType: 'per_stay', displayToClient: 0 },
];
const HAND_MADE = [
  { id: 40, title: 'Le repas des trappeurs', price: 25, priceType: 'per_person', category: 'Restauration' },
  { id: 41, title: 'Animation-visite animaux', price: 30, priceType: 'per_stay', category: 'Animations' },
];
const CATERING_ROWS = CATERING.map((c, i) => ({ id: 20 + i, priceType: 'per_stay', ...c }));
const ALL_OPTIONS = [...TYPED, ...CATERING_ROWS, ...HAND_MADE];
const bySeed = (key) => CATERING_ROWS.find((o) => o.seedKey === key).id;

// What each property offers: La Granja everything but the trappers' dinner, L'Estiva no animation
// and no towels to sell (they are included there).
const AVAILABLE = {
  [GRANJA]: ALL_OPTIONS.filter((o) => o.id !== 40).map((o) => o.id),
  [ESTIVA]: ALL_OPTIONS.filter((o) => o.id !== 41).map((o) => o.id),
};
const OFFERED = { [GRANJA]: [], [ESTIVA]: [1, 2, 3] };

const BATH = 30;

/**
 * Six stays covering children or not, pool season or not, every option state, direct and platform,
 * wifi or not, parking or not.
 */
const STAYS = [
  {
    id: 101, propertyId: GRANJA, platform: 'direct', startDate: '2027-07-10', endDate: '2027-07-17',
    adults: 2, children: 2, babies: 1, doubleBeds: 1, singleBeds: 2, options: [],
  },
  {
    id: 102, propertyId: GRANJA, platform: 'airbnb', startDate: '2027-10-08', endDate: '2027-10-11',
    adults: 2, children: 1, babies: 1, doubleBeds: 1, singleBeds: 1,
    options: [1, 2, 3, 4, 5, 6, bySeed('drink_jus_pomme_1l'), bySeed('drink_biscanna_75'), bySeed('board_m'), 41],
    complementAmount: 64, complementPaid: 0,
    sessions: [{ date: '2027-10-09', start: '18:00', end: '19:30' }],
  },
  {
    id: 103, propertyId: ESTIVA, platform: 'lodgify', startDate: '2027-05-14', endDate: '2027-05-16',
    adults: 2, children: 1, babies: 0, doubleBeds: 1, singleBeds: 1, options: [4, 40],
    complementAmount: 50, complementPaid: 0, complementDeferredToCheckout: 1,
  },
  {
    id: 104, propertyId: ESTIVA, platform: 'booking', startDate: '2027-08-20', endDate: '2027-08-27',
    adults: 4, children: 0, babies: 0, doubleBeds: 2, singleBeds: 0, options: [],
  },
  {
    id: 105, propertyId: GRANJA, platform: 'gites-de-france', startDate: '2027-12-27', endDate: '2028-01-02',
    adults: 1, children: 0, babies: 0, doubleBeds: 1, singleBeds: 0, options: [bySeed('drink_jus_pomme_kiwi_1l'), 6],
  },
  {
    id: 106, propertyId: ESTIVA, platform: 'direct', startDate: '2027-06-28', endDate: '2027-07-03',
    adults: 2, children: 2, teens: 1, babies: 0, doubleBeds: 1, singleBeds: 3, options: [bySeed('board_s'), 4],
  },
];

function insert(db, table, row) {
  const cols = Object.keys(row);
  db.prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map((c) => `@${c}`).join(', ')})`).run(row);
}

function tableExists(db, name) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}

/**
 * Boots the real `database.js` on a temporary file, then replaces every row the emails read with
 * Solio's. Must be called once per process: `database.js` is a module singleton.
 */
function buildSolioDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-golden-'));
  process.env.DB_PATH = path.join(dir, 'golden.db');
  const silent = console.log;
  console.log = () => {};
  let db;
  try { db = require('../database'); } finally { console.log = silent; }

  db.pragma('foreign_keys = OFF');
  for (const t of ['reservation_options', 'reservation_resources', 'property_options', 'property_option_defaults',
    'property_option_prices', 'property_resource_prices', 'options', 'resources', 'reservations', 'clients', 'properties',
    'email_mention_options', 'email_mentions', 'stay_texts']) {
    if (tableExists(db, t)) db.prepare(`DELETE FROM ${t}`).run();
  }
  db.pragma('foreign_keys = ON');

  db.prepare(`UPDATE app_settings SET companyName = 'Domaine Solio', companyPhone = '06 00 00 00 00',
    smtpFromName = 'Adrien et Sophie', googleReviewUrl = 'https://g.page/r/solio/review',
    instagramUrl = 'https://www.instagram.com/domainesolio', poolSeasonStart = '06-15', poolSeasonEnd = '08-31'`).run();
  if (!db.prepare("SELECT 1 FROM platforms WHERE name = 'lodgify'").get()) insert(db, 'platforms', { name: 'lodgify' });

  insert(db, 'properties', {
    id: GRANJA, name: 'La Granja', nameArticle: 'à', maxGuests: 6, doubleBeds: 2, singleBeds: 2,
    hasFilterCoffeeMaker: 1, hasWifi: 1, parkingDistanceMeters: 0, emailHook: 'Chaque matin, le soleil s\'y lève sur la vallée.',
  });
  insert(db, 'properties', {
    id: ESTIVA, name: 'L\'Estiva', nameArticle: 'à', maxGuests: 5, doubleBeds: 1, singleBeds: 3,
    hasFilterCoffeeMaker: 0, hasWifi: 0, parkingDistanceMeters: 300,
  });
  insert(db, 'pricing_rules', { propertyId: GRANJA, pricePerNight: 319 });
  insert(db, 'pricing_rules', { propertyId: ESTIVA, pricePerNight: 179 });

  for (const o of ALL_OPTIONS) {
    insert(db, 'options', {
      id: o.id, title: o.title, price: o.price, priceType: o.priceType, autoOptionType: o.autoOptionType || null,
      seedKey: o.seedKey || '', category: o.category || '', displayToClient: o.displayToClient === 0 ? 0 : 1,
    });
  }
  for (const [propertyId, ids] of Object.entries(AVAILABLE)) {
    for (const optionId of ids) insert(db, 'property_options', { propertyId: Number(propertyId), optionId });
  }
  for (const [propertyId, ids] of Object.entries(OFFERED)) {
    for (const optionId of ids) insert(db, 'property_option_defaults', { propertyId: Number(propertyId), optionId, offered: 1 });
  }

  insert(db, 'resources', { id: BATH, name: 'Bain nordique', quantity: 1, price: 30, priceType: 'per_hour', showsPlanningCard: 1 });
  insert(db, 'property_resource_prices', { propertyId: GRANJA, resourceId: BATH, price: 30, freeMinutes: 90 });
  insert(db, 'property_resource_prices', { propertyId: ESTIVA, resourceId: BATH, price: 30, freeMinutes: 60 });

  insert(db, 'clients', { id: 1, firstName: 'Camille', lastName: 'Martin', email: 'camille@example.fr' });
  for (const s of STAYS) {
    const { options, sessions, ...row } = s;
    insert(db, 'reservations', {
      kind: 'reservation', clientId: 1, createdAt: '2027-03-02 10:00:00', finalPrice: 1240,
      reservationNumber: `GF-2027-${s.id}`, checkInTime: '16:00', checkOutTime: '10:00', ...row,
    });
    for (const optionId of options) {
      const o = ALL_OPTIONS.find((x) => x.id === optionId);
      insert(db, 'reservation_options', { reservationId: s.id, optionId, quantity: 1, unitPrice: o.price, totalPrice: o.price });
    }
    if (sessions) {
      insert(db, 'reservation_resources', {
        reservationId: s.id, resourceId: BATH, quantity: 2, unitPrice: 30, priceType: 'per_hour', totalPrice: 60,
        sessions: JSON.stringify(sessions),
      });
    }
  }

  // Solio's stored sequence templates — data, never re-seeded over.
  const update = db.prepare('UPDATE email_templates SET subject = ?, body = ?, subjectEn = ?, bodyEn = ? WHERE stableKey = ?');
  for (const [key, t] of Object.entries(TEMPLATES)) update.run(t.subject, t.body, t.subjectEn, t.bodyEn, key);

  // The upgrade: the fixture booted as a new database, Solio's is an existing one.
  db.prepare("DELETE FROM migrations WHERE name = 'productisation_v1'").run();
  require('../utils/productisationMigration').runProductisationMigration(db, { env: {} });

  return db;
}

module.exports = { buildSolioDb, STAYS, FIXTURES };
