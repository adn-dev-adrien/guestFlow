/**
 * Onboarding controller — the start assistant (specs/plugins-phase-p-productisation.md §3.D rules
 * 20–23, §4.3). Admin-only through the role guard.
 *
 *   GET  /api/onboarding            { open, company, property, plugins, emails, pluginsSummary }
 *   PUT  /api/onboarding/company    { name, email, phone, address, siret } → 200 { company, loginEmail, loginChanged } | 422 { errors }
 *   PUT  /api/onboarding/property   { name, doubleBeds, singleBeds, maxGuests, checkIn, checkOut,
 *                                     pricePerNight } → 200 { id } | 422 { errors } | 402 quota
 *                                     | 409 PROPERTIES_EXIST (specs/guest-email-texts-made-simple.md rule 29)
 *   PUT  /api/onboarding/plugins    { ids } → { results: [{ id, ok, error, reason }], pluginsSummary }
 *   PUT  /api/onboarding/emails     { phone, senderName, properties: [{ id, nameArticle, address, access, accessCode,
 *                                     wifiName, wifiPassword, caution, cleaningIncluded, towelsProvided,
 *                                     bedLinenProvided }] }
 *                                     → 200 | 422 { errors } (specs/guest-email-texts-made-simple.md rule 21)
 *   POST /api/onboarding/done       records onboardingCompletedAt (« C'est prêt » and « Plus tard »)
 *
 * Every step reuses the core's own write path: the company settings, the property creation, the
 * plugin install and activate handlers. A failed plugin is named and the others go through.
 */

const validation = require('../utils/settingsValidation');
const { validatePropertyInput } = require('../utils/propertyValidation');
const { quotaRefusal } = require('../utils/planQuota');
const onboardingModel = require('../models/onboardingModel');
const arrivalFactsModel = require('../models/propertyArrivalFactsModel');
const propertyArticle = require('../utils/propertyArticle');
const { pendingFactsOf, withoutPending, answeredFlag, PENDABLE, FLAG_FACTS } = require('../utils/propertyFacts');
const { DEFAULT_ADMIN_EMAIL } = require('../constants/authDefaults');

// The articles a property name may take (models/propertiesModel.js).
const NAME_ARTICLES = propertyArticle.ARTICLES;

const RECOMMENDED = new Set(['website-booking', 'sas']);
const MAX_CAPACITY = 50;

/**
 * Runs an Express handler and resolves its answer once the handler has finished, so a step can reuse
 * an endpoint as it is. Rule 37 — an install answers before it releases the plugin lock: resolving on
 * the answer alone started the next install while the lock was still held.
 */
function capture(handler, req) {
  return new Promise((resolve) => {
    let answer = null;
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(body) { if (!answer) answer = { status: this.statusCode, body }; return this; },
      end() { if (!answer) answer = { status: this.statusCode, body: null }; return this; },
    };
    Promise.resolve()
      .then(() => handler(req, res))
      .then(() => resolve(answer || { status: 500, body: { error: 'NO_ANSWER' } }))
      .catch((err) => resolve(answer || { status: 500, body: { error: err && err.message } }));
  });
}

// Rule 37 — the reason a plugin was not activated, in the words the step prints.
const PLUGIN_FAILURES = Object.freeze({
  UNKNOWN_PLUGIN: 'plugin inconnu',
  PLAN_REQUIRED: 'non inclus dans la formule',
  UPDATE_IN_PROGRESS: 'activation en cours, réessayer dans un instant',
  RESTART_PENDING: 'redémarrage en cours, réessayer dans un instant',
});

function failureReason(code, message) {
  if (PLUGIN_FAILURES[code]) return PLUGIN_FAILURES[code];
  if (message) return String(message).replace(/\.$/, '').replace(/^./, (c) => c.toLowerCase());
  return 'échec de l’activation';
}

// Rule 38 — « 1 plugin actif », « 2 plugins actifs », « Aucun plugin actif ».
function activeSummary(count) {
  if (!count) return 'Aucun plugin actif';
  return count === 1 ? '1 plugin actif' : `${count} plugins actifs`;
}

