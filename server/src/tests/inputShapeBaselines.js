// The authenticated write routes from a VALID baseline, for input-shape-per-field.unit.test.js
// (specs/hosting-h2-account-security.md rule 68). A wrong value sent in every field stops at the first required-field
// refusal; only a body the route accepts reaches the field the fuzz changes. Each row is
// [method, url, body, { plugin, ok }]: the body or the url may be a function of a counter when a success uses up what it
// names, `plugin` skips a row whose plugin the tree does not ship, `ok` lists the statuses of a state the row is known to
// stop at (nothing in this harness connects Qonto: its calls would leave the machine).
const Database = require('better-sqlite3');

const dayAt = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

async function seed(app, admin, active) {
  const post = async (url, body, method = 'POST') => {
    const res = await app.call(admin, method, url, body);
    if (res.status >= 300) throw new Error(`seed ${method} ${url}: ${res.status} ${res.text.slice(0, 300)}`);
    return res.json;
  };
  const property = app.ids.property;
  const client = app.ids.client;
  const stay = (offset, over = {}) => post('/api/reservations', { propertyId: property, clientId: client, startDate: dayAt(offset), endDate: dayAt(offset + 3), adults: 2, children: 0, babies: 0, platform: 'direct', checkInTime: '15:00', checkOutTime: '10:00', ...over });
  const option = await post('/api/options', { title: 'Panier', price: 10, priceType: 'per_stay', propertyIds: [property] });
  const hourly = active.has('hourly-resources');
  const resource = await post('/api/resources', hourly
    ? { name: 'Bain', quantity: 50, price: 30, priceType: 'per_hour', isComplex: 1, slotDuration: 30, minimumUsageMinutes: 60, openTime: '08:00', closeTime: '22:00', openDays: '[0,1,2,3,4,5,6]', turnoverMinutes: 0 }
    : { name: 'Velo', quantity: 50, price: 30, priceType: 'per_stay' });
  const booking = hourly
    ? await post('/api/resource-bookings', { resourceId: resource.id, date: dayAt(80), startTime: '10:00', endTime: '11:00', propertyId: String(property), notes: '', paid: false, clientId: client, clientName: null, clientPhone: null })
    : { id: 0 };
  const closure = await post('/api/establishment-closures', { propertyId: property, startDate: dayAt(1700), endDate: dayAt(1702), label: 'Travaux' });
  const direct = await stay(100);
  const platformStay = await stay(110, { platform: 'Booking', platformGrossAmount: 500, platformPayoutAmount: 400 });
  const planned = await stay(125);
  const compensation = (await post('/api/accounting/cancellation-compensations', { platform: 'Booking', expectedAmount: 10, expectedDate: dayAt(5), propertyName: 'Ombre', clientFirstName: 'Marie', clientLastName: 'Martin', startDate: dayAt(5), endDate: dayAt(7), notes: '' })).compensation;
  const template = await post('/api/email-templates', { name: 'Modele', subject: 'Sujet', body: 'Texte', dayOffset: 1, sendMode: 'manual' });
  const source = await post(`/api/properties/${property}/ical-sources`, { platformKey: 'greengo', platformLabel: 'GreenGo', url: '', disabled: false, feedMarksStaysClosed: false });
  const season = await post(`/api/properties/${property}/pricing`, { label: 'Haute', pricePerNight: 100, startDate: dayAt(1000), endDate: dayAt(1010), minNights: 1, maxNights: 0 });
  const other = await post('/api/properties', { name: 'Autre', maxGuests: 2, doubleBeds: 1, singleBeds: 0 });
  const mention = await post('/api/email-mentions', { section: 'local', optionIds: [option.id], priceSource: 'min', offerFr: 'Offre', offerEn: 'Offer', bookedFr: 'Pris', bookedEn: 'Booked' });
  return {
    property, client, other: other.id, option: option.id, resource: resource.id, booking: booking.id, closure: closure.id, stay,
    direct: direct.id, platformStay: platformStay.id, planned: planned.id, compensation: compensation.id, template: template.id,
    source: source.id, season: season.id, mention: mention.id, reservation: app.ids.reservation, devis: app.ids.devis,
  };
}

