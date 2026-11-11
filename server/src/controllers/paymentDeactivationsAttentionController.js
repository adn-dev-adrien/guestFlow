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
  orphan: 'Séjour supprimé',
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
  const links = model.listOwedDeactivations({ now }).map((link) => ({
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
    stayLabel: link.stayMissing
      ? `Séjour n° ${link.reservationId}`
      : `Séjour ${link.reservationNumber || `n° ${link.reservationId}`}`,
    stayUrl: link.stayMissing ? null : `/reservations/${Number(link.reservationId)}`,
    reasonLabel: REASON_LABELS[link.reason] || 'Retiré',
    // The date is the withdrawal of the link, or the end of its validity: never the date the stay went away.
    sinceLabel: frDate(link.since)
      ? `${link.status === 'expired' || link.reason === 'validity' ? 'fin de validité' : 'lien retiré'} le ${frDate(link.since)}`
      : null,
  }));
  return { links, retrying: links.filter((l) => l.retrying).length };
}

/** Express handler: the attention source and the card's own list (GET /api/dashboard/payment-deactivations). */
const handler = (model, providers = paymentProviders) => (req, res) => res.json(owedDeactivations(model, providers));

module.exports = { owedDeactivations, handler };
