/**
 * Every editable sentence of the guest emails behind one key space
 * (specs/guest-email-texts-made-simple.md rules 9, 11, 16–19).
 *
 * The page, the preview draft, the CSV file and the translator all speak of a text by its key:
 *
 *   subject:<stableKey>          the subject of a stored template          email_templates
 *   text:<key>                   a stay text, global                      stay_texts (propertyId 0)
 *   text:<key>@<propertyId>      a stay text, one property's own          stay_texts
 *   mention:<id>:offer|booked    a mention's proposal or confirmation     email_mentions
 *   hook:<propertyId>            the J-7 hook of a property               properties.emailHook(En)
 *   access:<propertyId>          how to get in, free text                 property_arrival_facts
 *   resource:<id>                a resource's sentence once booked        resources.emailBookedText(En)
 *
 * Every item says whether a stored template of its email uses it (`used`, rule 25): a sentence no
 * template places never leaves, so the page folds it away and the readiness list ignores it.
 *
 * Secrets (the key-box code, the Wi-Fi password) are not texts and never appear here.
 *
 * API: buildModel(db) → { list({ propertyId }), all(), find(key), validate(key, { fr, en }),
 *      apply(changes, { autoTranslated }), confirm(key) }
 */

const { CATALOGUE, entryOf, MENTION_OFFER, MENTION_BOOKED, RESOURCE_BOOKED } = require('../utils/stayTextCatalogue');
const { DEFAULT_TEMPLATES, PLUGIN_OF_TEMPLATE } = require('../utils/defaultEmailTemplatesRegistry');
const {
  SECTIONS, SECTION_OF_MAIL, sectionOfStableKey, templateAllowed, chipsForSubject, chipsForText, tokenError,
  namesUsedBy, variableOfStayText,
} = require('../utils/templateTokens');
const stayTextsModel = require('./stayTextsModel');
const emailMentionsModel = require('./emailMentionsModel');
const arrivalFactsModel = require('./propertyArrivalFactsModel');

const HOOK_MAX_LENGTH = 300;
const SECTION_ORDER = SECTIONS.map((s) => s.id);
const MENTION_SECTION = { local: 'Produits locaux', extras: 'À prévoir', kids: 'Enfants' };

const str = (v) => (v == null ? '' : String(v));

function isLive(pluginId) {
  try { return require('../plugins/sdk/registry').isLive(pluginId); } catch { return false; }
}

