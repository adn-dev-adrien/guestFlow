-- GuestFlow database schema — generated baseline (specs/migrations-baseline.md).
-- Single source of truth for a FRESH database. Reproduces the production schema exactly
-- (verified: a fresh DB built from this file is PRAGMA-identical to prod). Legacy ALTER
-- migrations were removed once prod reached this schema. Keep CREATE … IF NOT EXISTS so an
-- existing prod DB is never re-created. To change the schema: edit here + add a guarded
-- migration in database.js if existing rows must be altered.

CREATE TABLE IF NOT EXISTS app_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    googleCalendarId TEXT DEFAULT '',
    googleServiceAccountEmail TEXT DEFAULT '',
    googleServiceAccountPrivateKey TEXT DEFAULT '',
    createdAt TEXT DEFAULT (datetime('now')),
    updatedAt TEXT DEFAULT (datetime('now'))
  , companyName TEXT DEFAULT '', companyAddress TEXT DEFAULT '', companySiret TEXT DEFAULT '', companyTva TEXT DEFAULT '', companyIban TEXT DEFAULT '', companyBic TEXT DEFAULT '', companyBankName TEXT DEFAULT '', quoteFooterText TEXT DEFAULT '', quoteValidityDays INTEGER DEFAULT 30, companyLogoPath TEXT DEFAULT '', companyEmail TEXT DEFAULT '', companyPhone TEXT DEFAULT '', smtpHost TEXT DEFAULT '', smtpPort INTEGER DEFAULT 587, smtpSecure INTEGER NOT NULL DEFAULT 0, smtpUsername TEXT DEFAULT '', smtpPasswordEncrypted TEXT DEFAULT '', smtpFromEmail TEXT DEFAULT '', smtpFromName TEXT DEFAULT 'GuestFlow', publicUrl TEXT DEFAULT '', allowEditPastReservations INTEGER NOT NULL DEFAULT 0, laundryWeekday INTEGER NOT NULL DEFAULT 2, bedLinenStockSingle INTEGER NOT NULL DEFAULT 0, bedLinenStockDouble INTEGER NOT NULL DEFAULT 0, bedLinenStockBaby   INTEGER NOT NULL DEFAULT 0, towelStockLarge     INTEGER NOT NULL DEFAULT 0, towelStockMedium    INTEGER NOT NULL DEFAULT 0, towelStockSmall     INTEGER NOT NULL DEFAULT 0, vatRate REAL NOT NULL DEFAULT 10, defaultCommissionAccountNumber TEXT NOT NULL DEFAULT '622600', vatRateCommission REAL NOT NULL DEFAULT 20, quoteFooterTextEn TEXT DEFAULT '', notificationsEnabled INTEGER NOT NULL DEFAULT 1, notificationRecipientEmail TEXT DEFAULT '', paymentDepositReminderOffsets  TEXT DEFAULT '[-5,0]', paymentDepositAbandonOffset    INTEGER NOT NULL DEFAULT 1, paymentDepositLinkExpiryDays   INTEGER NOT NULL DEFAULT 1, paymentBalanceReminderOffsets  TEXT DEFAULT '[-10,-5,0]', paymentBalanceAbandonOffset    INTEGER NOT NULL DEFAULT 1, paymentBalanceLinkExpiryDays   INTEGER NOT NULL DEFAULT 1, paymentLastMinuteDays          INTEGER NOT NULL DEFAULT 30, paymentFullPaymentDueDaysBefore INTEGER NOT NULL DEFAULT 7, qontoAccessTokenEncrypted  TEXT DEFAULT '', qontoRefreshTokenEncrypted TEXT DEFAULT '', qontoTokenExpiresAt        TEXT DEFAULT '', qontoConnectionId          TEXT DEFAULT '', qontoConnectionStatus      TEXT DEFAULT 'not_connected', qontoConnectedAt           TEXT DEFAULT '', portalCode TEXT DEFAULT '', notifyIcalReservationEnabled INTEGER NOT NULL DEFAULT 1, towelStockBathMat INTEGER NOT NULL DEFAULT 0, meteoFranceApiKeyEncrypted TEXT DEFAULT '', googleOAuthRefreshTokenEncrypted TEXT DEFAULT '', googleOAuthConnectedEmail TEXT DEFAULT '', googleOAuthConnectedAt TEXT DEFAULT '', googleCalendarSummary TEXT DEFAULT '', googleLastSyncAt TEXT DEFAULT '', googleLastSyncOk INTEGER DEFAULT NULL, googleLastSyncDetail TEXT DEFAULT '');

CREATE TABLE IF NOT EXISTS calendar_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    propertyId INTEGER NOT NULL,
    date TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    FOREIGN KEY (propertyId) REFERENCES properties(id) ON DELETE CASCADE,
    UNIQUE(propertyId, date)
  );

CREATE TABLE IF NOT EXISTS clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lastName TEXT NOT NULL,
    firstName TEXT NOT NULL,
    streetNumber TEXT DEFAULT '',
    street TEXT DEFAULT '',
    postalCode TEXT DEFAULT '',
    city TEXT DEFAULT '',
    address TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    email TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    createdAt TEXT DEFAULT (datetime('now')),
    updatedAt TEXT DEFAULT (datetime('now'))
  );

CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    propertyId INTEGER NOT NULL,
    type TEXT NOT NULL DEFAULT 'other',
    name TEXT NOT NULL,
    filePath TEXT NOT NULL,
    createdAt TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (propertyId) REFERENCES properties(id) ON DELETE CASCADE
  );

CREATE TABLE IF NOT EXISTS email_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    templateId INTEGER,
    reservationId INTEGER NOT NULL,
    sentAt TEXT NOT NULL DEFAULT (datetime('now')),
    status TEXT NOT NULL,
    errorMessage TEXT DEFAULT '',
    renderedSubject TEXT NOT NULL,
    renderedBody TEXT NOT NULL,
    recipientEmail TEXT NOT NULL DEFAULT '', channel TEXT NOT NULL DEFAULT 'smtp',
    CHECK (status IN ('sent', 'failed', 'acknowledged-skip'))
  );

CREATE TABLE IF NOT EXISTS email_manual_queue (
    templateId    INTEGER NOT NULL,
    reservationId INTEGER NOT NULL,
    createdAt     TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (templateId, reservationId),
    FOREIGN KEY (templateId)    REFERENCES email_templates(id) ON DELETE CASCADE,
    FOREIGN KEY (reservationId) REFERENCES reservations(id)    ON DELETE CASCADE
  );

CREATE TABLE IF NOT EXISTS email_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    stableKey TEXT UNIQUE,
    name TEXT NOT NULL,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    dayOffset INTEGER NOT NULL,
    sendMode TEXT NOT NULL DEFAULT 'manual',
    enabled INTEGER NOT NULL DEFAULT 1,
    anchor TEXT NOT NULL DEFAULT 'start',
    createdAt TEXT DEFAULT (datetime('now')),
    updatedAt TEXT DEFAULT (datetime('now')),
    CHECK (sendMode IN ('auto', 'manual'))
  );

CREATE TABLE IF NOT EXISTS establishment_closures (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    propertyId INTEGER,
    label TEXT NOT NULL DEFAULT 'Fermeture établissement',
    startDate TEXT NOT NULL,
    endDate TEXT NOT NULL,
    createdAt TEXT DEFAULT (datetime('now')),
    updatedAt TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (propertyId) REFERENCES properties(id) ON DELETE CASCADE
  );

CREATE TABLE IF NOT EXISTS ical_cancellation_alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reservationId INTEGER NOT NULL,
    sourceId INTEGER NOT NULL,
    eventUid TEXT NOT NULL,
    detectedAt TEXT NOT NULL DEFAULT (datetime('now')),
    acknowledgedAt TEXT,
    outcome TEXT
  );

CREATE TABLE IF NOT EXISTS ical_date_drift_alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reservationId INTEGER NOT NULL,
    previousStartDate TEXT NOT NULL,
    previousEndDate TEXT NOT NULL,
    newStartDate TEXT NOT NULL,
    newEndDate TEXT NOT NULL,
    detectedAt TEXT NOT NULL DEFAULT (datetime('now')),
    acknowledgedAt TEXT,
    outcome TEXT
  );

CREATE TABLE IF NOT EXISTS ical_import_events (
    sourceId INTEGER NOT NULL,
    eventUid TEXT NOT NULL,
    reservationId INTEGER NOT NULL,
    eventHash TEXT NOT NULL,
    lastSeenAt TEXT DEFAULT (datetime('now')), startDate TEXT NOT NULL DEFAULT '', endDate TEXT NOT NULL DEFAULT '', summaryNormalized TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (sourceId, eventUid),
    FOREIGN KEY (sourceId) REFERENCES ical_sources(id) ON DELETE CASCADE,
    FOREIGN KEY (reservationId) REFERENCES reservations(id) ON DELETE CASCADE
  );

CREATE TABLE IF NOT EXISTS ical_sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    propertyId INTEGER NOT NULL,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    platformKey TEXT NOT NULL,
    platformLabel TEXT NOT NULL,
    platformColor TEXT NOT NULL DEFAULT '#757575',
    isActive INTEGER NOT NULL DEFAULT 1,
    lastSyncAt TEXT,
    lastSyncStatus TEXT,
    lastSyncMessage TEXT,
    lastImportedCount INTEGER NOT NULL DEFAULT 0,
    createdAt TEXT DEFAULT (datetime('now')),
    updatedAt TEXT DEFAULT (datetime('now')), collectsTouristTax INTEGER NOT NULL DEFAULT 1,
    disabled INTEGER NOT NULL DEFAULT 0,
    lastSyncCounts TEXT,
    touristTaxRemittedByPlatform INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY (propertyId) REFERENCES properties(id) ON DELETE CASCADE
  );

CREATE TABLE IF NOT EXISTS ical_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    propertyId INTEGER NOT NULL UNIQUE,
    token TEXT NOT NULL UNIQUE,
    createdAt TEXT DEFAULT (datetime('now')),
    updatedAt TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (propertyId) REFERENCES properties(id) ON DELETE CASCADE
  );

