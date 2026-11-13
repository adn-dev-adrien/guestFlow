/**
 * standaloneSale — the one write path for a sale with no stay (specs/pricing-components.md §3 rules 53, 74; specs/outside-booking-sas.md rules 8, 12-19, 21-26).
 *
 *   quote(request, { now })                              → { status: 200, document, customer, refusals } | { status, body }   writes nothing
 *   sell(request, { actor, now })                        → { status: 200, document } | { status, body }
 *   offerLine(saleId, lineId, { offered, confirmRefund, version, actor })    « Offrir » / « Offert » on one line (rule 14)
 *   removeLine(saleId, lineId, { confirmRefund, version, actor })            a line taken off (an unpaid one freely, a paid one with the confirmation, rule 25)
 *   pay(saleId, { tenders, shortfall, paidAt, version, actor, source })      a payment on the reste, allocated by SETTLEMENT (rules 16-19)
 *   cancel(saleId)                                                           every line cancelled; money already taken stays and is owed back (rules 26, 41)
 *   documentOf(saleId)                                   → the saleDetail payload of the document, or null
 *
 * A request is `{ saleId?, lines: [{ articleRef: 'option:<id>' | 'resource:<id>', quantity, offered? }], customer?: { firstName, lastName, name, email,
 * registerAsClient }, payment?: { tenders, shortfall, paidAt }, acceptedTotalCents?, version?, originRef? }`. Lines are priced by the `externalSale` pipeline
 * (the same families, the external VAT, SETTLEMENT's remaining amount); a line already stored is never re-priced (rule 74) and a new line of the same article is
 * a line of its own (rule 13). `sell` re-quotes inside its transaction: a price that moved since the quote answers 409 `PRICE_CHANGED`, a document changed
 * underneath (its `version`) the same. Every figure comes from the server; money in cents; errors `{ error, code }` in French.
 *
 * Who the sale belongs to (rule 8a of the outside-visit spec): the registered client the request names, else the one client whose e-mail is exactly the typed one
 * (case-insensitive, trimmed), else the shared « Passage » client; a client record is created only when `registerAsClient` is set and a name is given.
 */
const { toCents } = require('./pricing/money');
const { externalSale } = require('./pricing/pipelines');
const { allocateDocumentPayment } = require('./pricing/settlement');
const articles = require('./pricing/articles');
const { buildDocumentDetail } = require('./saleDetail');
const { validateSettlement } = require('./paymentTenders');
const { todayIso } = require('./localDate');
const settingsProvider = require('../models/ports/settingsProvider');
const vatRegimeModel = require('../models/vatRegimeModel');
const sales = require('../models/standaloneSalesModel');
const payments = require('../models/standalonePaymentsModel');

const database = () => require('../database');
const events = () => require('../models/ports/eventPublisher');

const MAX_QUANTITY = 99;
// The families a counter sale may take (rule 53); the hourly one is a session booked from the planning, where conflicts are judged.
const COUNTER_FAMILIES = Object.freeze(['fixed', 'perUnit']);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const refuse = (status, code, error, extra = {}) => ({ status, body: { error, code, ...extra } });
const asString = (value) => String(value == null ? '' : value).trim();

function storedLine(row) {
  return {
    id: row.id,
    ref: sales.lineRef(row.id),
    articleRef: row.articleRef,
    family: row.family,
    label: row.label,
    quantity: Number(row.quantity),
    unitCents: toCents(row.unitPrice),
    totalCents: Number(row.totalCents),
    catalogueCents: row.catalogueCents == null ? Number(row.totalCents) : Number(row.catalogueCents),
    offered: Boolean(row.offered),
    cancelled: Boolean(row.cancelledAt),
    vatClass: row.vatClass,
    vatRate: Number(row.vatRate || 0),
    components: parse(row.components, []),
    fulfilmentRef: row.fulfilmentRef || null,
    source: row.source || null,
  };
}

function parse(raw, fallback) {
  try { return raw ? JSON.parse(raw) : fallback; } catch { return fallback; }
}

