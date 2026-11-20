/**
 * The stay link in the reminder e-mails (specs/guest-app.md rule 9bis b), declared by this plugin like the gate
 * key's variables are by `gate-access`. `{{stayAppUrl}}` is the stay's « Mon séjour » link, else the gate key's link,
 * so the sentence always has a link to give; `hasStayApp` says whether it is the app's own. While the plugin is
 * inactive both are empty — a template keeps its gate paragraph under `hasGateAccess`.
 *
 * Rules 70, 89 — two more flags, for the J-7 and J-2 paragraph that tells the guests what they can already do: `hasStayAppShop`
 * (the stay link is the app's own, the lodging shows the shop with an article sold, and orders are taken for the stay) and
 * `hasStayAppBath` (on top of it, the stay holds the nordic bath or has free minutes of it left); `hasStayAppShopOnly` is the shop
 * without the bath, so a paragraph of two flat blocks (the renderer does not nest) never promises a bath the stay does not have.
 */

const SCOPE = Object.freeze(['j7', 'j2']);
const TOKENS = Object.freeze([{ name: 'stayAppUrl', label: 'Lien Mon séjour', in: SCOPE }]);
const FLAGS = Object.freeze([
  { name: 'hasStayApp', label: 'Si lien Mon séjour', in: SCOPE },
  { name: 'hasStayAppShop', label: 'Si boutique Mon séjour', in: SCOPE },
  { name: 'hasStayAppBath', label: 'Si bain nordique à programmer', in: SCOPE },
  // The renderer's conditionals do not nest: the J-7 paragraph is two flat blocks, with the bath and without it.
  { name: 'hasStayAppShopOnly', label: 'Si boutique Mon séjour sans bain', in: SCOPE },
]);

function stayAppEmailContext({
  stayUrl, gateUrl, shop = false, bath = false,
}) {
  const own = stayUrl ? String(stayUrl) : '';
  const hasShop = Boolean(own) && Boolean(shop);
  return {
    tokens: { stayAppUrl: own || (gateUrl ? String(gateUrl) : '') },
    flags: {
      hasStayApp: Boolean(own), hasStayAppShop: hasShop, hasStayAppBath: hasShop && Boolean(bath), hasStayAppShopOnly: hasShop && !bath,
    },
  };
}

module.exports = { TOKENS, FLAGS, stayAppEmailContext };
