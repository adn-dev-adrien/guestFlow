// Vite injects build-time env vars via `import.meta.env`. CRA's `process.env.REACT_APP_*`
// equivalents become `VITE_*` (specs/cra-to-vite-migration.md §3.1 rule 6).
const API = import.meta.env.VITE_API_URL || '/api';

async function request(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    headers: options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' },
    credentials: 'include', // send the session cookie (same-origin in prod, credentialed CORS in dev)
    ...options,
    body: options.body instanceof FormData ? options.body : (options.body ? JSON.stringify(options.body) : undefined),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    const message = err.error || res.statusText;
    const apiError = new Error(message);
    Object.assign(apiError, err, { status: res.status });
    // A lost/absent session on any call (other than the auth probe itself) → tell the app to re-auth.
    if (res.status === 401 && path !== '/auth/me' && path !== '/auth/login') {
      window.dispatchEvent(new CustomEvent('guestflow:unauthenticated'));
    }
    throw apiError;
  }
  if (res.status === 204) return null;
  return res.json();
}

const api = {
  // Version / deployment metadata
  getVersion: () => request('/version'),

  // Auth
  login: (email, password) => request('/auth/login', { method: 'POST', body: { email, password } }),
  logout: () => request('/auth/logout', { method: 'POST' }),
  getMe: () => request('/auth/me'),
  changePassword: (currentPassword, newPassword) =>
    request('/auth/change-password', { method: 'POST', body: { currentPassword, newPassword } }),

  // Clients
  getClients: (q) => request(`/clients${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  getClient: (id) => request(`/clients/${id}`),
  getClientDeleteImpact: (id) => request(`/clients/${id}/delete-impact`),
  cleanupOrphanClients: () => request('/clients/cleanup-orphans', { method: 'POST' }),
  getOrphanClientsPreview: () => request('/clients/cleanup-orphans/preview'),
  cleanupOrphanClientsByIds: (ids) => request('/clients/cleanup-orphans/delete', { method: 'POST', body: { ids } }),
  createClient: (data) => request('/clients', { method: 'POST', body: data }),
  updateClient: (id, data) => request(`/clients/${id}`, { method: 'PUT', body: data }),
  deleteClient: (id, options = {}) => {
    const params = new URLSearchParams();
    if (options.force) params.set('force', 'true');
    const suffix = params.toString() ? `?${params.toString()}` : '';
    return request(`/clients/${id}${suffix}`, { method: 'DELETE' });
  },

  // Properties
  getProperties: () => request('/properties'),
  getProperty: (id) => request(`/properties/${id}`),
  getPlatformColors: () => request('/properties/platform-colors'),
  createProperty: (formData) => request('/properties', { method: 'POST', body: formData }),
  updateProperty: (id, formData) => request(`/properties/${id}`, { method: 'PUT', body: formData }),
  deleteProperty: (id) => request(`/properties/${id}`, { method: 'DELETE' }),
  // specs/platforms-and-ical-rework.md — merged per-property platform list (built-ins ∪ DB + this
  // property's iCal-source config + global colour) and the global per-platform colour setter.
  getPropertyPlatforms: (propId) => request(`/properties/${propId}/platforms`),
  setPlatformColor: (platformKey, color) => request(`/platforms/${encodeURIComponent(platformKey)}/color`, { method: 'PUT', body: { color } }),
  // Global per-platform tourist-tax mode ('platform' | 'platform_reversed' | 'owner') — applies to every property.
  setPlatformTouristTax: (platformKey, touristTaxCollection) => request(`/platforms/${encodeURIComponent(platformKey)}/tourist-tax`, { method: 'PUT', body: { touristTaxCollection } }),
  // specs/platform-deposit-toggle.md — global per-platform « acompte » flag (applies to every property).
  setPlatformDepositMode: (platformKey, takesDeposit) => request(`/platforms/${encodeURIComponent(platformKey)}/deposit-mode`, { method: 'PUT', body: { takesDeposit } }),
  getPropertyIcalSources: (propId) => request(`/properties/${propId}/ical-sources`),
  createPropertyIcalSource: (propId, data) => request(`/properties/${propId}/ical-sources`, { method: 'POST', body: data }),
  updatePropertyIcalSource: (propId, sourceId, data) => request(`/properties/${propId}/ical-sources/${sourceId}`, { method: 'PUT', body: data }),
  deletePropertyIcalSource: (propId, sourceId) => request(`/properties/${propId}/ical-sources/${sourceId}`, { method: 'DELETE' }),
  syncPropertyIcalSource: (propId, sourceId) => request(`/properties/${propId}/ical-sources/${sourceId}/sync`, { method: 'POST' }),
  syncAllPropertyIcalSources: (propId) => request(`/properties/${propId}/ical-sources/sync-all`, { method: 'POST' }),

  // Pricing
  addPricingRule: (propId, data) => request(`/properties/${propId}/pricing`, { method: 'POST', body: data }),
  updatePricingRule: (propId, ruleId, data) => request(`/properties/${propId}/pricing/${ruleId}`, { method: 'PUT', body: data }),
  deletePricingRule: (propId, ruleId) => request(`/properties/${propId}/pricing/${ruleId}`, { method: 'DELETE' }),
  applyPricingRulesToProperty: (sourcePropId, data) => request(`/properties/${sourcePropId}/pricing/apply-to`, { method: 'POST', body: data }),
  previewProgressivePricing: (propId, data) => request(`/properties/${propId}/pricing/progressive-preview`, { method: 'POST', body: data }),
  // specs/platform-price-from-commission.md — « prix plateformes » grid (seasons × platforms gross-up)
  // + the per-platform commission % editor (global per platform).
  getPlatformPrices: (propId) => request(`/properties/${propId}/platform-prices`),
  setPlatformCommission: (platformId, commissionPercent) => request(`/platforms/${platformId}/commission`, { method: 'PUT', body: { commissionPercent } }),

  // Documents
  uploadDocument: (propId, formData) => request(`/properties/${propId}/documents`, { method: 'POST', body: formData }),
  deleteDocument: (propId, docId) => request(`/properties/${propId}/documents/${docId}`, { method: 'DELETE' }),

  // Property options
  updatePropertyOptions: (propId, optionIds) => request(`/properties/${propId}/options`, { method: 'PUT', body: { optionIds } }),

  // Per-property option DEFAULTS (specs/weekly-bed-linen-tracking.md §3.7,
  // specs/reservation-option-immutability.md). Independent of updatePropertyOptions, which only
  // manages the availability filter. `getPropertyOptionDefaults` feeds the reservation form
  // (forced-option detection when CREATING a reservation) and the read-only mirror on the Options
  // page. The defaults are edited from the Options page (the per-property grid on an option); the
  // former PropertyDetail "Options incluses" card was removed, so no per-property write endpoint is
  // exposed here anymore.
  getPropertyOptionDefaults: (propId) => request(`/properties/${propId}/option-defaults`),
  getOptionPropertyDefaults: (optionId) => request(`/options/${optionId}/property-defaults`),

  // Options
  getOptions: () => request('/options'),
  createOption: (data) => request('/options', { method: 'POST', body: data }),
  updateOption: (id, data) => request(`/options/${id}`, { method: 'PUT', body: data }),
  deleteOption: (id) => request(`/options/${id}`, { method: 'DELETE' }),

  // Resources
  getResources: (propertyId) => request(`/resources${propertyId ? `?propertyId=${propertyId}` : ''}`),
  getResourcesAvailability: (params) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/resources/availability${qs ? `?${qs}` : ''}`);
  },
  getBabyBedAvailability: (params) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/resources/baby-bed-availability${qs ? `?${qs}` : ''}`);
  },
  createResource: (data) => request('/resources', { method: 'POST', body: data }),
  updateResource: (id, data) => request(`/resources/${id}`, { method: 'PUT', body: data }),
  getResourceDeleteImpact: (id) => request(`/resources/${id}/delete-impact`),
  deleteResource: (id, options = {}) => {
    const suffix = options.force ? '?force=true' : '';
    return request(`/resources/${id}${suffix}`, { method: 'DELETE' });
  },

  // Resource bookings (complex resources — time slots)
  getResourceBookings: (params) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/resource-bookings?${qs}`);
  },
  getResourceBookingPlanningEvents: (from, to) => request(`/resource-bookings/planning-events?from=${from}&to=${to}`),
  getOccupiedSlots: (resourceId, date) => request(`/resource-bookings/occupied-slots?resourceId=${resourceId}&date=${date}`),
  createResourceBooking: (data) => request('/resource-bookings', { method: 'POST', body: data }),
  updateResourceBooking: (id, data) => request(`/resource-bookings/${id}`, { method: 'PUT', body: data }),
  deleteResourceBooking: (id) => request(`/resource-bookings/${id}`, { method: 'DELETE' }),

  // Reservations
  getReservations: (params) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/reservations${qs ? `?${qs}` : ''}`);
  },
  // Canonical platform-name list for the dropdowns (built-ins ∪ DB platforms, incl. iCal-added).
  // specs/ical-platforms-in-dropdowns.md.
  getPlatforms: () => request('/platforms'),
  getReservation: (id) => request(`/reservations/${id}`),
  // Live "jump to a reservation" search by number / name (specs/reservation-number-and-search.md).
  searchReservations: (q) => request(`/reservations/search?q=${encodeURIComponent(q || '')}`),
  getReservationHistory: (id) => request(`/reservations/${id}/history`),
  calculatePrice: (data) => request('/reservations/calculate-price', { method: 'POST', body: data }),
  suggestBeds: (data) => request('/reservations/suggest-beds', { method: 'POST', body: data }),
  createReservation: (data) => request('/reservations', { method: 'POST', body: data }),
  updateReservation: (id, data) => request(`/reservations/${id}`, { method: 'PUT', body: data }),
  markPayment: (id, data) => request(`/reservations/${id}/payment`, { method: 'PATCH', body: data }),
  deleteReservation: (id) => request(`/reservations/${id}`, { method: 'DELETE' }),
  getOccupiedDates: (propertyId, from, to, excludeReservationId) => {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (excludeReservationId) params.set('excludeReservationId', excludeReservationId);
    return request(`/reservations/occupied-dates/${propertyId}?${params.toString()}`);
  },

  // Finance
  getFinanceSummary: (from, to) => {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    return request(`/finance/summary?${params}`);
  },
  getFinanceBreakdown: (metric, from, to) => {
    const params = new URLSearchParams();
    params.set('metric', metric);
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    return request(`/finance/breakdown?${params}`);
  },
  getFinanceProjection: (date) => request(`/finance/projection?date=${date || ''}`),
  getFinanceOperational: () => request('/finance/operational'),
  getTouristTaxExtraction: (month) => request(`/finance/tourist-tax?month=${encodeURIComponent(month)}`),
  // specs/tourist-tax-declared-checkbox.md — tick / untick « Déclarée » for one reservation.
  setTouristTaxDeclared: (reservationId, declared) => request(`/finance/tourist-tax/${reservationId}/declared`, { method: 'PATCH', body: { declared } }),

  // School holidays — getSchoolHolidays now returns { periods, syncState }.
  getSchoolHolidays: () => request('/school-holidays'),
  createSchoolHoliday: (data) => request('/school-holidays', { method: 'POST', body: data }),
  updateSchoolHoliday: (id, data) => request(`/school-holidays/${id}`, { method: 'PUT', body: data }),
  deleteSchoolHoliday: (id) => request(`/school-holidays/${id}`, { method: 'DELETE' }),
  unlockSchoolHoliday: (id) => request(`/school-holidays/${id}/unlock`, { method: 'PUT' }),
  syncSchoolHolidays: () => request('/school-holidays/sync', { method: 'POST' }),
  updateSchoolHolidaysSyncSettings: ({ syncIntervalDays, syncHorizonMonths }) =>
    request('/school-holidays/sync-settings', { method: 'PUT', body: { syncIntervalDays, syncHorizonMonths } }),

  // Public holidays — server-computed for the given years; returns [{ date, label }].
  getPublicHolidays: (years) => request(`/public-holidays?years=${[...new Set(years)].join(',')}`),

  // Calendar notes
  getCalendarNotes: (propertyId, from, to) => {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    return request(`/calendar-notes/${propertyId}?${params}`);
  },
  upsertCalendarNote: (propertyId, date, note) => request(`/calendar-notes/${propertyId}/${date}`, { method: 'PUT', body: { note } }),
  deleteCalendarNote: (propertyId, date) => request(`/calendar-notes/${propertyId}/${date}`, { method: 'DELETE' }),

  // iCal Export
  getIcalToken: (propertyId) => request(`/ical/token/${propertyId}`),
  regenerateIcalToken: (propertyId) => request(`/ical/regenerate-token/${propertyId}`, { method: 'POST' }),

  // App settings
  getSettings: () => request('/settings'),
  updateSettings: (payload) => request('/settings', { method: 'PUT', body: payload }),

  // PWA Web Push (specs/pwa-push-notifications.md §4.3). Per-user (the session cookie identifies the user).
  getPushPublicKey: () => request('/push/public-key'),
  subscribePush: (subscription) => request('/push/subscribe', { method: 'POST', body: { subscription } }),
  unsubscribePush: (endpoint) => request('/push/subscribe', { method: 'DELETE', body: { endpoint } }),
  getPushPreferences: () => request('/push/preferences'),
  updatePushPreferences: (prefs) => request('/push/preferences', { method: 'PUT', body: prefs }),
  sendPushTest: () => request('/push/test', { method: 'POST' }),
  // Online payments (specs/online-payments-qonto.md). Qonto connection state + configurable timings.
  getPaymentSettings: () => request('/payments/settings'),
  updatePaymentSettings: (payload) => request('/payments/settings', { method: 'PUT', body: payload }),
  getQontoStatus: () => request('/payments/qonto/status'),
  getQontoBankAccounts: () => request('/payments/qonto/bank-accounts'),
  connectQontoProvider: (payload) => request('/payments/qonto/connect-provider', { method: 'POST', body: payload }),
  refreshQontoConnection: () => request('/payments/qonto/refresh-connection'),
  // Payment links on a reservation/devis + manual poll (specs/online-payments-qonto.md §3.4/§7).
  createReservationPaymentLink: (id, type = 'deposit') => request(`/payments/reservations/${id}/payment-links`, { method: 'POST', body: { type } }),
  getReservationPaymentLinks: (id) => request(`/payments/reservations/${id}/payment-links`),
  sendDepositRequestEmail: (id) => request(`/payments/reservations/${id}/payment-emails`, { method: 'POST', body: { type: 'deposit' } }),
  sendBalanceRequestEmail: (id) => request(`/payments/reservations/${id}/payment-emails`, { method: 'POST', body: { type: 'balance' } }),
  pollPayments: () => request('/payments/poll', { method: 'POST' }),
  registerQontoWebhook: () => request('/payments/qonto/webhook/register', { method: 'POST' }),
  uploadCompanyLogo: (formData) => request('/settings/logo', { method: 'POST', body: formData }),
  deleteCompanyLogo: () => request('/settings/logo', { method: 'DELETE' }),

  // Devis (quotes)
  getDevis: (params) => {
    const qs = new URLSearchParams(params || {}).toString();
    return request(`/devis${qs ? `?${qs}` : ''}`);
  },
  getDevisById: (id) => request(`/devis/${id}`),
  createDevis: (data) => request('/devis', { method: 'POST', body: data }),
  updateDevis: (id, data) => request(`/devis/${id}`, { method: 'PUT', body: data }),
  updateDevisStatus: (id, status) => request(`/devis/${id}/status`, { method: 'PATCH', body: { status } }),
  deleteDevis: (id) => request(`/devis/${id}`, { method: 'DELETE' }),
  convertDevisToReservation: (id) => request(`/devis/${id}/convert-to-reservation`, { method: 'POST' }),
  createDevisFromReservation: (reservationId) => request(`/devis/from-reservation/${reservationId}`, { method: 'POST' }),
  getDevisPdfUrl: (id) => `${API}/devis/${id}/pdf`,
  // Fetch the devis PDF as a blob. Uses credentials so the session cookie is sent — required because
  // VITE_API_URL can be absolute (cross-origin in dev), where a default fetch would omit the cookie.
  getDevisPdfBlob: async (id) => {
    const res = await fetch(`${API}/devis/${id}/pdf`, { credentials: 'include' });
    if (!res.ok) throw new Error('Impossible de générer le PDF.');
    return res.blob();
  },
  getDevisHistory: (id) => request(`/devis/${id}/history`),

  // Accounting (read-only; admin + accountant)
  getAccountingSales: (month, year) => request(`/accounting/sales?month=${month}&year=${year}`),
  getAccountingPlatforms: (month, year) => request(`/accounting/platforms?month=${month}&year=${year}`),
  downloadAccountingSalesCsv: async (month, year) => {
    const res = await fetch(`${API}/accounting/sales.csv?month=${month}&year=${year}`, { credentials: 'include' });
    if (!res.ok) throw new Error("Impossible de générer le CSV.");
    return res.blob();
  },
  // Per-platform commission accounting config — admin + accountant (PUT whitelisted on the
  // accountant role guard, see middleware/enforceRoleAccess.js).
  // accounting-platform-commission-and-no-deposit.md §4.3.
  getPlatformAccounts: () => request('/accounting/platform-accounts'),
  // Pass the raw payload — the `request` helper above JSON.stringifies it once. The earlier
  // version of this line also called JSON.stringify, which produced a double-encoded body
  // (`"{\"defaultAccount\":...}"`) → body-parser rejected with 400, no row ever got persisted,
  // and the page silently appeared to save while actually doing nothing (see 2026-06-05 bug
  // report).
  savePlatformAccounts: (payload) => request('/accounting/platform-accounts', { method: 'PUT', body: payload }),
  // Rescan the union of `ical_sources` + `reservations.platform` so any platform that wasn't
  // ramassée at boot (e.g. fresh manual reservation) appears on the page without a server
  // restart. Returns `{ defaultAccount, vatRateCommission, platforms, newCount }`.
  refreshPlatformAccounts: () => request('/accounting/platform-accounts/refresh', { method: 'POST' }),

  // User management (admin-only). resetUserPassword no longer takes a password — the server
  // generates the temp password and emails it (specs/admin-account-management.md M2).
  listUsers: () => request('/users'),
  getCurrentUser: () => request('/users/me'),
  // Self-service profile update — every authenticated role can call this on their own row.
  // Email IS editable since 2026-06-02 (the bootstrap admin must be able to replace the
  // `admin@guestflow.local` seed). Roles stay locked server-side (privilege guard).
  updateSelf: (payload) => request('/users/me', { method: 'PUT', body: payload }),
  // Lightweight status feed for the email field's "you still use the default admin seed"
  // red warning. Returns `{ myEmail, defaultStillUsed }`.
  getMyEmailStatus: () => request('/users/me/email-status'),
  // Weekly bed-linen tracking (specs/weekly-bed-linen-tracking.md). Returns the laundry-day
  // summaries that fall in [from, to] inclusive — each with dropOff + pickUp bed counts.
  // `to` is OPTIONAL: when omitted the server projects to the inventory horizon (= last
  // reservation endDate). Use the explicit form when paginating an infinite-scroll viewport;
  // omit it for "give me everything that matters" calls like a post-toggle refetch
  // (specs/skip-laundry-trip.md §4.3 — hotfix 2026-06-05 follow-up #3).
  getLaundryPlanningSummary: ({ from, to } = {}) => {
    const params = [`from=${encodeURIComponent(from)}`];
    if (to) params.push(`to=${encodeURIComponent(to)}`);
    return request(`/planning/laundry?${params.join('&')}`);
  },
  // Per-day breakfast list (specs/breakfast-option-and-planning-card.md §4.3). Returns the
  // dates in [from, to] where ≥1 reservation has the breakfast option AND the customer is
  // present in the morning (= `startDate < D AND endDate >= D`). Payload:
  // `{ breakfastByDate: { 'YYYY-MM-DD': { items: [{ clientName, propertyName, persons }], totalPersons } } }`.
  getBreakfastPlanningSummary: ({ from, to }) =>
    request(`/planning/breakfast?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
  // Option-driven planning cards (specs/option-planning-card.md §3.3). Returns one card per stored
  // occurrence of a « carte planning » option whose date ∈ [from, to]. Payload:
  // `{ optionCardsByDate: { 'YYYY-MM-DD': { items: [{ reservationId, optionId, title, clientName, propertyName, date, time }] } } }`.
  getPlanningOptionCards: ({ from, to }) =>
    request(`/planning/option-cards?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
  // Toggle the « préparé » flag of one option-card occurrence (specs/option-planning-card.md §3.5).
  setPlanningOptionCardDone: ({ reservationId, optionId, date, time, done }) =>
    request('/planning/option-cards/done', {
      method: 'POST',
      body: { reservationId, optionId, date, time, done },
    }),
  // Resource-driven planning cards (specs/resource-hourly-scheduling.md §3.4). One card per session of a
  // « carte planning » resource whose date ∈ [from, to]. Payload:
  // `{ resourceCardsByDate: { 'YYYY-MM-DD': { items: [{ reservationId, resourceId, name, clientName, propertyName, date, start, end, done }] } } }`.
  getPlanningResourceCards: ({ from, to }) =>
    request(`/planning/resource-cards?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
  setPlanningResourceCardDone: ({ reservationId, resourceId, date, start, done }) =>
    request('/planning/resource-cards/done', {
      method: 'POST',
      body: { reservationId, resourceId, date, start, done },
    }),
  // Linen inventory projection (specs/linen-inventory-shortage-tracking.md §4.3). Returns the
  // post-day-end clean state per laundry day in the horizon, used by LaundryDayCard.
  getLinenInventory: () => request('/planning/linen-inventory'),
  // Dashboard linen shortage alert. Returns the grouped-by-type list of projected shortages,
  // empty when nothing is in shortage.
  getLinenShortageAlert: () => request('/dashboard/linen-shortage'),
  // Arrival / departure SAS (specs/arrival-departure-sas.md). One GET to assemble the wizard
  // data, one POST to commit each SAS (single write, no per-step persistence).
  getReservationSas: (id) => request(`/reservations/${encodeURIComponent(id)}/sas`),
  commitArrivalSas: (id, body) => request(`/reservations/${encodeURIComponent(id)}/sas/arrival`, { method: 'POST', body }),
  commitDepartureSas: (id, body) => request(`/reservations/${encodeURIComponent(id)}/sas/departure`, { method: 'POST', body }),
  // Weather-alert page for the arrival SAS (specs/checkin-weather-alerts.md). Fired in the
  // background when the check-in opens; returns { configured, resolved, department, alerts:[] }.
  getReservationWeatherAlerts: (id) => request(`/reservations/${encodeURIComponent(id)}/weather-alerts`),
  // Priced linen items + repair amounts (« Tarifs facturables » — specs/extinguisher-seal-and-repair-amounts.md).
  getLinenItems: () => request('/settings/linen-items'),
  updateLinenItems: (items) => request('/settings/linen-items', { method: 'PUT', body: items }),
  getRepairAmounts: () => request('/settings/repair-amounts'),
  updateRepairAmounts: (items) => request('/settings/repair-amounts', { method: 'PUT', body: items }),
  // Laundry trip skips — admin-only toggle on `/api/laundry/skips`. Marking a date as
  // skipped tells the linen inventory engine to defer drop-off + pick-up to the next
  // non-skipped trip. Global per date (one human, one trip). Spec
  // specs/skip-laundry-trip.md §4.3.
  listLaundrySkips: () => request('/laundry/skips'),
  addLaundrySkip: (date) => request('/laundry/skips', { method: 'POST', body: { date } }),
  removeLaundrySkip: (date) => request(`/laundry/skips/${date}`, { method: 'DELETE' }),
  // Per-trip manual linen additions — `{ additions: { 'YYYY-MM-DD': {6 counts} } }`. PUT upserts a
  // trip's six per-type counts (all-zero deletes). Spec specs/manual-laundry-additions.md §4.3.
  getLaundryManualAdditions: () => request('/laundry/manual-additions'),
  setLaundryManualAddition: (date, counts) => request(`/laundry/manual-additions/${date}`, { method: 'PUT', body: counts }),
  // Dashboard iCal date-drift approvals — pending date-change proposals on locked iCal
  // reservations (specs/ical-sync-override-locked-dates.md §4.3).
  getIcalDateDriftAlert: () => request('/dashboard/ical-date-drift'),
  approveIcalDateDrift: (id) => request(`/dashboard/ical-date-drift/${id}/approve`, { method: 'POST' }),
  rejectIcalDateDrift: (id) => request(`/dashboard/ical-date-drift/${id}/reject`, { method: 'POST' }),
  // Dashboard iCal cancellation approvals — pending deletion proposals when a reservation's
  // UID has fallen out of every source feed (specs/ical-cancellation-approval.md §4.3).
  getIcalCancellationAlert: () => request('/dashboard/ical-cancellation'),
  approveIcalCancellation: (id) => request(`/dashboard/ical-cancellation/${id}/approve`, { method: 'POST' }),
  rejectIcalCancellation: (id) => request(`/dashboard/ical-cancellation/${id}/reject`, { method: 'POST' }),
  // Dashboard "new iCal reservations today" — read-only notification of bookings imported via
  // iCal during the current day (specs/dashboard-ical-new-reservations.md).
  getIcalNewReservationsToday: () => request('/dashboard/ical-new-today'),
  // Dashboard "pending site devis" — booking requests submitted from the public website that are
  // still awaiting handling (specs/site-booking-notifications.md §3 rule 5).
  getPendingPublicDevis: () => request('/dashboard/public-devis-pending'),
  createUser: (payload) => request('/users', { method: 'POST', body: payload }),
  updateUser: (id, payload) => request(`/users/${id}`, { method: 'PUT', body: payload }),
  resetUserPassword: (id) => request(`/users/${id}/reset-password`, { method: 'POST' }),
  deleteUser: (id, { hard = false } = {}) => request(`/users/${id}${hard ? '?hard=1' : ''}`, { method: 'DELETE' }),

  // SMTP test (specs/admin-account-management.md M3) — sends "Email de test GuestFlow" to the
  // current admin so they can verify the SMTP block before inviting anyone.
  sendSmtpTest: () => request('/settings/smtp-test', { method: 'POST' }),

  // Google Calendar sync
  getGoogleCalendarStatus: () => request('/google-calendar/status'),
  syncGoogleCalendarReservations: (payload = {}) => request('/google-calendar/sync-reservations', { method: 'POST', body: payload }),
  testGoogleCalendarConnection: () => request('/google-calendar/test-connection', { method: 'POST' }),

  // Establishment closures
  getEstablishmentClosures: (params = {}) => {
    const filtered = Object.entries(params)
      .filter(([, v]) => v != null && v !== '')
      .reduce((acc, [k, v]) => { acc[k] = String(v); return acc; }, {});
    const qs = new URLSearchParams(filtered).toString();
    return request(`/establishment-closures${qs ? `?${qs}` : ''}`);
  },
  createEstablishmentClosure: (data) => request('/establishment-closures', { method: 'POST', body: data }),
  updateEstablishmentClosure: (id, data) => request(`/establishment-closures/${id}`, { method: 'PUT', body: data }),
  deleteEstablishmentClosure: (id) => request(`/establishment-closures/${id}`, { method: 'DELETE' }),

  // Email automation (specs/email-automation.md)
  getEmailTemplates:        () => request('/email-templates'),
  getEmailTemplate:         (id) => request(`/email-templates/${id}`),
  createEmailTemplate:      (data) => request('/email-templates', { method: 'POST', body: data }),
  updateEmailTemplate:      (id, data) => request(`/email-templates/${id}`, { method: 'PUT', body: data }),
  deleteEmailTemplate:      (id) => request(`/email-templates/${id}`, { method: 'DELETE' }),

  previewEmail: ({ reservationId, templateId }) =>
    request(`/emails/preview?reservationId=${encodeURIComponent(reservationId)}&templateId=${encodeURIComponent(templateId)}`),
  sendEmail:    ({ reservationId, templateId, overrides }) =>
    request('/emails/send', { method: 'POST', body: { reservationId, templateId, overrides } }),
  getPendingEmails:          () => request('/emails/pending'),
  acknowledgePendingEmail:   ({ templateId, reservationId }) =>
    request(`/emails/pending/${encodeURIComponent(templateId)}/${encodeURIComponent(reservationId)}/acknowledge`, { method: 'POST' }),
  // Mark a pending email as sent outside GuestFlow (specs/mark-email-sent-manually.md).
  markEmailSent:             ({ templateId, reservationId }) =>
    request(`/emails/pending/${encodeURIComponent(templateId)}/${encodeURIComponent(reservationId)}/mark-sent`, { method: 'POST' }),
  // Manual email compose (specs/manual-email-from-template.md)
  getEmailEligibleReservations: (q) =>
    request(`/emails/eligible-reservations${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  queueEmail: ({ templateId, reservationId, force }) =>
    request('/emails/queue', { method: 'POST', body: { templateId, reservationId, force: Boolean(force) } }),
  getEmailHistory: (params = {}) => {
    const filtered = Object.entries(params)
      .filter(([, v]) => v != null && v !== '')
      .reduce((acc, [k, v]) => { acc[k] = String(v); return acc; }, {});
    const qs = new URLSearchParams(filtered).toString();
    return request(`/emails/history${qs ? `?${qs}` : ''}`);
  },
};

export default api;
