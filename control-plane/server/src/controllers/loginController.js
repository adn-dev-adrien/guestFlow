/**
 * The shared login page's lookup (specs/control-plane-plans-and-access.md rules 24, 25, 26): an email
 * becomes the list of spaces it has an account in, through the directory's HMAC. Nothing else is
 * read, nothing is written, and the answer holds company names and addresses only.
 *
 * A suspended or archived space is still a match: its own address shows its closed page (rule 24).
 * The directory it reads is filled by `readDirectory`, from each instance's active accounts.
 */

const { emailHmac, normaliseEmail } = require('../utils/directory');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function createLoginController(ctx, customersController) {
  const { models, directoryKey } = ctx;
  const { customers, directory } = models;
  const { urlOf, servedSlug } = customersController;

  // Rule 22: during a rename, the address that answers is the old one until the directory is moved.
  function space(c) {
    const slug = servedSlug(c);
    return { slug, name: c.companyName, address: `${slug}.${ctx.domain}` };
  }

  /** → { kind: 'invalid' | 'none' | 'one' | 'several', spaces } */
  function lookup(email) {
    const value = String(email || '').trim();
    if (!EMAIL_RE.test(value)) return { kind: 'invalid', spaces: [] };
    const spaces = directory.customersOf(emailHmac(directoryKey, value))
      .map((id) => customers.get(id))
      .filter((c) => c && !c.erasedAt)
      .map(space)
      .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    if (!spaces.length) return { kind: 'none', spaces };
    return { kind: spaces.length === 1 ? 'one' : 'several', spaces };
  }

  /** The remembered space, or null when it no longer exists under that slug. */
  function remembered(slug) {
    if (!/^[a-z0-9-]{3,30}$/.test(String(slug || ''))) return null;
    const id = customers.idOfSlug(slug);
    return id ? space(customers.get(id)) : null;
  }

  /** Where « Continuer » sends the browser: the instance's own login, the email filled in. */
  function loginUrl(slug, email) {
    const hint = String(email || '').trim().toLowerCase();
    return `${urlOf(slug)}/login${hint ? `?login_hint=${encodeURIComponent(hint)}` : ''}`;
  }

  // Rule 26: every minute, each instance's active accounts replace its pairs. An instance that
  // cannot be read keeps what it had; archived customers stay findable. Rule 41: a space declares its
  // own users' emails and nothing proves them, but the address the operator recorded as a customer's
  // contact is a known identity: it is listed for that customer only, so no other space can make the
  // page name its company next to it by creating a user with that address.
  function readDirectory(at = ctx.now().toISOString()) {
    const all = customers.list();
    const contactOwners = new Map();
    all.filter((c) => !c.erasedAt && c.contactEmail).forEach((c) => {
      const key = normaliseEmail(c.contactEmail);
      contactOwners.set(key, (contactOwners.get(key) || new Set()).add(c.id));
    });
    let read = 0;
    for (const c of all) {
      const emails = ctx.instances.readActiveEmails(servedSlug(c));
      if (emails === null) continue;
      const claimable = emails.filter((e) => !contactOwners.has(normaliseEmail(e)) || contactOwners.get(normaliseEmail(e)).has(c.id));
      directory.replace(c.id, [...new Set(claimable.map((e) => emailHmac(directoryKey, e)))], at);
      read += 1;
    }
    return read;
  }

  return { lookup, remembered, loginUrl, readDirectory };
}

module.exports = { createLoginController };
