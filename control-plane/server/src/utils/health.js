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
    return { ok: true, version: body.version || null };
  } catch (err) {
    return { ok: false, error: err.name === 'AbortError' ? 'pas de réponse' : (err.cause && err.cause.code) || err.message };
  } finally {
    clearTimeout(timer);
  }
}

// `gone()` → a reason when waiting is pointless (the process has exited), else null.
async function waitHealthy({ url, expectVersion = null, timeoutMs = 60000, intervalMs = Math.min(1000, Math.max(50, timeoutMs / 10)), fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), gone = async () => null }) {
  const deadline = Date.now() + timeoutMs;
  let last = { ok: false, error: 'pas de réponse' };
  for (;;) {
    last = await probeOnce({ url, fetchImpl, timeoutMs: Math.min(5000, timeoutMs) });
    if (last.ok && (!expectVersion || last.version === expectVersion)) return last;
    const reason = last.ok ? null : await gone().catch(() => null);
    if (reason) return { ok: false, error: reason };
    if (Date.now() >= deadline) break;
    await sleep(intervalMs);
  }
  const seconds = Math.round(timeoutMs / 1000);
  if (last.ok) return { ok: false, version: last.version, error: `répond en ${last.version || 'version inconnue'} au lieu de ${expectVersion}` };
  return { ok: false, error: `aucune réponse de /api/version en ${seconds} s (${last.error})` };
}

module.exports = { probeOnce, waitHealthy };