function clientView(sale) {
  const client = sale.clientId ? sales.clientById(sale.clientId) : null;
  if (!client) return { id: null, label: 'Passage', kind: 'passage' };
  if (client.isPassage) return { id: client.id, label: 'Passage', kind: 'passage' };
  return { id: client.id, label: `${client.firstName} ${client.lastName}`.trim(), kind: 'registered' };
}

// Rule 8a — who the sale belongs to. `write` creates the client record the operator asked for; a quote only says what would happen.
function resolveCustomer(customer, { write }) {
  const input = customer || {};
  const email = asString(input.email).toLowerCase();
  if (email && !EMAIL.test(email)) return { error: refuse(400, 'EMAIL_INVALID', 'Adresse e-mail invalide.') };
  const name = asString(input.name) || `${asString(input.firstName)} ${asString(input.lastName)}`.trim();
  if (Number(input.clientId) > 0) {
    const client = sales.clientById(input.clientId);
    if (!client) return { error: refuse(404, 'CLIENT_NOT_FOUND', 'Client introuvable.') };
    if (client.isPassage) return { clientId: client.id, label: 'Passage', kind: 'passage', name, email };
    return { clientId: client.id, label: `${client.firstName} ${client.lastName}`.trim(), kind: 'registered', name, email };
  }
  const matches = email ? sales.clientsByEmail(email) : [];
  if (matches.length === 1) {
    const [client] = matches;
    return { clientId: client.id, label: `${client.firstName} ${client.lastName}`.trim(), kind: 'match', name, email };
  }
  if (input.registerAsClient === true) {
    if (!name) return { error: refuse(400, 'NAME_REQUIRED', 'Un nom pour enregistrer le client.') };
    const parts = name.split(/\s+/);
    const lastName = asString(input.lastName) || parts.pop();
    const firstName = asString(input.firstName) || parts.join(' ');
    const clientId = write ? sales.createClient({ firstName, lastName, email }) : null;
    return { clientId, label: `${firstName} ${lastName}`.trim(), kind: 'new', name, email };
  }
  return { clientId: write ? sales.passageClientId() : null, label: 'Passage', kind: 'passage', name, email };
}

// The articles asked for, as instances of rule 47, or the refusals that say why one is not on offer (rule 11).
function requestsOf(lines, { families = COUNTER_FAMILIES } = {}) {
  const requests = [];
  const refusals = [];
  for (const raw of Array.isArray(lines) ? lines : []) {
    const articleRef = asString(raw && raw.articleRef);
    const found = sales.catalogueRow(articleRef);
    if (!found) { refusals.push({ articleRef, code: 'ARTICLE_UNKNOWN', message: 'Article inconnu.' }); continue; }
    const article = articles.makeArticle(found.row, { kind: found.kind });
    const quantity = Number(raw.quantity);
    if (!article.config.sellableExternally) { refusals.push({ articleRef, code: 'NOT_SELLABLE', message: 'Article non vendable hors séjour.' }); continue; }
    if (!families.includes(article.family)) {
      const needsStay = !['hourly'].includes(article.family);
      refusals.push({ articleRef, code: needsStay ? 'NEEDS_STAY' : 'NEEDS_FULFILMENT', message: needsStay ? 'Cet article ne se vend qu’avec un séjour.' : 'Une séance se réserve au planning.' });
      continue;
    }
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
      refusals.push({ articleRef, code: 'QUANTITY_OUT_OF_BOUNDS', message: `Quantité : 1 à ${MAX_QUANTITY}.` });
      continue;
    }
    requests.push({ article, quantity, offered: raw.offered === true });
  }
  return { requests, refusals };
}

function storedOf(saleId) {
  if (!saleId) return { sale: null, stored: [], allocations: [] };
  const sale = sales.findSale(saleId);
  return { sale, stored: sale ? sales.linesOf(saleId).map(storedLine) : [], allocations: sale ? payments.allocationsOf(saleId) : [] };
}