async function baselines(app, admin, active) {
  const s = await seed(app, admin, active);
  const read = async (url) => (await app.call(admin, 'GET', url)).json;
  const option = await read(`/api/options/${s.option}`);
  const resource = await read(`/api/resources/${s.resource}`);
  const clientRow = await read(`/api/clients/${s.client}`);
  const propertyRow = await read(`/api/properties/${s.property}`);
  const stay = await read(`/api/reservations/${s.reservation}`);
  const templateRow = await read(`/api/email-templates/${s.template}`);
  const stayKey = (await read('/api/stay-texts')).texts[0].key;
  const [reception] = app.readDb("SELECT id FROM users WHERE email = 'reception@shape.test'");
  const linen = active.has('sas') ? await read('/api/settings/linen-items') : [];
  const repairs = active.has('sas') ? await read('/api/settings/repair-amounts') : [];
  const plan = (await app.call(admin, 'PUT', `/api/reservations/${s.planned}/installments`, { count: 2 })).json.installmentPlan.installments;
  const booking = (await read('/api/platforms/with-commission')).platforms.find((p) => /booking/i.test(p.name));
  const mentionList = await read('/api/email-mentions');
  const orderItems = mentionList.confirmationOrder;
  const mentionIds = mentionList.mentions.map((m) => m.id);
  const platformId = booking ? booking.id : 1;
  const mentionBody = { section: 'local', optionIds: [s.option], priceSource: 'min', offerFr: 'Offre', offerEn: 'Offer', bookedFr: 'Pris', bookedEn: 'Booked' };
  const compensationBody = { platform: 'Booking', expectedAmount: 12, expectedDate: dayAt(5), propertyId: s.property, propertyName: 'Ombre', clientFirstName: 'Marie', clientLastName: 'Martin', startDate: dayAt(5), endDate: dayAt(7), cancelledStayAmount: 20, notes: 'Note' };
  // A success uses up its dates: every stay body takes the next free ones, and a success moves on by a week.
  const stayBody = (n, over = {}) => ({ propertyId: s.property, clientId: s.client, startDate: dayAt(150 + n * 7), endDate: dayAt(153 + n * 7), adults: 2, children: 0, babies: 0, platform: 'direct', checkInTime: '15:00', checkOutTime: '10:00', notes: 'Note', discountPercent: 0, ...over });
  const closureDays = (n) => ({ startDate: dayAt(1600 + n * 3), endDate: dayAt(1601 + n * 3) });
  const bookingDays = (n) => dayAt(81 + (n % 400));
  const url = {
    property: `/api/properties/${s.property}`,
    option: `/api/options/${s.option}`,
    resource: `/api/resources/${s.resource}`,
    stay: `/api/reservations/${s.direct}`,
  };
  let cancelled = 0;
  const hourly = { plugin: 'hourly-resources' };
  const sas = { plugin: 'sas' };
  if (active.has('neat')) {
    const raw = new Database(app.dbPath);
    raw.prepare("INSERT OR REPLACE INTO plugin_settings (plugin_id, key, value) VALUES ('neat', 'neatContractFieldsJson', ?)").run(JSON.stringify([{ id: 'f1', title: 'F', name: 'f', type: 'string', required: true, options: [] }]));
    raw.close();
  }
  const reconciliation = { plugin: 'online-payment', ok: [409] };
  const rows = [
    ['PUT', '/api/onboarding/emails', { phone: '0102030405', senderName: 'Ombre', properties: [{ id: s.property, nameArticle: 'à la', address: 'Rue', access: 'Porte', accessCode: '', wifiName: 'Wifi', wifiPassword: '', caution: 10, cleaningIncluded: true, towelsProvided: true }] }],
    ['PUT', '/api/onboarding/company', { name: 'Ombre', email: 'bonjour@shape.test', phone: '0102030405', address: 'Rue', siret: '' }],
    ['PUT', '/api/onboarding/property', { name: 'Ombre', doubleBeds: 1, singleBeds: 0, maxGuests: 2, pricePerNight: 10, checkIn: '16:00', checkOut: '10:00' }, { ok: [409] }],
    ['POST', '/api/options', { title: 'Vin', description: 'Rouge', price: 5, priceType: 'per_stay', propertyIds: [s.property], category: 'Repas', autoPricingMode: 'fixed', autoFullNightThreshold: '10:00' }],
    ['PUT', url.option, option],
    ['POST', '/api/resources', { name: 'Velo', quantity: 1, price: 5, priceType: 'per_stay', propertyIds: [s.property], propertyPricing: {}, note: 'Note', emailBookedText: '', emailBookedTextEn: '', openTime: '08:00', closeTime: '22:00', openDays: '[0,1,2]', hourlyEveningStart: null }],
    ['PUT', url.resource, resource],
    ['POST', '/api/resource-bookings', (n) => ({ resourceId: s.resource, date: bookingDays(n), startTime: '10:00', endTime: '11:00', propertyId: String(s.property), notes: 'Note', paid: false, clientId: s.client, clientName: null, clientPhone: null, displayedTotal: 30 }), hourly],
    ['POST', '/api/resource-bookings', (n) => ({ resourceId: s.resource, date: bookingDays(n), startTime: '12:00', endTime: '13:00', propertyId: null, notes: 'Note', paid: true, clientId: null, clientName: 'Marie', clientPhone: '0600000000', reservationId: s.direct }), hourly],
    ['POST', '/api/resource-bookings/preview', { resourceId: s.resource, bookingId: s.booking, date: dayAt(80), startTime: '10:00', endTime: '11:00', propertyId: String(s.property) }, hourly],
    ['PUT', `/api/resource-bookings/${s.booking}`, { date: dayAt(80), startTime: '10:00', endTime: '11:00', propertyId: String(s.property), notes: 'Note', paid: false, clientId: s.client, clientName: null, clientPhone: null, displayedTotal: 30, reservationId: null }, hourly],
    ['POST', '/api/clients', { lastName: 'Durand', firstName: 'Lea', email: '', phone: '', streetNumber: '1', street: 'Rue', postalCode: '75000', city: 'Paris', address: 'Rue', notes: 'Note', emailLanguage: 'fr', allowDuplicate: true }],
    ['PUT', `/api/clients/${s.client}`, clientRow],
    ['PUT', url.property, { name: propertyRow.name, nameArticle: 'à la', maxGuests: 4, maxBabies: 0, doubleBeds: 1, singleBeds: 2, basePriceIncludedGuests: 2, extraGuestPrice: 5, extraGuestPriceUnit: 'per_stay', welcomePackCost: 0, touristTaxMode: 'per_day_per_person', touristTaxPerDayPerPerson: 1, touristTaxPercentage: 0, touristTaxDepartmentPercentage: 0, touristTaxFixedAmount: 0, defaultCheckIn: '15:00', defaultCheckOut: '10:00', depositEnabled: true, depositPercent: 30, depositDueDays: 7, balanceDaysBefore: 30, cancelAfterBalanceDueDays: 3, cleaningHours: 3, defaultCautionAmount: 0, parkingDistanceMeters: 0, hasWifi: true, poolSeasonMode: 'none', poolSeasonStart: '', poolSeasonEnd: '', cleaningIncluded: 'yes', towelsProvided: 'yes', bedLinenProvided: 'yes' }],
    ['POST', '/api/properties', { name: 'Neuve', maxGuests: 2, doubleBeds: 1, singleBeds: 0, pricePerNight: 80, touristTaxMode: 'percentage_accommodation' }],
    ['PUT', `${url.property}/arrival-facts`, { address: 'Rue', mapUrl: 'https://example.invalid/m', accessFr: 'Porte', accessEn: 'Door', wifiName: 'Wifi', accessCode: '1234', wifiPassword: 'secret' }],
    ['PUT', `${url.property}/options`, { optionIds: [s.option] }],
    ['PUT', `${url.property}/option-defaults/${s.option}`, { quantity: 1, offered: false, enabled: true, price: 1, displayToClient: true }],
    ['POST', `${url.property}/ical-sources`, { platformKey: 'pitchup', platformLabel: 'Pitchup', platformColor: '#112233', url: '', name: 'Pitchup', disabled: false, feedMarksStaysClosed: false, isActive: true, touristTaxCollection: 'platform', collectsTouristTax: true, touristTaxRemittedByPlatform: true }],
    ['PUT', `${url.property}/ical-sources/${s.source}`, { platformKey: 'greengo', platformLabel: 'GreenGo', url: '', disabled: false, feedMarksStaysClosed: false, isActive: true }],
    ['PUT', `${url.property}/pricing/${s.season}`, { label: 'Haute', pricePerNight: 110, netTargetPerNight: 100, extraGuestPrice: 1, startDate: dayAt(1000), endDate: dayAt(1010), minNights: 1, maxNights: 0, color: '#112233', pricingMode: 'fixed', progressiveTiers: [], extraGuestTiers: [] }],
    ['POST', `${url.property}/pricing`, (n) => ({ label: 'Saison', pricePerNight: 110, startDate: dayAt(1300 + n * 2), endDate: dayAt(1301 + n * 2), minNights: 1, maxNights: 0, color: '#112233' })],
    ['POST', `${url.property}/pricing/progressive-preview`, { pricePerNight: 100, maxNights: 3, progressiveTiers: [{ nightNumber: 2, extraNightPrice: 90 }] }],
    ['POST', `${url.property}/pricing/assign-dates`, (n) => ({ startDate: dayAt(1500 + n * 2), endDate: dayAt(1501 + n * 2), minNights: 1, target: { mode: 'existing', ruleId: s.season } })],
    ['POST', `${url.property}/pricing/apply-to`, { targetPropertyId: s.other, replaceExisting: false }],
    ['PUT', '/api/properties/email-hooks', { hooks: [{ propertyId: s.property, text: 'Texte' }] }],
    ['POST', '/api/establishment-closures', (n) => ({ propertyId: s.property, ...closureDays(n), label: 'Travaux' })],
    ['PUT', `/api/establishment-closures/${s.closure}`, { propertyId: s.property, startDate: dayAt(1700), endDate: dayAt(1702), label: 'Travaux' }],
    ['POST', '/api/email-templates', { name: 'Autre', subject: 'Sujet', body: 'Texte', subjectEn: 'Subject', bodyEn: 'Text', dayOffset: 1, sendMode: 'manual', enabled: false }],
    ['PUT', `/api/email-templates/${s.template}`, { name: templateRow.name, subject: templateRow.subject, body: templateRow.body, subjectEn: 'Subject', bodyEn: 'Text', dayOffset: 2, sendMode: 'manual', enabled: false }],
    ['POST', '/api/email-templates/when', { templateId: s.template, days: 2, direction: 'before' }],
    ['PUT', '/api/email-mentions/order', { ids: [s.mention, ...mentionIds.filter((id) => id !== s.mention)] }],
    ['POST', '/api/email-mentions', mentionBody],
    ['PUT', `/api/email-mentions/${s.mention}`, mentionBody],
    ['PUT', '/api/email-mentions/confirmation-order', { items: orderItems }],
    ['POST', '/api/email-mentions/preview', { ...mentionBody, propertyId: s.property, language: 'fr' }],
    ['PUT', `/api/stay-texts/${stayKey}`, { fr: 'Texte', en: 'Text', propertyId: 0 }],
    ['PUT', `/api/calendar-notes/${s.property}/${dayAt(5)}`, { note: 'Note' }],
    ['POST', '/api/accounting/cancellation-compensations', compensationBody],
    ['PUT', `/api/accounting/cancellation-compensations/${s.compensation}`, compensationBody],
    ['POST', `/api/accounting/cancellation-compensations/${s.compensation}/receive`, { receivedAmount: 10, receivedDate: dayAt(0) }],
    ['PUT', '/api/accounting/platform-accounts', { defaultAccount: '622600', vatRateCommission: 20, cancellationCompensationAccount: '758000', platforms: [] }, { plugin: 'accounting-export' }],
    ['PATCH', `${url.stay}/payment`, { checkInReady: 1, checkInDone: 0, checkOutDone: 0, complementDeferredToCheckout: 0 }],
    ['POST', `${url.stay}/refunds`, { totalTtc: 1, refundDate: dayAt(0), reason: 'Geste', method: 'transfer', lines: [{ key: 'accommodation', amountTtc: 1 }], fromOverpayment: false, overpaymentTtc: 0 }, { ok: [409] }],
    ['PUT', `/api/reservations/${s.planned}/installments`, { dates: plan.map((row, i) => ({ id: row.id, dueDate: dayAt(20 + i) })) }],
    ['PUT', `/api/reservations/${s.planned}/installments`, { amounts: [{ id: plan[0].id, amount: 1 }] }, { ok: [400] }],
    ['PUT', `/api/reservations/${s.planned}/installments`, { count: plan.length }],
    ['POST', `/api/reservations/${s.platformStay}/platform-penalties/preview`, { amount: 1, date: dayAt(0), reason: 'Frais', source: 'fiche', payoutIncludesPenalty: true }],
    ['POST', `/api/reservations/${s.platformStay}/platform-penalties`, { amount: 1, date: dayAt(0), reason: 'Frais', source: 'fiche', payoutIncludesPenalty: true }],
    ['POST', `${url.stay}/arrival-payment`, { method: 'card', mode: 'card', date: dayAt(0), amount: 1, keys: ['balance'], touristTax: true }],
    ['POST', `/api/payments/reservations/${s.direct}/payment-links`, { type: 'deposit', installmentId: 1 }, { plugin: 'online-payment', ok: [409] }],
    ['POST', `/api/payments/reservations/${s.direct}/payment-emails`, { type: 'deposit', installmentId: 1 }, { plugin: 'online-payment', ok: [409] }],
    ['POST', '/api/payments/reconciliation/discards', { transactionId: 'tx-1', reservationId: s.direct, ledgerKey: 'deposit' }, reconciliation],
    ['POST', '/api/payments/reconciliation/allocation-preview', { transactionIds: ['tx-1'], reservationId: s.direct, receiptKeys: ['deposit'], pairs: [], proposalId: 'p' }, reconciliation],
    ['POST', '/api/payments/reconciliation/links', { transactionId: 'tx-1', allocations: [{ reservationId: s.direct, ledgerKey: 'deposit', amountCents: 100 }] }, reconciliation],
    ['POST', '/api/payments/reconciliation/links/batch', { pairs: [{ transactionId: 'tx-1', reservationId: s.direct, ledgerKey: 'deposit', amountCents: 100 }], proposalId: 'p' }, reconciliation],
    ['POST', '/api/payments/reconciliation/confirm-all', { proposalIds: ['p'], amounts: { p: 100 } }, reconciliation],
    ['PUT', '/api/payments/qonto/credentials', { environment: 'sandbox', clientId: 'id', clientSecret: 'secret', stagingToken: 'token', webhookSecret: 'hook', publicSiteOrigin: 'https://example.invalid' }, { plugin: 'online-payment' }],
    ['PUT', '/api/neat/settings', { environment: 'staging', clientId: 'id', clientSecret: 'secret', marginPercent: 1 }, { plugin: 'neat' }],
    ['PUT', '/api/neat/selection', { salesChannelId: 'c', contractId: 'k', paymentMethodId: 'p' }, { plugin: 'neat', ok: [502] }],
    ['PUT', '/api/neat/mapping', { mapping: { f1: { source: 'constant', constant: 'x' } } }, { plugin: 'neat' }],
    ['POST', '/api/settings/vat-regime/preview', { regime: 'subject', basis: 'all', effectiveFrom: dayAt(0), rate: 20, legalMention: '' }],
    ['POST', '/api/tariff-recipes/journal', { propertyId: s.property, kind: 'platforms', note: 'Note', occurredAt: dayAt(0) }, { plugin: 'tariff-recipes' }],
    ['PUT', `/api/reservations/${s.reservation}`, stay],
    ['POST', '/api/reservations', (n) => stayBody(n)],
    ['POST', '/api/reservations/calculate-price', (n) => stayBody(n)],
    ['POST', '/api/reservations/suggest-beds', { propertyId: s.property, adults: 2, children: 0 }],
    ['POST', '/api/reservations/platform-commission', { gross: 100, payout: 90, touristTax: 1, platform: 'Booking' }],
    ['POST', '/api/devis', (n) => stayBody(n)],
    ['POST', async () => {
      cancelled += 1;
      return `/api/reservations/${(await s.stay(300 + cancelled * 4, { propertyId: s.other })).id}/cancel`;
    }, { reason: 'Motif', refund: 0 }, { name: '/api/reservations/:id/cancel' }],
    ['PUT', '/api/settings/linen-items', linen, sas],
    ['PUT', '/api/settings/repair-amounts', repairs, sas],
    ['PUT', '/api/laundry/schedule', { effectiveFrom: dayAt(1), weekdays: [1, 3], turnaroundDays: 1 }, { plugin: 'linen' }],
    ['POST', '/api/laundry/schedule/preview', { effectiveFrom: dayAt(1), weekdays: [1, 3], turnaroundDays: 1 }, { plugin: 'linen' }],
    ['POST', '/api/laundry/skips', { date: dayAt(9), reason: 'Ferme' }, { plugin: 'linen', ok: [400, 409] }],
    ['PUT', '/api/settings', { companyName: 'Ombre', companyPhone: '0102030405', smtpFromName: 'Ombre' }],
    ['POST', '/api/school-holidays', { label: 'Vacances', zoneA_start: dayAt(200), zoneA_end: dayAt(210) }, { plugin: 'school-holidays' }],
    ['PUT', '/api/users/me', { firstName: 'Marie', lastName: 'Martin', email: 'admin@shape.test', companyName: 'Ombre', notes: '' }],
    ['PUT', `/api/users/${reception ? reception.id : 2}`, { firstName: 'Marie', lastName: 'Martin', companyName: '', notes: '', roles: ['reception'] }, sas],
    ['POST', `/api/finance/tourist-tax/${s.direct}/declared`, { declared: true, date: dayAt(0) }, { ok: [404] }],
    ['PATCH', `/api/finance/tourist-tax/${s.direct}/declared`, { declared: false }, { ok: [400, 404, 409] }],
    ['POST', `/api/dashboard/payment-deadlines/${s.direct}/snooze`, { days: 3, until: dayAt(9), kind: 'balance' }, { ok: [400, 404] }],
    ['POST', `/api/dashboard/payment-deadlines/${s.direct}/remind`, { kind: 'balance' }, { ok: [400, 404, 409] }],
    ['POST', '/api/clients/parse-contact', { address: 'Rue', email: 'a@shape.test', phone: '0600000000' }],
    ['POST', '/api/reservations/mid-stay-note/preview', { reservationId: s.direct, before: [], after: [] }, { ok: [400, 404, 409] }],
    ['PUT', '/api/push/preferences', { channels: {}, preferences: {} }],
    ['POST', '/api/planning/option-cards/done', { reservationId: s.direct, optionId: s.option, date: dayAt(100), done: true }, { ok: [400, 404] }],
    ['POST', '/api/emails/preview', { templateId: s.template, reservationId: s.direct }],
    ['POST', '/api/emails/queue', { templateId: s.template, reservationId: s.direct }, { ok: [400, 404, 409] }],
    ['PUT', '/api/terms/draft', { fr: 'Texte', en: 'Text', text: 'Texte' }, { ok: [400, 404] }],
    ['POST', '/api/terms/preview', { fr: 'Texte', en: 'Text', text: 'Texte' }, { ok: [400, 404] }],
    ['PUT', '/api/terms/enforcement', { enabled: false, enforcement: 'off' }, { ok: [400, 404, 409] }],
    ['PUT', '/api/terms/public-site-origin', { publicSiteOrigin: 'https://example.invalid' }],
    ['PUT', '/api/platforms/settings', { platforms: [] }, { ok: [400, 404] }],
    ['PUT', `/api/platforms/${platformId}/color`, { color: '#112233' }],
    ['PUT', `/api/platforms/${platformId}/commission`, { commissionPercent: 10 }],
    ['PUT', `/api/platforms/${platformId}/deposit-mode`, { depositMode: 'none' }, { ok: [400] }],
    ['PUT', `/api/platforms/${platformId}/payout-due-days`, { payoutDueDays: 3 }, { ok: [400] }],
    ['PUT', `/api/platforms/${platformId}/tourist-tax`, { touristTaxCollection: 'platform' }, { ok: [400] }],
    ['PUT', `/api/devis/${s.devis}`, () => ({ propertyId: s.property, clientId: s.client, startDate: dayAt(50), endDate: dayAt(53), adults: 2, platform: 'direct', checkInTime: '15:00', checkOutTime: '10:00', notes: 'Note' })],
  ];
  return { seed: s, rows };
}

