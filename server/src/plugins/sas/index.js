/**
 * Arrivée et départ guidés (SAS) — module per specs/plugins-phase-2-hosts.md §3.C.
 *
 * The plugin owns the SAS routes, the controller that reads and orchestrates, and the « Facturables »
 * prices. The commit itself — payments at the door, complement lines, caution, settlement — stays in
 * the core (`reservationsModel.commitArrivalSas` / `commitDepartureSas`), called through the SDK.
 *
 * Rule 14: no `ctx.data` on purpose. Everything the SAS records is part of the stays, and the
 * « Facturables » prices are used again on reinstall, so there is nothing to erase.
 */

const id = 'sas';

function register(ctx) {
  // specs/plugins-phase-p-productisation.md rule 16 — « Contrôle de l'extincteur ».
  require('./settings').bind(ctx);

  // Resolved on the first request: the controllers bind core models when they load, and plugins
  // register while the core is still booting.
  const controller = (name) => (req, res) => require('./controller')[name](req, res);
  const billables = (name) => (req, res) => require('./billablesController')[name](req, res);

  ctx.route('get', '/api/reservations/:id/sas', controller('getSas'));
  ctx.route('post', '/api/reservations/:id/sas/arrival', controller('commitArrival'));
  ctx.route('post', '/api/reservations/:id/sas/departure', controller('commitDeparture'));

  // The reception role runs the check-in and check-out (specs/reception-role-checkin-only.md §3.6
  // rule 11). The controller still refuses a SAS outside its day (specs/reception-sas-today-only.md).
  ctx.reception([
    { method: 'GET', re: /^\/reservations\/\d+\/sas$/ },
    { method: 'POST', re: /^\/reservations\/\d+\/sas\/arrival$/ },
    { method: 'POST', re: /^\/reservations\/\d+\/sas\/departure$/ },
  ]);

  // Gap 3 — the « Facturables au SAS » prices answer only while the plugin is live.
  ctx.route('get', '/api/settings/linen-items', billables('getLinenItems'));
  ctx.route('put', '/api/settings/linen-items', billables('updateLinenItems'));
  ctx.route('get', '/api/settings/repair-amounts', billables('getRepairAmounts'));
  ctx.route('put', '/api/settings/repair-amounts', billables('updateRepairAmounts'));
}

module.exports = { id, register };
