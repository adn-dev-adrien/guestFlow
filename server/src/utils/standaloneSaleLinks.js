/**
 * The payment link of a standalone sale's reste (the outside-visit spec rules 39-42; specs/pricing-components.md rules 53, 74, 86).
 *
 *   linkOf(saleId, { now })                       → `{ available, reason, email, open }`, what the screen shows (rule 39): `reason` is `PROVIDER_NOT_READY`, `NO_EMAIL`, `NOTHING_DUE` or null
 *   mint(saleId, { email, now, deps })            → `{ status: 200, link: { id, url, amountCents, expiresAt, status, reused }, document } | { status, body }`   (rule 40)
 *   withdraw(saleId, linkId, { now, deps })       → `{ status: 200, document } | { status, body }`   « Retirer le lien » (payment-link-lifecycle rule 42)
 *   settlePaidLink({ database, link, paidDate, paidAt })  → the effect of a PAID link, called by the poll's `applyPaidEffect` (rule 41)
 *   emailLink(saleId, linkId, { deps })           → `{ status: 200, sent, recipientEmail } | { status, body }`   the one e-mail, on the operator's click only (rule 42)
 *
 * The amount of a link is SETTLEMENT's `remainingCents` at that moment (rule 15), never a request's; at most one open link per document: asking again reuses an open
 * link of the same amount that still has 24 hours to live, and replaces any other (rule 8 of the lifecycle). A link lives 36 hours (rule 6) and bills the document's VAT
 * basket, one group per rate. It is a `complement` link with an explicit basket `{ source: 'standalone-sale', ref: <document> }` and `saleRef` (no stay).
 * Nothing is e-mailed by minting; `emailLink` is the only sender and never runs by itself (`visit_payment_request` is stored manual, never an auto-send exception).
 */
const paymentProviders = require('./paymentProviders');
const standaloneSale = require('./standaloneSale');
const sales = require('../models/standaloneSalesModel');
const { buildVatItems } = require('./paymentLinkItems');
const { validityEnd, validityOf } = require('./paymentLinkLifecycle');
const { retireOpenLink } = require('./paymentLinkDeactivation');
const { withdrawPaymentLink } = require('./paymentLinkWithdrawal');
const { LINK_REASONS } = require('../constants/paymentLinks');

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const SOURCE = 'standalone-sale';
const TEMPLATE_KEY = 'visit_payment_request';
const LINK_TITLE = 'Règlement de votre passage';

const refuse = (status, code, error) => ({ status, body: { error, code } });
const model = () => require('../models/paymentLinksModel');
const database = () => require('../database');

function emailOf(sale) {
  const typed = String(sale.customerEmail || '').trim();
  if (typed) return typed;
  const client = sale.clientId ? sales.clientById(sale.clientId) : null;
  return client && !client.isPassage ? String(client.email || '').trim() : '';
}

function linkOf(saleId, { now = new Date() } = {}) {
  const sale = sales.findSale(saleId);
  const document = standaloneSale.documentOf(saleId);
  if (!sale || !document) return null;
  const links = model();
  const open = links.findOpenForSale(sales.documentRef(saleId));
  const email = emailOf(sale);
  let reason = null;
  if (!paymentProviders.active()) reason = 'PROVIDER_NOT_READY';
  else if (sale.status === 'cancelled' || document.totals.remainingCents <= 0) reason = 'NOTHING_DUE';
  else if (!email) reason = 'NO_EMAIL';
  return {
    available: reason === null,
    reason,
    email: email || null,
    open: open ? {
      id: open.id, url: open.url, amountCents: open.amountCents, expiresAt: validityOf(open, now).expiresAt || open.expiresAt || null,
    } : null,
  };
}

// The VAT basket of the reste: what each unpaid line still asks, one `buildVatItems` per rate, so Qonto's total is exactly the reste.
function basketOf(document) {
  const byRate = new Map();
  for (const line of document.lines) {
    if (line.status !== 'due') continue;
    const owed = line.totalCents - line.settledCents;
    if (owed <= 0) continue;
    const rate = Number(line.vatRate || 0);
    if (!byRate.has(rate)) byRate.set(rate, []);
    byRate.get(rate).push({ title: line.label, grossCents: owed, taxable: rate > 0 });
  }
  const items = [];
  let expectedTotalCents = 0;
  for (const [rate, components] of byRate) {
    const built = buildVatItems({ components, vatRatePercent: rate });
    items.push(...built.items);
    expectedTotalCents += built.expectedTotalCents;
  }
  return { items, expectedTotalCents };
}