// Every TEXT column of the instance, and what a wrong type leaves there. A number or a boolean written as text is the
// fuzz's own value coming back; the rows already there before the first request are not its doing.
const JUNK = "LIKE '%[object %'";
const SCALARS = ['true', 'false', 'null', 'undefined', 'NaN', 'Infinity', '1e+308', '1.0e+308', '1.5', '-1', '-1.0'];
// A setting's value, a journal and the history quote what they were given: only an object's text would be a defect there.
const QUOTING = new Set(['plugin_settings', 'reservation_history', 'support_access_log', 'translation_entries', 'tariff_change_events']);

function junkScanner(dbPath) {
  const db = new Database(dbPath, { readonly: true });
  const queries = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all().flatMap(({ name: table }) => db.prepare(`PRAGMA table_info("${table}")`).all()
    .filter((c) => /TEXT/i.test(c.type))
    .map((c) => {
      const scalar = QUOTING.has(table) ? '' : ` OR "${c.name}" IN (${SCALARS.map((v) => `'${v}'`).join(', ')})`;
      return { where: `${table}.${c.name}`, statement: db.prepare(`SELECT "${c.name}" AS v FROM "${table}" WHERE "${c.name}" ${JUNK}${scalar}`) };
    }));
  const scan = () => queries.flatMap(({ where, statement }) => statement.all().map((row) => `${where}=${String(row.v).slice(0, 40)}`));
  const known = new Set(scan());
  return {
    fresh: () => {
      const found = scan().filter((entry) => !known.has(entry));
      found.forEach((entry) => known.add(entry));
      return found;
    },
    close: () => db.close(),
  };
}