CREATE TABLE IF NOT EXISTS laundry_trip_manual_additions (
    tripDate     TEXT PRIMARY KEY NOT NULL CHECK (length(tripDate) = 10),
    singleBeds   INTEGER NOT NULL DEFAULT 0,
    doubleBeds   INTEGER NOT NULL DEFAULT 0,
    babyBeds     INTEGER NOT NULL DEFAULT 0,
    largeTowels  INTEGER NOT NULL DEFAULT 0,
    mediumTowels INTEGER NOT NULL DEFAULT 0,
    smallTowels  INTEGER NOT NULL DEFAULT 0,
    updatedAt    TEXT NOT NULL DEFAULT (datetime('now'))
  );

CREATE TABLE IF NOT EXISTS laundry_trip_skips (
    tripDate TEXT PRIMARY KEY NOT NULL CHECK (length(tripDate) = 10),
    createdAt TEXT NOT NULL DEFAULT (datetime('now'))
  );

CREATE TABLE IF NOT EXISTS linen_priced_items (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    label     TEXT NOT NULL,
    price     REAL NOT NULL DEFAULT 0,
    category  TEXT NOT NULL DEFAULT 'bed',
    sortOrder INTEGER NOT NULL DEFAULT 0
  );

CREATE TABLE IF NOT EXISTS migrations (
    name TEXT PRIMARY KEY,
    ran_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

CREATE TABLE IF NOT EXISTS options (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    priceType TEXT NOT NULL DEFAULT 'per_stay',
    price REAL NOT NULL DEFAULT 0,
    createdAt TEXT DEFAULT (datetime('now'))
  , autoOptionType TEXT, autoEnabled INTEGER NOT NULL DEFAULT 0, autoPricingMode TEXT NOT NULL DEFAULT 'fixed', autoFullNightThreshold TEXT, optionProgressiveTiers TEXT NOT NULL DEFAULT '[]', countsAsBedLinen INTEGER NOT NULL DEFAULT 0, countsAsBathroomLinen INTEGER NOT NULL DEFAULT 0, linenIncludesSingle INTEGER NOT NULL DEFAULT 1, linenIncludesDouble INTEGER NOT NULL DEFAULT 1, linenIncludesBaby INTEGER NOT NULL DEFAULT 1, towelLargePerPerson INTEGER NOT NULL DEFAULT 1, towelMediumPerPerson INTEGER NOT NULL DEFAULT 0, towelSmallPerPerson INTEGER NOT NULL DEFAULT 1, titleEn TEXT NOT NULL DEFAULT '', breakfastTime TEXT DEFAULT '09:00', archivedAt TEXT, showsPlanningCard INTEGER NOT NULL DEFAULT 0, cardRepeat TEXT NOT NULL DEFAULT 'once', planningCardDate TEXT, planningCardTimes TEXT, scopeMigratedV2 INTEGER NOT NULL DEFAULT 0, countsAsBathMat INTEGER NOT NULL DEFAULT 0, displayToClient INTEGER NOT NULL DEFAULT 1, breakfastNotifyLeadMinutes INTEGER NOT NULL DEFAULT 30, category TEXT NOT NULL DEFAULT '', seedKey TEXT NOT NULL DEFAULT '', alwaysVisible INTEGER NOT NULL DEFAULT 0);

CREATE TABLE IF NOT EXISTS payment_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reservationId INTEGER NOT NULL,
    type TEXT NOT NULL,
    qontoPaymentLinkId TEXT,
    url TEXT NOT NULL DEFAULT '',
    amountCents INTEGER NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'EUR',
    status TEXT NOT NULL DEFAULT 'open',
    qontoPaymentId TEXT,
    createdAt TEXT NOT NULL DEFAULT (datetime('now')),
    paidAt TEXT,
    expiresAt TEXT,
    CHECK (type IN ('deposit', 'balance', 'full', 'complement')),
    CHECK (status IN ('open', 'paid', 'expired', 'cancelled'))
  );

CREATE TABLE IF NOT EXISTS platforms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    commissionAccountNumber TEXT,
    hasVatOnCommission INTEGER NOT NULL DEFAULT 0
  , commissionPercent REAL NOT NULL DEFAULT 0, color TEXT,
    collectsTouristTax INTEGER NOT NULL DEFAULT 1,
    touristTaxRemittedByPlatform INTEGER NOT NULL DEFAULT 1, platformTakesDeposit INTEGER NOT NULL DEFAULT 0);

CREATE TABLE IF NOT EXISTS pricing_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    propertyId INTEGER NOT NULL,
    label TEXT DEFAULT 'Standard',
    pricePerNight REAL NOT NULL DEFAULT 100,
    pricingMode TEXT NOT NULL DEFAULT 'fixed',
    progressiveTiers TEXT NOT NULL DEFAULT '[]',
    dateRanges TEXT NOT NULL DEFAULT '[]',
    color TEXT NOT NULL DEFAULT '#1976d2',
    startDate TEXT,
    endDate TEXT,
    minNights INTEGER DEFAULT 1,
    seasonKey TEXT DEFAULT NULL, seasonRank INTEGER DEFAULT NULL, netTargetPerNight REAL DEFAULT NULL,
    extraGuestPrice REAL DEFAULT NULL, extraGuestNetTarget REAL DEFAULT NULL, maxNights INTEGER DEFAULT NULL,
    changeoverArrival INTEGER DEFAULT NULL, changeoverDeparture INTEGER DEFAULT NULL,
    FOREIGN KEY (propertyId) REFERENCES properties(id) ON DELETE CASCADE
  );

