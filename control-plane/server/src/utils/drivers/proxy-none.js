/**
 * The `none` proxy driver (specs/hosting-h1-fleet-runtime.md H-D6): development and CI, where each
 * instance answers on its own port and nothing stands in front. It still records what the proxy
 * would serve — a site, the closed page, a redirect — in `<root>/proxy-routes.json`, so the
 * lifecycle can be followed and tested.
 */

const fs = require('fs');
const path = require('path');

function createNoneProxyDriver({ root }) {
  const file = path.join(root, 'proxy-routes.json');
  const read = () => {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      return {};
    }
  };
  const write = (routes) => {
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(routes, null, 2));
  };
  const set = (slug, route) => {
    const routes = read();
    if (route) routes[slug] = route;
    else delete routes[slug];
    write(routes);
  };

  return {
    name: 'none',
    file,
    writeSite: async (inst) => set(inst.slug, { kind: 'site', port: inst.port }),
    writeClosed: async (slug) => set(slug, { kind: 'closed' }),
    writeRedirect: async (from, to) => set(from, { kind: 'redirect', to }),
    remove: async (slug) => set(slug, null),
    route: (slug) => read()[slug] || null,
    healthUrl: (inst) => `http://127.0.0.1:${inst.port}/api/version`,
    certExpiry: async () => null,
    instanceEnv: () => ({ GUESTFLOW_LISTEN_HOST: '127.0.0.1' }),
  };
}

module.exports = { createNoneProxyDriver };
