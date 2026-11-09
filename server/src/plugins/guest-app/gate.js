/**
 * The « Portail » tile (specs/guest-app.md rules 12-14): a door to the gate app that already exists, never a gate
 * screen. The URL is the stay's key link as `gate-access` holds it — the very `{{gateAccessUrl}}` of the e-mails,
 * read through the e-mail context that plugin declares, never from its tables. GuestFlow still never calls the house.
 *
 *   outside    — not a stay session (the tile is absent): no URL, ever;
 *   preparing  — a stay session, Sowel has not read the key yet: « Accès en préparation », not clickable;
 *   active     — the key exists: the tile opens its URL.
 */

const registry = require('../sdk/registry');

const GATE_PLUGIN = 'gate-access';

const gateLive = () => registry.isLive(GATE_PLUGIN);

/** The stay's key link, or null: what `gate-access` would put in an e-mail now. */
function keyUrlOf(reservationId) {
  if (!gateLive()) return null;
  const record = registry.get(GATE_PLUGIN);
  const url = (record ? record.emailProviders : [])
    .map((provider) => {
      try {
        const context = provider.build(reservationId);
        return context && context.tokens ? context.tokens.gateAccessUrl : null;
      } catch {
        return null;
      }
    })
    .find(Boolean);
  return url ? String(url) : null;
}

const STATE_LABELS = Object.freeze({ fr: { preparing: 'Accès en préparation' }, en: { preparing: 'Access being prepared' } });

/** Rule 13 — `{ state, url? }` for a session; the URL only for a stay session. */
function gateState({ mode, reservationId }, readUrl = keyUrlOf) {
  if (mode !== 'stay' || !reservationId) return { state: 'outside' };
  const url = readUrl(reservationId);
  return url ? { state: 'active', url } : { state: 'preparing' };
}

const stateLabel = (state, lang = 'fr') => ((STATE_LABELS[lang] || STATE_LABELS.fr)[state] || null);

module.exports = {
  GATE_PLUGIN, gateLive, gateState, keyUrlOf, stateLabel,
};