CREATE TABLE IF NOT EXISTS properties (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    photo TEXT DEFAULT '',
    maxAdults INTEGER DEFAULT 2,
    maxChildren INTEGER DEFAULT 0,
    maxBabies INTEGER DEFAULT 0,
    singleBeds INTEGER DEFAULT 0,
    doubleBeds INTEGER DEFAULT 0,
    depositPercent REAL DEFAULT 30,
    depositDaysBefore INTEGER DEFAULT 30,
    balanceDaysBefore INTEGER DEFAULT 7,
    defaultCheckIn TEXT DEFAULT '15:00',
    defaultCheckOut TEXT DEFAULT '10:00',
    cleaningHours REAL DEFAULT 3,
    defaultCautionAmount REAL DEFAULT 500,
    touristTaxPerDayPerPerson REAL DEFAULT 0,
    createdAt TEXT DEFAULT (datetime('now')),
    updatedAt TEXT DEFAULT (datetime('now'))
  , touristTaxMode TEXT DEFAULT 'per_day_per_person', touristTaxPercentage REAL DEFAULT 0, touristTaxFixedAmount REAL DEFAULT 0, touristTaxDepartmentPercentage REAL DEFAULT 0, basePriceIncludedGuests INTEGER DEFAULT 0, extraGuestPrice REAL DEFAULT 0, nameArticle TEXT DEFAULT 'au', publicDepositEnabled INTEGER NOT NULL DEFAULT 0, tariffRecipeId TEXT DEFAULT '', tariffRecipeVersion TEXT DEFAULT '', extraGuestPriceUnit TEXT DEFAULT 'per_stay', welcomePackCost REAL DEFAULT 0);

CREATE TABLE IF NOT EXISTS property_option_defaults (
    propertyId INTEGER NOT NULL,
    optionId   INTEGER NOT NULL,
    offered    INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (propertyId, optionId),
    FOREIGN KEY (propertyId) REFERENCES properties(id) ON DELETE CASCADE,
    FOREIGN KEY (optionId)   REFERENCES options(id)    ON DELETE CASCADE
  );

CREATE TABLE IF NOT EXISTS property_option_prices (
    propertyId INTEGER NOT NULL,
    optionId INTEGER NOT NULL,
    price REAL NOT NULL DEFAULT 0,
    freeUnits REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (propertyId, optionId),
    FOREIGN KEY (propertyId) REFERENCES properties(id) ON DELETE CASCADE,
    FOREIGN KEY (optionId) REFERENCES options(id) ON DELETE CASCADE
  );

CREATE TABLE IF NOT EXISTS property_option_bath_mats (
    propertyId INTEGER NOT NULL,
    optionId   INTEGER NOT NULL,
    quantity   INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (propertyId, optionId),
    FOREIGN KEY (propertyId) REFERENCES properties(id) ON DELETE CASCADE,
    FOREIGN KEY (optionId)   REFERENCES options(id)    ON DELETE CASCADE
  );

CREATE TABLE IF NOT EXISTS property_options (
    propertyId INTEGER NOT NULL,
    optionId INTEGER NOT NULL,
    PRIMARY KEY (propertyId, optionId),
    FOREIGN KEY (propertyId) REFERENCES properties(id) ON DELETE CASCADE,
    FOREIGN KEY (optionId) REFERENCES options(id) ON DELETE CASCADE
  );

CREATE TABLE IF NOT EXISTS property_resource_prices (
    propertyId INTEGER NOT NULL,
    resourceId INTEGER NOT NULL,
    price REAL NOT NULL DEFAULT 0,
    freeMinutes INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (propertyId, resourceId),
    FOREIGN KEY (propertyId) REFERENCES properties(id) ON DELETE CASCADE,
    FOREIGN KEY (resourceId) REFERENCES resources(id) ON DELETE CASCADE
  );

CREATE TABLE IF NOT EXISTS push_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId INTEGER NOT NULL,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    createdAt TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
  );

CREATE TABLE IF NOT EXISTS repair_amounts (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    repairKey TEXT,
    label     TEXT NOT NULL,
    price     REAL NOT NULL DEFAULT 0,
    sortOrder INTEGER NOT NULL DEFAULT 0
  );

CREATE TABLE IF NOT EXISTS reservation_custom_options (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reservationId INTEGER NOT NULL,
    description TEXT NOT NULL,
    amount REAL NOT NULL DEFAULT 0,
    offered INTEGER NOT NULL DEFAULT 0,
    sortOrder INTEGER NOT NULL DEFAULT 0,
    createdAt TEXT DEFAULT (datetime('now')),
    updatedAt TEXT DEFAULT (datetime('now')), inComplement INTEGER NOT NULL DEFAULT 0, acompteContribTtc REAL DEFAULT NULL, soldeContribTtc REAL DEFAULT NULL, sasArrivalOrigin INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (reservationId) REFERENCES reservations(id) ON DELETE CASCADE
  );

