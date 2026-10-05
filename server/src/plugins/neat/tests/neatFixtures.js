/**
 * Shared fixtures for the Neat suites (scan / worker / controller) — a non-test module so no suite
 * imports (and therefore re-runs) another suite. specs/neat-cancellation-insurance-subscription.md.
 *
 * The schema is the minimal slice the scan queries + the engine replay
 * (utils/reservationEngineInput.js) touch, in the house partial-DDL style.
 */

const Database = require('better-sqlite3');

const DDL = `
  CREATE TABLE properties (id INTEGER PRIMARY KEY, name TEXT, depositPercent REAL DEFAULT 30,
    depositDaysBefore INTEGER DEFAULT 30, balanceDaysBefore INTEGER DEFAULT 7,
    defaultCheckIn TEXT DEFAULT '16:00', defaultCheckOut TEXT DEFAULT '10:00',
    touristTaxPerDayPerPerson REAL DEFAULT 0, touristTaxMode TEXT DEFAULT 'per_day_per_person',
    touristTaxPercentage REAL DEFAULT 0, touristTaxDepartmentPercentage REAL DEFAULT 0, touristTaxFixedAmount REAL DEFAULT 0,
    basePriceIncludedGuests INTEGER DEFAULT 0, extraGuestPrice REAL DEFAULT 0, extraGuestPriceUnit TEXT DEFAULT 'per_stay');
  CREATE TABLE pricing_rules (id INTEGER PRIMARY KEY, propertyId INTEGER, label TEXT, pricePerNight REAL DEFAULT 100,
    pricingMode TEXT DEFAULT 'fixed', progressiveTiers TEXT DEFAULT '[]', dateRanges TEXT DEFAULT '[]',
    color TEXT DEFAULT '#1976d2', startDate TEXT, endDate TEXT, minNights INTEGER DEFAULT 1, maxNights INTEGER);
  CREATE TABLE options (id INTEGER PRIMARY KEY, title TEXT, priceType TEXT DEFAULT 'per_stay', price REAL DEFAULT 0,
    optionProgressiveTiers TEXT DEFAULT '[]', autoOptionType TEXT, autoEnabled INTEGER DEFAULT 0,
    autoPricingMode TEXT DEFAULT 'fixed', autoFullNightThreshold TEXT,
    showsPlanningCard INTEGER DEFAULT 0, cardRepeat TEXT, isCancellationInsurance INTEGER DEFAULT 0);
  CREATE TABLE property_options (propertyId INTEGER, optionId INTEGER, PRIMARY KEY (propertyId, optionId));
  CREATE TABLE property_option_prices (propertyId INTEGER, optionId INTEGER, price REAL DEFAULT 0,
    freeUnits REAL NOT NULL DEFAULT 0, PRIMARY KEY (propertyId, optionId));
  CREATE TABLE resources (id INTEGER PRIMARY KEY, name TEXT, quantity INTEGER DEFAULT 0, price REAL DEFAULT 0,
    priceType TEXT DEFAULT 'per_stay', isComplex INTEGER DEFAULT 0);
  CREATE TABLE resource_properties (propertyId INTEGER, resourceId INTEGER, PRIMARY KEY (propertyId, resourceId));
  CREATE TABLE clients (id INTEGER PRIMARY KEY AUTOINCREMENT, firstName TEXT, lastName TEXT, email TEXT, phone TEXT,
    streetNumber TEXT, street TEXT, postalCode TEXT, city TEXT);
  CREATE TABLE reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL DEFAULT 'reservation',
    propertyId INTEGER, clientId INTEGER, startDate TEXT, endDate TEXT,
    adults INTEGER DEFAULT 2, children INTEGER DEFAULT 0, teens INTEGER DEFAULT 0, babies INTEGER DEFAULT 0,
    babyBeds INTEGER DEFAULT 0, checkInTime TEXT DEFAULT '16:00', checkOutTime TEXT DEFAULT '10:00', platform TEXT,
    discountPercent REAL DEFAULT 0, customPrice REAL, finalPrice REAL DEFAULT 0,
    extraGuestSurchargeOffered INTEGER DEFAULT 0, touristTaxInComplement INTEGER DEFAULT 0,
    depositAmount REAL DEFAULT 0, depositDueDate TEXT, depositPaid INTEGER DEFAULT 0, depositDisabled INTEGER DEFAULT 0,
    balanceAmount REAL DEFAULT 0, balanceDueDate TEXT, balancePaid INTEGER DEFAULT 0,
    complementAmount REAL DEFAULT 0, complementPaid INTEGER DEFAULT 0,
    createdAt TEXT DEFAULT (datetime('now')), updatedAt TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE reservation_options (
    id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER, optionId INTEGER, quantity REAL, unitPrice REAL,
    billedUnits REAL, priceType TEXT, totalPrice REAL, offered INTEGER DEFAULT 0,
    inComplement INTEGER DEFAULT 0, acompteContribTtc REAL, soldeContribTtc REAL, cardOccurrences TEXT
  );
  CREATE TABLE reservation_custom_options (id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER, description TEXT,
    amount REAL, offered INTEGER DEFAULT 0, sortOrder INTEGER DEFAULT 0, inComplement INTEGER DEFAULT 0,
    acompteContribTtc REAL, soldeContribTtc REAL);
  CREATE TABLE reservation_resources (id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER, resourceId INTEGER,
    quantity REAL, unitPrice REAL, billedUnits REAL, priceType TEXT, totalPrice REAL, offered INTEGER DEFAULT 0,
    inComplement INTEGER DEFAULT 0, acompteContribTtc REAL, soldeContribTtc REAL, sessions TEXT);
  CREATE TABLE reservation_nights (reservationId INTEGER, date TEXT, seasonLabel TEXT, pricingMode TEXT, price REAL);
  CREATE TABLE app_settings (id INTEGER PRIMARY KEY, vatRate REAL NOT NULL DEFAULT 10);
  CREATE TABLE neat_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reservationId INTEGER NOT NULL,
    environment TEXT NOT NULL,
    externalId TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    neatSubscriptionId TEXT,
    premiumAmount REAL,
    billedAmount REAL,
    attempts INTEGER NOT NULL DEFAULT 0,
    nextAttemptAt TEXT,
    lastError TEXT,
    errorKind TEXT,
    lastNotifiedAt TEXT,
    createdAt TEXT NOT NULL DEFAULT (datetime('now')),
    updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK (environment IN ('production', 'staging')),
    CHECK (status IN ('pending', 'active', 'failed', 'voided')),
    UNIQUE (reservationId, environment)
  );
  CREATE TABLE neat_price_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT, environment TEXT NOT NULL, contractId TEXT NOT NULL,
    fieldsHash TEXT NOT NULL, premium REAL NOT NULL, fetchedAt TEXT NOT NULL,
    UNIQUE (environment, contractId, fieldsHash)
  );
`;

