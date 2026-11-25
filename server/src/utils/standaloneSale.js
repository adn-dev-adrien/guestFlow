/**
 * standaloneSale — the one write path for a sale with no stay (specs/pricing-components.md §3 rules 53, 74; the outside-visit spec rules 8, 12-19, 21-26).
 *
 *   quote(request, { now })                              → { status: 200, document, customer, refusals } | { status, body }   writes nothing
 *   sell(request, { actor, now })                        → { status: 200, document } | { status, body }
 *   offerLine(saleId, lineId, { offered, confirmRefund, version, actor })    « Offrir » / « Offert » on one line (rule 14)
 *   removeLine(saleId, lineId, { confirmRefund, version, actor })            a line taken off (an unpaid one freely, a paid one with the confirmation, rule 25)
 *   pay(saleId, { tenders, shortfall, paidAt, version, actor, source })      a payment on the reste, allocated by SETTLEMENT (rules 16-19)
 *   takePrepaid(saleId, { tender, covers, paidAt, actor })                   money a plugin's prepaid instrument already collected, filed on the lines it paid (SDK 2.33.0)
 *   paidByOf(saleId)                                                         what paid each line: `[{ lineRef, amountCents, paymentId, paidAt, kind: 'prepaid' | 'money', label, source?, ref? }]`
 *   recordHistory(saleId, text, actor) · historyOf(saleId)                   the document's journal of events
 *   cancel(saleId)                                                           every line cancelled; money already taken stays and is owed back (rules 26, 41)
 *   writeObligationRefund(saleId, obligation, { day })                       an open row marked refunded: its refund allocations (rules 49, 55)
 *   writeKept(saleId, obligation, { day })                                   an open row closed « rien à rembourser »: its kept allocations, a tip (rules 50, 55, 56)
 *   documentOf(saleId, { paidElsewhere })                → the saleDetail payload of the document, or null
 *   paymentsOf(saleId)                                   → `[{ id, paidAt, receivedCents, tenders, source }]`, oldest first
 *
 * A request is `{ saleId?, lines: [{ articleRef: 'option:<id>' | 'resource:<id>', quantity, offered? }], customer?: { firstName, lastName, name, email,
 * registerAsClient }, payment?: { tenders, shortfall, paidAt }, acceptedTotalCents?, version?, originRef?, fulfilments?, paidElsewhere? }`. Lines are priced by the `externalSale` pipeline
 * (the same families, the external VAT, SETTLEMENT's remaining amount); a line already stored is never re-priced (rule 74) and a new line of the same article is
 * a line of its own (rule 13). `sell` re-quotes inside its transaction: a price that moved since the quote answers 409 `PRICE_CHANGED`, a document changed
 * underneath (its `version`) the same. Every figure comes from the server; money in cents; errors `{ error, code }` in French.
 *
 * A `quote` also takes a dateless session — `{ articleRef: 'resource:<id>', session: { band: 'day' | 'evening', minutes, rankOffsetMinutes? } }` — priced by the family that owns the hourly
 * resource for the customer with no stay (its external rate of the band, its degressive tiers by hour rank, the VAT of its class). It is a price, never a sale: `sell` refuses it (`NEEDS_FULFILMENT`).
 *
 * `fulfilments` are lines a plugin's family priced for a booking it fulfils — the session of an outside visit (the outside-visit spec rule 10):
 * `[{ articleRef, label, quantity, unitCents, totalCents, catalogueCents, offered, vatClass, components: [{ label, detail, amountCents }], fulfilmentRef }]`, stored with
 * their `fulfilmentRef` and taxed by the VAT step. `paidElsewhere` are lines whose money was taken outside the document before it existed (a session paid on the
 * booking, rule 34): `[{ ref, articleRef, label, quantity, unitCents, totalCents, vatClass, vatRate, components, fulfilmentRef }]`, shown « Payée » and counted in
 * the totals by SETTLEMENT through one allocation of their whole amount, never stored on the document.
 *
 * Who the sale belongs to (rule 8a of the outside-visit spec): the registered client the request names, else the one client whose e-mail is exactly the typed one
 * (case-insensitive, trimmed), else the shared « Passage » client; a client record is created only when `registerAsClient` is set and a name is given.
 */
