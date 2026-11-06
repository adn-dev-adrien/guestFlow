// The write routes each plugin mounts, by plugin id (specs/hosting-h2-account-security.md rule 68, census; reading of
// 2026-11-05, audit R24-S1). A tree without a plugin holds none of its routes, so the census drops that plugin's
// exemptions and baseline rows instead of calling them stale. route-census.unit.test.js holds this list equal to what each
// plugin of the tree registers: a plugin route added, moved or removed changes it here.
const PLUGIN_ROUTES = {
  'accounting-export': [
    'POST /api/accounting/platform-accounts/refresh',
    'PUT /api/accounting/platform-accounts',
  ],
  'airbnb-intake': [
    'POST /api/airbnb-intake/:intakeId/apply',
    'POST /api/airbnb-intake/:intakeId/dismiss',
    'POST /api/airbnb-intake/run',
    'POST /api/airbnb-intake/test-mailbox',
  ],
  'booking-intake': [
    'POST /api/booking-intake/:id/apply',
    'POST /api/booking-intake/:id/hide',
    'POST /api/booking-intake/:id/ignore',
    'POST /api/booking-intake/pending/:reservationId/dismiss',
    'POST /api/booking-intake/secret',
    'POST /api/booking-intake/secret/regenerate',
    'POST /public/booking-intake/page',
  ],
  'gate-access': [
    'POST /public/v1/gate/results',
  ],
  'gites-de-france-intake': [
    'POST /api/gdf-intake/:intakeId/apply',
    'POST /api/gdf-intake/:intakeId/dismiss',
    'POST /api/gdf-intake/run',
    'POST /api/gdf-intake/test-mailbox',
  ],
  'google-calendar': [
    'POST /api/google-calendar/oauth/disconnect',
    'POST /api/google-calendar/sync-now',
    'POST /api/google-calendar/test-connection',
    'PUT /api/google-calendar/calendar',
  ],
  'google-vacation-rentals': [
    'POST /api/google-vacation-rentals/check',
    'POST /api/google-vacation-rentals/push',
  ],
  'hourly-resources': [
    'DELETE /api/resource-bookings/:id',
    'POST /api/planning/resource-cards/done',
    'POST /api/resource-bookings',
    'POST /api/resource-bookings/preview',
    'PUT /api/resource-bookings/:id',
  ],
  'linen': [
    'DELETE /api/laundry/extra-trips/:date',
    'DELETE /api/laundry/skips/:date',
    'POST /api/laundry/schedule/preview',
    'POST /api/laundry/skips',
    'PUT /api/laundry/extra-trips/:date',
    'PUT /api/laundry/manual-additions/:date',
    'PUT /api/laundry/schedule',
  ],
  'neat': [
    'POST /api/neat/reservations/:id/retry',
    'POST /api/neat/reservations/:id/void',
    'POST /api/neat/test-connection',
    'PUT /api/neat/mapping',
    'PUT /api/neat/selection',
    'PUT /api/neat/settings',
  ],
  'online-payment': [
    'DELETE /api/payments/reconciliation/links/:transactionId',
    'DELETE /api/payments/reconciliation/transactions/:id/outside',
    'POST /api/payments/qonto/connect-provider',
    'POST /api/payments/qonto/test',
    'POST /api/payments/qonto/webhook',
    'POST /api/payments/reconciliation/allocation-preview',
    'POST /api/payments/reconciliation/confirm-all',
    'POST /api/payments/reconciliation/discards',
    'POST /api/payments/reconciliation/links',
    'POST /api/payments/reconciliation/links/batch',
    'POST /api/payments/reconciliation/read',
    'POST /api/payments/reconciliation/transactions/:id/outside',
    'PUT /api/payments/qonto/credentials',
  ],
  'sas': [
    'POST /api/reservations/:id/sas/arrival',
    'POST /api/reservations/:id/sas/arrival/preview',
    'POST /api/reservations/:id/sas/departure',
    'POST /api/reservations/:id/sas/departure/preview',
    'PUT /api/settings/linen-items',
    'PUT /api/settings/repair-amounts',
  ],
  'school-holidays': [
    'DELETE /api/school-holidays/:id',
    'POST /api/school-holidays',
    'POST /api/school-holidays/sync',
    'PUT /api/school-holidays/:id',
    'PUT /api/school-holidays/:id/unlock',
  ],
  'tariff-recipes': [
    'DELETE /api/tariff-recipes/journal/:eventId',
    'POST /api/properties/:id/tariff-recipe/apply',
    'POST /api/properties/:id/tariff-recipe/detach',
    'POST /api/tariff-recipes/journal',
    'POST /api/tariff-recipes/runs/:runId/dismiss',
  ],
  'website-booking': [
    'POST /api/settings/website-connection/regenerate',
    'PUT /api/terms/enforcement',
  ],
};

/** The id of the plugin that mounts `route` ('METHOD /path/:param'), or null for a core route. */
const ownerOf = (route) => Object.keys(PLUGIN_ROUTES).find((id) => PLUGIN_ROUTES[id].includes(route)) || null;

module.exports = { PLUGIN_ROUTES, ownerOf };