const INSURANCE_OPTION_ID = 10;

// One required number field mapped to the nights — the smallest valid contract + mapping pair.
const CONTRACT_FIELDS = [{ id: 'f-nights', title: 'Nuits', name: 'nights', type: 'number', required: true, options: [] }];
const MAPPING = { 'f-nights': { source: 'nights' } };

function freshNeatDb() {
  const db = new Database(':memory:');
  db.exec(DDL);
  db.prepare('INSERT INTO app_settings (id) VALUES (1)').run();
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Aventura Lodge')").run();
  db.prepare(`INSERT INTO pricing_rules (id, propertyId, pricePerNight, dateRanges)
    VALUES (1, 1, 100, '[{"startDate":"2020-01-01","endDate":"2099-12-31"}]')`).run();
  db.prepare(`INSERT INTO options (id, title, priceType, price, isCancellationInsurance)
    VALUES (${INSURANCE_OPTION_ID}, 'Assurance annulation', 'per_night', 3, 1)`).run();
  db.prepare("INSERT INTO options (id, title, priceType, price) VALUES (20, 'Ménage', 'per_stay', 80)").run();
  db.prepare(`INSERT INTO property_options (propertyId, optionId) VALUES (1, ${INSURANCE_OPTION_ID})`).run();
  db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, 20)').run();
  db.prepare(`INSERT INTO clients (id, firstName, lastName, email, phone)
    VALUES (1, 'Jeanne', 'Durand', 'jeanne@x.fr', '0601020304')`).run();
  return db;
}

