/**
 * Onboarding controller — the start assistant (specs/plugins-phase-p-productisation.md §3.D rules
 * 20–23, §4.3). Admin-only through the role guard.
 *
 *   GET  /api/onboarding            { open, company, plugins }
 *   PUT  /api/onboarding/company    { name, email, phone, address, siret } → 200 | 422 { errors }
 *   PUT  /api/onboarding/property   { name, doubleBeds, singleBeds, maxGuests, checkIn, checkOut,
 *                                     pricePerNight } → 200 { id } | 422 { errors } | 402 quota
 *   PUT  /api/onboarding/plugins    { ids } → { results: [{ id, ok, error }] }
 *   POST /api/onboarding/done       records onboardingCompletedAt (« C'est prêt » and « Plus tard »)
 *
 * Every step reuses the core's own write path: the company settings, the property creation, the
 * plugin install and activate handlers. A failed plugin is named and the others go through.
 */

const validation = require('../utils/settingsValidation');
const { validatePropertyInput } = require('../utils/propertyValidation');
const { quotaRefusal } = require('../utils/planQuota');
const onboardingModel = require('../models/onboardingModel');

const RECOMMENDED = new Set(['website-booking', 'sas']);
const MAX_CAPACITY = 50;

/** Runs an Express handler and resolves its answer, so a step can reuse an endpoint as it is. */
function capture(handler, req) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(body) { resolve({ status: this.statusCode, body }); return this; },
      end() { resolve({ status: this.statusCode, body: null }); return this; },
    };
    Promise.resolve(handler(req, res)).catch((err) => resolve({ status: 500, body: { error: err && err.message } }));
  });
}

function buildController({ database, settingsModel, propertiesModel, plugins, ensureVapid = () => {} }) {
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
    }));
  }

  async function get(req, res) {
    return res.json({ open: model().isOpen(), company: companyOf(settingsModel.read()), plugins: await pluginList() });
  }

  function saveCompany(req, res) {
    const b = req.body || {};
    const company = {
      name: String(b.name || '').trim(), email: String(b.email || '').trim(), phone: String(b.phone || '').trim(),
      address: String(b.address || '').trim(), siret: String(b.siret || '').replace(/\s/g, ''),
    };
    const errors = {};
    if (!company.name) errors.name = 'Nom obligatoire';
    if (!company.email) errors.email = 'Adresse obligatoire';
    else if (validation.validateEmail(company.email)) errors.email = 'Adresse invalide';
    if (company.siret && validation.validateSiret(company.siret)) errors.siret = '14 chiffres';
    if (Object.keys(errors).length) return res.status(422).json({ errors });
    settingsModel.upsert({
      companyName: company.name, companyEmail: company.email, companyPhone: company.phone,
      companyAddress: company.address, companySiret: company.siret,
    });
    ensureVapid(settingsModel.read());
    return res.json({ company });
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
    if (b.pricePerNight === '' || b.pricePerNight == null || !Number.isFinite(price) || price < 0) errors.pricePerNight = 'Prix positif ou nul';
    for (const [key, field] of [['checkIn', 'defaultCheckIn'], ['checkOut', 'defaultCheckOut']]) {
      if (b[key] && !/^\d{2}:\d{2}$/.test(String(b[key]))) errors[field] = 'Heure invalide';
    }
    if (Object.keys(errors).length) return res.status(422).json({ errors });
    const refusal = quotaRefusal('units', () => propertiesModel.count());
    if (refusal) return res.status(402).json(refusal);
    const created = await propertiesModel.create({ ...body, pricePerNight: price });
    return res.json(created);
  }

  async function savePlugins(req, res) {
    const ids = Array.isArray(req.body && req.body.ids) ? [...new Set(req.body.ids.map(String))] : [];
    const known = new Map((await pluginList()).map((p) => [p.id, p]));
    const results = [];
    for (const id of ids) {
      const plugin = known.get(id);
      if (!plugin) { results.push({ id, ok: false, error: 'UNKNOWN_PLUGIN' }); continue; }
      if (!plugin.allowed) { results.push({ id, ok: false, error: 'PLAN_REQUIRED' }); continue; }
      if (plugin.state === 'active') { results.push({ id, ok: true }); continue; }
      const handler = plugin.state === 'available' ? plugins.install : plugins.activate;
      const answer = await capture(handler, { params: { id } });
      results.push(answer.status < 300 ? { id, ok: true } : { id, ok: false, error: (answer.body && answer.body.error) || 'FAILED' });
    }
    return res.json({ results });
  }

  function done(req, res) {
    model().complete();
    return res.json({ open: false });
  }

  return { get, saveCompany, saveProperty, savePlugins, done };
}

module.exports = { buildController, RECOMMENDED };
