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

  // Documents
  uploadDocument: (propId, formData) => request(`/properties/${propId}/documents`, { method: 'POST', body: formData }),
  deleteDocument: (propId, docId) => request(`/properties/${propId}/documents/${docId}`, { method: 'DELETE' }),

  // Property options
  updatePropertyOptions: (propId, optionIds) => request(`/properties/${propId}/options`, { method: 'PUT', body: { optionIds } }),

  // Per-property option DEFAULTS (specs/weekly-bed-linen-tracking.md §3.7). Independent of
  // updatePropertyOptions, which only manages the availability filter. The endpoints below
  // drive the "Options ajoutées par défaut" section in PropertyDetail and the read-only
  // mirror in OptionsPage.
  getPropertyOptionDefaults: (propId) => request(`/properties/${propId}/option-defaults`),
  setPropertyOptionDefault: (propId, optionId, offered) =>
    request(`/properties/${propId}/option-defaults/${optionId}`, {
      method: 'PUT', body: { offered: Boolean(offered) },
    }),
  unsetPropertyOptionDefault: (propId, optionId) =>
    request(`/properties/${propId}/option-defaults/${optionId}`, { method: 'DELETE' }),
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
  getReservation: (id) => request(`/reservations/${id}`),
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
  getFinanceProjection: (date) => request(`/finance/projection?date=${date || ''}`),
  getFinanceOperational: () => request('/finance/operational'),
  getTouristTaxExtraction: (month) => request(`/finance/tourist-tax?month=${encodeURIComponent(month)}`),

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
  getLaundryPlanningSummary: ({ from, to }) =>
    request(`/planning/laundry?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
  // Linen inventory projection (specs/linen-inventory-shortage-tracking.md §4.3). Returns the
  // post-day-end clean state per laundry day in the horizon, used by LaundryDayCard.
  getLinenInventory: () => request('/planning/linen-inventory'),
  // Dashboard linen shortage alert. Returns the grouped-by-type list of projected shortages,
  // empty when nothing is in shortage.
  getLinenShortageAlert: () => request('/dashboard/linen-shortage'),
  // Laundry trip skips — admin-only toggle on `/api/laundry/skips`. Marking a date as
  // skipped tells the linen inventory engine to defer drop-off + pick-up to the next
  // non-skipped trip. Global per date (one human, one trip). Spec
  // specs/skip-laundry-trip.md §4.3.
  listLaundrySkips: () => request('/laundry/skips'),
  addLaundrySkip: (date) => request('/laundry/skips', { method: 'POST', body: { date } }),
  removeLaundrySkip: (date) => request(`/laundry/skips/${date}`, { method: 'DELETE' }),
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
};

export default api;
