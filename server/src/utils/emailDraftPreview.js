/**
 * The full email rendered from a draft that is not saved yet (specs/guest-email-texts-made-simple.md
 * rules 13–15, 21).
 *
 * The draft is written inside a transaction that is always rolled back: the email is rendered by the
 * very path a real send takes (graph loader, context builder, renderer), on the data as it would be
 * once saved, and nothing persists. better-sqlite3 is synchronous, so no other request can see the
 * draft while it exists. « Exemple » — no upcoming stay, or asked for — is a sample stay inserted
 * the same way.
 *
 * Draft shape (every part optional):
 *   texts      { [textKey]: { fr?, en? } }               models/emailTextsModel.js keys
 *   template   { subject?, body?, subjectEn?, bodyEn? }  the full template being edited
 *   settings   { companyName?, companyPhone?, smtpFromName? }
 *   arrival    { [propertyId]: { address?, mapUrl?, accessFr?, accessEn?, accessCode?, wifiName?, wifiPassword? } }
 *   properties { [propertyId]: { nameArticle?, caution?, cleaningIncluded?, towelsProvided?, bedLinenProvided? } }
 */

const emailTextsModel = require('../models/emailTextsModel');
const arrivalFactsModel = require('../models/propertyArrivalFactsModel');
const { answeredFlag, withoutPending, FLAG_FACTS } = require('./propertyFacts');
const { sectionOfStableKey, templateAllowed, tokenError } = require('./templateTokens');
const { localIsoDate } = require('./localDate');
const stayTextsModel = require('../models/stayTextsModel');
const { tagText, split } = require('./previewTags');

const SETTINGS_KEYS = ['companyName', 'companyPhone', 'smtpFromName'];
const NAME_ARTICLES = ['au', 'à la', "à l'", 'aux', 'à'];
const SAMPLE_NIGHTS = 3;
const SAMPLE_LEAD_DAYS = 9;

const ENGLISH_FALLS_BACK = 'Texte anglais manquant : le français sera envoyé';
const ENGLISH_OMITTED = 'Texte anglais manquant : phrase absente de l’email anglais';

class Rollback extends Error {}

// The operator's calendar day, `offsetDays` from today — never the UTC one (utils/localDate.js).
const isoDay = (offsetDays, now = new Date()) => {
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offsetDays);
  return localIsoDate(day);
};
const frDate = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');

