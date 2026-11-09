/**
 * Qonto as the instance's invoice issuer (specs/resource-booking-pricing-and-invoicing.md rules 14, 16-19, 25).
 *
 * Qonto numbers, renders and keeps the invoice; GuestFlow never numbers one (rule 16). Every call goes through
 * `withQonto`, so a token is refreshed and a failure is recorded where the operator reads it. Refusals the seller
 * shows are thrown with a `code`:
 *   ISSUER_NEEDS_ADDRESS  — Qonto wants a billing address it was not given (rule 25)
 *   ISSUER_REAUTH         — the connection predates the invoicing scopes (Q6): reconnect Qonto
 *   ISSUER_AMOUNT_MISMATCH — Qonto computed another total; the invoice it made is cancelled (rule 14)
 *   ISSUER_AMOUNT_UNREACHABLE — no set of lines excluding VAT adds up to the total charged: refused before any call (rule 40)
 */

const crypto = require('crypto');
const sdk = require('../sdk');

const { withQonto } = sdk.coreModule('qonto').qontoService;

const BATCH_REFERENCE = (date) => {
  const [y, m, d] = String(date).split('-');
  return new RegExp(`paiements?-en-personne-${d}-${m}-${y}`, 'i');
};
const MAX_BATCH_PAGES = 3;

const refusal = (code, message, cause) => {
  const err = new Error(message);
  err.code = code;
  if (cause) err.cause = cause;
  return err;
};

const bodyText = (err) => JSON.stringify((err && err.body) || '').toLowerCase();
const isScopeRefusal = (err) => Number(err && err.status) === 403 || /insufficient_scope/.test(bodyText(err));
const isAddressRefusal = (err) => Number(err && err.status) === 422 && /address|zip|city|street/.test(bodyText(err));
const isLineRefusal = (err) => Number(err && err.status) === 422 && /unit_price|items|amount/.test(bodyText(err));

