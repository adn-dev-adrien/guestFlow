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
const { templateAllowed, sectionOfStableKey, namesUsedBy, namesUsedOutside } = require('../utils/templateTokens');
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

  /** Is a stay starting within 14 days written to in English? Its English gaps are then urgent. */
  function englishStaySoon() {
    const lang = (table) => database.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === 'emailLanguage');
    if (!lang('reservations')) return false;
    const clientLang = lang('clients') ? "NULLIF(c.emailLanguage, '')," : '';
    return Boolean(database.prepare(`
      SELECT 1 FROM reservations r LEFT JOIN clients c ON c.id = r.clientId
       WHERE r.cancelledAt IS NULL AND COALESCE(r.kind, 'reservation') = 'reservation'
         AND r.startDate >= ? AND r.startDate <= ? AND COALESCE(${clientLang} r.emailLanguage, 'fr') = 'en'
       LIMIT 1
    `).get(isoDay(0), isoDay(HORIZON_DAYS)));
  }

  /**
   * Rule 6 (2026-10-17): a fact is asked for only when a stored, enabled template uses it — Solio's
   * J-2 writes its address by hand and needs none of them; a new instance's neutral J-2 asks for all.
   */
  function compute() {
    const settings = settingsModel.read();
    const stays = upcoming();
    const anySoon = Object.values(stays).some((s) => s.soon);
    const templates = database.prepare('SELECT * FROM email_templates WHERE enabled = 1').all();
    const used = namesUsedBy(templates);
    const uses = (...names) => names.some((n) => used.has(n));
    const phoneNeeded = templates.some((t) => ['subject', 'body', 'subjectEn', 'bodyEn']
      .some((f) => namesUsedOutside(t[f], 'hasCompanyPhone').has('companyPhone')));
    const items = [];
    const push = (item) => items.push({ propertyId: null, section: null, soon: false, ...item });

    // Company identity — every email signs with it.
    if (blank(settings.companyName) && (uses('companyName') || (uses('senderName') && blank(settings.smtpFromName)))) {
      push({ id: 'company.name', check: 'company', label: 'Nom de l’entreprise', target: { path: '/settings/etablissement' }, soon: anySoon });
    }
    if (blank(settings.companyPhone) && phoneNeeded) {
      push({ id: 'company.phone', check: 'company', label: 'Téléphone de l’entreprise', target: { path: '/settings/etablissement' }, soon: anySoon });
    }
    if (blank(settings.smtpFromName) && blank(settings.companyName) && uses('senderName')) {
      push({ id: 'company.sender', check: 'company', label: 'Nom d’expéditeur', target: { path: '/settings/emails' }, soon: anySoon });
    }

    const properties = database.prepare('SELECT * FROM properties ORDER BY id').all();
    const facts = new Map(database.prepare('SELECT propertyId, address, accessFr, accessCodeEncrypted, wifiName FROM property_arrival_facts').all()
      .map((f) => [f.propertyId, f]));
    // The company's address stands in for a property's (rule 3, 2026-10-17).
    const addressUsed = uses('addressParagraph', 'hasAddressParagraph', 'propertyAddress');
    const addressNeeded = addressUsed && blank(settings.companyAddress);
    const accessNeeded = uses('accessParagraph', 'hasAccessParagraph');
    const wifiNeeded = uses('arrivalWifiParagraph', 'hasArrivalWifiParagraph');
    for (const p of properties) {
      const stay = stays[p.id] || { any: false, soon: false };
      const target = { path: `/properties/${p.id}` };
      const stayTab = { path: `/properties/${p.id}`, search: 'tab=sejour' };
      if (Number(p.nameArticleConfirmed || 0) !== 1) {
        push({ id: `property.article:${p.id}`, check: 'article', label: `Article — ${p.name}`, propertyId: p.id, target, soon: stay.soon });
      }
      if (!stay.any) continue;
      const f = facts.get(p.id) || {};
      // The company's address stands in: said once, never urgent, so a company domiciled elsewhere
      // notices (rule 6, 2026-10-17 bis).
      if (addressUsed && blank(f.address) && !blank(settings.companyAddress)) {
        push({ id: `property.address-company:${p.id}`, check: 'arrival', label: `Adresse — ${p.name} : celle de l’entreprise est utilisée`, section: 'j2', propertyId: p.id, target: stayTab, soon: false });
      }
      if (addressNeeded && blank(f.address)) {
        push({ id: `property.address:${p.id}`, check: 'arrival', label: `Adresse — ${p.name}`, section: 'j2', propertyId: p.id, target: stayTab, soon: stay.soon });
      }
      if (accessNeeded && blank(f.accessFr) && blank(f.accessCodeEncrypted)) {
        push({ id: `property.access:${p.id}`, check: 'arrival', label: `Accès — ${p.name}`, section: 'j2', propertyId: p.id, target: stayTab, soon: stay.soon });
      }
      if (wifiNeeded && Number(p.hasWifi == null ? 1 : p.hasWifi) !== 0 && blank(f.wifiName)) {
        push({ id: `property.wifi:${p.id}`, check: 'arrival', label: `Wi-Fi — ${p.name}`, section: 'j2', propertyId: p.id, target: stayTab, soon: stay.soon });
      }
    }

    // A French without its English, in a sentence a template places: absent from the English email.
    // Urgent only when an English-speaking guest arrives within 14 days.
    const englishSoon = englishStaySoon();
    for (const item of emailTextsModel.buildModel(database).all()) {
      if (!['text', 'mention', 'hook', 'resource'].includes(item.kind) || !item.used || blank(item.fr) || !blank(item.en)) continue;
      push({
        id: `english:${item.key}`, check: 'english', label: `Anglais manquant — ${item.label}`,
        section: item.section, target: { path: TEXTS_PAGE, hash: item.section }, soon: englishSoon,
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