function buildDraftPreview({ database, templatesModel, buildPreview }) {
  const findTemplate = (body) => {
    if (body.templateId) return templatesModel.findById(Number(body.templateId)) || null;
    if (body.stableKey) return database.prepare('SELECT * FROM email_templates WHERE stableKey = ?').get(String(body.stableKey)) || null;
    return null;
  };

  /**
   * Rule 13 — the stays that receive this email, the next one first. Cancelled stays receive only
   * the cancellation notice; the season emails go to past guests.
   */
  function candidates(template, propertyId) {
    const section = sectionOfStableKey(template.stableKey);
    const today = isoDay(0);
    let where;
    let order;
    if (section === 'cancellation') {
      where = 'r.cancelledAt IS NOT NULL';
      order = 'r.cancelledAt DESC';
    } else if (section === 'season') {
      where = "r.cancelledAt IS NULL AND COALESCE(r.kind, 'reservation') = 'reservation' AND r.endDate < @today";
      order = 'r.endDate DESC';
    } else if (section === 'j1') {
      where = "r.cancelledAt IS NULL AND COALESCE(r.kind, 'reservation') = 'reservation' AND r.endDate >= date(@today, '-1 day')";
      order = 'r.endDate ASC';
    } else {
      where = `r.cancelledAt IS NULL AND r.startDate >= @today${section === 'payment' ? '' : " AND COALESCE(r.kind, 'reservation') = 'reservation'"}`;
      order = 'r.startDate ASC';
    }
    if (propertyId) where += ' AND r.propertyId = @propertyId';
    let rows;
    try {
      rows = database.prepare(`
        SELECT r.id, r.startDate, c.firstName, c.lastName, p.name AS propertyName
          FROM reservations r
          LEFT JOIN clients c ON c.id = r.clientId
          LEFT JOIN properties p ON p.id = r.propertyId
         WHERE ${where}
         ORDER BY ${order}
         LIMIT 20
      `).all({ today, propertyId: Number(propertyId) || 0 });
    } catch {
      rows = [];
    }
    return rows.map((r) => ({
      id: r.id,
      label: [`${r.firstName || ''} ${r.lastName || ''}`.trim(), r.propertyName, frDate(String(r.startDate || '').slice(0, 10))].filter(Boolean).join(' · '),
    }));
  }

  function insertSample(propertyId, lang) {
    let pid = Number(propertyId) || (database.prepare('SELECT id FROM properties ORDER BY id LIMIT 1').get() || {}).id;
    if (!pid) pid = database.prepare("INSERT INTO properties (name) VALUES ('Le logement')").run().lastInsertRowid;
    const clientId = database.prepare("INSERT INTO clients (firstName, lastName, email) VALUES ('Camille', 'Exemple', 'camille@example.com')")
      .run().lastInsertRowid;
    const price = (database.prepare('SELECT MIN(pricePerNight) AS p FROM pricing_rules WHERE propertyId = ? AND pricePerNight > 0').get(pid) || {}).p || 0;
    const id = database.prepare(`
      INSERT INTO reservations (propertyId, clientId, startDate, endDate, adults, children, doubleBeds, singleBeds, finalPrice, totalPrice, createdAt)
      VALUES (?, ?, ?, ?, 2, 0, 1, 0, ?, ?, datetime('now'))
    `).run(pid, clientId, isoDay(SAMPLE_LEAD_DAYS), isoDay(SAMPLE_LEAD_DAYS + SAMPLE_NIGHTS), price * SAMPLE_NIGHTS, price * SAMPLE_NIGHTS).lastInsertRowid;
    // Rule 30 — the sample arrives and leaves at the property's own times, as a real stay would.
    const times = database.prepare('SELECT defaultCheckIn, defaultCheckOut FROM properties WHERE id = ?').get(pid) || {};
    const resCols = new Set(database.prepare('PRAGMA table_info(reservations)').all().map((c) => c.name));
    if (resCols.has('checkInTime') && times.defaultCheckIn) database.prepare('UPDATE reservations SET checkInTime = ? WHERE id = ?').run(times.defaultCheckIn, id);
    if (resCols.has('checkOutTime') && times.defaultCheckOut) database.prepare('UPDATE reservations SET checkOutTime = ? WHERE id = ?').run(times.defaultCheckOut, id);
    for (const table of ['clients', 'reservations']) {
      if (database.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === 'emailLanguage')) {
        database.prepare(`UPDATE ${table} SET emailLanguage = ? WHERE id = ?`).run(lang, table === 'clients' ? clientId : id);
      }
    }
    return id;
  }

  /** Writes the draft; returns a refusal `{ field, message, key? }` or null. */
  function applyDraft(template, draft) {
    const texts = draft.texts && typeof draft.texts === 'object' ? draft.texts : {};
    const changes = Object.entries(texts).map(([key, v]) => ({ key, fr: v && v.fr, en: v && v.en }));
    if (changes.length) {
      const result = emailTextsModel.buildModel(database).apply(changes);
      if (!result.ok) {
        const { ok, ...refusal } = result;
        return refusal;
      }
    }
    if (draft.template && typeof draft.template === 'object') {
      const allowed = templateAllowed();
      for (const field of ['subject', 'body', 'subjectEn', 'bodyEn']) {
        const value = draft.template[field];
        if (value === undefined) continue;
        const error = tokenError(field, String(value), allowed);
        if (error) return error;
        database.prepare(`UPDATE email_templates SET ${field} = ? WHERE id = ?`).run(String(value), template.id);
      }
    }
    const arrival = arrivalFactsModel.buildModel(database);
    for (const [pid, facts] of Object.entries(draft.arrival || {})) arrival.save(Number(pid), facts || {});
    for (const [pid, props] of Object.entries(draft.properties || {})) {
      if (props && NAME_ARTICLES.includes(props.nameArticle)) {
        database.prepare('UPDATE properties SET nameArticle = ? WHERE id = ?').run(props.nameArticle, Number(pid));
      }
      // Rule 27 — the deposit, cleaning, towels and bed linen being answered in the assistant.
      const answered = [];
      if (props && props.caution != null && String(props.caution).trim() !== '' && Number.isFinite(Number(String(props.caution).replace(',', '.')))) {
        database.prepare('UPDATE properties SET defaultCautionAmount = ? WHERE id = ?').run(Number(String(props.caution).replace(',', '.')), Number(pid));
        answered.push('caution');
      }
      for (const [field, fact] of FLAG_FACTS) {
        const flag = props ? answeredFlag(props[field]) : null;
        if (flag === null) continue;
        database.prepare(`UPDATE properties SET ${field} = ? WHERE id = ?`).run(Number(flag), Number(pid));
        answered.push(fact);
      }
      if (answered.length) {
        const row = database.prepare('SELECT pendingFacts FROM properties WHERE id = ?').get(Number(pid));
        if (row) database.prepare('UPDATE properties SET pendingFacts = ? WHERE id = ?').run(withoutPending(row.pendingFacts, answered), Number(pid));
      }
    }
    return null;
  }

  /**
   * Rule 41 (UI/UX review 2026-10-18, decision 13) — every stored text tagged with its key, inside the
   * rolled-back transaction only, so the rendered email says which text each sentence comes from.
   * An empty text stays empty: a property's own text left blank still lets the shared one speak.
   */
  function tagStoredTexts() {
    const stayTexts = stayTextsModel.buildModel(database);
    const both = (item) => ({ fr: tagText(item.fr, item.key), en: tagText(item.en, item.key) });
    for (const item of emailTextsModel.buildModel(database).all()) {
      const rest = item.key.slice(item.key.indexOf(':') + 1);
      const { fr, en } = both(item);
      if (item.kind === 'text') {
        stayTexts.save(rest, { fr, en }, 0);
      } else if (item.kind === 'override') {
        const [key, pid] = rest.split('@');
        if (String(item.fr).trim() || String(item.en).trim()) stayTexts.save(key, { fr: item.fr ? fr : null, en: item.en ? en : null }, Number(pid));
      } else if (item.kind === 'mention') {
        const [id, side] = rest.split(':');
        const prefix = side === 'booked' ? 'booked' : 'offer';
        database.prepare(`UPDATE email_mentions SET ${prefix}Fr = ?, ${prefix}En = ? WHERE id = ?`).run(fr, en, Number(id));
      } else if (item.kind === 'hook') {
        database.prepare('UPDATE properties SET emailHook = ?, emailHookEn = ? WHERE id = ?').run(fr, en, Number(rest));
      } else if (item.kind === 'resource') {
        database.prepare('UPDATE resources SET emailBookedText = ?, emailBookedTextEn = ? WHERE id = ?').run(fr, en, Number(rest));
      } else if (item.kind === 'access') {
        database.prepare('UPDATE property_arrival_facts SET accessFr = ?, accessEn = ? WHERE propertyId = ?').run(fr, en, Number(rest));
      }
    }
  }

  /**
   * Rule 14 — what an English reader misses. An empty English template, or an empty English « accès »,
   * sends the French; any other sentence left without its English is absent from the English email
   * (that is how stored texts have always rendered, and Solio's emails must not move).
   */
  function englishNotice(template, propertyId) {
    const fresh = database.prepare('SELECT * FROM email_templates WHERE id = ?').get(template.id) || template;
    const section = sectionOfStableKey(template.stableKey);
    const gaps = emailTextsModel.buildModel(database).list({ propertyId })
      .filter((item) => item.section === section && String(item.fr).trim() && !String(item.en).trim());
    if (!String(fresh.bodyEn || '').trim() || !String(fresh.subjectEn || '').trim() || gaps.some((i) => i.kind === 'access')) {
      return ENGLISH_FALLS_BACK;
    }
    return gaps.length ? ENGLISH_OMITTED : null;
  }

  /**
   * @returns {{ payload } | { error, status, body? }}
   */
  function render(body) {
    const template = findTemplate(body);
    if (!template) return { error: 'TEMPLATE_NOT_FOUND', status: 404 };
    const lang = body.language === 'en' ? 'en' : 'fr';
    const draft = body.draft && typeof body.draft === 'object' ? body.draft : {};
    const propertyId = Number(body.propertyId) || null;
    const list = candidates(template, propertyId);
    const wantsSample = body.reservationId === 'sample';
    const reservationId = wantsSample ? null : (Number(body.reservationId) || (list[0] && list[0].id) || null);

    const settings = Object.fromEntries(SETTINGS_KEYS
      .filter((k) => draft.settings && draft.settings[k] !== undefined)
      .map((k) => [k, String(draft.settings[k])]));

    let outcome;
    try {
      database.transaction(() => {
        const refusal = applyDraft(template, draft);
        if (refusal) { outcome = { error: 'INVALID_TEXT', status: 422, body: refusal }; throw new Rollback(); }
        const id = reservationId || insertSample(propertyId, lang);
        const stayProperty = (database.prepare('SELECT propertyId FROM reservations WHERE id = ?').get(id) || {}).propertyId;
        // Rule 38 — the count follows what is typed: it is read on the draft, before the tags.
        const toTranslate = emailTextsModel.countToTranslate(emailTextsModel.buildModel(database).list({ propertyId: propertyId || stayProperty }));
        const notice = lang === 'en' ? englishNotice(template, stayProperty) : null;
        // The email as it is sent, rendered before any tag: what `body` carries, always.
        const preview = buildPreview(id, template.id, {}, lang, { settings });
        if (preview.error) { outcome = { error: preview.error, status: preview.status }; throw new Rollback(); }
        // Rule 41 — the same email with every text tagged; its segments are kept only when they read
        // exactly as the email sent, else the email is shown whole, not clickable.
        tagStoredTexts();
        const tagged = split(buildPreview(id, template.id, {}, lang, { settings }).body || '');
        const segments = tagged.plain === preview.body ? tagged.segments : [{ text: preview.body, key: null }];
        outcome = {
          payload: {
            subject: preview.subject,
            body: preview.body,
            segments,
            subjectKey: template.stableKey ? `subject:${template.stableKey}` : null,
            lang,
            reservationId: reservationId || null,
            sample: !reservationId,
            reservations: list,
            englishNotice: notice,
            toTranslate,
          },
        };
        throw new Rollback();
      })();
    } catch (err) {
      if (!(err instanceof Rollback)) throw err;
    }
    return outcome;
  }

  return { render, candidates };
}

module.exports = { buildDraftPreview, __test: { isoDay } };