// Rule 39 — Qonto's idempotency key is a UUID: the caller's key and what the request depends on, hashed into that
// shape (the control plane's own rule). A retry of the same request carries the same key; another request never does.
function uuidKey(...parts) {
  const h = crypto.createHash('sha256').update(parts.map((p) => String(p ?? '')).join('|')).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

// Rule 40 — Qonto takes each line excluding VAT and adds the VAT itself, line by line (Q3); GuestFlow's lines are the
// prices the guest paid. Each line goes back to its HT, and the lines move by a cent or two — any of them, the fewest
// cents moved off each line's own price — until the totals Qonto will compute add up to the total charged. A total no such set reaches (a single
// line whose TTC falls between two roundings) gets a « Arrondi de TVA » line of a cent or two; when even that cannot
// reach it, `null`: the caller refuses before Qonto numbers anything. The money guard of `createClientInvoice` still
// checks Qonto's own figure.
const ttcOf = (htCents, rate) => Math.round(htCents * (1 + Number(rate || 0) / 100));
const NUDGE = [0, -1, 1, -2, 2, -3, 3];
const ROUNDING_TITLE = 'Arrondi de TVA';

function solveLines(lines, expectedTotalCents) {
  const bases = lines.map((l) => Math.round(l.amountCents / (1 + Number(l.vatRate || 0) / 100)));
  let best = null;
  const walk = (i, chosen, total, cost) => {
    if (best && cost >= best.cost) return;
    if (i === lines.length) {
      if (total === expectedTotalCents) best = { chosen: [...chosen], cost };
      return;
    }
    for (const d of NUDGE) {
      const ht = bases[i] + d;
      const ttc = ttcOf(ht, lines[i].vatRate);
      chosen.push(ht);
      walk(i + 1, chosen, total + ttc, cost + Math.abs(ttc - lines[i].amountCents) * 10 + Math.abs(d));
      chosen.pop();
    }
  };
  walk(0, [], 0, 0);
  return best ? lines.map((l, i) => ({ ...l, amountCents: best.chosen[i] })) : null;
}

function toExcludingVat(lines, expectedTotalCents) {
  if (expectedTotalCents == null || lines.length === 0) {
    return lines.map((l) => ({ ...l, amountCents: Math.round(l.amountCents / (1 + Number(l.vatRate || 0) / 100)) }));
  }
  const solved = solveLines(lines, expectedTotalCents);
  if (solved) return solved;
  const rate = lines[0].vatRate;
  for (const cent of [1, -1, 2, -2]) {
    const withRounding = solveLines([...lines, { title: ROUNDING_TITLE, amountCents: ttcOf(cent, rate), vatRate: rate }], expectedTotalCents);
    if (withRounding) return withRounding;
  }
  return null;
}

function wireItems(items, discount, expectedTotalCents = null) {
  const lines = items.map((it) => ({ title: it.title, ...(it.description ? { description: it.description } : {}), amountCents: it.amountCents, vatRate: it.vatRate }));
  const all = !discount || !discount.amountCents
    ? lines
    : [...lines, { title: discount.title, amountCents: -Math.abs(discount.amountCents), vatRate: discount.vatRate }];
  return toExcludingVat(all, expectedTotalCents);
}

// Q3 — when Qonto refuses a negative line, the discount is folded into the lines, largest first, and named in their
// description: the total is the same, the reader still sees what was offered.
function foldedItems(items, discount, expectedTotalCents = null) {
  let left = Math.abs(discount.amountCents);
  return toExcludingVat([...items]
    .sort((a, b) => b.amountCents - a.amountCents)
    .map((it) => {
      const cut = Math.min(left, it.amountCents);
      left -= cut;
      return cut > 0
        ? { ...it, amountCents: it.amountCents - cut, description: `${discount.title} : −${(cut / 100).toFixed(2).replace('.', ',')} €` }
        : it;
    }), expectedTotalCents);
}

/**
 * @param {object} deps
 * @param {() => object} deps.store    the plugin's settings store (`qontoConnected`)
 * @param {() => string} deps.iban     the company IBAN printed on the invoice (core settings)
 * @param {object} [deps.env]
 * @param {Function} [deps.withQontoImpl] injected in tests
 */
function createQontoInvoiceIssuer({ store, iban, env = process.env, withQontoImpl = withQonto }) {
  const call = (origin, fn) => withQontoImpl({ settings: store(), env, origin }, fn);

  async function issue(request) {
    const { idempotencyKey, client: who, issueDate, performanceDate, items, discount, expectedTotalCents, paid } = request;
    const wired = wireItems(items, discount, expectedTotalCents);
    if (!wired) throw refusal('ISSUER_AMOUNT_UNREACHABLE', 'Total impossible à facturer au centime près : facture à établir dans Qonto.');
    try {
      return await call('invoicing', async (client, accessToken) => {
        const clientId = who.clientId || (await client.createIndividualClient({
          accessToken,
          firstName: who.firstName,
          lastName: who.lastName,
          street: who.street,
          postcode: who.postcode,
          city: who.city,
          countryCode: who.countryCode || 'FR',
          idempotencyKey: uuidKey(idempotencyKey, 'client', who.lastName, who.firstName, who.street, who.postcode, who.city, who.countryCode || 'FR'),
        })).id;
        const base = {
          accessToken, clientId, issueDate, dueDate: issueDate,
          performanceStart: performanceDate, performanceEnd: performanceDate,
          iban: iban(), expectedTotalCents,
        };
        let invoice;
        try {
          invoice = await client.createClientInvoice({ ...base, items: wired, idempotencyKey: uuidKey(idempotencyKey, 'invoice', clientId) });
        } catch (err) {
          if (!(discount && discount.amountCents && isLineRefusal(err))) throw err;
          const folded = foldedItems(items, discount, expectedTotalCents);
          if (!folded) throw refusal('ISSUER_AMOUNT_UNREACHABLE', 'Total impossible à facturer au centime près : facture à établir dans Qonto.');
          invoice = await client.createClientInvoice({ ...base, items: folded, idempotencyKey: uuidKey(idempotencyKey, 'invoice-folded', clientId) });
        }
        // Rule 38 — the invoice is numbered: from here nothing may lose it. « Marquer payée » is optional (Q4): its
        // failure leaves the invoice « à payer » in Qonto and the watch job tries again.
        let markedPaid = false;
        let markPending = false;
        if (paid) {
          try {
            const marked = await client.markClientInvoicePaid({ accessToken, id: invoice.id, paidAt: issueDate });
            markedPaid = Boolean(marked.supported);
          } catch (err) {
            markPending = true;
            // eslint-disable-next-line no-console
            console.warn(`[online-payment] invoice ${invoice.number || invoice.id} not marked paid in Qonto:`, err && err.message);
          }
        }
        return { invoiceId: invoice.id, number: invoice.number, totalCents: invoice.totalCents, clientId, markedPaid, markPending };
      });
    } catch (err) {
      if (err && err.body && err.body.code === 'AMOUNT_MISMATCH') {
        if (err.body.invoiceId) {
          await call('invoicing', (client, accessToken) => client.cancelClientInvoice({ accessToken, id: err.body.invoiceId })).catch(() => {});
        }
        throw refusal('ISSUER_AMOUNT_MISMATCH', 'Le total calculé par Qonto diffère : facture annulée.', err);
      }
      if (isAddressRefusal(err)) throw refusal('ISSUER_NEEDS_ADDRESS', "Qonto demande l'adresse de facturation pour émettre la facture.", err);
      if (isScopeRefusal(err)) throw refusal('ISSUER_REAUTH', 'Reconnecter Qonto dans Réglages → Intégrations pour facturer.', err);
      throw err;
    }
  }

  // Rule 17 — the day's on-site card credit, read live: it may land after the hourly read of the reconciliation.
  async function findCardBatch(date) {
    const pattern = BATCH_REFERENCE(date);
    return call('invoicing', async (client, accessToken) => {
      const accounts = await client.listBankAccounts({ accessToken });
      const main = accounts.find((a) => a.main) || accounts[0];
      if (!main) return null;
      let page = 1;
      while (page && page <= MAX_BATCH_PAGES) {
        // eslint-disable-next-line no-await-in-loop
        const batch = await client.listTransactions({ accessToken, bankAccountId: main.id, settledFrom: `${date}T00:00:00.000Z`, page });
        const found = batch.transactions.find((t) => pattern.test(String(t.reference || '')));
        if (found) return { transactionId: found.id, settledAt: found.settledAt };
        page = batch.nextPage;
      }
      return null;
    });
  }

  async function attach({ invoiceId, transactionId, idempotencyKey }) {
    try {
      return await call('invoicing', async (client, accessToken) => {
        const pdf = await client.getClientInvoicePdf({ accessToken, id: invoiceId });
        if (!pdf) throw refusal('ISSUER_PDF_PENDING', 'PDF de la facture pas encore prêt chez Qonto.');
        const att = await client.uploadTransactionAttachment({ accessToken, transactionId, bytes: pdf.bytes, fileName: pdf.fileName, idempotencyKey: uuidKey(idempotencyKey) });
        return { attachmentId: att.id };
      });
    } catch (err) {
      if (isScopeRefusal(err)) throw refusal('ISSUER_REAUTH', 'Reconnecter Qonto dans Réglages → Intégrations pour facturer.', err);
      throw err;
    }
  }

  // Rule 38 — `{ done: true }` marked paid, `{ done: false }` Qonto does not offer it; a failure is thrown (retried).
  async function markPaid({ invoiceId, paidAt }) {
    const marked = await call('invoicing', (client, accessToken) => client.markClientInvoicePaid({ accessToken, id: invoiceId, paidAt }));
    return { done: Boolean(marked.supported) };
  }

  async function invoiceStatus(invoiceId) {
    const inv = await call('invoicing', (client, accessToken) => client.getClientInvoice({ accessToken, id: invoiceId }));
    return String(inv.status || '').toLowerCase();
  }

  return {
    id: 'qonto',
    isReady: () => Boolean(store().qontoConnected()),
    issue,
    findCardBatch,
    attach,
    markPaid,
    invoiceStatus,
  };
}

module.exports = {
  createQontoInvoiceIssuer, wireItems, foldedItems, toExcludingVat, ttcOf, uuidKey,
};
