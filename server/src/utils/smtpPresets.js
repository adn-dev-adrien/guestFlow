/**
 * The sending server deduced from the sending address (specs/settings-rationalization.md rule 28;
 * UI/UX review 2026-10-18, decision 14). The operator types an address and a password; the server
 * recognises the provider — first by the address's own domain (gmail.com, orange.fr…), then by the
 * domain's MX records — and proposes its host and security. The port follows the security (rule 11).
 *
 * DNS only, from the server: no third-party API. The resolver is injected so the unit suites never
 * reach the network; `GUESTFLOW_SMTP_DETECT=off` (E2E, development) turns the lookup off.
 *
 *   createSmtpDetector({ resolveMx?, timeoutMs?, ttlMs?, maxEntries?, now?, env? }).detect(address)
 *     → { status: 'found', domain, provider: { id, name, host, secure, port, hint } }
 *     | { status: 'unsupported', domain, provider: { id, name }, reason }
 *     | { status: 'unknown' | 'dns-failed' | 'off', domain } | { status: 'invalid', domain: '' }
 */

const dns = require('dns');

const APP_PASSWORD = 'Un mot de passe d’application, créé dans le compte.';
const MAILBOX_PASSWORD = 'Le mot de passe de la boîte mail.';
const MAX_DOMAIN_LENGTH = 253;

// `domains`: addresses whose own domain names the provider (no DNS needed). `mx`: suffixes of the
// MX hosts that betray it for any other domain (a company domain hosted there); `mxExclude`: MX
// hosts of that provider that hold no mailbox (OVH's redirection-only `redirect.ovh.net`).
// `unsupported`: a provider that refuses a password over SMTP — nothing is proposed, the card says why.
// Zoho: an address @zohomail.* is a personal account (smtp.zoho.*); a company domain whose MX is
// Zoho's is an organisation account (smtppro.zoho.*).
const PROVIDERS = Object.freeze([
  { id: 'google', name: 'Gmail', host: 'smtp.gmail.com', secure: true, hint: 'Un mot de passe d’application Google (16 lettres).', domains: ['gmail.com', 'googlemail.com'], mx: ['google.com', 'googlemail.com'] },
  {
    id: 'outlook', name: 'Outlook.com',
    unsupported: 'Outlook, Hotmail et Live demandent l’authentification moderne : l’envoi par mot de passe n’est pas pris en charge.',
    domains: ['outlook.com', 'outlook.fr', 'hotmail.com', 'hotmail.fr', 'live.com', 'live.fr', 'msn.com'], mx: [],
  },
  { id: 'microsoft365', name: 'Microsoft 365', host: 'smtp.office365.com', secure: false, hint: 'Le mot de passe de la boîte ; l’envoi SMTP authentifié doit être autorisé pour elle dans Microsoft 365, sinon Microsoft refuse.', domains: [], mx: ['mail.protection.outlook.com'] },
  { id: 'ovh', name: 'OVHcloud', host: 'ssl0.ovh.net', secure: true, hint: MAILBOX_PASSWORD, domains: [], mx: ['ovh.net'], mxExclude: [/^redirect\./] },
  { id: 'ionos', name: 'IONOS', host: 'smtp.ionos.fr', secure: true, hint: MAILBOX_PASSWORD, domains: [], mx: ['ionos.fr', 'ionos.com', 'kundenserver.de', '1and1.fr'] },
  { id: 'infomaniak', name: 'Infomaniak', host: 'mail.infomaniak.com', secure: true, hint: MAILBOX_PASSWORD, domains: ['ik.me'], mx: ['infomaniak.ch'] },
  { id: 'gandi', name: 'Gandi', host: 'mail.gandi.net', secure: true, hint: MAILBOX_PASSWORD, domains: [], mx: ['gandi.net'] },
  { id: 'zoho-eu', name: 'Zoho Mail', host: 'smtp.zoho.eu', secure: true, hint: APP_PASSWORD, domains: ['zohomail.eu'], mx: [] },
  { id: 'zoho-com', name: 'Zoho Mail', host: 'smtp.zoho.com', secure: true, hint: APP_PASSWORD, domains: ['zohomail.com', 'zoho.com'], mx: [] },
  { id: 'zoho-pro-eu', name: 'Zoho Mail', host: 'smtppro.zoho.eu', secure: true, hint: APP_PASSWORD, domains: [], mx: ['zoho.eu'] },
  { id: 'zoho-pro-com', name: 'Zoho Mail', host: 'smtppro.zoho.com', secure: true, hint: APP_PASSWORD, domains: [], mx: ['zoho.com'] },
  { id: 'icloud', name: 'iCloud', host: 'smtp.mail.me.com', secure: false, hint: 'Un mot de passe pour app, créé sur le compte Apple.', domains: ['icloud.com', 'me.com', 'mac.com'], mx: ['icloud.com'] },
  { id: 'yahoo', name: 'Yahoo', host: 'smtp.mail.yahoo.com', secure: true, hint: APP_PASSWORD, domains: ['yahoo.com', 'yahoo.fr', 'ymail.com'], mx: ['yahoodns.net'] },
  { id: 'orange', name: 'Orange', host: 'smtp.orange.fr', secure: true, hint: MAILBOX_PASSWORD, domains: ['orange.fr', 'wanadoo.fr'], mx: ['orange.fr'] },
  { id: 'free', name: 'Free', host: 'smtp.free.fr', secure: true, hint: MAILBOX_PASSWORD, domains: ['free.fr'], mx: ['free.fr'] },
  { id: 'sfr', name: 'SFR', host: 'smtp.sfr.fr', secure: true, hint: MAILBOX_PASSWORD, domains: ['sfr.fr', 'neuf.fr'], mx: ['sfr.fr'] },
  { id: 'laposte', name: 'La Poste', host: 'smtp.laposte.net', secure: true, hint: MAILBOX_PASSWORD, domains: ['laposte.net'], mx: ['laposte.net'] },
]);