// Runs the `externalSale` pipeline over the document's frozen lines and the new requests.
function price({ requests, stored, allocations }) {
  const db = database();
  const provider = settingsProvider.create(db);
  return externalSale({
    input: {
      requests,
      stored,
      allocations,
      families: articles.liveFamilies(),
      settings: { vat: provider.for('vat', {}) },
      vatRegime: vatRegimeModel.forRow(db, null),
    },
  });
}

const refusalList = (ctx, own) => [...own, ...ctx.refusals.map((r) => ({ articleRef: r.ref, code: r.code, message: r.message })), ...ctx.vatRefusals.map((r) => ({ articleRef: r.ref, code: r.code, message: r.message }))];

function detailOf(ctx, sale, client) {
  const lines = ctx.lines.map((line, index) => (line.ref ? line : { ...line, ref: `draft:${index}`, id: null }));
  const settled = ctx.settlement.lines.map((line, index) => ({ ...line, ref: lines[index].ref }));
  return buildDocumentDetail({
    sale: sale || {
      id: null, status: 'due', version: 0, soldAt: null, originRef: null, customerName: null, customerEmail: null,
    },
    client,
    lines,
    settlement: { ...ctx.settlement, lines: settled },
    vatByRate: ctx.vatByRate,
  });
}

function quote(request = {}) {
  const body = request || {};
  const { sale, stored, allocations } = storedOf(body.saleId);
  if (body.saleId && !sale) return refuse(404, 'SALE_NOT_FOUND', 'Vente introuvable.');
  const customer = resolveCustomer(body.customer || (sale ? { clientId: sale.clientId } : null), { write: false });
  if (customer.error) return customer.error;
  const { requests, refusals } = requestsOf(body.lines, { families: body.families });
  const ctx = price({ requests, stored, allocations });
  const client = sale ? clientView(sale) : { id: customer.clientId, label: customer.label, kind: customer.kind };
  return {
    status: 200,
    document: detailOf(ctx, sale, client),
    customer: { clientId: customer.clientId, label: customer.label, kind: customer.kind },
    refusals: refusalList(ctx, refusals),
    quoted: true,
  };
}

const documentOf = (saleId) => {
  const { sale, stored, allocations } = storedOf(saleId);
  if (!sale) return null;
  return detailOf(price({ requests: [], stored, allocations }), sale, clientView(sale));
};

const versionRefusal = (sale, version) => (version !== undefined && version !== null && Number(version) !== Number(sale.version)
  ? refuse(409, 'PRICE_CHANGED', 'Prix modifié — relire le panier') : null);

// Money taken for the document: the tenders validated against the reste, filed on the lines by SETTLEMENT, in the caller's transaction.
function takePayment(saleId, { tenders, shortfall, paidAt, source = null, actor = null }) {
  const { stored, allocations } = storedOf(saleId);
  const ctx = price({ requests: [], stored, allocations });
  if (shortfall && shortfall.kind === 'waived') return refuse(400, 'WAIVED_REFUSED', 'Geste commercial : offrir une ligne.');
  const checked = validateSettlement({ tenders, dueCents: ctx.settlement.remainingCents, shortfall });
  if (!checked.ok) return refuse(400, 'TENDERS_INVALID', checked.error, { field: checked.field });
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(paidAt || '')) ? paidAt : todayIso();
  const internalCents = checked.lines.filter((line) => line.internal).reduce((sum, line) => sum + line.amountCents, 0);
  const walk = allocateDocumentPayment({ lines: ctx.lines.map((line, index) => ({ ...line, ref: line.ref || `draft:${index}` })), allocations, amountCents: checked.receivedCents });
  let booksLeft = checked.receivedCents - internalCents;
  const filed = [];
  for (const row of walk) {
    const books = Math.min(row.amountCents, booksLeft);
    booksLeft -= books;
    if (books > 0) filed.push({ lineRef: row.lineRef, amountCents: books, internal: false });
    if (row.amountCents - books > 0) filed.push({ lineRef: row.lineRef, amountCents: row.amountCents - books, internal: true });
  }
  const paymentId = payments.record({
    saleId, paidAt: day, tenders: checked.lines, receivedCents: checked.receivedCents, shortfallCents: checked.shortfallCents, shortfallKind: checked.shortfallKind, source, createdBy: actor, allocations: filed,
  });
  return { paymentId, receivedCents: checked.receivedCents };
}

