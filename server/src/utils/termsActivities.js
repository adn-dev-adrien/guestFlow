/**
 * The activities whose terms the core keeps (specs/gift-voucher-campaigns.md rule 37): `lodging` is the core's own, a plugin
 * declares another with `ctx.termsActivity({ key, label, seed? })` — read here through the registry, so a plugin that is off
 * takes its tab and its public text away while its published versions and acceptances stay.
 */

const registry = require('../plugins/sdk/registry');

const LODGING = 'lodging';
const CORE = [{ key: LODGING, label: 'Hébergement' }];

function declared() {
  return registry.all()
    .filter((r) => registry.isLive(r.id))
    .flatMap((r) => (r.termsActivities || []).map((a) => ({ key: a.key, label: a.label, seed: a.seed || null })));
}

/** → [{ key, label, seed }] — the core's first. */
function list() {
  return [...CORE.map((a) => ({ ...a, seed: null })), ...declared()];
}

function find(key) {
  return list().find((a) => a.key === key) || null;
}

/** The key a request names: absent means `lodging`; unknown or off → null. */
function resolve(raw) {
  const key = raw == null || raw === '' ? LODGING : String(raw);
  return find(key) ? key : null;
}

/** Writes the declared first drafts of the activities that never had a draft. Never publishes. */
function seedDrafts(model) {
  declared().filter((a) => a.seed && !model.hasDraft(a.key)).forEach((a) => model.saveDraft({ fr: a.seed.fr, en: a.seed.en, activity: a.key }));
}

module.exports = {
  LODGING, list, find, resolve, seedDrafts,
};