const { toCents } = require('./pricing/money');
const { externalSale } = require('./pricing/pipelines');
const { allocateDocumentPayment, refileDocumentExcess, unallocatedOf } = require('./pricing/settlement');
const { owedOnDocument, documentRowsInStep, refundRowsOfDocument } = require('./pricing/refunds/owed');
const articles = require('./pricing/articles');
const { buildDocumentDetail } = require('./saleDetail');
const { validateSettlement, methodLabel, euros } = require('./paymentTenders');
const { todayIso } = require('./localDate');
const settingsProvider = require('../models/ports/settingsProvider');
const vatRegimeModel = require('../models/vatRegimeModel');
const sales = require('../models/standaloneSalesModel');
const payments = require('../models/standalonePaymentsModel');

const database = () => require('../database');
const events = () => require('../models/ports/eventPublisher');

const MAX_QUANTITY = 99;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const refuse = (status, code, error, extra = {}) => ({ status, body: { error, code, ...extra } });
const asString = (value) => String(value == null ? '' : value).trim();

// « Jour · 18:00–19:00 · 1 h × 30,00 € ; Temps offert · 15 min » — the words of a fulfilled line's parts, as its family wrote them.
const partsDetail = (components) => (components.length && components.every((part) => part && part.label)
  ? components.map((part) => [part.label, part.detail].filter(Boolean).join(' · ')).join(' ; ')
  : null);

