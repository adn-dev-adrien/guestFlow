/**
 * The health check of an instance (specs/hosting-h1-fleet-runtime.md rules 1.7, 10): `GET
 * /api/version` answers, and — when a version is expected — with that version. Polled until it does
 * or the time is up.
 */

async function probeOnce({ url, fetchImpl = fetch, timeoutMs = 5000 }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { signal: controller.signal, redirect: 'manual' });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const body = await res.json().catch(() => ({}));
    return { ok: true, version: body.version || null, plugin: body.plugin || null };
  } catch (err) {
    return { ok: false, error: err.name === 'AbortError' ? 'pas de réponse' : (err.cause && err.cause.code) || err.message };
  } finally {
    clearTimeout(timer);
  }
}

// A plugin pushed by the console (rule 11) must have loaded, at the pushed version.
function pluginReady(last, expectPlugin) {
  if (!expectPlugin) return true;
  return Boolean(last.plugin && last.plugin.ok && last.plugin.version === expectPlugin.version);
}

// `gone()` → a reason when waiting is pointless (the process has exited), else null.
// `expectPlugin` = { id, version }: `/api/version?plugin=<id>` must say it loaded at that version.
async function waitHealthy({ url, expectVersion = null, expectPlugin = null, timeoutMs = 60000, intervalMs = Math.min(1000, Math.max(50, timeoutMs / 10)), fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), gone = async () => null }) {
  const deadline = Date.now() + timeoutMs;
  let last = { ok: false, error: 'pas de réponse' };
  const target = expectPlugin ? `${url}${url.includes('?') ? '&' : '?'}plugin=${encodeURIComponent(expectPlugin.id)}` : url;
  for (;;) {
    last = await probeOnce({ url: target, fetchImpl, timeoutMs: Math.min(5000, timeoutMs) });
    if (last.ok && (!expectVersion || last.version === expectVersion) && pluginReady(last, expectPlugin)) return last;
    const reason = last.ok ? null : await gone().catch(() => null);
    if (reason) return { ok: false, error: reason };
    if (Date.now() >= deadline) break;
    await sleep(intervalMs);
  }
  const seconds = Math.round(timeoutMs / 1000);
  if (last.ok && expectVersion && last.version !== expectVersion) return { ok: false, version: last.version, error: `répond en ${last.version || 'version inconnue'} au lieu de ${expectVersion}` };
  if (last.ok) {
    const p = last.plugin;
    const why = !p || !p.version ? 'non chargé' : (p.ok ? `chargé en ${p.version}` : `en échec en ${p.version}`);
    return { ok: false, version: last.version, error: `plugin ${expectPlugin.id} ${why} au lieu de ${expectPlugin.version}` };
  }
  return { ok: false, error: `aucune réponse de /api/version en ${seconds} s (${last.error})` };
}

module.exports = { probeOnce, waitHealthy };