function buildController({ database, settingsModel, propertiesModel, plugins, usersModel = null, ensureVapid = () => {} }) {
  const model = () => onboardingModel.buildModel(database);

  function companyOf(row) {
    return {
      name: row.companyName || '', email: row.companyEmail || '', phone: row.companyPhone || '',
      address: row.companyAddress || '', siret: row.companySiret || '',
    };
  }

  async function pluginList() {
    const { body } = await capture(plugins.list, {});
    return (Array.isArray(body) ? body : []).map((p) => ({
      id: p.id,
      label: p.name,
      description: p.description,
      allowed: !p.outOfPlan,
      plan: p.planChip,
      state: p.state,
      recommended: RECOMMENDED.has(p.id),
      // Neither recommended nor active: folded under « Pour aller plus loin » (rule 36).
      more: !RECOMMENDED.has(p.id) && p.state !== 'active',
    }));
  }

  // Step « Vos emails » (rule 21): what the J-2 needs, pre-filled from what is already known.
  // Every property, its address pre-filled with the company's when it has none of its own (rule 21,
  // 2026-10-17): the address typed at step 1 is not asked twice.
  function emailsOf(row) {
    const arrival = arrivalFactsModel.buildModel(database);
    const properties = database.prepare('SELECT * FROM properties ORDER BY id').all().map((p) => {
      const facts = arrival.forForm(p.id);
      const pending = pendingFactsOf(p);
      return {
        id: p.id,
        name: p.name,
        // Rule 30 — an article nobody chose is not shown as chosen.
        nameArticle: Number(p.nameArticleConfirmed || 0) === 1 ? (p.nameArticle || 'au') : null,
        // The articles worth offering for this name, as the guest will read them: « au Fournil »…
        articles: propertyArticle.choices(p.name),
        address: facts.address || row.companyAddress || '',
        access: facts.accessFr,
        hasAccessCode: facts.hasAccessCode,
        hasWifi: Number(p.hasWifi == null ? 1 : p.hasWifi) !== 0,
        wifiName: facts.wifiName,
        hasWifiPassword: facts.hasWifiPassword,
        // Rule 28 — what the emails say about the deposit, the cleaning and the towels; null while
        // nobody answered.
        caution: pending.has('caution') ? null : Number(p.defaultCautionAmount || 0),
        ...Object.fromEntries(FLAG_FACTS.map(([field, fact]) => [field, pending.has(fact) ? null : answeredFlag(p[field])])),
        pending: [...pending],
      };
    });
    return {
      phone: row.companyPhone || '',
      senderName: row.smtpFromName || row.companyName || '',
      properties,
      previewStableKey: 'arrival_reminder_1d',
    };
  }

  // Rule 29 — the property the assistant created, so step 2 edits it instead of adding a second one.
  function assistantProperty() {
    let id = null;
    try { id = (database.prepare('SELECT onboardingPropertyId AS id FROM app_settings ORDER BY id LIMIT 1').get() || {}).id; } catch { id = null; }
    if (!id) return null;
    return database.prepare('SELECT * FROM properties WHERE id = ?').get(Number(id)) || null;
  }

  // Rule 29 (2026-10-18) — the rule the assistant created with the property is its first one; the
  // seasons added since are the owner's, and the assistant never writes them.
  function assistantRule(propertyId) {
    return database.prepare('SELECT id, pricePerNight FROM pricing_rules WHERE propertyId = ? ORDER BY id LIMIT 1').get(propertyId) || null;
  }

  function propertyStep() {
    const own = assistantProperty();
    const count = database.prepare('SELECT COUNT(*) AS n FROM properties').get().n;
    if (own) {
      return {
        id: own.id, existing: count,
        draft: {
          name: own.name, doubleBeds: String(own.doubleBeds ?? 0), singleBeds: String(own.singleBeds ?? 0),
          maxGuests: String(own.maxGuests ?? 1), checkIn: own.defaultCheckIn || '16:00', checkOut: own.defaultCheckOut || '10:00',
          pricePerNight: String((assistantRule(own.id) || {}).pricePerNight ?? ''),
        },
      };
    }
    return { id: null, existing: count, draft: null };
  }

  async function get(req, res) {
    const row = settingsModel.read();
    const list = await pluginList();
    return res.json({
      open: model().isOpen(), company: companyOf(row), property: propertyStep(), emails: emailsOf(row), plugins: list,
      pluginsSummary: activeSummary(list.filter((p) => p.state === 'active').length),
    });
  }

  // Every field may be skipped: an absent one is left as it is. `properties`: one entry per property.
  function saveEmails(req, res) {
    const b = req.body || {};
    const list = Array.isArray(b.properties) ? b.properties : [];
    const errors = {};
    const known = new Set(database.prepare('SELECT id FROM properties').all().map((p) => p.id));
    list.forEach((p, i) => {
      if (!p || !known.has(Number(p.id))) errors[`properties.${i}`] = 'Logement inconnu';
      else if (p.nameArticle !== undefined && !NAME_ARTICLES.includes(p.nameArticle)) errors[`properties.${i}.nameArticle`] = 'Article inconnu';
      for (const key of ['address', 'access', 'accessCode', 'wifiName', 'wifiPassword']) {
        if (p && p[key] !== undefined && String(p[key]).length > arrivalFactsModel.MAX_LENGTH) errors[`properties.${i}.${key}`] = 'Trop long';
      }
      if (p && p.caution !== undefined && p.caution !== null) {
        const amount = Number(String(p.caution).replace(',', '.'));
        if (String(p.caution).trim() === '' || !Number.isFinite(amount) || amount < 0) errors[`properties.${i}.caution`] = 'Un montant ≥ 0 €';
      }
    });
    if (Object.keys(errors).length) return res.status(422).json({ errors });
    const settings = {};
    if (b.phone !== undefined) settings.companyPhone = String(b.phone).trim();
    if (b.senderName !== undefined) settings.smtpFromName = String(b.senderName).trim();
    if (Object.keys(settings).length) settingsModel.upsert(settings);
    const companyAddress = String(settingsModel.read().companyAddress || '').trim();
    const arrival = arrivalFactsModel.buildModel(database);
    database.transaction(() => {
      for (const p of list) {
        const id = Number(p.id);
        if (p.nameArticle !== undefined) {
          database.prepare('UPDATE properties SET nameArticle = ?, nameArticleConfirmed = 1 WHERE id = ?').run(p.nameArticle, id);
        }
        // Rule 28 — an answered fact is stored and leaves the pending list.
        const answered = [];
        if (p.caution !== undefined && p.caution !== null) {
          database.prepare('UPDATE properties SET defaultCautionAmount = ? WHERE id = ?').run(Number(String(p.caution).replace(',', '.')), id);
          answered.push('caution');
        }
        for (const [field, fact] of FLAG_FACTS) {
          const flag = answeredFlag(p[field]);
          if (flag === null) continue;
          database.prepare(`UPDATE properties SET ${field} = ? WHERE id = ?`).run(Number(flag), id);
          answered.push(fact);
        }
        if (answered.length) {
          const row = database.prepare('SELECT pendingFacts FROM properties WHERE id = ?').get(id);
          database.prepare('UPDATE properties SET pendingFacts = ? WHERE id = ?').run(withoutPending(row.pendingFacts, answered), id);
        }
        const patch = {};
        // The company's address left as it was stays derived, so a later change of it follows.
        if (p.address !== undefined) patch.address = String(p.address).trim() === companyAddress ? '' : p.address;
        if (p.access !== undefined) patch.accessFr = p.access;
        // Rule 32 — the code has its own field, kept encrypted, out of the texts and the file.
        if (p.accessCode !== undefined && p.accessCode !== '') patch.accessCode = p.accessCode;
        if (p.wifiName !== undefined) patch.wifiName = p.wifiName;
        if (p.wifiPassword !== undefined && p.wifiPassword !== '') patch.wifiPassword = p.wifiPassword;
        if (Object.keys(patch).length) arrival.save(id, patch);
      }
    })();
    return res.json({ emails: emailsOf(settingsModel.read()) });
  }

  /**
   * specs/hosting-h2-account-security.md rule 27 — the bootstrap login (`admin@guestflow.local`) is
   * nobody's mailbox: the company email typed at step 1 becomes the administrator's login, so « Mot de
   * passe oublié » reaches someone. Any other login is the owner's own choice and is kept. Returns the
   * login after the step.
   */
  function adoptLoginEmail(user, email) {
    const kept = (row) => ({ loginEmail: row && row.email ? row.email : null, loginChanged: false });
    if (!usersModel || !user || !user.id) return kept(user);
    const current = usersModel.findById(user.id);
    if (!current || String(current.email).toLowerCase() !== DEFAULT_ADMIN_EMAIL) return kept(current);
    const holder = usersModel.findByEmail(email);
    if (holder && Number(holder.id) !== Number(current.id)) return kept(current);
    try {
      return { loginEmail: usersModel.updateUser(current.id, { email }).email, loginChanged: true };
    } catch {
      return kept(current);
    }
  }

  function saveCompany(req, res) {
    const b = req.body || {};
    const company = {
      name: String(b.name || '').trim(), email: String(b.email || '').trim(), phone: String(b.phone || '').trim(),
      address: String(b.address || '').trim(), siret: String(b.siret || '').replace(/\s/g, ''),
    };
    const errors = {};
    if (!company.name) errors.name = 'Nom obligatoire';
    if (!company.email) errors.email = 'Email obligatoire';
    else if (validation.validateEmail(company.email)) errors.email = 'Email invalide';
    if (company.siret && validation.validateSiret(company.siret)) errors.siret = '14 chiffres';
    if (Object.keys(errors).length) return res.status(422).json({ errors });
    settingsModel.upsert({
      companyName: company.name, companyEmail: company.email, companyPhone: company.phone,
      companyAddress: company.address, companySiret: company.siret,
    });
    ensureVapid(settingsModel.read());
    return res.json({ company, ...adoptLoginEmail(req.user, company.email) });
  }

  async function saveProperty(req, res) {
    const b = req.body || {};
    const body = {
      name: String(b.name || '').trim(),
      doubleBeds: b.doubleBeds, singleBeds: b.singleBeds, maxGuests: b.maxGuests,
      defaultCheckIn: b.checkIn, defaultCheckOut: b.checkOut, pricePerNight: b.pricePerNight,
    };
    const errors = validatePropertyInput(body, null);
    if (!body.name) errors.name = 'Nom obligatoire';
    const capacity = Number(body.maxGuests);
    if (!errors.maxGuests && (!Number.isInteger(capacity) || capacity < 1 || capacity > MAX_CAPACITY)) errors.maxGuests = 'Entre 1 et 50';
    const price = Number(String(b.pricePerNight ?? '').replace(',', '.'));
    // Rule 38 — an empty price is a missing one, not a negative one.
    if (b.pricePerNight == null || String(b.pricePerNight).trim() === '') errors.pricePerNight = 'Prix obligatoire';
    else if (!Number.isFinite(price) || price < 0) errors.pricePerNight = 'Prix positif ou nul';
    for (const [key, field] of [['checkIn', 'defaultCheckIn'], ['checkOut', 'defaultCheckOut']]) {
      if (b[key] && !/^\d{2}:\d{2}$/.test(String(b[key]))) errors[field] = 'Heure invalide';
    }
    if (Object.keys(errors).length) return res.status(422).json({ errors });
    // Rule 29 — « Précédent » then « Suivant », or the assistant opened again: the property it created
    // is edited, never created twice; an instance that already has properties gets none from it.
    const own = assistantProperty();
    if (own) {
      database.prepare(`UPDATE properties SET name = ?, doubleBeds = ?, singleBeds = ?, maxGuests = ?, defaultCheckIn = ?, defaultCheckOut = ?,
        updatedAt = datetime('now') WHERE id = ?`).run(
        body.name, Number(body.doubleBeds) || 0, Number(body.singleBeds) || 0, capacity,
        body.defaultCheckIn || own.defaultCheckIn || '15:00', body.defaultCheckOut || own.defaultCheckOut || '10:00', own.id,
      );
      if (b.name && b.name.trim() !== own.name) renamed(own.id, body.name);
      const rule = assistantRule(own.id);
      if (rule && Number(rule.pricePerNight) !== price) {
        database.prepare('UPDATE pricing_rules SET pricePerNight = ? WHERE id = ?').run(price, rule.id);
      }
      return res.json({ id: own.id });
    }
    if (database.prepare('SELECT COUNT(*) AS n FROM properties').get().n > 0) {
      return res.status(409).json({ error: 'PROPERTIES_EXIST', message: 'Logements déjà créés : les modifier dans Logements.' });
    }
    const refusal = quotaRefusal('units', () => propertiesModel.count());
    if (refusal) return res.status(402).json(refusal);
    // Rule 30 — a name that says its article is not asked for one; rule 28 — the deposit, the cleaning
    // and the towels are not asked here, so the emails say nothing of them until they are answered.
    const article = propertyArticle.derive(body.name);
    const created = await propertiesModel.create({ ...body, nameArticle: article.article, pricePerNight: price, defaultCautionAmount: 0 });
    database.prepare('UPDATE properties SET nameArticleConfirmed = ?, pendingFacts = ? WHERE id = ?')
      .run(article.certain ? 1 : 0, PENDABLE.join(','), Number(created.id));
    database.prepare(`INSERT INTO app_settings (id, onboardingPropertyId) VALUES (1, @id)
      ON CONFLICT (id) DO UPDATE SET onboardingPropertyId = @id`).run({ id: Number(created.id) });
    return res.json(created);
  }

  // A renamed property takes the article its new name says, unless the owner chose one.
  function renamed(id, name) {
    const row = database.prepare('SELECT nameArticleConfirmed FROM properties WHERE id = ?').get(id);
    const article = propertyArticle.derive(name);
    if (row && Number(row.nameArticleConfirmed) === 1 && !article.certain) return;
    database.prepare('UPDATE properties SET nameArticle = ?, nameArticleConfirmed = ? WHERE id = ?').run(article.article, article.certain ? 1 : 0, id);
  }

  async function savePlugins(req, res) {
    const ids = Array.isArray(req.body && req.body.ids) ? [...new Set(req.body.ids.map(String))] : [];
    const known = new Map((await pluginList()).map((p) => [p.id, p]));
    const results = [];
    const fail = (id, code, message) => results.push({ id, ok: false, error: code, reason: failureReason(code, message) });
    let restarting = false;
    // Rule 37 — one after the other: each install has released the plugin lock before the next starts.
    for (const id of ids) {
      const plugin = known.get(id);
      if (!plugin) { fail(id, 'UNKNOWN_PLUGIN'); continue; }
      if (!plugin.allowed) { fail(id, 'PLAN_REQUIRED'); continue; }
      if (plugin.state === 'active') { results.push({ id, ok: true }); continue; }
      if (restarting) { fail(id, 'RESTART_PENDING'); continue; }
      const handler = plugin.state === 'available' ? plugins.install : plugins.activate;
      const answer = await capture(handler, { params: { id }, body: {} }); // eslint-disable-line no-await-in-loop
      if (answer.status < 300) {
        results.push({ id, ok: true });
        restarting = Boolean(answer.body && answer.body.restarting);
      } else {
        const body = answer.body || {};
        fail(id, body.error || 'FAILED', body.message);
      }
    }
    return res.json({ results, pluginsSummary: await pluginsSummary() });
  }

  async function pluginsSummary() {
    return activeSummary((await pluginList()).filter((p) => p.state === 'active').length);
  }

  function done(req, res) {
    model().complete();
    return res.json({ open: false });
  }

  return { get, saveCompany, saveProperty, savePlugins, saveEmails, done };
}

module.exports = { buildController, RECOMMENDED, activeSummary, failureReason };
