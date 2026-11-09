/**
 * The stay link in the reminder e-mails (specs/guest-app.md rule 9bis b), declared by this plugin like the gate
 * key's variables are by `gate-access`. `{{stayAppUrl}}` is the stay's « Mon séjour » link, else the gate key's link,
 * so the sentence always has a link to give; `hasStayApp` says whether it is the app's own. While the plugin is
 * inactive both are empty — a template keeps its gate paragraph under `hasGateAccess`.
 */

const SCOPE = Object.freeze(['j7', 'j2']);
const TOKENS = Object.freeze([{ name: 'stayAppUrl', label: 'Lien Mon séjour', in: SCOPE }]);
const FLAGS = Object.freeze([{ name: 'hasStayApp', label: 'Si lien Mon séjour', in: SCOPE }]);

function stayAppEmailContext({ stayUrl, gateUrl }) {
  const own = stayUrl ? String(stayUrl) : '';
  return { tokens: { stayAppUrl: own || (gateUrl ? String(gateUrl) : '') }, flags: { hasStayApp: Boolean(own) } };
}

module.exports = { TOKENS, FLAGS, stayAppEmailContext };