function storedLine(row) {
  const components = parse(row.components, []);
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
    components,
    detail: row.fulfilmentRef ? partsDetail(components) : null,
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
function requestsOf(lines) {
  const requests = [];
  const refusals = [];
  for (const raw of Array.isArray(lines) ? lines : []) {
    const articleRef = asString(raw && raw.articleRef);
    if (raw && raw.session != null) { refusals.push({ articleRef, code: 'NEEDS_FULFILMENT', message: 'Une séance se réserve au planning.' }); continue; }
    const found = sales.catalogueRow(articleRef);
    if (!found) { refusals.push({ articleRef, code: 'ARTICLE_UNKNOWN', message: 'Article inconnu.' }); continue; }
    const article = articles.makeArticle(found.row, { kind: found.kind });
    const quantity = Number(raw.quantity);
    if (!article.config.sellableExternally) { refusals.push({ articleRef, code: 'NOT_SELLABLE', message: 'Article non vendable hors séjour.' }); continue; }
    const outside = articles.outsideSale(article);
    if (outside.code !== null) {
      refusals.push({ articleRef, code: outside.code === 'INSURANCE' ? 'NEEDS_STAY' : outside.code, message: outside.reason });
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

// A session with no date, quoted and never sold (`session: { band, minutes, rankOffsetMinutes? }`): the family that owns the hourly resource prices it for the
// customer with no stay, and answers a line of the shape a fulfilled booking has. The sale itself still takes a booked session (`sell` refuses it).
function sessionQuotesOf(lines) {
  const fulfilments = [];
  const refusals = [];
  const families = articles.liveFamilies();
  for (const raw of Array.isArray(lines) ? lines : []) {
    if (!raw || raw.session == null) continue;
    const articleRef = asString(raw.articleRef);
    const found = sales.catalogueRow(articleRef);
    if (!found) { refusals.push({ articleRef, code: 'ARTICLE_UNKNOWN', message: 'Article inconnu.' }); continue; }
    const article = articles.makeArticle(found.row, { kind: found.kind });
    if (!article.config.sellableExternally) { refusals.push({ articleRef, code: 'NOT_SELLABLE', message: 'Article non vendable hors séjour.' }); continue; }
    const family = article.family === 'hourly' ? families.hourly : null;
    if (!family || typeof family.quoteSession !== 'function') { refusals.push({ articleRef, code: 'NEEDS_FULFILMENT', message: 'Une séance se réserve au planning.' }); continue; }
    const answer = family.quoteSession(article.config, raw.session);
    if (answer.refusal) refusals.push({ articleRef, ...answer.refusal });
    else fulfilments.push(answer.line);
  }
  return { fulfilments, refusals };
}

// Rule 34 of the outside-visit spec — a line paid before the document existed: counted whole, paid whole, by one allocation SETTLEMENT reads like any other.
function paidElsewhereOf(list) {
  const lines = (Array.isArray(list) ? list : []).map((line) => ({
    id: null,
    ref: line.ref,
    articleRef: line.articleRef || null,
    family: line.family || null,
    label: line.label,
    quantity: Number(line.quantity == null ? 1 : line.quantity),
    unitCents: Number(line.unitCents == null ? line.totalCents : line.unitCents),
    totalCents: Number(line.totalCents),
    catalogueCents: Number(line.totalCents),
    offered: false,
    cancelled: false,
    vatClass: line.vatClass,
    vatRate: Number(line.vatRate || 0),
    components: line.components || [],
    detail: partsDetail(line.components || []),
    fulfilmentRef: line.fulfilmentRef || null,
    source: 'paidElsewhere',
  }));
  return { lines, allocations: lines.map((line) => ({ lineRef: line.ref, amountCents: line.totalCents, kind: 'payment', books: 1 })) };
}

function storedOf(saleId, { paidElsewhere = [] } = {}) {
  const before = paidElsewhereOf(paidElsewhere);
  if (!saleId) return { sale: null, stored: before.lines, allocations: before.allocations };
  const sale = sales.findSale(saleId);
  return {
    sale,
    stored: [...before.lines, ...(sale ? sales.linesOf(saleId).map(storedLine) : [])],
    allocations: [...before.allocations, ...(sale ? payments.allocationsOf(saleId) : [])],
  };
}

// Runs the `externalSale` pipeline over the document's frozen lines and the new requests.
function price({
  requests, fulfilments = [], stored, allocations,
}) {
  const db = database();
  const provider = settingsProvider.create(db);
  return externalSale({
    input: {
      requests,
      fulfilments,
      stored,
      allocations,
      families: articles.liveFamilies(),
      settings: { vat: provider.for('vat', {}) },
      vatRegime: vatRegimeModel.forRow(db, null),
    },
  });
}

const refusalList = (ctx, own) => [...own, ...ctx.refusals.map((r) => ({ articleRef: r.ref, code: r.code, message: r.message })), ...ctx.vatRefusals.map((r) => ({ articleRef: r.ref, code: r.code, message: r.message }))];

// Outside-visit rule 41 (end-review V-4): each open obligation is a row of its own with its words, and `refundUnheldCents` is the part of the
// owed money no row holds — so a screen shows the rows and that remainder, never the same euros twice.
// Loop t4 B4-2 (rule 56 b) — a closed row leaves the document through its allocations (a refund, or the money kept), so what the document owes back is
// read on its lines and its money only: no closed row is subtracted a second time, forever, wherever its line's money went since.
// `amounts` (the quote, rule 56 d): the open rows at the amounts the plan of the draft gives them, a row planned to nothing left out.
function owedOf(ctx, saleId, amounts = null) {
  const stored = saleId ? sales.obligationsOf(saleId) : [];
  const planned = amounts ? stored.map((row) => ({ ...row, amountCents: (amounts.find((a) => a.id === row.id) || row).amountCents })).filter((row) => row.amountCents > 0) : stored;
  const obligations = planned.map((row) => ({ ...row, label: `${euros(row.amountCents)} à rembourser`, detail: row.reason || null }));
  const owed = owedOnDocument({
    dueCents: ctx.settlement.totalCents,
    paidCents: ctx.settlement.paidCents + ctx.settlement.refundedCents,
    refundedCents: ctx.settlement.refundedCents,
    heldCents: obligations.reduce((sum, row) => sum + row.amountCents, 0),
  });
  return { obligations, owed };
}

// Loop t4 B4-5 (rule 56 c) — the caisse-interne money the document still holds, net of what was given back, kept or moved: what keeps an invoice
// refused (`INTERNAL_CASH`), judged on the money held and no longer on the tenders of a payment whose money left.
function internalHeldOf(allocations) {
  const byRef = new Map();
  for (const row of allocations || []) {
    if (Number(row.books) !== 0 || String(row.paymentRef || '').endsWith(':prepaid')) continue;
    const key = row.lineRef == null ? '' : row.lineRef;
    byRef.set(key, (byRef.get(key) || 0) + Math.round(Number(row.amountCents || 0)));
  }
  return [...byRef.values()].reduce((sum, cents) => sum + Math.max(0, cents), 0);
}

function detailOf(ctx, sale, client, { amounts = null, allocations = [] } = {}) {
  const { obligations, owed } = owedOf(ctx, sale && sale.id, amounts);
  const lines = ctx.lines.map((line, index) => (line.ref ? line : { ...line, ref: `draft:${index}`, id: null }));
  const settled = ctx.settlement.lines.map((line, index) => ({ ...line, ref: lines[index].ref }));
  const detail = buildDocumentDetail({
    sale: sale || {
      id: null, status: 'due', version: 0, soldAt: null, originRef: null, customerName: null, customerEmail: null,
    },
    client,
    lines,
    settlement: {
      ...ctx.settlement,
      lines: settled,
      refundOwedCents: owed.owedCents,
    },
    vatByRate: ctx.vatByRate,
  });
  return {
    ...detail,
    totals: { ...detail.totals, refundUnheldCents: owed.unheldCents, internalHeldCents: internalHeldOf(allocations) },
    history: sale ? sales.historyOf(sale.id) : [],
    refundObligations: obligations,
  };
}

function quote(request = {}) {
  const body = request || {};
  const { sale, stored, allocations } = storedOf(body.saleId, { paidElsewhere: body.paidElsewhere });
  if (body.saleId && !sale) return refuse(404, 'SALE_NOT_FOUND', 'Vente introuvable.');
  const customer = resolveCustomer(body.customer || (sale ? { clientId: sale.clientId } : null), { write: false });
  if (customer.error) return customer.error;
  const sessions = sessionQuotesOf(body.lines);
  const { requests, refusals: own } = requestsOf((Array.isArray(body.lines) ? body.lines : []).filter((line) => !(line && line.session != null)));
  const refusals = [...sessions.refusals, ...own];
  // Loop t4 B4-6 (rule 56 d) — the preview is the plan the commit runs (rules 52-55), nothing written: the unallocated money and a lowered line's
  // money pay the new lines, and the open rows are shown at the amounts that plan leaves them.
  const plan = planOf(sale ? sale.id : null, {
    stored, allocations, requests, fulfilments: [...(body.fulfilments || []), ...sessions.fulfilments],
  });
  const client = sale ? clientView(sale) : { id: customer.clientId, label: customer.label, kind: customer.kind };
  return {
    status: 200,
    document: detailOf(plan.ctx, sale, client, { amounts: sale ? plan.step.amounts : null, allocations: plan.after }),
    customer: { clientId: customer.clientId, label: customer.label, kind: customer.kind },
    refusals: refusalList(plan.ctx, refusals),
    quoted: true,
  };
}

const documentOf = (saleId, { paidElsewhere = [] } = {}) => {
  const { sale, stored, allocations } = storedOf(saleId, { paidElsewhere });
  if (!sale) return null;
  return detailOf(price({ requests: [], stored, allocations }), sale, clientView(sale), { allocations });
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
  const words = checked.lines.map((line) => `${methodLabel(line.method)}${line.internal ? ' (caisse interne)' : ''}`).join(', ');
  sales.addHistory(saleId, `${euros(checked.receivedCents)} encaissés : ${words}`, actor);
  return { paymentId, receivedCents: checked.receivedCents };
}

/**
 * Money that arrived for the document through a channel that does not go by the tenders (a payment link, outside-visit spec rule 41): booked in full, filed on the lines
 * by SETTLEMENT in sale order, whatever the document became meanwhile. What no line asks any more is filed on no line and is owed back (`surplusCents`).
 */
function receive(saleId, {
  method, amountCents, paidAt, source = null, surplus = null,
}) {
  const db = database();
  let outcome = null;
  db.transaction(() => {
    const { stored, allocations } = storedOf(saleId);
    const ctx = price({ requests: [], stored, allocations });
    const day = /^\d{4}-\d{2}-\d{2}$/.test(String(paidAt || '')) ? paidAt : todayIso();
    const walk = allocateDocumentPayment({ lines: ctx.lines.map((line, index) => ({ ...line, ref: line.ref || `draft:${index}` })), allocations, amountCents });
    const paymentId = payments.record({
      saleId,
      paidAt: day,
      tenders: [{ method, amountCents, internal: false }],
      receivedCents: amountCents,
      source,
      allocations: walk.map((row) => ({ ...row, internal: false })),
    });
    sales.addHistory(saleId, `${euros(amountCents)} encaissés : ${methodLabel(method)}`);
    const surplusCents = walk.filter((row) => row.lineRef == null).reduce((sum, row) => sum + row.amountCents, 0);
    // Loop t3 B3-1 (rule 55) — the surplus is the document's unallocated money: its row opens here and follows the document like every other row.
    if (surplusCents > 0 && surplus) {
      sales.openObligation({
        saleId, paymentLinkId: surplus.paymentLinkId, amountCents: surplusCents, reason: surplus.reason,
      });
    }
    reconcile(saleId);
    refreshInPlace(saleId);
    sales.bumpVersion(saleId);
    outcome = { paymentId, surplusCents };
  })();
  return outcome;
}

/**
 * Money a plugin's prepaid instrument already collected (SDK 2.33.0, mixed-method-payments rules 60-61, 65), filed on the lines it paid: `tender` is
 * `{ source, ref, label }` as the plugin wrote it, `covers` `[{ fulfilmentRef | articleRef, amountCents }]` — which line each cent pays, the plugin's call, never
 * the walk's. It is received money, never collected money: the allocations are off the books (`:prepaid`), the VAT of that money was declared when the
 * instrument was sold. Refused when a cover names no line, or more than the line still asks.
 */
function takePrepaid(saleId, {
  tender, covers, paidAt, actor = null,
}) {
  const db = database();
  let outcome = null;
  try {
    db.transaction(() => {
      const { stored, allocations } = storedOf(saleId);
      const ctx = price({ requests: [], stored, allocations });
      const room = new Map(ctx.settlement.lines.map((row, index) => [ctx.lines[index].ref, row.dueCents - row.settledCents]));
      const rows = [];
      for (const cover of Array.isArray(covers) ? covers : []) {
        const index = ctx.lines.findIndex((line) => (cover.fulfilmentRef ? line.fulfilmentRef === cover.fulfilmentRef : line.articleRef === cover.articleRef)
          && room.has(line.ref) && !rows.some((r) => r.lineRef === line.ref));
        const amount = Math.round(Number(cover.amountCents));
        if (index < 0 || !(amount > 0) || amount > room.get(ctx.lines[index].ref)) { outcome = refuse(409, 'PREPAID_COVER_INVALID', 'Part prépayée invalide.'); throw outcome; }
        rows.push({ lineRef: ctx.lines[index].ref, amountCents: amount, prepaid: true });
      }
      const total = rows.reduce((sum, row) => sum + row.amountCents, 0);
      if (!(total > 0)) { outcome = refuse(409, 'PREPAID_COVER_INVALID', 'Part prépayée invalide.'); throw outcome; }
      const day = /^\d{4}-\d{2}-\d{2}$/.test(String(paidAt || '')) ? paidAt : todayIso();
      const paymentId = payments.record({
        saleId,
        paidAt: day,
        tenders: [{ method: 'prepaid', amountCents: total, internal: false, source: tender.source, ref: tender.ref, label: tender.label }],
        receivedCents: total,
        source: `prepaid:${tender.source}:${tender.ref}`,
        createdBy: actor,
        allocations: rows,
      });
      sales.addHistory(saleId, `${euros(total)} réglés : ${tender.label}`, actor);
      refreshInPlace(saleId);
      sales.bumpVersion(saleId);
      outcome = { status: 200, paymentId, receivedCents: total };
    })();
  } catch (err) {
    if (err !== outcome || !outcome || outcome.status === 200) throw err;
  }
  return outcome;
}

/**
 * What paid each line of the document, payment by payment (rules 35-36, 53 of the campaigns spec; SDK 2.33.0):
 * `[{ lineRef, amountCents, paymentId, paidAt, kind: 'prepaid' | 'money', label, source?, ref? }]`. A `prepaid` row is money a plugin's instrument already collected
 * (its tender names the `source`, its `ref` and its `label`); a `money` row carries the methods of its payment (« CB », « Espèces + CB »). Read from the payments and
 * the allocations they filed, never recomputed.
 */
function paidByOf(saleId) {
  const rows = payments.paymentsOf(saleId);
  if (!rows.length) return [];
  const allocations = payments.allocationsOf(saleId);
  return rows.flatMap((payment) => {
    const base = `standalone-payment:${payment.id}`;
    const prepaid = payment.tenders.find((tender) => tender.method === 'prepaid') || null;
    const money = [...new Set(payment.tenders.filter((tender) => tender.method !== 'prepaid').map((tender) => methodLabel(tender.method)))].join(' + ');
    return allocations
      .filter((row) => row.lineRef && (row.paymentRef === base || row.paymentRef === `${base}:internal` || row.paymentRef === `${base}:prepaid`))
      .map((row) => (row.paymentRef.endsWith(':prepaid') && prepaid
        ? {
          lineRef: row.lineRef, amountCents: Number(row.amountCents), paymentId: payment.id, paidAt: payment.paidAt, kind: 'prepaid', label: prepaid.label, source: prepaid.source, ref: prepaid.ref,
        }
        : {
          lineRef: row.lineRef, amountCents: Number(row.amountCents), paymentId: payment.id, paidAt: payment.paidAt, kind: 'money', label: money || 'Paiement',
        }));
  });
}

/** A line of the document's history (rule 53 of the campaigns spec): the journal of everything that happened to a sale, newest first when read by `historyOf`. */
const recordHistory = (saleId, text, actor = null) => sales.addHistory(saleId, text, actor);
const historyOf = (saleId) => sales.historyOf(saleId);

function sell(request = {}, { actor = null, now = new Date() } = {}) {
  const body = request || {};
  const db = database();
  let outcome = null;
  try {
    db.transaction(() => {
      const { sale: existing, stored, allocations } = storedOf(body.saleId, { paidElsewhere: body.paidElsewhere });
      if (body.saleId && !existing) { outcome = refuse(404, 'SALE_NOT_FOUND', 'Vente introuvable.'); throw outcome; }
      if (existing) {
        const stale = versionRefusal(existing, body.version);
        if (stale) { outcome = stale; throw outcome; }
        if (existing.status === 'cancelled') { outcome = refuse(409, 'SALE_CANCELLED', 'Vente annulée.'); throw outcome; }
      }
      const customer = resolveCustomer(body.customer || (existing ? { clientId: existing.clientId } : null), { write: true });
      if (customer.error) { outcome = customer.error; throw outcome; }
      const { requests, refusals } = requestsOf(body.lines);
      if (requests.length === 0 && !existing && !(body.fulfilments || []).length) refusals.push({ articleRef: null, code: 'NO_ARTICLE', message: 'Ajouter au moins un article.' });
      const ctx = price({
        requests, fulfilments: body.fulfilments, stored, allocations,
      });
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
          fulfilmentRef: line.fulfilmentRef || null,
          soldAt,
          source: body.source || 'counter',
        });
      }
      if (existing) sales.bumpVersion(saleId);
      else sales.addHistory(saleId, 'Vente enregistrée', actor);
      for (const added of ctx.lines.filter((l) => l.isNew)) sales.addHistory(saleId, `${added.label} ×${added.quantity} ${added.offered ? 'offerte' : 'ajoutée'}`, actor);
      if (existing) reconcile(saleId);
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
// Rule 40 of the outside-visit spec — an open link that no longer bills the reste (a payment taken, a line added, offered or removed) is withdrawn in
// the same transaction, so it can never be paid; its provider side is deactivated after the commit by the poll (`remotePending`). A cancelled
// document withdraws it whatever its amount.
function refreshInPlace(saleId) {
  const { stored, allocations } = storedOf(saleId);
  const ctx = price({ requests: [], stored, allocations });
  const sale = sales.findSale(saleId);
  const status = sale.status === 'cancelled' ? 'cancelled' : (ctx.settlement.remainingCents === 0 ? 'paid' : 'due');
  sales.updateSale(saleId, { totalCents: ctx.settlement.totalCents, vatJson: JSON.stringify(ctx.vatByRate), status });
  retireStaleLink(saleId, status === 'cancelled' ? null : ctx.settlement.remainingCents);
  return ctx;
}

function retireStaleLink(saleId, remainingCents) {
  const links = require('../models/paymentLinksModel');
  const open = links.findOpenForSale && links.findOpenForSale(sales.documentRef(saleId));
  if (!open || (remainingCents != null && Number(open.amountCents) === Number(remainingCents))) return null;
  const { LINK_REASONS } = require('../constants/paymentLinks');
  links.cancelIfOpen(open.id, { reason: remainingCents == null ? LINK_REASONS.OPERATOR : LINK_REASONS.AMOUNT_CHANGED, endsAt: new Date() });
  if (open.providerLinkId) links.cancel(open.id, { remotePending: true });
  return open.id;
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

/**
 * Loop t2 B2-2, B2-3 (outside-visit rules 52, 53) — after every change of a stored document, in its transaction: the money a lowered line holds is first
 * filed on the lines still due (a transfer dated today, so the journal books what the money now pays), then the open `lineLowered` rows are kept in step
 * with what the document owes back; a confirmed lowering (`lowered`: `{ reason, lineRef }`, `lineRef` null for the whole document) opens what no row
 * holds yet (loop t1 B-1, AV-1, rule 25): the « À rembourser » lists show it, the invoice waits for it, and « Marquer remboursé » closes it.
 */
function planOf(saleId, {
  stored, allocations, requests = [], fulfilments = [],
}, lowered = null) {
  const named = (lines) => lines.map((line, index) => ({ ...line, ref: line.ref || `draft:${index}` }));
  const moved = refileDocumentExcess({
    lines: named(price({
      requests, fulfilments, stored, allocations,
    }).lines),
    allocations,
  });
  const after = [...allocations, ...moved.map((row) => ({ ...row, kind: 'payment' }))];
  const ctx = price({
    requests, fulfilments, stored, allocations: after,
  });
  const { obligations, owed } = owedOf(ctx, saleId);
  const step = documentRowsInStep({
    rows: obligations.map((row) => ({ ...row, unallocated: row.origin === 'linkSurplus' })),
    lines: ctx.settlement.lines,
    owedCents: owed.owedCents,
    unallocatedCents: unallocatedOf(after).cents,
    open: lowered ? { lineRef: lowered.lineRef || null } : null,
  });
  return {
    moved, obligations, step, ctx, after,
  };
}

/**
 * Loop t3 B3-1 (rule 55) — the plan covers every open row: a `linkSurplus` row holds at most the money still on no line once rule 52 has filed it on the
 * lines still due, so a line made payable again or sold after a late link is paid by that money and its row shrinks (closed by `system` at 0).
 */
function reconcile(saleId, lowered = null) {
  const { moved, obligations, step } = planOf(saleId, storedOf(saleId), lowered);
  if (moved.length) payments.recordTransfer({ saleId, at: todayIso(), rows: moved });
  for (const row of step.amounts) {
    const before = obligations.find((r) => r.id === row.id);
    if (before && before.amountCents !== row.amountCents) sales.resizeObligation(row.id, row.amountCents);
  }
  if (lowered && step.openCents > 0) {
    sales.openObligation({
      saleId, origin: 'lineLowered', amountCents: step.openCents, reason: lowered.reason, lineRef: lowered.lineRef || null,
    });
  }
}

// One change of a stored document, in its own transaction: the version is compared, the change made, the document reconciled and refreshed, its version moved.
function change(saleId, version, work, { lowered = null } = {}) {
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
      reconcile(saleId, typeof lowered === 'function' ? lowered() : lowered);
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
// Mock M5 (loop t1 UI-12), loop t3 B3-3 (rule 55): the refusal names what the confirmed change would really open — the plan of `reconcile` run on the
// document as the change would leave it (`lowerTo`: the line offered or removed), after the line's money paid the lines still due. Nothing to open, no question.
function lineOf(saleId, lineId, { confirmRefund, lowerTo = null }) {
  const row = sales.findLine(saleId, lineId);
  if (!row || row.cancelledAt) return { refusal: refuse(404, 'LINE_NOT_FOUND', 'Ligne introuvable.') };
  if (confirmRefund === true || !lowerTo) return { row };
  const { stored, allocations } = storedOf(saleId);
  const ref = sales.lineRef(row.id);
  const lowered = stored.map((line) => (line.ref === ref ? { ...line, ...lowerTo } : line));
  const { step } = planOf(saleId, { stored: lowered, allocations }, { lineRef: ref });
  if (step.openCents > 0) {
    return { refusal: refuse(409, 'LINE_PAID', `Ligne payée : remboursement à confirmer. ${euros(step.openCents)} à rembourser.`, { refundCents: step.openCents, label: row.label }) };
  }
  return { row };
}

function offerLine(saleId, lineId, { offered = true, confirmRefund = false, version } = {}) {
  let label = '';
  return change(saleId, version, () => {
    const { row, refusal } = lineOf(saleId, lineId, { confirmRefund: offered ? confirmRefund : true, lowerTo: { offered: true, totalCents: 0 } });
    if (refusal) return refusal;
    label = row.label;
    const catalogue = row.catalogueCents == null ? row.totalCents : row.catalogueCents;
    sales.updateLine(row.id, { offered: offered ? 1 : 0, totalCents: offered ? 0 : catalogue, catalogueCents: catalogue });
    sales.addHistory(saleId, `${row.label} ${offered ? 'offerte' : 'à nouveau payante'}`);
    return null;
  }, { lowered: () => (offered ? { reason: `${label} offerte après paiement`, lineRef: sales.lineRef(lineId) } : null) });
}

function removeLine(saleId, lineId, { confirmRefund = false, version } = {}) {
  let label = '';
  return change(saleId, version, () => {
    const { row, refusal } = lineOf(saleId, lineId, { confirmRefund, lowerTo: { cancelled: true } });
    if (refusal) return refusal;
    label = row.label;
    sales.updateLine(row.id, { cancelledAt: new Date().toISOString() });
    sales.addHistory(saleId, `${row.label} retirée`);
    return null;
  }, { lowered: () => ({ reason: `${label} retirée après paiement`, lineRef: sales.lineRef(lineId) }) });
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
    sales.addHistory(saleId, 'Vente annulée');
    // The open link of the document is withdrawn with it (`refreshInPlace`); a payment that still arrives on it is booked in full and owed back (rule 41).
    return null;
  }, { lowered: { reason: 'Vente annulée après paiement', lineRef: null } });
}

/**
 * Loop t1 B-1 (outside-visit rule 49) — « Marquer remboursé » on a `lineLowered` row: the money given back is written as refund allocations (rule 74:
 * a refund is a negative allocation), in the caller's transaction, on the line the row was opened for first, then on the other lines that hold more than
 * they now ask, dated the day of the refund (which line, REFUNDS' `refundRowsOfDocument` — loop t2 B2-1, B2-4). The
 * journal books them as the document's avoir that day (`accounting/standaloneDocuments.js`), so the revenue and the VAT of the money given back leave
 * the books; SETTLEMENT reads them as refunded.
 */
// Which money a closed row takes off the document (REFUNDS' `refundRowsOfDocument`): its own line first, then the excess no other open row names (B4-3).
function rowsLeaving(saleId, obligation) {
  const { stored, allocations } = storedOf(saleId);
  const ctx = price({ requests: [], stored, allocations });
  const reserved = sales.obligationsOf(saleId).filter((row) => row.id !== obligation.id && row.origin !== 'linkSurplus');
  return refundRowsOfDocument({
    lines: ctx.settlement.lines,
    allocations,
    amountCents: Number(obligation.amountCents),
    lineRef: obligation.lineRef || null,
    unallocated: obligation.origin === 'linkSurplus',
    reserved,
  });
}

function writeObligationRefund(saleId, obligation, { day = todayIso() } = {}) {
  payments.recordRefund({
    saleId, obligationId: obligation.id, at: day, rows: rowsLeaving(saleId, obligation),
  });
  refreshInPlace(saleId);
  sales.bumpVersion(saleId);
}

/**
 * Loop t3 B3-2 (rule 55, owner rule 50) — a link surplus closed « rien à rembourser » is money the business keeps: it leaves the document's unallocated
 * money as a « kept » allocation (`payments.recordKept`), so it can no longer pay a line sold later; the journal books it as the tip of rule 50.
 * Loop t4 B4-1, B4-2 (owner 2026-11-16, rule 56 a) — a `lineLowered` row closed « rien à rembourser » is kept the same way: negative `payment` allocations
 * on the lines the money leaves (the same rows a refund would take), so the line's revenue and VAT leave the books on the close day and the money kept is
 * a tip; what the document owes then follows its lines.
 */
function writeKept(saleId, obligation, { day = todayIso() } = {}) {
  payments.recordKept({
    saleId, obligationId: obligation.id, at: day, rows: rowsLeaving(saleId, obligation),
  });
  refreshInPlace(saleId);
  sales.bumpVersion(saleId);
}

// The payments of a document, oldest first, each with its tenders: what an invoice states and the card batch reads (the outside-visit spec rule 31).
const paymentsOf = (saleId) => payments.paymentsOf(saleId).map((row) => ({
  id: row.id, paidAt: row.paidAt, receivedCents: Number(row.receivedCents), tenders: row.tenders, source: row.source || null,
}));

module.exports = {
  quote, sell, offerLine, removeLine, pay, cancel, receive, documentOf, paymentsOf, takePayment, takePrepaid, paidByOf, recordHistory, historyOf, writeObligationRefund, writeKept, MAX_QUANTITY,
};
