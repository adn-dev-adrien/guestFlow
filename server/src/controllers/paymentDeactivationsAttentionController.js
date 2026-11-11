/**
 * The payment links still payable at the provider because their deactivation is owed
 * (specs/payment-link-lifecycle.md rule 67), as the home's attention subject `payment-deactivations` reads them.
 * Whatever path withdrew the link (orphan, taken dates, amount changed, settled, superseded, lapsed), the
 * marker `remoteCancelPendingAt` is the single source: the poll retries it while the provider is connected,
 * and the link stays listed until the provider has deactivated it.
 */
const paymentProviders = require('../utils/paymentProviders');
const { formatEuros } = require('../utils/reservationLedger');

// The words of each row, shaped here: the card only draws them (fat backend). Short, impersonal.
const KIND_LABELS = { deposit: 'Acompte', balance: 'Solde', full: 'Paiement total', installment: 'Échéance', complement: 'Complément' };
const REASON_LABELS = {
  orphan: 'Fiche supprimée',
  'stay-cancelled': 'Séjour annulé',
  superseded: 'Doublon écarté',
  'dates-taken': 'Dates prises',
  operator: 'Retiré à la main',
  settled: 'Perçu autrement',
  'amount-changed': 'Montant modifié',
  validity: 'Validité dépassée',
  'stay-started': 'Séjour commencé',
  refunded: 'Remboursé',
};
const frDate = (value) => {
  const ms = Date.parse(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(String(value)) ? `${String(value).replace(' ', 'T')}Z` : String(value || ''));
  if (!(ms > 0)) return null;
  return new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(ms));
};

// What the row's `reservationId` really names, and where it opens (the client's own convention, DevisPage.editPathOf):
// a live stay → its fiche; a devis not converted → the devis editor; a converted devis → the stay it became, shown with both
// numbers; a row that is gone, or a devis whose stay is gone, has nothing to open. Never a raw row id behind « Séjour n° »
// for a devis (that id answers 404 on /reservations/:id).
function subjectOf(link) {
  const id = Number(link.reservationId);
  if (link.stayMissing) return { label: `Fiche n° ${id}`, url: null };
  if (link.stayKind !== 'devis') {
    return { label: `Séjour ${link.reservationNumber || `n° ${id}`}`, url: `/reservations/${id}` };
  }
  const devis = `Devis ${link.devisNumber || `n° ${id}`}`;
  if (link.convertedReservationId == null) return { label: devis, url: `/reservations/new?mode=devis&devisId=${id}` };
  if (link.convertedStayId == null) return { label: devis, url: null };
  const stay = Number(link.convertedStayId);
  return { label: `${devis} · séjour ${link.convertedNumber || `n° ${stay}`}`, url: `/reservations/${stay}` };
}

const capitalised = (id) => String(id || '').replace(/^./, (c) => c.toUpperCase());

/** → { links: [{ id, reservationId, type, amountCents, provider, providerLabel, stayMissing, retrying, kindLabel, amountLabel,
 *   reference, stayLabel, stayUrl, reasonLabel, sinceLabel }], retrying } */
function owedDeactivations(model, providers = paymentProviders, now = new Date()) {
  const live = providers.active();
  const declared = providers.declared();
  const labelOf = (id) => {
    if (declared && declared.id === id) return declared.label;
    return capitalised(id);
  };
  const links = model.listOwedDeactivations({ now }).map((link) => {
    const subject = subjectOf(link);
    return {
      id: link.id,
      reservationId: link.reservationId,
      type: link.type,
      amountCents: link.amountCents,
      provider: link.provider,
      providerLabel: labelOf(link.provider),
      stayMissing: link.stayMissing,
      retrying: Boolean(live && live.id === link.provider),
      kindLabel: KIND_LABELS[link.type] || 'Paiement',
      amountLabel: formatEuros(Number(link.amountCents || 0) / 100),
      reference: link.providerLinkId,
      stayLabel: subject.label,
      stayUrl: subject.url,
      reasonLabel: REASON_LABELS[link.reason] || 'Retiré',
      // The date is the withdrawal of the link, or the end of its validity: never the date the stay went away.
      sinceLabel: frDate(link.since)
        ? `${link.status === 'expired' || link.reason === 'validity' ? 'fin de validité' : 'lien retiré'} le ${frDate(link.since)}`
        : null,
    };
  });
  return { links, retrying: links.filter((l) => l.retrying).length };
}

/** Express handler: the attention source and the card's own list (GET /api/dashboard/payment-deactivations). */
const handler = (model, providers = paymentProviders) => (req, res) => res.json(owedDeactivations(model, providers));

module.exports = { owedDeactivations, handler };