function* leaves(body, prefix = []) {
  if (Array.isArray(body)) {
    for (let i = 0; i < Math.min(body.length, 2); i += 1) {
      yield [...prefix, i];
      if (body[i] && typeof body[i] === 'object') yield* leaves(body[i], [...prefix, i]);
    }
  } else if (body && typeof body === 'object') {
    for (const key of Object.keys(body)) {
      yield [...prefix, key];
      if (body[key] && typeof body[key] === 'object') yield* leaves(body[key], [...prefix, key]);
    }
  }
}

function withValue(body, keyPath, value) {
  const copy = JSON.parse(JSON.stringify(body));
  let at = copy;
  for (const key of keyPath.slice(0, -1)) at = at[key];
  at[keyPath[keyPath.length - 1]] = value;
  return copy;
}

/**
 * One row, one field wrong at a time. Answers the requests made, the failures (a 5xx, an `[unhandled]` line, junk in a text
 * column) and the baseline's status: a row that stops at a refusal of its own never reaches its fields.
 */
async function fuzzRow(app, session, scanner, row, values) {
  const [method, rawUrl, rawBody, options = {}] = row;
  let counter = 0;
  const failures = [];
  let requests = 0;
  const send = async (make) => {
    const target = typeof rawUrl === 'function' ? await rawUrl() : rawUrl;
    const body = make(typeof rawBody === 'function' ? rawBody(counter) : rawBody);
    const mark = app.logMark();
    const res = await app.call(session, method, target, body);
    requests += 1;
    if (res.status < 400) counter += 1;
    const unhandled = /\[unhandled\]/.test(app.logSince(mark));
    return { res, unhandled, label: `${method} ${options.name || target}` };
  };
  const first = await send((body) => body);
  const baseline = first.res.status;
  const reached = baseline < 300 || (options.ok || []).includes(baseline);
  const sample = typeof rawBody === 'function' ? rawBody(0) : rawBody;
  for (const keyPath of leaves(sample)) {
    for (const [name, value] of values) {
      const { res, unhandled, label } = await send((body) => withValue(body, keyPath, value));
      if ((res.status >= 500 && !(options.ok || []).includes(res.status)) || unhandled) failures.push(`${label} ${keyPath.join('.')}=${name} → ${res.status}${unhandled ? ' [unhandled]' : ''} ${res.text.slice(0, 100)}`);
      if (res.status < 400) {
        for (const junk of scanner.fresh()) failures.push(`${label} ${keyPath.join('.')}=${name} → ${res.status} stored ${junk}`);
      }
    }
  }
  return { requests, failures, baseline, reached, answer: first.res.text.slice(0, 160) };
}

module.exports = { baselines, fuzzRow, junkScanner, dayAt };