CREATE TABLE IF NOT EXISTS reservation_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reservationId INTEGER NOT NULL,
    eventType TEXT NOT NULL DEFAULT 'update',
    changedFields TEXT NOT NULL DEFAULT '[]',
    createdAt TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (reservationId) REFERENCES reservations(id) ON DELETE CASCADE
  );

CREATE TABLE IF NOT EXISTS reservation_nights (
    reservationId INTEGER NOT NULL,
    date TEXT NOT NULL,
    seasonLabel TEXT DEFAULT 'Standard',
    pricingMode TEXT DEFAULT 'fixed',
    price REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (reservationId, date),
    FOREIGN KEY (reservationId) REFERENCES reservations(id) ON DELETE CASCADE
  );

CREATE TABLE IF NOT EXISTS reservation_options (
    reservationId INTEGER NOT NULL,
    optionId INTEGER NOT NULL,
    quantity REAL DEFAULT 1,
    unitPrice REAL NOT NULL DEFAULT 0,
    billedUnits REAL NOT NULL DEFAULT 0,
    priceType TEXT NOT NULL DEFAULT 'per_stay',
    totalPrice REAL DEFAULT 0, offered INTEGER NOT NULL DEFAULT 0, inComplement INTEGER NOT NULL DEFAULT 0, acompteContribTtc REAL DEFAULT NULL, soldeContribTtc REAL DEFAULT NULL, cardOccurrences TEXT,
    PRIMARY KEY (reservationId, optionId),
    FOREIGN KEY (reservationId) REFERENCES reservations(id) ON DELETE CASCADE,
    FOREIGN KEY (optionId) REFERENCES options(id) ON DELETE CASCADE
  );

-- Remboursements (specs/reservation-refunds.md §5). An « avoir »: money returned to the guest AFTER
-- the sale, at its own date, WITHOUT touching the sale (finalPrice, échéances, paid flags stay
-- verbatim). One header + N lines; `vatRate` is frozen per line at creation so a later settings
-- change never re-prices an avoir already sent to the accountant.
CREATE TABLE IF NOT EXISTS reservation_refunds (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    reservationId INTEGER NOT NULL,
    refundDate    TEXT NOT NULL,                    -- YYYY-MM-DD, real money-out date
    method        TEXT NOT NULL DEFAULT 'transfer', -- 'transfer' | 'cash' | 'internal'
    totalTtc      REAL NOT NULL DEFAULT 0,          -- server-computed sum of the lines
    reason        TEXT DEFAULT '',
    createdAt     TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (reservationId) REFERENCES reservations(id) ON DELETE CASCADE
  );

CREATE TABLE IF NOT EXISTS reservation_refund_lines (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    refundId  INTEGER NOT NULL,
    lineKey   TEXT,                                 -- 'accommodation' | 'opt:<id>' | 'res:<id>' | 'custom:<label>' | 'touristTax' | NULL (free line)
    label     TEXT NOT NULL,
    bucket    TEXT NOT NULL,                        -- 'accommodation' | 'options' | 'resources' | 'touristTax'
    quantity  REAL,
    unitPrice REAL,
    amountTtc REAL NOT NULL,
    vatRate   REAL NOT NULL DEFAULT 0,
    FOREIGN KEY (refundId) REFERENCES reservation_refunds(id) ON DELETE CASCADE
  );

CREATE INDEX IF NOT EXISTS idx_refunds_reservation ON reservation_refunds(reservationId);
CREATE INDEX IF NOT EXISTS idx_refunds_date ON reservation_refunds(refundDate);

CREATE TABLE IF NOT EXISTS reservation_resources (
    reservationId INTEGER NOT NULL,
    resourceId INTEGER NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    unitPrice REAL NOT NULL DEFAULT 0,
    billedUnits REAL NOT NULL DEFAULT 0,
    priceType TEXT NOT NULL DEFAULT 'per_stay',
    totalPrice REAL NOT NULL DEFAULT 0, offered INTEGER NOT NULL DEFAULT 0, inComplement INTEGER NOT NULL DEFAULT 0, acompteContribTtc REAL DEFAULT NULL, soldeContribTtc REAL DEFAULT NULL, sessions TEXT,
    PRIMARY KEY (reservationId, resourceId),
    FOREIGN KEY (reservationId) REFERENCES reservations(id) ON DELETE CASCADE,
    FOREIGN KEY (resourceId) REFERENCES resources(id) ON DELETE CASCADE
  );