// A settingsModel double whose neatConfig is fully valid for BOTH subscription and pricing.
function fakeNeatSettings(overrides = {}) {
  return {
    neatConfig: () => ({
      environment: 'staging', clientId: 'id', clientSecret: 'secret',
      storeId: '', salesChannelId: 'ch-1', salesChannelLabel: 'Site', contractId: 'c-1', contractLabel: 'Assurance',
      paymentMethodId: 'pm-1', paymentMethodKind: 'Cash', paymentMethodLabel: 'Facturation établissement',
      fieldMappingJson: JSON.stringify(MAPPING),
      contractFieldsJson: JSON.stringify(CONTRACT_FIELDS),
      marginPercent: 30,
      ...overrides,
    }),
    upsert: () => {},
  };
}

/**
 * Inserts a reservation (+ its insurance line unless `insured: false`). Defaults: direct, future
 * stay, deposit paid — i.e. eligible for the scan (spec rule 7).
 */
function insertReservation(db, {
  kind = 'reservation', platform = 'direct', startDate = '2027-07-01', endDate = '2027-07-04',
  depositPaid = 1, depositDisabled = 0, balancePaid = 0, insured = true, insuranceOffered = 0, clientId = 1,
} = {}) {
  const { lastInsertRowid } = db.prepare(`
    INSERT INTO reservations (kind, propertyId, clientId, startDate, endDate, platform,
      depositPaid, depositDisabled, balancePaid)
    VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?)
  `).run(kind, clientId, startDate, endDate, platform, depositPaid, depositDisabled, balancePaid);
  const id = Number(lastInsertRowid);
  if (insured) {
    db.prepare(`
      INSERT INTO reservation_options (reservationId, optionId, quantity, unitPrice, billedUnits, priceType, totalPrice, offered)
      VALUES (?, ${INSURANCE_OPTION_ID}, 1, 3, 3, 'per_night', ?, ?)
    `).run(id, insuranceOffered ? 0 : 9, insuranceOffered);
  }
  return id;
}

// A scripted Neat client factory for the worker: overrides pick the behaviour per method.
function fakeNeatClientFactory({
  existing = null, priceAmount = 17.5, subscribeId = 'sub-1', failWith = null,
} = {}) {
  const calls = { getByExternalId: [], price: [], subscribe: [], voidSubscription: [] };
  const factory = () => ({
    async getByExternalId(contractId, externalId) {
      calls.getByExternalId.push({ contractId, externalId });
      if (failWith) throw failWith;
      return existing;
    },
    async price(contractId, payload) {
      calls.price.push({ contractId, payload });
      if (failWith) throw failWith;
      return { amount: priceAmount };
    },
    async subscribe(contractId, dto) {
      calls.subscribe.push({ contractId, dto });
      if (failWith) throw failWith;
      return { id: subscribeId };
    },
    async voidSubscription(id) {
      calls.voidSubscription.push({ id });
      if (failWith) throw failWith;
      return { id };
    },
  });
  factory.calls = calls;
  return factory;
}

function fakePushService() {
  const sent = [];
  return { sent, sendToPref: async (prefKey, payload) => { sent.push({ prefKey, payload }); return { sent: 1 }; } };
}

const silentLogger = { log: () => {}, warn: () => {}, error: () => {} };

module.exports = {
  DDL, INSURANCE_OPTION_ID, CONTRACT_FIELDS, MAPPING,
  freshNeatDb, fakeNeatSettings, insertReservation, fakeNeatClientFactory, fakePushService, silentLogger,
};