async function mint(saleId, { email = null, now = new Date(), deps = {} } = {}) {
  const sale = sales.findSale(saleId);
  if (!sale) return refuse(404, 'SALE_NOT_FOUND', 'Vente introuvable.');
  if (sale.status === 'cancelled') return refuse(409, 'SALE_CANCELLED', 'Vente annulée.');
  const provider = deps.provider || paymentProviders.active();
  if (!provider) return refuse(409, 'PROVIDER_NOT_READY', 'Aucun moyen de paiement en ligne n’est connecté.');
  const typed = String(email || '').trim();
  if (typed && !EMAIL.test(typed)) return refuse(400, 'EMAIL_INVALID', 'Adresse e-mail invalide.');
  if (typed && typed !== String(sale.customerEmail || '').trim()) sales.updateSale(saleId, { customerEmail: typed });
  if (!typed && !emailOf(sale)) return refuse(409, 'NO_EMAIL', 'Adresse e-mail requise.');
  const document = standaloneSale.documentOf(saleId);
  const amountCents = document.totals.remainingCents;
  if (amountCents <= 0) return refuse(409, 'NOTHING_DUE', 'Rien à encaisser.');

  const links = deps.paymentLinksModel || model();
  const ref = sales.documentRef(saleId);
  const existing = links.findOpenForSale(ref);
  if (existing && existing.url) {
    const sameAmount = Number(existing.amountCents) === amountCents;
    const validity = validityOf(existing, now);
    if (sameAmount && validity.reusable) {
      return { status: 200, link: { ...linkView(existing), reused: true }, document };
    }
    try {
      await retireOpenLink(existing, {
        paymentLinksModel: links, provider, now, reason: sameAmount ? LINK_REASONS.VALIDITY : LINK_REASONS.AMOUNT_CHANGED,
      });
    } catch (err) {
      if (err && err.error === 'LINK_ALREADY_PAID') return refuse(409, 'LINK_ALREADY_PAID', 'Ce lien vient d’être payé : paiement enregistré.');
      throw err;
    }
  }
  const { items, expectedTotalCents } = basketOf(document);
  const linkArgs = { title: LINK_TITLE, amountCents };
  if (expectedTotalCents === amountCents && items.length) { linkArgs.items = items; linkArgs.expectedTotalCents = expectedTotalCents; }
  const created = await provider.createLink(linkArgs, { origin: 'basket' });
  const row = links.create({
    reservationId: null,
    type: 'complement',
    amountCents,
    provider: provider.id,
    providerLinkId: created.id,
    url: created.url,
    status: created.status,
    createdAt: now.toISOString().replace('T', ' ').slice(0, 19),
    // The 36 hours of rule 6 run from the row's creation, whatever the provider answers about its own expiry.
    expiresAt: validityEnd(now),
    basket: { source: SOURCE, ref },
    saleRef: ref,
  });
  return { status: 200, link: { ...linkView(row), reused: false }, document: standaloneSale.documentOf(saleId) };
}

const linkView = (row) => ({
  id: row.id, url: row.url, amountCents: row.amountCents, expiresAt: row.expiresAt, status: row.status,
});

async function withdraw(saleId, linkId, { now = new Date(), deps = {} } = {}) {
  const links = deps.paymentLinksModel || model();
  const link = links.findById(Number(linkId));
  if (!link || link.saleRef !== sales.documentRef(saleId)) return refuse(404, 'LINK_NOT_FOUND', 'Lien de paiement introuvable.');
  try {
    await withdrawPaymentLink(link.id, {
      database: database(),
      paymentLinksModel: links,
      provider: deps.provider || paymentProviders.declared(),
      now,
      bookPaid: async () => {},
    });
  } catch (err) {
    if (err && err.httpStatus) return refuse(err.httpStatus, err.error, err.message);
    throw err;
  }
  return { status: 200, document: standaloneSale.documentOf(saleId) };
}

/**
 * The paid effect of a link (rule 41): one payment (method `link`, source `payment-link:<id>`) and its allocations, in one transaction. The money is booked
 * in full; what the document no longer asks (a line offered or removed meanwhile, a cancelled document) is a refund owed, and the admin is told.
 */
function settlePaidLink({ link, paidDate = null, paidAt = null }) {
  const saleId = Number(String(link.saleRef || '').replace('standalone:', ''));
  const sale = sales.findSale(saleId);
  if (!sale) return { effect: 'no-reservation' };
  const source = `payment-link:${link.id}`;
  const already = database().prepare('SELECT 1 FROM standalone_sale_payments WHERE saleId = ? AND source = ?').get(saleId, source);
  if (already) return { effect: 'already-processed' };
  const received = standaloneSale.receive(saleId, {
    method: 'link', amountCents: Number(link.amountCents), paidAt: paidDate || (paidAt ? String(paidAt).slice(0, 10) : null), source,
  });
  const cancelled = sale.status === 'cancelled';
  if (received.surplusCents > 0) {
    return { effect: 'standalone-sale-refund-owed', saleId, surplusCents: received.surplusCents, cancelled };
  }
  return { effect: 'standalone-sale-settled', saleId };
}