CREATE TABLE IF NOT EXISTS reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    propertyId INTEGER NOT NULL,
    clientId INTEGER NOT NULL,
    startDate TEXT NOT NULL,
    endDate TEXT NOT NULL,
    adults INTEGER DEFAULT 1,
    children INTEGER DEFAULT 0,
    teens INTEGER DEFAULT 0,
    babies INTEGER DEFAULT 0,
    singleBeds INTEGER,
    doubleBeds INTEGER,
    babyBeds INTEGER,
    checkInTime TEXT DEFAULT '15:00',
    checkOutTime TEXT DEFAULT '10:00',
    platform TEXT DEFAULT 'direct',
    totalPrice REAL NOT NULL DEFAULT 0,
    discountPercent REAL DEFAULT 0,
    finalPrice REAL NOT NULL DEFAULT 0,
    depositAmount REAL DEFAULT 0,
    depositDueDate TEXT,
    depositPaid INTEGER DEFAULT 0,
    balanceAmount REAL DEFAULT 0,
    balanceDueDate TEXT,
    balancePaid INTEGER DEFAULT 0,
    notes TEXT DEFAULT '',
    createdAt TEXT DEFAULT (datetime('now')),
    updatedAt TEXT DEFAULT (datetime('now')), cautionAmount REAL DEFAULT 0, cautionReceived INTEGER DEFAULT 0, cautionReceivedDate TEXT, cautionReturned INTEGER DEFAULT 0, cautionReturnedDate TEXT, sourceType TEXT NOT NULL DEFAULT 'manual', sourcePlatformKey TEXT, sourceIcalSourceId INTEGER, sourceIcalEventUid TEXT, icalSyncLocked INTEGER NOT NULL DEFAULT 0, checkInReady INTEGER DEFAULT 0, checkInDone INTEGER DEFAULT 0, checkOutDone INTEGER DEFAULT 0, blocksPreviousNight INTEGER NOT NULL DEFAULT 0, blocksNextNight INTEGER NOT NULL DEFAULT 0, touristTaxRate REAL DEFAULT 0, touristTaxTotal REAL DEFAULT 0, customPrice REAL, extraGuestSurchargeOffered INTEGER NOT NULL DEFAULT 0, icalOriginalSummary TEXT, depositPaidDate TEXT, balancePaidDate TEXT, complementAmount REAL NOT NULL DEFAULT 0, complementPaid INTEGER NOT NULL DEFAULT 0, complementPaidDate TEXT, clientGrossAmount REAL, platformCommissionAmount REAL, acompteCommissionAmount REAL, platformGrossAmount REAL, platformPayoutAmount REAL, kind TEXT NOT NULL DEFAULT 'reservation', devisNumber TEXT, devisStatus TEXT, validUntil TEXT, convertedReservationId INTEGER, depositDisabled INTEGER NOT NULL DEFAULT 0, touristTaxInComplement INTEGER NOT NULL DEFAULT 0, accommodationAcompteContribTtc REAL DEFAULT NULL, accommodationSoldeContribTtc REAL DEFAULT NULL, touristTaxAcompteContribTtc REAL DEFAULT NULL, touristTaxSoldeContribTtc REAL DEFAULT NULL, pdfLanguage TEXT NOT NULL DEFAULT 'fr', breakfastTime TEXT, requestOrigin TEXT, depositAmountOverride REAL, endOfStayComplementAmount REAL NOT NULL DEFAULT 0, endOfStayComplementPaid INTEGER NOT NULL DEFAULT 0, endOfStayComplementPaidDate TEXT, endOfStayComplementDetail TEXT, arrivalSasDoneAt TEXT, departureSasDoneAt TEXT, breakfastCoffee INTEGER NOT NULL DEFAULT 0, breakfastTea INTEGER NOT NULL DEFAULT 0, breakfastChocolate INTEGER NOT NULL DEFAULT 0, breakfastMilk INTEGER NOT NULL DEFAULT 0, breakfastPastries INTEGER NOT NULL DEFAULT 0, breakfastCereals INTEGER NOT NULL DEFAULT 0, breakfastBread REAL NOT NULL DEFAULT 0, breakfastNotifiedDate TEXT, breakfastNote TEXT, departureHandoverNote TEXT, complementPaidCash INTEGER NOT NULL DEFAULT 0, endOfStayComplementPaidCash INTEGER NOT NULL DEFAULT 0, arrivalNotifiedAt TEXT, departureNotifiedAt TEXT, extinguisherSealOkAtArrival INTEGER, extinguisherSealOkAtDeparture INTEGER, bookingConflictAt TEXT, touristTaxDeclaredAt TEXT, publicToken TEXT,
    FOREIGN KEY (propertyId) REFERENCES properties(id) ON DELETE CASCADE,
    FOREIGN KEY (clientId) REFERENCES clients(id) ON DELETE CASCADE
  );

CREATE TABLE IF NOT EXISTS resource_bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    resourceId INTEGER NOT NULL,
    reservationId INTEGER,
    clientId INTEGER,
    clientName TEXT,
    clientPhone TEXT,
    propertyId INTEGER,
    date TEXT NOT NULL,
    startTime TEXT NOT NULL,
    endTime TEXT NOT NULL,
    notes TEXT DEFAULT '',
    totalPrice REAL DEFAULT 0,
    paid INTEGER DEFAULT 0,
    createdAt TEXT DEFAULT (datetime('now')),
    updatedAt TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (resourceId) REFERENCES resources(id) ON DELETE CASCADE,
    FOREIGN KEY (reservationId) REFERENCES reservations(id) ON DELETE SET NULL,
    FOREIGN KEY (clientId) REFERENCES clients(id) ON DELETE SET NULL,
    FOREIGN KEY (propertyId) REFERENCES properties(id) ON DELETE SET NULL
  );

