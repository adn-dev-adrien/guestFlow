// Shared fixture of the specs/payment-link-lifecycle.md e-mail suites (rules 26, 27, 35, 36): the emails
// controller over an in-memory database with the default templates, a stay, a fake payment provider and
// the real link service at a fixed clock. Nothing leaves the process; no SMTP, no provider.

const registry = require('../plugins/sdk/registry');
const { buildController } = require('../controllers/emailsController');
const { buildModel: buildTemplatesModel } = require('../models/emailTemplatesModel');
const { buildModel: buildLogModel } = require('../models/emailLogModel');
const { ensureDefaultEmailTemplates } = require('../utils/defaultEmailTemplatesSeed');
const { ensurePaymentLink, ensureInstallmentLink } = require('../utils/paymentRequestService');
const { createInstallmentRequests } = require('../utils/installmentRequests');
const installmentsModel = require('../models/installmentsModel');
const { seedDb, addStay, addLink, fakeProvider, HOUR } = require('./paymentLinkLifecycleFixture');

const NOW = new Date('2026-11-02T08:00:00Z');

const settingsModel = {
  read: () => ({ companyName: 'Demo', smtpHost: 'smtp.example.test', smtpFromEmail: 'from@example.test' }),
  smtpConfigured: () => true,
  decryptedSmtpSettings: () => ({}),
};

function res() {
  return {
    statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

// `provider`: 'ready' (a connected provider), 'unready' (declared, not connected) or null (none).
function declareProvider(state, provider) {
  registry.reset();
  registry.configure({ isActive: () => true, allows: () => true });
  if (state) registry.ensure('online-payment').paymentProvider = { ...provider, isReady: () => state === 'ready' };
}

function emailsFixture({ provider: state = 'ready', lang = 'fr', now = NOW, stay = {} } = {}) {
  const { db, links } = seedDb();
  // The language columns come from database.js's migrations, not from the baseline schema.
  db.exec('ALTER TABLE clients ADD COLUMN emailLanguage TEXT; ALTER TABLE email_templates ADD COLUMN subjectEn TEXT; ALTER TABLE email_templates ADD COLUMN bodyEn TEXT;');
  ensureDefaultEmailTemplates(db, { logger: { log: () => {}, warn: () => {} } });
  db.prepare('UPDATE clients SET emailLanguage = ? WHERE id = 1').run(lang);
  const id = addStay(db, { depositAmount: 90, balanceAmount: 210, ...stay });
  const provider = fakeProvider();
  declareProvider(state, provider);
  const sent = [];
  const minted = [];
  const linkDeps = { database: db, paymentLinksModel: links, provider, now: () => now, installmentsModel: installmentsModel.buildModel(db) };
  const paymentRequests = {
    available: () => state === 'ready',
    ensureLink: async (reservationId, type) => {
      minted.push([reservationId, type]);
      return ensurePaymentLink({ ...linkDeps, resolveAmountCents: () => (type === 'balance' ? 21000 : 9000) }, reservationId, type);
    },
  };
  const installmentRequests = createInstallmentRequests({
    installmentsModel: linkDeps.installmentsModel,
    paymentLinksModel: links,
    paymentProviders: { active: () => (state === 'ready' ? provider : null) },
    ensureLink: async (reservationId, installmentId) => {
      minted.push([reservationId, 'installment']);
      return ensureInstallmentLink(linkDeps, reservationId, installmentId);
    },
  });
  const templatesModel = buildTemplatesModel(db);
  const ctl = buildController({
    database: db, templatesModel, logModel: buildLogModel(db), settingsModel,
    paymentLinksModel: links, paymentRequests, installmentRequests, now: () => now,
    emailServiceFactory: () => ({ isConfigured: true, send: async (m) => { sent.push(m); }, sendTest: async () => ({}) }),
  });
  const templateId = (stableKey) => templatesModel.findByStableKey(stableKey).id;
  return {
    db, links, id, provider, ctl, sent, minted, templateId,
    async send(stableKey, body = {}) {
      const r = res();
      await ctl.send({ body: { reservationId: id, templateId: templateId(stableKey), ...body } }, r);
      return r;
    },
    preview(stableKey, query = {}) {
      const r = res();
      ctl.preview({ query: { reservationId: id, templateId: templateId(stableKey), ...query } }, r);
      return r;
    },
    openLink: (over = {}) => addLink(links, db, id, { createdAt: new Date(now.getTime() - 2 * HOUR), expiresAt: new Date(now.getTime() + 34 * HOUR), ...over }),
  };
}

const teardown = () => registry.reset();

module.exports = { emailsFixture, teardown, NOW, HOUR };
