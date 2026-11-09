/**
 * Qonto as the instance's invoice issuer (specs/resource-booking-pricing-and-invoicing.md rules 14, 16-19, 25).
 *
 * Qonto numbers, renders and keeps the invoice; GuestFlow never numbers one (rule 16). Every call goes through
 * `withQonto`, so a token is refreshed and a failure is recorded where the operator reads it. Refusals the seller
 * shows are thrown with a `code`:
 *   ISSUER_NEEDS_ADDRESS  — Qonto wants a billing address it was not given (rule 25)
 *   ISSUER_REAUTH         — the connection predates the invoicing scopes (Q6): reconnect Qonto
 *   ISSUER_AMOUNT_MISMATCH — Qonto computed another total; the invoice it made is cancelled (rule 14)
 */

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

// Qonto takes each line excluding VAT and adds the VAT itself; GuestFlow's lines are the prices the guest paid. Each
// line goes back to its HT, and the largest one moves by a cent until the totals Qonto will compute (each line
// rounded) add up to the total charged — the money guard of `createClientInvoice` then checks Qonto's own figure.
const ttcOf = (htCents, rate) => Math.round(htCents * (1 + Number(rate || 0) / 100));
function toExcludingVat(lines, expectedTotalCents) {
  const out = lines.map((l) => ({ ...l, amountCents: Math.round(l.amountCents / (1 + Number(l.vatRate || 0) / 100)) }));
  if (expectedTotalCents == null || out.length === 0) return out;
  const largest = out.reduce((best, l, i) => (Math.abs(l.amountCents) > Math.abs(out[best].amountCents) ? i : best), 0);
  for (let step = 0; step < 4; step += 1) {
    const gap = expectedTotalCents - out.reduce((sum, l) => sum + ttcOf(l.amountCents, l.vatRate), 0);
    if (gap === 0) break;
    out[largest] = { ...out[largest], amountCents: out[largest].amountCents + Math.sign(gap) };
  }
  return out;
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
          idempotencyKey: `${idempotencyKey}:client`,
        })).id;
        const base = {
          accessToken, clientId, issueDate, dueDate: issueDate,
          performanceStart: performanceDate, performanceEnd: performanceDate,
          iban: iban(), expectedTotalCents,
        };
        let invoice;
        try {
          invoice = await client.createClientInvoice({ ...base, items: wireItems(items, discount, expectedTotalCents), idempotencyKey: `${idempotencyKey}:invoice` });
        } catch (err) {
          if (!(discount && discount.amountCents && isLineRefusal(err))) throw err;
          invoice = await client.createClientInvoice({ ...base, items: foldedItems(items, discount, expectedTotalCents), idempotencyKey: `${idempotencyKey}:invoice-folded` });
        }
        let markedPaid = false;
        if (paid) {
          const marked = await client.markClientInvoicePaid({ accessToken, id: invoice.id, paidAt: issueDate });
          markedPaid = Boolean(marked.supported);
        }
        return { invoiceId: invoice.id, number: invoice.number, totalCents: invoice.totalCents, clientId, markedPaid };
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
        const att = await client.uploadTransactionAttachment({ accessToken, transactionId, bytes: pdf.bytes, fileName: pdf.fileName, idempotencyKey });
        return { attachmentId: att.id };
      });
    } catch (err) {
      if (isScopeRefusal(err)) throw refusal('ISSUER_REAUTH', 'Reconnecter Qonto dans Réglages → Intégrations pour facturer.', err);
      throw err;
    }
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
    invoiceStatus,
  };
}

module.exports = { createQontoInvoiceIssuer, wireItems, foldedItems, toExcludingVat };