function sell(request = {}, { actor = null, now = new Date() } = {}) {
  const body = request || {};
  const db = database();
  let outcome = null;
  try {
    db.transaction(() => {
      const { sale: existing, stored, allocations } = storedOf(body.saleId);
      if (body.saleId && !existing) { outcome = refuse(404, 'SALE_NOT_FOUND', 'Vente introuvable.'); throw outcome; }
      if (existing) {
        const stale = versionRefusal(existing, body.version);
        if (stale) { outcome = stale; throw outcome; }
        if (existing.status === 'cancelled') { outcome = refuse(409, 'SALE_CANCELLED', 'Vente annulée.'); throw outcome; }
      }
      const customer = resolveCustomer(body.customer || (existing ? { clientId: existing.clientId } : null), { write: true });
      if (customer.error) { outcome = customer.error; throw outcome; }
      const { requests, refusals } = requestsOf(body.lines, { families: body.families });
      if (requests.length === 0 && !existing) refusals.push({ articleRef: null, code: 'NO_ARTICLE', message: 'Ajouter au moins un article.' });
      const ctx = price({ requests, stored, allocations });
      const all = refusalList(ctx, refusals);
      if (all.length) { outcome = refuse(400, all[0].code, all[0].message, { refusals: all }); throw outcome; }
      const quotedTotal = ctx.settlement.totalCents;
      if (body.acceptedTotalCents != null && Number(body.acceptedTotalCents) !== quotedTotal) {
        outcome = refuse(409, 'PRICE_CHANGED', 'Prix modifié — relire le panier', { totalCents: quotedTotal });
        throw outcome;
      }
      const soldAt = now.toISOString();
      const saleId = existing ? existing.id : sales.insertSale({
        soldAt,
        clientId: customer.clientId,
        customerName: customer.name || null,
        customerEmail: customer.email || null,
        totalCents: quotedTotal,
        status: 'due',
        originRef: body.originRef || null,
        createdBy: actor,
      });
      for (const line of ctx.lines.filter((l) => l.isNew)) {
        sales.insertLine(saleId, {
          articleRef: line.articleRef,
          kind: line.kind,
          family: line.family,
          label: line.label,
          quantity: line.quantity,
          unitPrice: line.unitCents / 100,
          totalCents: line.totalCents,
          catalogueCents: line.catalogueCents,
          offered: line.offered ? 1 : 0,
          discountCents: 0,
          vatClass: line.vatClass,
          vatRate: line.vatRate,
          components: JSON.stringify(line.components),
          fulfilmentRef: null,
          soldAt,
          source: body.source || 'counter',
        });
      }
      if (existing) sales.bumpVersion(saleId);
      refreshInPlace(saleId);
      if (body.payment) {
        const taken = takePayment(saleId, { ...body.payment, actor });
        if (taken.status) { outcome = taken; throw outcome; }
        refreshInPlace(saleId);
      }
      outcome = { status: 200, saleId };
    })();
  } catch (err) {
    if (err !== outcome || !outcome || outcome.status === 200) throw err;
    return outcome;
  }
  const document = documentOf(outcome.saleId);
  publishSold(document);
  return { status: 200, document };
}

// `refresh` without the version bump of a second write inside the same transaction: the sale's version moves once per request.
function refreshInPlace(saleId) {
  const { stored, allocations } = storedOf(saleId);
  const ctx = price({ requests: [], stored, allocations });
  const sale = sales.findSale(saleId);
  const status = sale.status === 'cancelled' ? 'cancelled' : (ctx.settlement.remainingCents === 0 ? 'paid' : 'due');
  sales.updateSale(saleId, { totalCents: ctx.settlement.totalCents, vatJson: JSON.stringify(ctx.vatByRate), status });
  return ctx;
}

