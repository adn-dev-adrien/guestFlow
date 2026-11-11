/**
 * The `caddy` proxy driver (specs/hosting-h1-fleet-runtime.md H-D2): one site file per address in
 * the directory the main Caddyfile imports (deploy/hosting/Caddyfile), then `caddy reload`. Caddy
 * obtains each certificate by itself.
 *
 * A reload Caddy refuses leaves its running configuration live; the driver puts the previous file
 * back so the disk matches what runs, and the step fails with Caddy's own message.
 */

const fs = require('fs');
const path = require('path');
const tls = require('tls');
const { readEnv } = require('../instanceEnv');

// The secret header tells the instance this request came through Caddy (rule 21).
function siteFile({ host, port, secret }) {
  const up = secret ? ` {\n\t\theader_up X-Guestflow-Proxy ${secret}\n\t}` : '';
  return `# Written by the GuestFlow console — edits are overwritten.\n${host} {\n\tencode zstd gzip\n\treverse_proxy 127.0.0.1:${port}${up}\n}\n`;
}

function closedFile({ host, closedDir }) {
  return `# Written by the GuestFlow console — edits are overwritten.\n${host} {\n\troot * ${closedDir}\n\trewrite * /index.html\n\tfile_server\n}\n`;
}

function redirectFile({ host, to }) {
  return `# Written by the GuestFlow console — edits are overwritten.\n${host} {\n\tredir https://${to}{uri} permanent\n}\n`;
}

// The certificate served on 127.0.0.1:443 for `host` (SNI), read without trusting it.
function servedCertificate(host, { port = 443, timeoutMs = 3000 } = {}) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host: '127.0.0.1', port, servername: host, rejectUnauthorized: false, timeout: timeoutMs }, () => {
      const cert = socket.getPeerCertificate();
      socket.end();
      resolve(cert && Object.keys(cert).length ? cert : null);
    });
    socket.on('timeout', () => { socket.destroy(); reject(new Error('timeout')); });
    socket.on('error', reject);
  });
}

function createCaddyProxyDriver({
  exec, domain, sitesDir = '/etc/caddy/sites', caddyfile = '/etc/caddy/Caddyfile', caddyBin = 'caddy',
  closedDir = '/srv/guestflow/closed', peerCertificate = servedCertificate,
}) {
  const hostOf = (slug) => `${slug}.${domain}`;
  const fileOf = (slug) => path.join(sitesDir, `${slug}.caddy`);

  async function reload() {
    try {
      await exec(caddyBin, ['reload', '--config', caddyfile, '--adapter', 'caddyfile']);
    } catch (err) {
      throw new Error(`Caddy : ${err.message}`);
    }
  }

  // Writes (or removes, content null) one site file and reloads; a refusal restores the old file.
  // One change at a time: two reloads at once make Caddy drop one of them (EOF on its admin socket,
  // found on the real-host check when two customers were created together).
  let chain = Promise.resolve();
  function apply(slug, content) {
    const run = chain.catch(() => {}).then(() => applyNow(slug, content));
    chain = run;
    return run;
  }

  async function applyNow(slug, content) {
    const file = fileOf(slug);
    const previous = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    if (previous === content) return;
    fs.mkdirSync(sitesDir, { recursive: true });
    if (content === null) fs.rmSync(file, { force: true });
    else fs.writeFileSync(file, content, { mode: 0o640 });
    try {
      await reload();
    } catch (err) {
      if (previous === null) fs.rmSync(file, { force: true });
      else fs.writeFileSync(file, previous, { mode: 0o640 });
      throw new Error(`${err.message} (configuration précédente conservée)`);
    }
  }

  return {
    name: 'caddy',
    hostOf,
    fileOf,
    writeSite: (inst) => apply(inst.slug, siteFile({
      host: hostOf(inst.slug), port: inst.port, secret: inst.envFile ? (readEnv(inst.envFile) || {}).GUESTFLOW_PROXY_SECRET : null,
    })),
    writeClosed: (slug) => apply(slug, closedFile({ host: hostOf(slug), closedDir })),
    writeRedirect: (from, to) => apply(from, redirectFile({ host: hostOf(from), to: hostOf(to) })),
    remove: (slug) => apply(slug, null),
    route(slug) {
      const file = fileOf(slug);
      if (!fs.existsSync(file)) return null;
      const text = fs.readFileSync(file, 'utf8');
      if (text.includes('reverse_proxy')) return { kind: 'site' };
      if (text.includes('redir ')) return { kind: 'redirect' };
      return { kind: 'closed' };
    },
    healthUrl: (inst) => `https://${hostOf(inst.slug)}/api/version`,
    // Rule 15: the expiry of the certificate Caddy actually serves for the address, or null.
    async certExpiry(slug) {
      const cert = await peerCertificate(hostOf(slug)).catch(() => null);
      return cert && cert.valid_to ? new Date(cert.valid_to).toISOString() : null;
    },
    // Variables the instance needs behind Caddy: trust one hop, HTTPS-grade headers, local listener.
    instanceEnv: () => ({ TRUST_PROXY_HOPS: '1', HTTPS_ENABLED: 'true', GUESTFLOW_TLS_UPSTREAM: '1', GUESTFLOW_LISTEN_HOST: '127.0.0.1' }),
  };
}

module.exports = { createCaddyProxyDriver, siteFile, closedFile, redirectFile, servedCertificate };
