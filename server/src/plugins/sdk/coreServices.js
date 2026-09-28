/**
 * `ctx.core` — the ONLY core services a plugin may call (specs/plugins-phase-1-sdk.md rule 11). A
 * plugin needing more asks for it here, in one reviewed place, instead of requiring a core file.
 * Requires are lazy: the plugins register while the core is still booting.
 */

const lazy = (path) => () => require(path);
const reservations = lazy('../../models/reservationsModel');
const settings = lazy('../../models/settingsModel');
const textFormatters = lazy('../../utils/textFormatters');
const pushService = lazy('../../utils/pushService');

module.exports = Object.freeze({
  reservations: Object.freeze({
    getByIdWithDetails: (id) => reservations().getByIdWithDetails(id),
  }),
  settings: Object.freeze({
    companyAddress: () => String(settings().read().companyAddress || ''),
    publicUrl: () => settings().publicUrl(),
  }),
  push: Object.freeze({
    sendToUser: (userId, payload) => pushService().sendToUser(userId, payload),
  }),
  text: Object.freeze({
    sentenceCase: (s) => textFormatters().sentenceCase(s),
  }),
});
