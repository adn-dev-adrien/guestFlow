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
const {
  netFirstCents, ttcFromNetCents: ttcOf, vatOf, netFirst,
} = sdk.coreModule('vat');
// Rule 62 — the VAT of one (class, rate) group, cut once by the VAT component on the group's TTC: the core's `groupVatCents`, read through `vatOf`
// (SDK 2.29) so the plugin keeps its SDK floor.
const groupVatCents = (ttcCents, rate) => (ttcCents > 0
  ? vatOf([{ amountCents: ttcCents, vatClass: 'external', customerContext: 'external' }], { regime: null, settings: { get: () => rate } }).totals.vatCents
  : 0);
// Loop t5 B5-2 — a group whose key starts with `booking:` is a session the hourly booking journals itself: ONE line whose HT is the net of its TTC
// (`legacyBucketSplit.netOfTtc`, net first, in euros) and whose VAT is what is left. Its items reach that cut, so the invoice states the booking
// journal's VAT (20 € − 15 € « 1 h offerte » at 10 % → 0,45, where one cut on the TTC by `groupVatCents` and Qonto's per-line VAT gave 0,46 before).
const BOOKING_GROUP = 'booking:';
const bookingVatCents = (ttcCents, rate) => (ttcCents > 0 && Number(rate) > 0
  ? ttcCents - Math.round(netFirst(ttcCents / 100, Number(rate)).net * 100)
  : 0);
const groupCutCents = (group, ttcCents, rate) => (String(group).startsWith(BOOKING_GROUP) ? bookingVatCents(ttcCents, rate) : groupVatCents(ttcCents, rate));
const NUDGE = [0, -1, 1, -2, 2, -3, 3];
const ROUNDING_TITLE = 'Arrondi de TVA';

// Rule 48 (R36-EXT-2) — a line keeps its sign: a price never becomes a 0 € or a negative HT line, a discount never 0 €.
const keepsSign = (amountCents, ht) => (amountCents > 0 ? ht >= 1 : (amountCents < 0 ? ht <= -1 : ht === 0));

function solveLines(lines, expectedTotalCents) {
  const bases = lines.map((l) => netFirstCents(l.amountCents, l.vatRate));
  let best = null;
  const walk = (i, chosen, total, cost) => {
    if (best && cost >= best.cost) return;
    if (i === lines.length) {
      if (total === expectedTotalCents) best = { chosen: [...chosen], cost };
      return;
    }
    for (const d of NUDGE) {
      const ht = bases[i] + d;
      if (!keepsSign(lines[i].amountCents, ht)) continue;
      const ttc = ttcOf(ht, lines[i].vatRate);
      chosen.push(ht);
      walk(i + 1, chosen, total + ttc, cost + Math.abs(ttc - lines[i].amountCents) * 10 + Math.abs(d));
      chosen.pop();
    }
  };
  walk(0, [], 0, 0);
  return best ? lines.map((l, i) => ({ ...l, amountCents: best.chosen[i] })) : null;
}

/**
 * Loop t4 B4-4 (pricing-components rule 62, outside-visit rule 56 e) — the lines of ONE (class, rate) group sent so that Qonto's per-line VAT adds up to the
 * VAT the journal cuts once on the group: their HT sum is `htCents` and their TTC sum `ttcCents`. Each line moves by at most three cents of HT off its
 * own price (`width` more when Qonto's per-line VAT can reach the group's cut no other way — at a low rate a line's VAT moves a cent only every 1 / rate
 * cents of HT), the fewest cents of TTC moved first; a dynamic walk over the (HT, TTC) sums reached — their difference, the VAT, spans a few cents — so
 * a long basket stays cheap. `null` when unreachable.
 */
function solveGroup(lines, { htCents, ttcCents }, { width = 0 } = {}) {
  let states = new Map([['0|0', {
    ht: 0, ttc: 0, cost: 0, chosen: [],
  }]]);
  const wide = width ? Array.from({ length: 2 * width + 1 }, (_, i) => i - width) : NUDGE;
  lines.forEach((line) => {
    const base = netFirstCents(line.amountCents, line.vatRate);
    const nudges = line.rounding ? NUDGE : wide;
    const next = new Map();
    for (const state of states.values()) {
      for (const d of nudges) {
        const ht = base + d;
        if (!keepsSign(line.amountCents, ht)) continue;
        const ttc = ttcOf(ht, line.vatRate);
        const key = `${state.ht + ht}|${state.ttc + ttc}`;
        const cost = state.cost + Math.abs(ttc - line.amountCents) * 10 + Math.abs(d);
        const known = next.get(key);
        if (!known || cost < known.cost) {
          next.set(key, {
            ht: state.ht + ht, ttc: state.ttc + ttc, cost, chosen: [...state.chosen, ht],
          });
        }
      }
    }
    states = next;
  });
  const found = states.get(`${htCents}|${ttcCents}`);
  return found ? lines.map(({ rounding, ...line }, i) => ({ ...line, amountCents: found.chosen[i] })) : null;
}

