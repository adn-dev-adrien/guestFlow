/**
 * What would render badly in the guest emails, computed — never guessed
 * (specs/guest-email-texts-made-simple.md rules 6–7).
 *
 *   GET /api/email-readiness   { items: [{ id, check, label, section, propertyId, target, soon }], soonCount }
 *
 * `target` is where to fix it: `{ path, search?, hash? }` for the client router. `soon` is true when the item
 * concerns a stay starting within 14 days — the dashboard's « Emails incomplets » counts those.
 * Admin-only through the role guard.
 */

const emailTextsModel = require('../models/emailTextsModel');
const { templateAllowed, sectionOfStableKey } = require('../utils/templateTokens');
const { unknownToken } = require('../utils/emailTemplateRenderer');

const HORIZON_DAYS = 14;
const TEXTS_PAGE = '/settings/emails/textes';

const isoDay = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const blank = (v) => String(v == null ? '' : v).trim() === '';

function buildController({ database, settingsModel }) {
  /** The stays still to come, per property: { [propertyId]: { any, soon } }. */
  function upcoming() {
    const today = isoDay(0);
    const horizon = isoDay(HORIZON_DAYS);
    const rows = database.prepare(`
      SELECT propertyId, MIN(startDate) AS first
        FROM reservations
       WHERE cancelledAt IS NULL AND COALESCE(kind, 'reservation') = 'reservation' AND endDate >= ?
       GROUP BY propertyId
    `).all(today);
    return Object.fromEntries(rows.map((r) => [r.propertyId, { any: true, soon: String(r.first).slice(0, 10) <= horizon }]));
  }

  function compute() {
    const settings = settingsModel.read();
    const stays = upcoming();
    const anySoon = Object.values(stays).some((s) => s.soon);
    const items = [];
    const push = (item) => items.push({ propertyId: null, section: null, soon: false, ...item });

    // Company identity — every email signs with it.
    if (blank(settings.companyName)) {
      push({ id: 'company.name', check: 'company', label: 'Nom de l’entreprise', target: { path: '/settings/etablissement' }, soon: anySoon });
    }
    if (blank(settings.companyPhone)) {
      push({ id: 'company.phone', check: 'company', label: 'Téléphone de l’entreprise', target: { path: '/settings/etablissement' }, soon: anySoon });
    }
    if (blank(settings.smtpFromName) && blank(settings.companyName)) {
      push({ id: 'company.sender', check: 'company', label: 'Nom d’expéditeur', target: { path: '/settings/emails' }, soon: anySoon });
    }

    const properties = database.prepare('SELECT * FROM properties ORDER BY id').all();
    const facts = new Map(database.prepare('SELECT propertyId, address, accessFr, accessCodeEncrypted FROM property_arrival_facts').all()
      .map((f) => [f.propertyId, f]));
    for (const p of properties) {
      const stay = stays[p.id] || { any: false, soon: false };
      const target = { path: `/properties/${p.id}` };
      const stayTab = { path: `/properties/${p.id}`, search: 'tab=sejour' };
      if (Number(p.nameArticleConfirmed || 0) !== 1) {
        push({ id: `property.article:${p.id}`, check: 'article', label: `Article — ${p.name}`, propertyId: p.id, target, soon: stay.soon });
      }
      if (stay.any) {
        const f = facts.get(p.id) || {};
        if (blank(f.address)) {
          push({ id: `property.address:${p.id}`, check: 'arrival', label: `Adresse — ${p.name}`, section: 'j2', propertyId: p.id, target: stayTab, soon: stay.soon });
        }
        if (blank(f.accessFr) && blank(f.accessCodeEncrypted)) {
          push({ id: `property.access:${p.id}`, check: 'arrival', label: `Accès — ${p.name}`, section: 'j2', propertyId: p.id, target: stayTab, soon: stay.soon });
        }
      }
    }

    // A French without its English: the English email would send French (rule 14).
    for (const item of emailTextsModel.buildModel(database).all()) {
      if (!['text', 'mention'].includes(item.kind) || blank(item.fr) || !blank(item.en)) continue;
      push({
        id: `english:${item.key}`, check: 'english', label: `Anglais manquant — ${item.label}`,
        section: item.section, target: { path: TEXTS_PAGE, hash: item.section }, soon: anySoon,
      });
    }

    // A stored template naming a variable that does not exist.
    const allowed = templateAllowed();
    for (const t of database.prepare('SELECT * FROM email_templates').all()) {
      const bad = ['subject', 'body', 'subjectEn', 'bodyEn'].map((f) => unknownToken(t[f], allowed)).find((n) => n != null);
      if (bad == null) continue;
      const section = sectionOfStableKey(t.stableKey);
      push({
        id: `template.token:${t.id}`, check: 'token', label: `Variable inconnue {{${bad}}} — ${t.name}`, section,
        target: section ? { path: TEXTS_PAGE, hash: section } : { path: '/emails' }, soon: anySoon,
      });
    }
    return { items, soonCount: items.filter((i) => i.soon).length };
  }

  function get(req, res) {
    return res.json(compute());
  }

  return { get, compute };
}

module.exports = { buildController, HORIZON_DAYS };
