/**
 * The sending server deduced from the sending address (specs/settings-rationalization.md rule 28;
 * UI/UX review 2026-10-18, decision 14). The operator types an address and a password; the server
 * recognises the provider — first by the address's own domain (gmail.com, orange.fr…), then by the
 * domain's MX records — and proposes its host and security. The port follows the security (rule 11).
 *
 * DNS only, from the server: no third-party API. The resolver is injected so the unit suites never
 * reach the network.
 *
 *   createSmtpDetector({ resolveMx?, timeoutMs?, ttlMs?, now? }).detect(address)
 *     → { status: 'found', domain, provider: { id, name, host, secure, port, hint } }
 *     | { status: 'unknown' | 'dns-failed', domain } | { status: 'invalid', domain: '' }
 */

const dns = require('dns');

const APP_PASSWORD = 'Un mot de passe d’application, créé dans le compte.';
const MAILBOX_PASSWORD = 'Le mot de passe de la boîte mail.';

// `domains`: addresses whose own domain names the provider (no DNS needed). `mx`: suffixes of the
// MX hosts that betray it for any other domain (a company domain hosted there).
const PROVIDERS = Object.freeze([
  { id: 'google', name: 'Gmail', host: 'smtp.gmail.com', secure: true, hint: 'Un mot de passe d’application Google (16 lettres).', domains: ['gmail.com', 'googlemail.com'], mx: ['google.com', 'googlemail.com'] },
  { id: 'microsoft', name: 'Outlook', host: 'smtp.office365.com', secure: false, hint: 'Le mot de passe du compte Microsoft ; l’envoi SMTP doit y être autorisé.', domains: ['outlook.com', 'outlook.fr', 'hotmail.com', 'hotmail.fr', 'live.com', 'live.fr', 'msn.com'], mx: ['outlook.com'] },
  { id: 'ovh', name: 'OVHcloud', host: 'ssl0.ovh.net', secure: true, hint: MAILBOX_PASSWORD, domains: [], mx: ['ovh.net'] },
  { id: 'ionos', name: 'IONOS', host: 'smtp.ionos.fr', secure: true, hint: MAILBOX_PASSWORD, domains: [], mx: ['ionos.fr', 'ionos.com', 'kundenserver.de', '1and1.fr'] },
  { id: 'infomaniak', name: 'Infomaniak', host: 'mail.infomaniak.com', secure: true, hint: MAILBOX_PASSWORD, domains: ['ik.me'], mx: ['infomaniak.ch'] },
  { id: 'gandi', name: 'Gandi', host: 'mail.gandi.net', secure: true, hint: MAILBOX_PASSWORD, domains: [], mx: ['gandi.net'] },
  { id: 'zoho', name: 'Zoho Mail', host: 'smtp.zoho.eu', secure: true, hint: APP_PASSWORD, domains: [], mx: ['zoho.eu', 'zoho.com'] },
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
  return m ? m[1].toLowerCase().replace(/\.$/, '') : '';
}

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
    const found = PROVIDERS.find((p) => p.mx.some((suffix) => endsWithDomain(host, suffix)));
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
  resolveMx = (domain) => dns.promises.resolveMx(domain), timeoutMs = 3000, ttlMs = 60 * 60 * 1000, now = () => Date.now(),
} = {}) {
  const cache = new Map();

  async function detect(address) {
    const domain = domainOf(address);
    if (!domain) return { status: 'invalid', domain: '' };
    const direct = byDomain(domain);
    if (direct) return { status: 'found', domain, provider: view(direct) };
    const hit = cache.get(domain);
    if (hit && hit.until > now()) return hit.result;
    let result;
    try {
      const found = byMx(await withTimeout(Promise.resolve(resolveMx(domain)), timeoutMs));
      result = found ? { status: 'found', domain, provider: view(found) } : { status: 'unknown', domain };
    } catch {
      result = { status: 'dns-failed', domain };
    }
    // A failed lookup is not remembered: the next try may reach the resolver.
    if (result.status !== 'dns-failed') cache.set(domain, { until: now() + ttlMs, result });
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
  return 'Adresse d’envoi à saisir.';
}

module.exports = { createSmtpDetector, detectionMessage, domainOf, PROVIDERS, portFor };