CREATE TABLE IF NOT EXISTS resource_properties (
    resourceId INTEGER NOT NULL,
    propertyId INTEGER NOT NULL,
    PRIMARY KEY (resourceId, propertyId),
    FOREIGN KEY (resourceId) REFERENCES resources(id) ON DELETE CASCADE,
    FOREIGN KEY (propertyId) REFERENCES properties(id) ON DELETE CASCADE
  );

CREATE TABLE IF NOT EXISTS resources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 0,
    price REAL NOT NULL DEFAULT 0,
    priceType TEXT NOT NULL DEFAULT 'per_stay',
    propertyId INTEGER,
    note TEXT DEFAULT '',
    createdAt TEXT DEFAULT (datetime('now')),
    updatedAt TEXT DEFAULT (datetime('now')), isComplex INTEGER NOT NULL DEFAULT 0, slotDuration INTEGER NOT NULL DEFAULT 60, openTime TEXT NOT NULL DEFAULT '08:00', closeTime TEXT NOT NULL DEFAULT '22:00', closedDays TEXT NOT NULL DEFAULT '[]', openDays TEXT NOT NULL DEFAULT '[0,1,2,3,4,5,6]', turnoverMinutes INTEGER NOT NULL DEFAULT 0, minimumUsageMinutes INTEGER NOT NULL DEFAULT 0, nameEn TEXT NOT NULL DEFAULT '', showsPlanningCard INTEGER NOT NULL DEFAULT 0, hourlyEveningStart TEXT, hourlyEveningRate REAL NOT NULL DEFAULT 0, hourlyExternalDayRate REAL NOT NULL DEFAULT 0, hourlyExternalEveningRate REAL NOT NULL DEFAULT 0,
    FOREIGN KEY (propertyId) REFERENCES properties(id) ON DELETE SET NULL
  );

CREATE TABLE IF NOT EXISTS school_holidays (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    label TEXT NOT NULL,
    zoneA_start TEXT,
    zoneA_end TEXT,
    zoneB_start TEXT,
    zoneB_end TEXT,
    zoneC_start TEXT,
    zoneC_end TEXT
  , externalRef TEXT, isLocked INTEGER NOT NULL DEFAULT 0, lastSyncedAt TEXT);

CREATE TABLE IF NOT EXISTS school_holidays_sync_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    syncIntervalDays INTEGER NOT NULL DEFAULT 60,
    syncHorizonMonths INTEGER NOT NULL DEFAULT 24,
    lastSyncAt TEXT,
    lastSyncStatus TEXT DEFAULT 'never',
    lastSyncMessage TEXT DEFAULT '',
    lastImportedCount INTEGER DEFAULT 0,
    updatedAt TEXT DEFAULT (datetime('now'))
  );

CREATE TABLE IF NOT EXISTS sessions
  (
    sid TEXT NOT NULL PRIMARY KEY,
    sess JSON NOT NULL,
    expire TEXT NOT NULL
  );

CREATE TABLE IF NOT EXISTS tariff_recipe_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    propertyId INTEGER NOT NULL,
    recipeId TEXT NOT NULL,
    recipeVersion TEXT NOT NULL DEFAULT '',
    generatedYear INTEGER,
    note TEXT NOT NULL DEFAULT '',
    blocking INTEGER NOT NULL DEFAULT 0,
    createdAt TEXT DEFAULT (datetime('now')),
    dismissedAt TEXT,
    FOREIGN KEY (propertyId) REFERENCES properties(id) ON DELETE CASCADE
  );

CREATE TABLE IF NOT EXISTS user_push_prefs (
    userId INTEGER PRIMARY KEY,
    newReservation INTEGER NOT NULL DEFAULT 1,
    arrivals INTEGER NOT NULL DEFAULT 1,
    departures INTEGER NOT NULL DEFAULT 1,
    breakfast INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
  );

CREATE TABLE IF NOT EXISTS user_roles (
    userId INTEGER NOT NULL,
    role TEXT NOT NULL,
    PRIMARY KEY (userId, role),
    FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
  );

CREATE TABLE IF NOT EXISTS weather_vigilance_cache (
    departmentCode TEXT PRIMARY KEY,
    payload        TEXT NOT NULL,
    fetchedAt      TEXT NOT NULL
  );

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    passwordHash TEXT NOT NULL,
    mustChangePassword INTEGER NOT NULL DEFAULT 0,
    isActive INTEGER NOT NULL DEFAULT 1,
    createdAt TEXT DEFAULT (datetime('now')),
    updatedAt TEXT DEFAULT (datetime('now'))
  , firstName TEXT NOT NULL DEFAULT '', lastName TEXT NOT NULL DEFAULT '', companyName TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', lastLoginAt TEXT, emailChangedAt TEXT);

CREATE INDEX IF NOT EXISTS idx_calendar_notes_propertyId_date ON calendar_notes(propertyId, date);

CREATE INDEX IF NOT EXISTS idx_documents_propertyId ON documents(propertyId);

CREATE INDEX IF NOT EXISTS idx_email_log_reservation ON email_log(reservationId);

CREATE INDEX IF NOT EXISTS idx_email_log_status_sent ON email_log(status, sentAt DESC);

