/**
 * Delivers one ARI message (specs/google-vacation-rentals-feed.md rules 14-16).
 *
 *   Envoi       POST https://www.google.com/travel/hotels/uploads/<path>, Content-Type application/xml,
 *               aborted after `timeoutMs`; Google's body is parsed for its errors and warnings.
 *   Simulation  the XML is written under `<dataDir>/simulation/` and `fetch` is never called.
 *
 * `fetchImpl` is injectable so tests never reach Google.
 */

const fs = require('fs');
const path = require('path');
const { parseResponse } = require('./ariXml');

const BASE_URL = 'https://www.google.com/travel/hotels/uploads/';
const DEFAULT_TIMEOUT_MS = 60000;

// mode() → 'simulation' | 'envoi'; dataDir() → the plugin's own directory.
function createGoogleClient({ mode, dataDir, fetchImpl = (...args) => fetch(...args), timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const simulationDir = (folder) => path.join(dataDir(), 'simulation', folder);

  return {
    /** The previous simulated run of a property is replaced, never accumulated. */
    beginRun(folder) {
      if (mode() !== 'simulation') return;
      fs.rmSync(simulationDir(folder), { recursive: true, force: true });
    },

    // → { ok, simulated, status, body, warnings, errors }
    async send({ path: uploadPath, xml, folder, file }) {
      if (mode() !== 'envoi') {
        const dir = simulationDir(folder);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, file), xml);
        return { ok: true, simulated: true, status: null, body: '', warnings: [], errors: [] };
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetchImpl(`${BASE_URL}${uploadPath}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/xml' },
          body: xml,
          signal: controller.signal,
        });
        const body = await res.text();
        return { ...parseResponse(res.status, body), simulated: false, status: res.status, body };
      } catch (err) {
        const message = err && err.name === 'AbortError' ? `Délai dépassé (${Math.round(timeoutMs / 1000)} s)` : String((err && err.message) || err);
        return { ok: false, simulated: false, status: null, body: message, warnings: [], errors: [message] };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

module.exports = { createGoogleClient, BASE_URL };