function buildModel(database) {
  const stayTexts = stayTextsModel.buildModel(database);
  const mentionsModel = emailMentionsModel.buildModel(database);
  const arrival = arrivalFactsModel.buildModel(database);

  const properties = () => database.prepare('SELECT id, name, emailHook, emailHookEn FROM properties ORDER BY id').all();
  const optionTitles = () => new Map(database.prepare('SELECT id, title FROM options').all().map((o) => [Number(o.id), o.title]));
  const templates = () => database.prepare('SELECT * FROM email_templates WHERE stableKey IS NOT NULL').all()
    .filter((t) => sectionOfStableKey(t.stableKey))
    .filter((t) => !PLUGIN_OF_TEMPLATE[t.stableKey] || isLive(PLUGIN_OF_TEMPLATE[t.stableKey]));
  const flagRows = () => {
    try { return database.prepare('SELECT key, language FROM stay_text_flags WHERE autoTranslated = 1').all(); } catch { return []; }
  };

  const hasEnglishColumns = () => database.prepare('PRAGMA table_info(email_templates)').all().some((c) => c.name === 'subjectEn');

  const defaultSubject = (stableKey) => {
    const def = DEFAULT_TEMPLATES.find((d) => d.stableKey === stableKey);
    return def ? { fr: def.subject || '', en: def.subjectEn || '' } : { fr: '', en: '' };
  };

  // ------------------------------------------------------------------ building the items

  function subjectItems() {
    return templates().map((t) => ({
      key: `subject:${t.stableKey}`,
      kind: 'subject',
      section: sectionOfStableKey(t.stableKey),
      label: 'Objet',
      description: `Objet — ${t.name}`,
      templateId: t.id,
      fr: str(t.subject),
      en: str(t.subjectEn),
      defaultFr: defaultSubject(t.stableKey).fr,
      defaultEn: defaultSubject(t.stableKey).en,
      chips: chipsForSubject(t),
      allowed: templateAllowed(),
      required: true,
    }));
  }

  function globalTextItems() {
    const stored = stayTexts.rows(0);
    return CATALOGUE.map((e) => {
      const row = stored[e.key] || {};
      return {
        key: `text:${e.key}`,
        kind: 'text',
        section: SECTION_OF_MAIL[e.email],
        label: e.label,
        description: e.label,
        fr: row.fr != null ? row.fr : e.fr,
        en: row.en != null ? row.en : e.en,
        defaultFr: e.fr,
        defaultEn: e.en,
        chips: chipsForText(e),
        allowed: { tokens: e.tokens, flags: e.flags },
      };
    });
  }

  function propertyItems(property) {
    const own = stayTexts.rows(property.id);
    const global = stayTexts.rows(0);
    const effective = (key, side) => (global[key] && global[key][side] != null ? global[key][side] : entryOf(key)[side]);
    const overrides = CATALOGUE.filter((e) => e.overridable).map((e) => ({
      key: `text:${e.key}@${property.id}`,
      kind: 'override',
      section: SECTION_OF_MAIL[e.email],
      propertyId: property.id,
      label: `${e.label} — ${property.name}`,
      description: `${e.label} — ${property.name}`,
      fr: str((own[e.key] || {}).fr),
      en: str((own[e.key] || {}).en),
      defaultFr: '',
      defaultEn: '',
      placeholderFr: effective(e.key, 'fr'),
      placeholderEn: effective(e.key, 'en'),
      chips: chipsForText(e),
      allowed: { tokens: e.tokens, flags: e.flags },
    }));
    const facts = arrival.forForm(property.id);
    return [
      {
        key: `hook:${property.id}`,
        kind: 'hook',
        section: 'j7',
        propertyId: property.id,
        label: `Accroche — ${property.name}`,
        description: `Accroche — ${property.name}`,
        fr: str(property.emailHook),
        en: str(property.emailHookEn),
        defaultFr: '',
        defaultEn: '',
        chips: chipsForText({}),
        allowed: { tokens: [], flags: [] },
        maxLength: HOOK_MAX_LENGTH,
      },
      ...overrides,
      {
        key: `access:${property.id}`,
        kind: 'access',
        section: 'j2',
        propertyId: property.id,
        label: `Accès — ${property.name}`,
        description: `Accès — ${property.name}`,
        fr: facts.accessFr,
        en: facts.accessEn,
        defaultFr: '',
        defaultEn: '',
        chips: chipsForText({}),
        allowed: { tokens: [], flags: [] },
        maxLength: arrivalFactsModel.MAX_LENGTH,
      },
    ];
  }

  function mentionItems() {
    const titles = optionTitles();
    return mentionsModel.list().flatMap((m) => {
      const names = (m.optionIds || []).map((id) => titles.get(Number(id))).filter(Boolean).join(', ') || MENTION_SECTION[m.section];
      return [
        {
          key: `mention:${m.id}:offer`,
          kind: 'mention',
          section: 'j7',
          variable: m.section === 'kids' ? 'kidsParagraph' : 'localProductsParagraph',
          label: `Proposition — ${names}`,
          description: `Proposition — ${names}`,
          fr: str(m.offerFr),
          en: str(m.offerEn),
          defaultFr: '',
          defaultEn: '',
          chips: chipsForText(MENTION_OFFER),
          allowed: MENTION_OFFER,
        },
        {
          key: `mention:${m.id}:booked`,
          kind: 'mention',
          section: 'j2',
          variable: 'bookedOptionsParagraph',
          label: `Confirmation — ${names}`,
          description: `Confirmation — ${names}`,
          fr: str(m.bookedFr),
          en: str(m.bookedEn),
          defaultFr: '',
          defaultEn: '',
          chips: chipsForText(MENTION_BOOKED),
          allowed: MENTION_BOOKED,
        },
      ];
    });
  }

  // Rule 24 — a resource speaks in the J-2 once booked: its sentence is a text like the others.
  function resourceItems() {
    let rows = [];
    try { rows = database.prepare('SELECT id, name, emailBookedText, emailBookedTextEn FROM resources ORDER BY id').all(); } catch { rows = []; }
    return rows.map((r) => ({
      key: `resource:${r.id}`,
      kind: 'resource',
      section: 'j2',
      variable: 'nordicBathReminder',
      label: `Réservé — ${r.name}`,
      description: `Réservé — ${r.name}`,
      fr: str(r.emailBookedText),
      en: str(r.emailBookedTextEn),
      defaultFr: '',
      defaultEn: '',
      chips: chipsForText(RESOURCE_BOOKED),
      allowed: RESOURCE_BOOKED,
    }));
  }

  /** The variable of each item, and whether a stored template of its email places it (rule 25). */
  function withUse(items) {
    const bySection = new Map(SECTIONS.map((s) => [s.id, namesUsedBy(templates().filter((t) => s.stableKeys.includes(t.stableKey)))]));
    return items.map((item) => {
      const variable = item.variable !== undefined ? item.variable : variableOf(item);
      return { ...item, variable, used: !variable || (bySection.get(item.section) || new Set()).has(variable) };
    });
  }

  function variableOf(item) {
    if (item.kind === 'text' || item.kind === 'override') return variableOfStayText(item.key.slice(5).split('@')[0]);
    if (item.kind === 'hook') return 'propertyHook';
    if (item.kind === 'access') return 'accessParagraph';
    return null;
  }

  function withFlags(items) {
    const flagged = new Set(flagRows().filter((r) => r.language === 'en').map((r) => r.key));
    return withUse(items).map((item) => ({ ...item, autoTranslated: flagged.has(item.key) }));
  }

  // Send order (rule 9), and within an email: the subject, the hook, then the sentences.
  const KIND_ORDER = ['subject', 'hook', 'text', 'override', 'mention', 'access', 'resource'];
  function sorted(items) {
    return items
      .map((item, index) => ({ item, index }))
      .sort((a, b) => SECTION_ORDER.indexOf(a.item.section) - SECTION_ORDER.indexOf(b.item.section)
        || KIND_ORDER.indexOf(a.item.kind) - KIND_ORDER.indexOf(b.item.kind)
        || a.index - b.index)
      .map(({ item }) => item);
  }

  /** The texts of the page: the global ones and those of one property (the first by default). */
  function list({ propertyId } = {}) {
    const props = properties();
    const chosen = props.find((p) => p.id === Number(propertyId)) || props[0];
    return withFlags(sorted([
      ...subjectItems(), ...globalTextItems(), ...mentionItems(), ...resourceItems(), ...(chosen ? propertyItems(chosen) : []),
    ]));
  }

  /** Every text, every property: the file and the translator. */
  function all() {
    return withFlags(sorted([
      ...subjectItems(), ...globalTextItems(), ...mentionItems(), ...resourceItems(), ...properties().flatMap(propertyItems),
    ]));
  }

  function find(key) {
    return all().find((item) => item.key === key) || null;
  }

  /** Rule 11 — the same refusal for every kind of text; rules 16–17 — a subject is never emptied. */
  function validate(item, { fr, en }) {
    for (const [lang, value] of [['fr', fr], ['en', en]]) {
      if (value === undefined) continue;
      const error = tokenError(lang, value, item.allowed);
      if (error) return error;
      if (item.maxLength && String(value).length > item.maxLength) {
        return { field: lang, message: `${item.maxLength} caractères au plus` };
      }
    }
    if (item.required && fr !== undefined && !String(fr).trim()) return { field: 'fr', message: 'Texte obligatoire' };
    return null;
  }

  // ------------------------------------------------------------------ writing

  function write(item, fr, en) {
    const [kind, rest] = [item.kind, item.key.slice(item.key.indexOf(':') + 1)];
    if (kind === 'subject') {
      const sets = [];
      const params = { stableKey: rest.replace(/^subject:/, '') };
      if (fr !== undefined) { sets.push('subject = @fr'); params.fr = fr; }
      if (en !== undefined && hasEnglishColumns()) { sets.push('subjectEn = @en'); params.en = en; }
      if (sets.length) database.prepare(`UPDATE email_templates SET ${sets.join(', ')}, updatedAt = datetime('now') WHERE stableKey = @stableKey`).run(params);
      return;
    }
    if (kind === 'text' || kind === 'override') {
      const [key, pid] = rest.split('@');
      const propertyId = Number(pid) || 0;
      const current = stayTexts.rows(propertyId)[key] || { fr: null, en: null };
      stayTexts.save(key, {
        fr: fr !== undefined ? fr : current.fr,
        en: en !== undefined ? en : current.en,
      }, propertyId);
      return;
    }
    if (kind === 'mention') {
      const [id, side] = rest.split(':');
      const prefix = side === 'booked' ? 'booked' : 'offer';
      if (fr !== undefined) database.prepare(`UPDATE email_mentions SET ${prefix}Fr = ? WHERE id = ?`).run(fr, Number(id));
      if (en !== undefined) database.prepare(`UPDATE email_mentions SET ${prefix}En = ? WHERE id = ?`).run(en, Number(id));
      return;
    }
    if (kind === 'hook') {
      if (fr !== undefined) database.prepare('UPDATE properties SET emailHook = ? WHERE id = ?').run(fr, Number(rest));
      if (en !== undefined) database.prepare('UPDATE properties SET emailHookEn = ? WHERE id = ?').run(en, Number(rest));
      return;
    }
    if (kind === 'resource') {
      if (fr !== undefined) database.prepare('UPDATE resources SET emailBookedText = ? WHERE id = ?').run(fr, Number(rest));
      if (en !== undefined) database.prepare('UPDATE resources SET emailBookedTextEn = ? WHERE id = ?').run(en, Number(rest));
      return;
    }
    if (kind === 'access') {
      const patch = {};
      if (fr !== undefined) patch.accessFr = fr;
      if (en !== undefined) patch.accessEn = en;
      arrival.save(Number(rest), patch);
    }
  }

  function setFlag(key, on) {
    if (on) {
      database.prepare(`INSERT INTO stay_text_flags (key, language, autoTranslated) VALUES (?, 'en', 1)
        ON CONFLICT (key, language) DO UPDATE SET autoTranslated = 1`).run(key);
    } else {
      database.prepare("DELETE FROM stay_text_flags WHERE key = ? AND language = 'en'").run(key);
    }
  }

  /**
   * Applies `[{ key, fr?, en? }]` in one transaction (rule 17); `undefined` keeps a language. Every
   * change is validated first: one refusal and nothing is written. An English written by hand drops
   * its « traduit automatiquement » mark (rule 19); one written by the translator sets it.
   *
   * @returns {{ ok: true, applied: number } | { ok: false, key, field, message }}
   */
  function apply(changes, { autoTranslated = false } = {}) {
    const items = new Map(all().map((item) => [item.key, item]));
    for (const change of changes) {
      const item = items.get(change.key);
      if (!item) return { ok: false, key: change.key, field: 'key', message: `Clé inconnue : ${change.key}` };
      const error = validate(item, change);
      if (error) return { ok: false, key: change.key, ...error };
    }
    database.transaction(() => {
      for (const change of changes) {
        write(items.get(change.key), change.fr, change.en);
        if (change.en !== undefined) setFlag(change.key, autoTranslated && String(change.en).trim() !== '');
      }
    })();
    return { ok: true, applied: changes.length };
  }

  /** « Relu » — the English stays, the mark goes. */
  function confirm(key) {
    setFlag(key, false);
  }

  return { list, all, find, validate, apply, confirm };
}

module.exports = { buildModel, HOOK_MAX_LENGTH };