// The lines of a group within three cents; else moved further, the least TTC moved winning; else an « Arrondi de TVA » line at the group's rate: a
// cent or two with the lines within three cents, then with the lines moved further, then a rounding line as wide as the lines. Loop t5 B5-3 — a
// discount folded into one line (Q3, no negative line) may leave a group whose cut no single line carries: 14,00 € − 11,69 € at 20 % needs the line
// moved further AND a rounding line (1,89 + 0,03 HT); 5,50 € − 1,95 € at 5,5 % needs a rounding line that carries a cent of VAT (0,10 HT).
function solveGroupWithRounding(lines, target, { noNegative }) {
  const rate = lines[0].vatRate;
  const wide = { width: Math.ceil(100 / Math.max(Number(rate) || 0, 1)) + 1 };
  const solved = solveGroup(lines, target) || solveGroup(lines, target, wide);
  if (solved) return solved;
  const cents = noNegative ? [1, 2] : [1, -1, 2, -2];
  for (const [options, pinned] of [[{}, true], [wide, true], [wide, false]]) {
    for (const cent of cents) {
      const withRounding = solveGroup([...lines, {
        title: ROUNDING_TITLE, amountCents: ttcOf(cent, rate), vatRate: rate, rounding: pinned,
      }], target, options);
      if (withRounding) return withRounding;
    }
  }
  return null;
}

// Lines that name their `vatGroup` (a sale document's, rule 62): each group reaches the HT and TTC of the group's single VAT cut. The group key leaves
// the wire; the lines keep their order, a group's rounding line after its last line.
function toExcludingVatByGroup(lines, { noNegative }) {
  const groups = new Map();
  lines.forEach((line, index) => {
    const group = groups.get(line.vatGroup) || [];
    group.push({ line, index });
    groups.set(line.vatGroup, group);
  });
  const out = [];
  for (const [group, members] of groups) {
    const ttcCents = members.reduce((sum, { line }) => sum + line.amountCents, 0);
    const target = { ttcCents, htCents: ttcCents - groupCutCents(group, ttcCents, members[0].line.vatRate) };
    const solved = solveGroupWithRounding(members.map(({ line }) => line), target, { noNegative });
    if (!solved) return null;
    solved.forEach((line, i) => out.push({ at: i < members.length ? members[i].index : members[members.length - 1].index + 0.5, line }));
  }
  return out.sort((a, b) => a.at - b.at).map(({ line }) => {
    const { vatGroup, ...wire } = line;
    return wire;
  });
}

// `noNegative` (the folded fallback, sent after Qonto refused a negative line): the rounding line is positive too.
function toExcludingVat(lines, expectedTotalCents, { noNegative = false } = {}) {
  const grouped = lines.length > 0 && lines.every((l) => l.vatGroup != null);
  if (grouped && expectedTotalCents != null && lines.reduce((sum, l) => sum + l.amountCents, 0) === expectedTotalCents) {
    return toExcludingVatByGroup(lines, { noNegative });
  }
  if (expectedTotalCents == null || lines.length === 0) {
    return lines.map((l) => ({ ...l, amountCents: netFirstCents(l.amountCents, l.vatRate) }));
  }
  const solved = solveLines(lines, expectedTotalCents);
  if (solved) return solved;
  const rate = lines[0].vatRate;
  for (const cent of noNegative ? [1, 2] : [1, -1, 2, -2]) {
    const withRounding = solveLines([...lines, { title: ROUNDING_TITLE, amountCents: ttcOf(cent, rate), vatRate: rate }], expectedTotalCents);
    if (withRounding) return withRounding;
  }
  return null;
}

function wireItems(items, discount, expectedTotalCents = null) {
  const group = (it) => (it.vatGroup != null ? { vatGroup: it.vatGroup } : {});
  const lines = items.map((it) => ({
    title: it.title, ...(it.description ? { description: it.description } : {}), amountCents: it.amountCents, vatRate: it.vatRate, ...group(it),
  }));
  const all = !discount || !discount.amountCents
    ? lines
    : [...lines, {
      title: discount.title, amountCents: -Math.abs(discount.amountCents), vatRate: discount.vatRate, ...group(discount),
    }];
  return toExcludingVat(all, expectedTotalCents);
}

// Q3 — when Qonto refuses a negative line, the discount is folded into the lines, largest first, and named in their
// description: the total is the same, the reader still sees what was offered. Rule 48 — a line the discount covers
// whole is left out (never a 0 € line), the cents land on the positive lines only; none left = `null` (refused).
// Loop t4 B4-4 — a discount that names its VAT group folds into that group's lines only, so each group keeps the TTC its VAT is cut on.
function foldedItems(items, discount, expectedTotalCents = null) {
  let left = Math.abs(discount.amountCents);
  const folded = [...items]
    .sort((a, b) => b.amountCents - a.amountCents)
    .map((it) => {
      if (discount.vatGroup != null && it.vatGroup !== discount.vatGroup) return it;
      const cut = Math.min(left, it.amountCents);
      left -= cut;
      return cut > 0
        ? { ...it, amountCents: it.amountCents - cut, description: `${discount.title} : −${(cut / 100).toFixed(2).replace('.', ',')} €` }
        : it;
    })
    .filter((it) => it.amountCents > 0);
  if (folded.length === 0) return null;
  return toExcludingVat(folded, expectedTotalCents, { noNegative: true });
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