function publishSold(document) {
  events().publish('standaloneSale.sold', {
    saleId: document.document.id,
    ref: document.document.ref,
    clientId: document.document.client.id,
    totalCents: document.totals.totalCents,
    lines: document.lines.filter((line) => line.status !== 'cancelled').map((line) => ({ ref: line.ref, label: line.label, totalCents: line.totalCents })),
  });
}

// One change of a stored document, in its own transaction: the version is compared, the change made, the document refreshed and its version moved.
function change(saleId, version, work) {
  const db = database();
  let outcome = null;
  try {
    db.transaction(() => {
      const sale = sales.findSale(saleId);
      if (!sale) { outcome = refuse(404, 'SALE_NOT_FOUND', 'Vente introuvable.'); throw outcome; }
      const stale = versionRefusal(sale, version);
      if (stale) { outcome = stale; throw outcome; }
      const refused = work(sale);
      if (refused) { outcome = refused; throw outcome; }
      refreshInPlace(saleId);
      sales.bumpVersion(saleId);
      outcome = { status: 200 };
    })();
  } catch (err) {
    if (err !== outcome || !outcome || outcome.status === 200) throw err;
    return outcome;
  }
  return { status: 200, document: documentOf(saleId) };
}

// Rule 25 — lowering a line the document already collected owes money back: refused unless the caller confirmed it.
function lineOf(saleId, lineId, { confirmRefund }) {
  const row = sales.findLine(saleId, lineId);
  if (!row || row.cancelledAt) return { refusal: refuse(404, 'LINE_NOT_FOUND', 'Ligne introuvable.') };
  const { stored, allocations } = storedOf(saleId);
  const ctx = price({ requests: [], stored, allocations });
  const settled = ctx.settlement.lines.find((line) => line.ref === sales.lineRef(row.id));
  if (settled && settled.settledCents > 0 && confirmRefund !== true) return { refusal: refuse(409, 'LINE_PAID', 'Ligne payée : remboursement à confirmer.') };
  return { row };
}

function offerLine(saleId, lineId, { offered = true, confirmRefund = false, version } = {}) {
  return change(saleId, version, () => {
    const { row, refusal } = lineOf(saleId, lineId, { confirmRefund: offered ? confirmRefund : true });
    if (refusal) return refusal;
    const catalogue = row.catalogueCents == null ? row.totalCents : row.catalogueCents;
    sales.updateLine(row.id, { offered: offered ? 1 : 0, totalCents: offered ? 0 : catalogue, catalogueCents: catalogue });
    return null;
  });
}

function removeLine(saleId, lineId, { confirmRefund = false, version } = {}) {
  return change(saleId, version, () => {
    const { row, refusal } = lineOf(saleId, lineId, { confirmRefund });
    if (refusal) return refusal;
    sales.updateLine(row.id, { cancelledAt: new Date().toISOString() });
    return null;
  });
}

function pay(saleId, {
  tenders, shortfall = null, paidAt, version, actor = null, source = null,
} = {}) {
  return change(saleId, version, (sale) => {
    if (sale.status === 'cancelled') return refuse(409, 'SALE_CANCELLED', 'Vente annulée.');
    const taken = takePayment(saleId, { tenders, shortfall, paidAt, actor, source });
    return taken.status ? taken : null;
  });
}

function cancel(saleId) {
  return change(saleId, undefined, (sale) => {
    if (sale.status === 'cancelled') return null;
    const at = new Date().toISOString();
    for (const row of sales.linesOf(saleId)) if (!row.cancelledAt) sales.updateLine(row.id, { cancelledAt: at });
    sales.updateSale(saleId, { status: 'cancelled', cancelledAt: at });
    return null;
  });
}

module.exports = {
  quote, sell, offerLine, removeLine, pay, cancel, documentOf, takePayment, MAX_QUANTITY,
};
