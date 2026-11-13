// Shared fixtures of the mini SAS suites (specs/outside-booking-sas.md §7): a visit payload as `GET /:id/visit` answers it, and a stand-in for the server's quote so a suite can
// drive the draft. The stand-in prices only what the suites ask for; the dialog under test renders what it answers and computes nothing.
export const BOOKING = {
  id: 5, resourceId: 3, resourceName: 'Bain nordique', date: '2099-02-13', startTime: '18:00', endTime: '20:00', propertyId: null,
  displayName: 'Claire Martin', external: true, arrived: false, paid: false, frozen: false, payment: null, invoice: null, noShowAt: null,
  offeredMinutes: 0, totalPrice: 120, billing: { street: '', postcode: '', city: '' }, clientId: null,
};

export const CATALOGUE = {
  'option:7': { label: 'Bière locale', unitCents: 650, max: 12 },
  'option:8': { label: 'Limonade', unitCents: 400, max: 12 },
};

export const SUGGESTIONS = [
  { articleRef: 'option:7', label: 'Bière locale', unitCents: 650, max: 12 },
  { articleRef: 'option:8', label: 'Limonade', unitCents: 400, max: 12 },
];

export const sessionLine = (over = {}) => ({
  id: null, ref: 'draft:0', kind: 'session', label: 'Bain nordique', detail: null,
  components: [
    { key: 'band:day', label: 'Jour · 18:00–19:00', detail: '1 h × 50,00 €', amountCents: 5000 },
    { key: 'band:evening', label: 'Soir · 19:00–20:00', detail: '1 h × 70,00 €', amountCents: 7000 },
  ],
  quantity: 1, unitCents: 12000, totalCents: 12000, catalogueCents: 12000, offered: false, status: 'due', statusLabel: 'À payer', settledCents: 0, vatRate: 20, legacy: false, draft: true, ...over,
});

export const visitPayload = (over = {}) => ({
  booking: BOOKING,
  document: { ref: null, id: null, status: null, version: 0, client: { id: 1, label: 'Passage', kind: 'passage' } },
  lines: [sessionLine()],
  groups: [],
  totals: {
    totalCents: 12000, paidCents: 0, remainingCents: 12000, refundOwedCents: 0,
  },
  vatByRate: [{ rate: 20, vatCents: 2000 }],
  suggestions: SUGGESTIONS,
  paymentLink: {
    available: false, reason: 'PROVIDER_NOT_READY', email: null, open: null,
  },
  window: { open: true, reason: null },
  access: { writable: true, reason: null, reception: false },
  invoice: null,
  invoiceReady: true,
  history: [],
  session: { offeredMinutes: 0, editable: true },
  ...over,
});

// The server's quote, reduced to what the suites exercise: the session (its offered time, offered whole), the extras at the catalogue price, the quantity bound.
export function fakeQuote(base = visitPayload()) {
  return async (_id, body) => {
    const minutes = body.offeredMinutes || 0;
    const sessionTotal = body.sessionOffered ? 0 : 12000 - Math.round((minutes / 60) * 5000);
    const lines = base.lines.map((line) => (line.kind === 'session' && line.draft ? {
      ...line,
      totalCents: sessionTotal,
      offered: Boolean(body.sessionOffered),
      components: minutes ? [...line.components, { key: 'offered', label: 'Temps offert', detail: `${minutes} min`, amountCents: -(12000 - sessionTotal) }] : line.components,
    } : line));
    const refusals = [];
    (body.extras || []).forEach((extra, index) => {
      const article = CATALOGUE[extra.articleRef];
      if (!article) return;
      if (!(extra.quantity >= 1 && extra.quantity <= article.max)) {
        refusals.push({ field: extra.articleRef, code: 'QUANTITY_OUT_OF_BOUNDS', error: `Quantité : 1 à ${article.max}.` });
        return;
      }
      const catalogueCents = extra.quantity * article.unitCents;
      lines.push({
        id: null, ref: `draft:${index + 1}`, kind: 'extra', label: article.label, detail: `${extra.quantity} × ${(article.unitCents / 100).toFixed(2).replace('.', ',')} €`,
        components: [], quantity: extra.quantity, unitCents: article.unitCents, totalCents: extra.offered ? 0 : catalogueCents, catalogueCents,
        offered: Boolean(extra.offered), status: extra.offered ? 'offered' : 'due', statusLabel: extra.offered ? 'Offerte' : 'À payer', settledCents: 0, vatRate: 20, legacy: false, draft: true,
      });
    });
    const totalCents = lines.filter((l) => l.status !== 'cancelled').reduce((sum, l) => sum + l.totalCents, 0);
    const paidCents = base.totals.paidCents;
    return {
      ...base,
      lines,
      totals: { ...base.totals, totalCents, remainingCents: totalCents - paidCents },
      vatByRate: [{ rate: 20, vatCents: Math.round((totalCents * 20) / 120) }],
      quoted: true,
      refusals,
    };
  };
}
