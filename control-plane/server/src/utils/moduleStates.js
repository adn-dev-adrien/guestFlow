/**
 * What one module line says (specs/plugin-operator-provisioning.md rule 14): never what the operator
 * hopes, always what the space reports. Pure.
 *
 *   facts           `instances.readFacts()` — null when the space cannot be read
 *   licenceWrittenAt  `issuedAt` of the licence the console last wrote for this customer
 *
 * A line is a short `stateLabel` (the badge) plus what goes with it: `detail` (the space's own sentence),
 * `setupLabel` (a second, warning badge) and `stale` (a wait long enough to worry about).
 */

const PENDING_ALERT_MS = 5 * 60 * 1000;

const line = (state, stateLabel, extra = {}) => ({
  state, stateLabel, detail: null, setupLabel: null, canRetry: false, needsSetup: false, stale: false, ...extra,
});

function moduleState({ id, on, facts, licenceWrittenAt, now }) {
  if (!facts) return line('unknown', 'Non relevé', { detail: 'Espace illisible.' });
  const reported = facts.provisioning || null;
  const actual = facts.active.includes(id);
  if (actual === on) {
    if (!on) return line('inactive', 'Inactif');
    const missing = reported && reported.moduleFacts[id] ? reported.moduleFacts[id].setup : null;
    const version = facts.versions[id];
    return line('active', version ? `Actif · ${version}` : 'Actif', missing ? { setupLabel: `à configurer : ${missing}`, needsSetup: true } : {});
  }
  const row = reported && reported.rows.find((r) => r.pluginId === id);
  const answered = row && licenceWrittenAt && row.licenceIssuedAt === licenceWrittenAt && row.desired === (on ? 'active' : 'inactive');
  if (answered && row.outcome === 'failed') return line('failed', 'Échec', { detail: row.message, canRetry: true });
  if (answered && row.outcome === 'blocked') return line('blocked', 'Bloqué', { detail: row.message });
  const waitedMs = licenceWrittenAt ? now.getTime() - Date.parse(licenceWrittenAt) : 0;
  return waitedMs >= PENDING_ALERT_MS
    ? line('pending', 'En attente', { detail: `Depuis ${Math.floor(waitedMs / 60000)} min — espace injoignable ?`, stale: true })
    : line('pending', 'En attente', { detail: 'L’espace lit la licence…' });
}

// → [{ text, tone }]: only a failure is worth a colour; the client joins the parts with « · ».
function headerParts(counts) {
  const parts = [{ text: `${counts.active} actif${counts.active > 1 ? 's' : ''}`, tone: null }];
  if (counts.toConfigure) parts.push({ text: `${counts.toConfigure} à configurer`, tone: null });
  if (counts.failed) parts.push({ text: `${counts.failed} en échec`, tone: 'error' });
  if (counts.blocked) parts.push({ text: `${counts.blocked} bloqué${counts.blocked > 1 ? 's' : ''}`, tone: null });
  return parts;
}

const headerText = (counts) => headerParts(counts).map((p) => p.text).join(' · ');

module.exports = { moduleState, headerText, headerParts, PENDING_ALERT_MS };
