/**
 * The visit of an outside client — the mini SAS of a booking with no stay (specs/outside-booking-sas.md rules 1-34).
 *
 * The plugin owns the screen, the session line and the slot; the money is the core's external sale (`standaloneSale`): one document per visit, named on the
 * booking by `saleRef = standalone:<id>`. This model only builds what the core is asked — the session line priced by the plugin's hourly pricing (a
 * `fulfilment` line, `fulfilmentRef = hourly-slot:<bookingId>`), the session already paid on the booking (rule 34, a `paidElsewhere` line), the client of
 * the visit — and reads the document back as the visit payload. It adds, subtracts and allocates nothing: totals, remaining amount, statuses and VAT
 * come from SETTLEMENT and the VAT component through `standaloneSale` (rule 4).
 *
 * When the document is born (C37 reading of rule 34): at the visit's first write — « Valider l'arrivée », a payment or a link asked from the mini SAS, or a
 * payment of the booking dialog once a document exists. A booking paid on its own columns before (legacy) keeps that money there: its session reads
 * « Payée » from those columns and the document holds only the extras sold from then on.
 *
 *   view(row, { reception, draft })     → the payload of GET /:id/visit and of the quote (§4.3); `draft` = the quote body
 *   commit(row, body, { actor })         « Valider l'arrivée » / « Enregistrer »: session, extras, payment and arrival in one transaction (rule 21)
 *   pay(row, body, { actor })            a payment on the reste (rules 16-19)
 *   patchLine(row, lineId, body)         « Offrir » / « Retirer » on a stored line (rules 13, 25)
 *   noShow(row)                          « Client absent » (rule 27)
 *   ensureDocument(row, { actor })       the document of the visit, created with its session line when it has none
 *   documentOf(row)                      the document payload with the legacy session, or null
 *   moneyOf(row)                         `{ totalCents, paidCents, remainingCents, payments }` of a booking whose money is on a document, else null
 *   repriceSession(row)                  the session line of an unpaid visit follows its booking's new slot (a retired line and a new one, journaled)
 */

const sdk = require('../sdk');

const SALE_REF = /^standalone:([1-9]\d*)$/;
const sessionRefOf = (bookingId) => `hourly-slot:${Number(bookingId)}`;
const originRefOf = (bookingId) => `resource-booking:${Number(bookingId)}`;
const saleIdOf = (row) => {
  const match = SALE_REF.exec(String((row && row.saleRef) || ''));
  return match ? Number(match[1]) : null;
};
// Rule 37 of the invoicing spec — `paid` is the truth of a payment taken on the booking's own columns.
const paidOnBooking = (row) => Number(row && row.paid) === 1;

const refuse = (status, code, error, extra = {}) => ({ status, code, error, ...extra });
const core = () => sdk.coreModule('standaloneSale');
const links = () => sdk.coreModule('standaloneSaleLinks');
const { toCents } = sdk.coreModule('money');

