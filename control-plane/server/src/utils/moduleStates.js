/**
 * What one module line says (specs/plugin-operator-provisioning.md rule 14): never what the operator
 * hopes, always what the space reports. Pure.
 *
 *   facts           `instances.readFacts()` — null when the space cannot be read
 *   licenceWrittenAt  `issuedAt` of the licence the console last wrote for this customer
 */

const PENDING_ALERT_MS = 5 * 60 * 1000;

function moduleState({ id, on, facts, licenceWrittenAt, now }) {
  if (!facts) {
    return { state: 'unknown', stateLabel: 'Non relevé', detail: 'Espace illisible.', canRetry: false, needsSetup: false };
  }
  const reported = facts.provisioning || null;
  const actual = facts.active.includes(id);
  if (actual === on) {
    if (!on) return { state: 'inactive', stateLabel: 'Inactif', detail: null, canRetry: false, needsSetup: false };
    const missing = reported && reported.moduleFacts[id] ? reported.moduleFacts[id].setup : null;
    const version = facts.versions[id];
    if (missing) {
      return { state: 'active', stateLabel: `Actif · à configurer : ${missing}`, detail: version || null, canRetry: false, needsSetup: true };
    }
    return { state: 'active', stateLabel: version ? `Actif · ${version}` : 'Actif', detail: null, canRetry: false, needsSetup: false };
  }
  const row = reported && reported.rows.find((r) => r.pluginId === id);
  const answered = row && licenceWrittenAt && row.licenceIssuedAt === licenceWrittenAt && row.desired === (on ? 'active' : 'inactive');
  if (answered && row.outcome === 'failed') {
    return { state: 'failed', stateLabel: `Échec : ${row.message}`, detail: null, canRetry: true, needsSetup: false };
  }
  if (answered && row.outcome === 'blocked') {
    return { state: 'blocked', stateLabel: `Bloqué : ${row.message}`, detail: null, canRetry: false, needsSetup: false };
  }
  const waitedMs = licenceWrittenAt ? now.getTime() - Date.parse(licenceWrittenAt) : 0;
  const stateLabel = waitedMs >= PENDING_ALERT_MS
    ? `En attente depuis ${Math.floor(waitedMs / 60000)} min — espace injoignable ?`
    : 'En attente';
  return { state: 'pending', stateLabel, detail: null, canRetry: false, needsSetup: false };
}

function headerText(counts) {
  const parts = [`${counts.active} actif${counts.active > 1 ? 's' : ''}`];
  if (counts.toConfigure) parts.push(`${counts.toConfigure} à configurer`);
  if (counts.failed) parts.push(`${counts.failed} en échec`);
  if (counts.blocked) parts.push(`${counts.blocked} bloqué${counts.blocked > 1 ? 's' : ''}`);
  return parts.join(' · ');
}

module.exports = { moduleState, headerText, PENDING_ALERT_MS };
