/**
 * Plan quotas (specs/control-plane-plans-and-access.md rule 13). Creating a rental unit or an
 * account beyond the licence's quota is refused; what already exists above a lowered quota keeps
 * working. `licence` is injectable for tests.
 */

const LABELS = {
  units: (n) => (n > 1 ? `${n} logements` : '1 logement'),
  users: (n) => (n > 1 ? `${n} comptes` : '1 compte'),
};

// The 402 body when one more `quota` item would exceed the plan, or null. `count` is only called
// when the plan has a limit.
function quotaRefusal(quota, count, licence = require('./licence').default) {
  const limit = licence.quota(quota);
  if (limit === null || count() < limit) return null;
  const plan = licence.planName();
  return {
    error: 'QUOTA_REACHED',
    quota,
    limit,
    message: `${plan ? `Forfait ${plan}` : 'Forfait'} : ${LABELS[quota](limit)} maximum.`,
  };
}

module.exports = { quotaRefusal };