function recipientOf(sale) {
  const client = sale.clientId ? sales.clientById(sale.clientId) : null;
  const named = client && !client.isPassage ? client.firstName : '';
  return { to: emailOf(sale), firstName: named || String(sale.customerName || '').trim().split(/\s+/)[0] || '' };
}

/**
 * « Envoyer par e-mail » (rule 42): the template `visit_payment_request`, rendered in the client's language, sent once per call and logged in `email_log` with the
 * document's `saleRef`; the document's history says « Lien envoyé à {e-mail} ». Never called by a cron, a queue or a mint.
 */
async function emailLink(saleId, linkId, { deps = {} } = {}) {
  const sale = sales.findSale(saleId);
  if (!sale) return refuse(404, 'SALE_NOT_FOUND', 'Vente introuvable.');
  const links = deps.paymentLinksModel || model();
  const link = links.findById(Number(linkId));
  if (!link || link.saleRef !== sales.documentRef(saleId)) return refuse(404, 'LINK_NOT_FOUND', 'Lien de paiement introuvable.');
  if (link.status !== 'open') return refuse(409, 'LINK_NOT_OPEN', 'Ce lien n’est plus ouvert.');
  const { to, firstName } = recipientOf(sale);
  if (!to) return refuse(409, 'NO_EMAIL', 'Adresse e-mail requise.');

  const templatesModel = deps.templatesModel || require('../models/emailTemplatesModel');
  const logModel = deps.logModel || require('../models/emailLogModel');
  const settingsModel = deps.settingsModel || require('../models/settingsModel');
  const emailServiceFactory = deps.emailServiceFactory || require('./emailService').createEmailService;
  const template = templatesModel.findByStableKey(TEMPLATE_KEY);
  if (!template || !template.enabled) return refuse(409, 'TEMPLATE_DISABLED', 'Le modèle de l’e-mail est désactivé.');

  const { renderTemplate } = require('./emailTemplateRenderer');
  const { normaliseLang, pickTemplateSide, englishMissing } = require('./emailTemplateLanguage');
  const { emailAmount } = require('./emailMoney');
  const { formatMomentLong } = require('./dateFr');
  const { guestEmailMessage } = require('./guestEmailHtml');
  const { resolveEmailIdentity } = require('./emailIdentity');

  const client = sale.clientId ? sales.clientById(sale.clientId) : null;
  const settings = settingsModel.read();
  const lang = normaliseLang(client && client.emailLanguage);
  const phone = String(settings.companyPhone || '');
  const rendered = renderTemplate(
    { subject: pickTemplateSide(template, lang).subject, body: pickTemplateSide(template, lang).body },
    {
      vars: {
        clientFirstName: firstName,
        paymentLink: link.url,
        paymentAmount: emailAmount(Number(link.amountCents) / 100, lang),
        paymentLinkValidUntil: formatMomentLong(link.expiresAt, lang),
        companyPhone: phone,
        senderName: resolveEmailIdentity(settings).fromName,
      },
      flags: { hasPaymentLink: true, hasPaymentLinkValidUntil: Boolean(formatMomentLong(link.expiresAt, lang)), hasCompanyPhone: phone.trim().length > 0 },
    },
  );
  const entry = {
    templateId: template.id, reservationId: null, saleRef: link.saleRef, renderedSubject: rendered.subject, renderedBody: rendered.body, recipientEmail: to,
  };
  if (englishMissing(template, lang)) {
    logModel.insert({ ...entry, status: 'failed', errorMessage: 'ENGLISH_VERSION_MISSING' });
    return refuse(409, 'ENGLISH_VERSION_MISSING', 'Version anglaise du modèle manquante.');
  }
  try {
    const svc = emailServiceFactory(settingsModel.decryptedSmtpSettings());
    await svc.send(guestEmailMessage({ to, subject: rendered.subject, text: rendered.body, settings, lang }));
  } catch (err) {
    const message = err && err.code === 'EMAIL_NOT_CONFIGURED' ? 'EMAIL_NOT_CONFIGURED' : String((err && err.message) || 'unknown');
    logModel.insert({ ...entry, status: 'failed', errorMessage: message });
    return refuse(502, message, 'L’e-mail n’a pas pu partir.');
  }
  logModel.insert({ ...entry, status: 'sent', channel: 'smtp', errorMessage: '' });
  sales.addHistory(saleId, `Lien envoyé à ${to}`);
  return { status: 200, sent: true, recipientEmail: to };
}

module.exports = {
  linkOf, mint, withdraw, settlePaidLink, emailLink, basketOf, SOURCE, TEMPLATE_KEY,
};