CREATE INDEX IF NOT EXISTS idx_email_log_template_res ON email_log(templateId, reservationId);

CREATE INDEX IF NOT EXISTS idx_email_templates_enabled_offset
    ON email_templates(enabled, dayOffset);

CREATE INDEX IF NOT EXISTS idx_establishment_closures_propertyId_dates ON establishment_closures(propertyId, startDate, endDate);

CREATE INDEX IF NOT EXISTS idx_ical_cancel_unack
    ON ical_cancellation_alerts(acknowledgedAt)
    WHERE acknowledgedAt IS NULL;

CREATE INDEX IF NOT EXISTS idx_ical_cancel_unack_event
    ON ical_cancellation_alerts(sourceId, eventUid)
    WHERE acknowledgedAt IS NULL;

CREATE INDEX IF NOT EXISTS idx_ical_cancel_unack_reservation
    ON ical_cancellation_alerts(reservationId)
    WHERE acknowledgedAt IS NULL;

CREATE INDEX IF NOT EXISTS idx_ical_drift_unack
    ON ical_date_drift_alerts(acknowledgedAt)
    WHERE acknowledgedAt IS NULL;

CREATE INDEX IF NOT EXISTS idx_ical_drift_unack_reservation
    ON ical_date_drift_alerts(reservationId)
    WHERE acknowledgedAt IS NULL;

CREATE INDEX IF NOT EXISTS idx_ical_import_events_fallback
    ON ical_import_events (sourceId, startDate, endDate, summaryNormalized);

CREATE INDEX IF NOT EXISTS idx_ical_import_events_reservationId ON ical_import_events(reservationId);

CREATE INDEX IF NOT EXISTS idx_ical_sources_propertyId ON ical_sources(propertyId);

CREATE INDEX IF NOT EXISTS idx_ical_tokens_propertyId ON ical_tokens(propertyId);

CREATE INDEX IF NOT EXISTS idx_payment_links_reservation ON payment_links(reservationId);

CREATE INDEX IF NOT EXISTS idx_payment_links_status ON payment_links(status);

CREATE INDEX IF NOT EXISTS idx_pricing_rules_propertyId ON pricing_rules(propertyId);

CREATE INDEX IF NOT EXISTS idx_property_option_prices_option ON property_option_prices(optionId);

CREATE INDEX IF NOT EXISTS idx_property_options_optionId ON property_options(optionId);

CREATE INDEX IF NOT EXISTS idx_property_options_propertyId ON property_options(propertyId);

CREATE INDEX IF NOT EXISTS idx_property_resource_prices_resource ON property_resource_prices(resourceId);

CREATE INDEX IF NOT EXISTS idx_reservation_custom_options_reservationId ON reservation_custom_options(reservationId);

CREATE INDEX IF NOT EXISTS idx_reservation_history_reservationId ON reservation_history(reservationId);

CREATE INDEX IF NOT EXISTS idx_reservation_nights_reservationId ON reservation_nights(reservationId);

CREATE INDEX IF NOT EXISTS idx_reservation_options_optionId ON reservation_options(optionId);

CREATE INDEX IF NOT EXISTS idx_reservation_options_reservationId ON reservation_options(reservationId);

CREATE INDEX IF NOT EXISTS idx_reservation_resources_reservationId ON reservation_resources(reservationId);

CREATE INDEX IF NOT EXISTS idx_reservation_resources_resourceId ON reservation_resources(resourceId);

CREATE INDEX IF NOT EXISTS idx_reservations_clientId ON reservations(clientId);

CREATE INDEX IF NOT EXISTS idx_reservations_ical_source ON reservations(sourceIcalSourceId, sourceIcalEventUid);

CREATE INDEX IF NOT EXISTS idx_reservations_kind ON reservations(kind);

CREATE INDEX IF NOT EXISTS idx_reservations_propertyId ON reservations(propertyId);

CREATE INDEX IF NOT EXISTS idx_reservations_startDate ON reservations(startDate);

CREATE INDEX IF NOT EXISTS idx_resource_bookings_date ON resource_bookings(date);

CREATE INDEX IF NOT EXISTS idx_resource_bookings_propertyId ON resource_bookings(propertyId);

CREATE INDEX IF NOT EXISTS idx_resource_bookings_reservationId ON resource_bookings(reservationId);

CREATE INDEX IF NOT EXISTS idx_resource_bookings_resourceId ON resource_bookings(resourceId);

CREATE INDEX IF NOT EXISTS idx_resource_properties_resourceId ON resource_properties(resourceId);

CREATE INDEX IF NOT EXISTS idx_school_holidays_externalRef ON school_holidays(externalRef);

CREATE INDEX IF NOT EXISTS idx_tariff_recipe_runs_propertyId ON tariff_recipe_runs(propertyId);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_ical_sources_property_platform ON ical_sources(propertyId, platformKey);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_resource_bookings_slot ON resource_bookings(resourceId, date, startTime, endTime);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_users_email ON users(email);

CREATE UNIQUE INDEX IF NOT EXISTS ux_reservations_devisNumber ON reservations(devisNumber) WHERE devisNumber IS NOT NULL;