function createVisitModel({ db, bookings, now = () => new Date() }) {
  const resourceName = (row) => (db.prepare('SELECT name FROM resources WHERE id = ?').get(row.resourceId) || {}).name || 'Ressource';

  // The parts of a session as the hourly pricing wrote them: « Jour · 18:00–19:00 » « 1 h × 50,00 € », the free minutes, the offered time.
  const partsOf = (breakdown) => breakdown.lines.map((line) => ({
    key: line.key, label: line.label, detail: line.detail || '', amountCents: toCents(line.amount),
  }));

  /** The session line of the visit, priced by the plugin (rule 10) — or the refusal of its offered time (rule 13, invoicing rule 9). */
  function sessionDraft(row, { offeredMinutes, offered = false } = {}) {
    const minutes = offeredMinutes === undefined || offeredMinutes === null ? Number(row.offeredMinutes) || 0 : offeredMinutes;
    const priced = bookings().priceBooking({
      resourceId: row.resourceId, bookingId: row.id, date: row.date, startTime: row.startTime, endTime: row.endTime, propertyId: row.propertyId, offeredMinutes: minutes,
    });
    if (priced.error) return { refusal: refuse(priced.status || 400, 'SESSION_REFUSED', priced.error, { field: 'offeredMinutes' }) };
    const totalCents = toCents(priced.total);
    const parts = partsOf(priced);
    return {
      line: {
        articleRef: `resource:${Number(row.resourceId)}`,
        family: 'hourly',
        label: resourceName(row),
        detail: parts.map((part) => [part.label, part.detail].filter(Boolean).join(' · ')).join(' ; ') || null,
        quantity: 1,
        unitCents: totalCents,
        totalCents,
        catalogueCents: totalCents,
        offered: offered === true,
        vatClass: 'resources',
        components: parts,
        fulfilmentRef: sessionRefOf(row.id),
      },
      offeredMinutes: Number(minutes) || 0,
    };
  }

  // Rule 34 — the session paid on the booking before its document: « Payée », at the rate frozen with that payment.
  function legacySession(row) {
    if (!paidOnBooking(row)) return [];
    const basis = bookings().invoiceBasis(row.id);
    const breakdown = basis ? basis.breakdown : { lines: [], vat: null };
    return [{
      ref: originRefOf(row.id),
      articleRef: `resource:${Number(row.resourceId)}`,
      family: 'hourly',
      label: resourceName(row),
      quantity: 1,
      totalCents: toCents(row.totalPrice),
      vatClass: 'resources',
      vatRate: breakdown.vat ? Number(breakdown.vat.rate) : 0,
      components: partsOf(breakdown),
      fulfilmentRef: sessionRefOf(row.id),
    }];
  }

  const documentOf = (row) => {
    const saleId = saleIdOf(row);
    return saleId ? core().documentOf(saleId, { paidElsewhere: legacySession(row) }) : null;
  };

  // Is the session a line of the document already (not retired)?
  const storedSession = (document, row) => (document
    ? document.lines.find((line) => line.fulfilmentRef === sessionRefOf(row.id) && line.status !== 'cancelled' && line.id != null) || null
    : null);

  // The session the visit still has to sell: none when it is paid on the booking, already on the document (even retired: a no-show, a re-priced slot), or
  // the client did not come.
  function pendingSession(row, document, draft) {
    const sold = document && document.lines.some((line) => line.fulfilmentRef === sessionRefOf(row.id) && line.id != null);
    if (paidOnBooking(row) || sold || row.noShowAt) return { line: null };
    return sessionDraft(row, { offeredMinutes: draft && draft.offeredMinutes, offered: draft && draft.sessionOffered === true });
  }

  // Rule 8 — the client of the visit: the booking's registered client, else the typed e-mail (exact match) or « Passage »; the typed name kept for the receipt.
  function customerOf(row, draft = {}) {
    const typed = draft.customer && typeof draft.customer === 'object' ? draft.customer : {};
    if (row.clientId) return { clientId: row.clientId, email: typed.email };
    return {
      name: row.clientName || typed.name || '', email: typed.email, registerAsClient: typed.registerAsClient === true,
    };
  }

  // Rule 5 — the day window of the stay SAS: D 00:00 → D+1 04:00 (Europe/Paris), through the core's clock.
  function windowOf(row) {
    const reason = sdk.coreModule('sasEditWindow').sasLockReason({ stay: { startDate: row.date, endDate: row.date }, side: 'arrival', doneAt: null, now: now() });
    if (row.noShowAt) return { open: false, reason: 'noShow' };
    return { open: reason === null, reason };
  }

  const extrasOf = (draft) => (draft && Array.isArray(draft.extras) ? draft.extras : []).map((extra) => ({
    articleRef: extra && extra.articleRef, quantity: extra && extra.quantity, offered: Boolean(extra && extra.offered === true),
  }));

  function suggestionsOf(row) {
    try {
      return sdk.coreModule('suggestedArticles').resolve({ context: { kind: 'resource', id: String(row.resourceId) }, customerContext: 'external' });
    } catch { return []; }
  }

  // Rules 39-42 — the link block, read from the server: on the document once it exists, else what minting would answer.
  function linkOf(row, document, draft) {
    const saleId = saleIdOf(row);
    if (saleId) return links().linkOf(saleId, { now: now() });
    const email = (draft && draft.customer && draft.customer.email) || (row.clientId ? (db.prepare('SELECT email FROM clients WHERE id = ?').get(row.clientId) || {}).email : '');
    return links().draftLinkOf({ remainingCents: document ? document.totals.remainingCents : 0, email });
  }

  /** The visit payload (§4.3). `draft` (the quote body) adds the extras and the session's offered time; nothing is written. */
  function view(row, { reception = false, draft = null } = {}) {
    const saleId = saleIdOf(row);
    const stored = documentOf(row);
    const session = pendingSession(row, stored, draft);
    const refusals = session.refusal ? [{ field: session.refusal.field, code: session.refusal.code, error: session.refusal.error }] : [];
    const quoted = core().quote({
      saleId: saleId || undefined,
      lines: extrasOf(draft),
      fulfilments: session.line ? [session.line] : [],
      paidElsewhere: legacySession(row),
      customer: saleId ? undefined : customerOf(row, draft || {}),
    });
    if (quoted.status !== 200) return { status: quoted.status, body: quoted.body };
    refusals.push(...quoted.refusals.map((r) => ({ field: r.articleRef, code: r.code, error: r.message })));
    const document = quoted.document;
    const sale = saleId ? document.document : null;
    const totals = { ...document.totals };
    const lines = document.lines.map((line) => ({
      id: line.id,
      ref: line.ref,
      kind: line.kind,
      label: line.label,
      detail: line.detail,
      components: line.components,
      quantity: line.quantity,
      unitCents: line.unitCents,
      totalCents: line.totalCents,
      catalogueCents: line.catalogueCents,
      offered: line.offered,
      status: line.status,
      statusLabel: line.statusLabel,
      settledCents: line.settledCents,
      vatRate: line.vatRate,
      legacy: line.source === 'paidElsewhere',
      draft: line.id == null && line.source !== 'paidElsewhere',
    }));
    // Rule 7 — the reception sees the door money only: never a refund amount (reception-role-checkin-only rule 12bis).
    if (reception) delete totals.refundOwedCents;
    const payload = {
      booking: bookingView(row, { reception }),
      document: {
        ref: sale ? sale.ref : null,
        id: sale ? sale.id : null,
        status: sale ? sale.status : null,
        version: sale ? sale.version : 0,
        client: document.document.client,
      },
      lines,
      groups: document.groups,
      totals,
      vatByRate: document.vatByRate,
      suggestions: suggestionsOf(row),
      paymentLink: linkOf(row, document, draft),
      window: windowOf(row),
      invoice: row.qontoInvoiceId ? { number: row.invoiceNumber || null, cancelled: Boolean(row.invoiceCancelledAt) } : null,
      // Whether an invoice can be made now (invoicing rule 2): the server's answer, never guessed by the screen.
      invoiceReady: sdk.coreModule('invoiceIssuers').ready(),
      history: reception ? [] : (document.history || []),
      session: { offeredMinutes: session.line ? session.offeredMinutes : Number(row.offeredMinutes) || 0, editable: Boolean(session.line) },
    };
    if (draft) { payload.quoted = true; payload.refusals = refusals; }
    return { status: 200, body: payload };
  }

  // What the mini SAS shows of the booking. The reception gets the door fields only, no phone, no notes (AUTH-4).
  function bookingView(row, { reception }) {
    const booking = bookings().findById(row.id);
    if (!reception) return booking;
    const keep = ['id', 'resourceId', 'resourceName', 'date', 'startTime', 'endTime', 'displayName', 'offeredMinutes', 'arrived', 'external', 'frozen', 'noShowAt', 'cardState'];
    return Object.fromEntries(keep.filter((key) => key in booking).map((key) => [key, booking[key]]));
  }

  const setSaleRef = (row, saleId) => db.prepare("UPDATE resource_bookings SET saleRef = ?, updatedAt = datetime('now') WHERE id = ?").run(`standalone:${Number(saleId)}`, row.id);

  // Runs `work` in one transaction; a refusal thrown inside rolls every write back and is returned.
  function inTransaction(work) {
    const stop = (refusal) => { const err = new Error('refused'); err.refusal = refusal; throw err; };
    try {
      let out = null;
      db.transaction(() => { out = work(stop); })();
      return out;
    } catch (err) {
      if (err && err.refusal) return err.refusal;
      throw err;
    }
  }

  const fromCore = (result) => ({ status: result.status, code: result.body.code, error: result.body.error, ...(result.body.refusals ? { refusals: result.body.refusals } : {}), ...(result.body.field ? { field: result.body.field } : {}) });

  // The document of the visit, created with its session line when the booking has none (and its session is not paid on the booking).
  function ensureDocument(row, { actor = null, stop, draft = {} } = {}) {
    const existing = saleIdOf(row);
    if (existing) return existing;
    if (paidOnBooking(row)) return null;
    const session = sessionDraft(row, { offeredMinutes: draft.offeredMinutes, offered: draft.sessionOffered === true });
    if (session.refusal) return stop(session.refusal);
    const sold = core().sell({
      fulfilments: [session.line], customer: customerOf(row, draft), originRef: originRefOf(row.id), source: 'visit',
    }, { actor, now: now() });
    if (sold.status !== 200) return stop(fromCore(sold));
    setSaleRef(row, sold.document.document.id);
    return sold.document.document.id;
  }

  // Rule 22 — once arrived, the version of the document guards two devices on the same visit.
  function versionRefusal(row, version) {
    const saleId = saleIdOf(row);
    if (!saleId || version === undefined || version === null) return null;
    const document = core().documentOf(saleId);
    return document && Number(document.document.version) !== Number(version)
      ? refuse(409, 'PRICE_CHANGED', 'Prix modifié — relire le panier')
      : null;
  }

  // The booking's own offered minutes follow the session line sold (the slot never moves here, invoicing Q10).
  function keepOfferedMinutes(row, minutes) {
    if (Number(row.offeredMinutes || 0) === Number(minutes || 0)) return null;
    const moved = bookings().update(row.id, { offeredMinutes: minutes });
    return moved.error ? refuse(moved.status, moved.code || 'SESSION_REFUSED', moved.error, { field: 'offeredMinutes' }) : null;
  }

  /**
   * Rule 21 — « Valider l'arrivée » (first commit) or « Enregistrer » (reopened): the session line when it is not sold yet, the extras (appended,
   * rule 12), the payment and its allocations, the arrival mark — one transaction, the quote re-run inside it (`acceptedTotalCents`, `version`).
   */
  function commit(row, body = {}, { actor = null } = {}) {
    const stale = versionRefusal(row, body.version);
    if (stale) return stale;
    return inTransaction((stop) => {
      const saleId = saleIdOf(row);
      const stored = documentOf(row);
      const session = pendingSession(row, stored, body);
      if (session.refusal) stop(session.refusal);
      if (session.line) {
        const kept = keepOfferedMinutes(row, session.offeredMinutes);
        if (kept) stop(kept);
      } else if (body.offeredMinutes !== undefined && body.offeredMinutes !== null && Number(body.offeredMinutes) !== Number(row.offeredMinutes || 0)) {
        stop(refuse(409, 'SESSION_SOLD', 'Séance déjà enregistrée : l’offrir en entier si besoin.', { field: 'offeredMinutes' }));
      }
      const extras = extrasOf(body);
      if (body.payment && !saleId && !session.line && !extras.length) stop(refuse(409, 'NOTHING_DUE', 'Rien à encaisser.'));
      const sells = saleId || session.line || extras.length;
      if (sells) {
        const sold = core().sell({
          saleId: saleId || undefined,
          lines: extras,
          fulfilments: session.line ? [session.line] : [],
          paidElsewhere: legacySession(row),
          customer: saleId ? undefined : customerOf(row, body),
          acceptedTotalCents: body.acceptedTotalCents,
          originRef: originRefOf(row.id),
          source: 'visit',
          payment: body.payment || undefined,
        }, { actor, now: now() });
        if (sold.status !== 200) stop(fromCore(sold));
        if (!saleId) setSaleRef(row, sold.document.document.id);
      }
      db.prepare("UPDATE resource_bookings SET arrivedAt = COALESCE(arrivedAt, datetime('now')), updatedAt = datetime('now') WHERE id = ?").run(row.id);
      return { ok: true };
    });
  }

  /** Rules 16-19, 22 — a payment on the reste after the visit was opened: SETTLEMENT allocates it, a shortfall stays « à percevoir ». */
  function pay(row, body = {}, { actor = null } = {}) {
    return inTransaction((stop) => {
      const saleId = ensureDocument(row, { actor, stop });
      if (!saleId) stop(refuse(409, 'NOTHING_DUE', 'Rien à encaisser.'));
      const paid = core().pay(saleId, {
        tenders: body.tenders, shortfall: body.shortfall || null, paidAt: body.paidAt, version: body.version, actor,
      });
      if (paid.status !== 200) stop(fromCore(paid));
      return { ok: true };
    });
  }

  /**
   * Rules 13, 25 — « Offrir » / « Offert » or « Retirer » on a stored line of the document. A line already paid answers 409 `LINE_PAID` until the
   * administrator confirms the refund it owes (`confirmRefund`); the reception never gets that far (the controller's 403).
   */
  function patchLine(row, lineId, body = {}) {
    const saleId = saleIdOf(row);
    if (!saleId) return refuse(404, 'LINE_NOT_FOUND', 'Ligne introuvable.');
    // The session is the booking's: it is offered, or the booking deleted (rule 26) — never retired alone from the visit.
    const session = storedSession(documentOf(row), row);
    if (body.remove === true && session && Number(session.id) === Number(lineId)) {
      return refuse(409, 'SESSION_LINE', 'La séance se retire en supprimant la réservation.');
    }
    const options = { confirmRefund: body.confirmRefund === true, version: body.version };
    const result = body.remove === true
      ? core().removeLine(saleId, lineId, options)
      : core().offerLine(saleId, lineId, { ...options, offered: body.offered !== false });
    return result.status === 200 ? { ok: true } : fromCore(result);
  }

  /** Is the line paid, even in part? The reception may not touch it (rule 7). */
  function linePaid(row, lineId) {
    const document = documentOf(row);
    const line = document && document.lines.find((l) => Number(l.id) === Number(lineId));
    return Boolean(line && line.settledCents > 0);
  }

  /**
   * Rule 27 — « Client absent »: the visit closes without arrival. The unpaid lines are retired (a line partly paid stays as it is, its money too), the
   * open link withdrawn, the slot kept on the planning marked « Absent ». A refund of money taken is an explicit admin action (rule 25).
   */
  async function noShow(row) {
    if (row.arrivedAt) return refuse(409, 'BOOKING_ARRIVED', 'Arrivée déjà enregistrée.');
    if (row.noShowAt) return { ok: true };
    if (sdk.coreModule('sasEditWindow').sasLockReason({ stay: { startDate: row.date, endDate: row.date }, side: 'arrival', doneAt: null, now: now() }) === 'future') {
      return refuse(409, 'NO_SHOW_TOO_EARLY', 'Client absent : à partir du jour de la séance.');
    }
    const saleId = saleIdOf(row);
    if (saleId) {
      const open = links().linkOf(saleId, { now: now() });
      if (open && open.open) await links().withdraw(saleId, open.open.id, { now: now() });
    }
    return inTransaction((stop) => {
      if (saleId) {
        const document = core().documentOf(saleId);
        for (const line of document.lines) {
          if (line.status !== 'due' || line.settledCents > 0) continue;
          const removed = core().removeLine(saleId, line.id, {});
          if (removed.status !== 200) stop(fromCore(removed));
        }
      }
      db.prepare("UPDATE resource_bookings SET noShowAt = ?, updatedAt = datetime('now') WHERE id = ?").run(now().toISOString(), row.id);
      return { ok: true };
    });
  }

  /** The money of a booking whose session or extras live on a document (rule 34), for the planning card, the booking dialog and the invoice. */
  function moneyOf(row) {
    const saleId = saleIdOf(row);
    if (!saleId) return null;
    const document = documentOf(row);
    if (!document) return null;
    return {
      saleId,
      totalCents: document.totals.totalCents,
      paidCents: document.totals.paidCents,
      remainingCents: document.totals.remainingCents,
      sessionOnDocument: Boolean(storedSession(document, row)),
      payments: core().paymentsOf(saleId),
      document,
    };
  }

  /**
   * Edge case of §3 — a booking moved after its session was sold is re-priced only while the session line is unpaid: the line is retired and the new
   * price appended, both journaled on the document (rule 23: explicit actions, never a rewrite). A paid session answers 409 `BOOKING_PAID`.
   */
  function repriceSession(row, { actor = null } = {}) {
    const saleId = saleIdOf(row);
    const document = documentOf(row);
    const line = storedSession(document, row);
    if (!line) return { ok: true };
    if (line.settledCents > 0) return refuse(409, 'BOOKING_PAID', 'Le prix change : la séance est déjà payée.');
    const fresh = sessionDraft(row, { offered: line.offered });
    if (fresh.refusal) return fresh.refusal;
    if (fresh.line.totalCents === line.catalogueCents) return { ok: true };
    const removed = core().removeLine(saleId, line.id, {});
    if (removed.status !== 200) return fromCore(removed);
    const sold = core().sell({ saleId, lines: [], fulfilments: [fresh.line], originRef: originRefOf(row.id), source: 'visit' }, { actor, now: now() });
    return sold.status === 200 ? { ok: true } : fromCore(sold);
  }

  /** Rule 26 — the booking of an unpaid visit is deleted with its document cancelled; a visit holding money is never deleted. */
  function cancelDocument(row) {
    const saleId = saleIdOf(row);
    if (!saleId) return { ok: true };
    // What the document itself collected (a session paid on the booking is not the document's money).
    if (core().documentOf(saleId).totals.paidCents > 0) {
      return refuse(409, 'BOOKING_PAID', 'Payée : un remboursement par l’administrateur avant de supprimer.');
    }
    const cancelled = core().cancel(saleId);
    return cancelled.status === 200 ? { ok: true } : fromCore(cancelled);
  }

  return {
    view, commit, pay, patchLine, linePaid, noShow, ensureDocument, documentOf, moneyOf, repriceSession, cancelDocument, windowOf, inTransaction, saleIdOf, paidOnBooking,
  };
}

module.exports = {
  createVisitModel, saleIdOf, sessionRefOf, originRefOf,
};