const portFor = (secure) => (secure ? 465 : 587);

const view = ({ id, name, host, secure, hint }) => ({ id, name, host, secure, port: portFor(secure), hint });

/** The lower-case domain of an address, or '' when it is not one. */
function domainOf(address) {
  const m = /^[^\s@]+@([a-z0-9.-]+\.[a-z]{2,})$/i.exec(String(address || '').trim());
  const domain = m ? m[1].toLowerCase().replace(/\.$/, '') : '';
  return domain.length > MAX_DOMAIN_LENGTH ? '' : domain;
}

const outcome = (provider, domain) => (provider.unsupported
  ? { status: 'unsupported', domain, provider: { id: provider.id, name: provider.name }, reason: provider.unsupported }
  : { status: 'found', domain, provider: view(provider) });

const endsWithDomain = (host, suffix) => host === suffix || host.endsWith(`.${suffix}`);

function byDomain(domain) {
  return PROVIDERS.find((p) => p.domains.includes(domain)) || null;
}

/** The provider the MX records point at, the most preferred record first. */
function byMx(records) {
  const hosts = [...(records || [])]
    .sort((a, b) => Number(a.priority || 0) - Number(b.priority || 0))
    .map((r) => String(r.exchange || '').toLowerCase().replace(/\.$/, ''));
  for (const host of hosts) {
    const found = PROVIDERS.find((p) => p.mx.some((suffix) => endsWithDomain(host, suffix))
      && !(p.mxExclude || []).some((re) => re.test(host)));
    if (found) return found;
  }
  return null;
}

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('DNS_TIMEOUT')), ms); }),
  ]).finally(() => clearTimeout(timer));
}

function createSmtpDetector({
  resolveMx = (domain) => dns.promises.resolveMx(domain), timeoutMs = 3000, ttlMs = 60 * 60 * 1000, maxEntries = 500,
  now = () => Date.now(), env = process.env,
} = {}) {
  const cache = new Map();
  const off = String(env.GUESTFLOW_SMTP_DETECT || '').toLowerCase() === 'off';

  function remember(domain, result) {
    cache.delete(domain);
    // Bounded: past `maxEntries` the oldest answer goes (a Map keeps insertion order).
    while (cache.size >= maxEntries) cache.delete(cache.keys().next().value);
    cache.set(domain, { until: now() + ttlMs, result });
  }

  async function detect(address) {
    const domain = domainOf(address);
    if (!domain) return { status: 'invalid', domain: '' };
    const direct = byDomain(domain);
    if (direct) return outcome(direct, domain);
    if (off) return { status: 'off', domain };
    const hit = cache.get(domain);
    if (hit && hit.until > now()) return hit.result;
    let result;
    try {
      const found = byMx(await withTimeout(Promise.resolve(resolveMx(domain)), timeoutMs));
      result = found ? outcome(found, domain) : { status: 'unknown', domain };
    } catch {
      result = { status: 'dns-failed', domain };
    }
    // A failed lookup is not remembered: the next try may reach the resolver.
    if (result.status !== 'dns-failed') remember(domain, result);
    return result;
  }

  return { detect };
}

/** The sentence the Envoi card prints under the address, for each outcome. */
function detectionMessage(result) {
  if (!result) return '';
  if (result.status === 'found') return `Serveur trouvé : ${result.provider.name} (${result.provider.host}).`;
  if (result.status === 'unknown') return `Fournisseur non reconnu pour ${result.domain} : saisir le serveur.`;
  if (result.status === 'dns-failed') return `Domaine ${result.domain} injoignable : saisir le serveur.`;
  if (result.status === 'unsupported') return result.reason;
  // Lookup turned off (E2E, development): nothing to say, the manual fields stay at hand.
  if (result.status === 'off') return '';
  return 'Adresse d’envoi à saisir.';
}

module.exports = {
  createSmtpDetector, detectionMessage, domainOf, PROVIDERS, portFor, MAX_DOMAIN_LENGTH,
};
