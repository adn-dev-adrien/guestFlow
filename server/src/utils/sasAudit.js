/**
 * Arrival / departure SAS → « Historique des modifications » of the reservation.
 *
 * specs/arrival-departure-sas.md §3.7. Everything the SAS records (caution, upsells, linen elements,
 * breakfast, complements, extinguisher, handover note) used to land in the DB with no trace in the
 * fiche's history, so a « who changed this? » question had no answer for the very moments where the
 * most money changes hands.
 *
 * Same contract as the fiche audit (utils/reservationAudit.js): a snapshot before, a snapshot after,
 * and a labeled diff `[{ field, label, fromText, toText }]` stored via `model.addHistoryEntry`. The
 * texts are rendered French-side here (the SAS records booleans and amounts, not raw column values),
 * so the client only prints them.
 *
 * Pure: takes plain rows, no DB access.
 */

const SAS_FIELD_LABELS = {
  cautionReceived: 'Caution reçue',
  cautionReturned: 'Caution restituée',
  cleaningOption: 'Ménage',
  bathLinenOption: 'Linge de toilette',
  soldOptions: 'Prestations vendues au check-in',
  complementAmount: 'Complément à percevoir',
  complementPaid: 'Complément encaissé',
  complementDeferredToCheckout: 'Complément reporté en fin de séjour',
  endOfStayComplementAmount: 'Complément de fin de séjour',
  endOfStayComplementPaid: 'Complément de fin de séjour encaissé',
  endOfStayComplementDetail: 'Détail fin de séjour',
  breakfast: 'Petit déjeuner',
  breakfastTime: 'Heure du petit déjeuner',
  breakfastNote: 'Note petit déjeuner',
  departureHandoverNote: 'Note pour le départ',
  extinguisherSealOkAtArrival: 'Extincteur à l\'arrivée',
  extinguisherSealOkAtDeparture: 'Extincteur au départ',
  linenItems: 'Éléments de linge facturés',
};

const money = (amount) => {
  const value = Math.round((Number(amount) || 0) * 100) / 100;
  const text = Number.isInteger(value) ? String(value) : value.toFixed(2).replace('.', ',');
  return `${text} €`;
};

const yesNo = (v) => (Number(v) === 1 || v === true ? 'oui' : 'non');
const takenOrNot = (v) => (v ? 'pris' : 'non pris');
const sealText = (v) => (v == null ? 'non renseigné' : (Number(v) === 1 ? 'plomb présent' : 'plomb absent'));
const textOrDash = (v) => {
  const s = (v == null ? '' : String(v)).trim();
  return s === '' ? '—' : s;
};

// « 2 café, 1 thé, 4 viennoiseries, 1,5 baguette » — only what is non-zero, so an untouched breakfast
// produces no line at all instead of a wall of zeros.
function breakfastText(row) {
  const parts = [
    [row.breakfastCoffee, 'café'], [row.breakfastTea, 'thé'], [row.breakfastChocolate, 'chocolat'],
    [row.breakfastMilk, 'lait'], [row.breakfastPastries, 'viennoiserie(s)'], [row.breakfastCereals, 'céréales'],
    [row.breakfastBread, 'baguette(s)'],
  ]
    .filter(([n]) => Number(n) > 0)
    .map(([n, label]) => `${String(Number(n)).replace('.', ',')} ${label}`);
  return parts.length > 0 ? parts.join(', ') : 'aucun';
}

// Line items billed by the SAS, as « Serviette de bain ×2 (16 €) ». Accepts the end-of-stay detail
// array or the SAS-origin custom rows; both carry `{ label|description, amount, qty }`.
// specs/sas-offer-complement-lines.md §3.5 — an offered line reads « Ménage ×1 (offert) »: the history
// is where the operator later checks what was given away, so the gesture must be spelled out.
function itemsText(lines) {
  const list = (lines || [])
    .map((l) => {
      const label = String((l && (l.label ?? l.description)) || '').trim();
      const qty = Number(l && l.qty) > 1 ? ` ×${Number(l.qty)}` : '';
      // How the quantity was reached, when it is not obvious — « 1 × 2 pers. servies » for a card
      // option sold to part of the table only (specs/card-option-served-persons.md §3.3 rule 15).
      const detail = (l && typeof l.detail === 'string' && l.detail.trim()) ? ` — ${l.detail.trim()}` : '';
      const value = Number(l && l.offered) === 1 ? 'offert' : money(l && l.amount);
      return label ? `${label}${qty}${detail} (${value})` : '';
    })
    .filter(Boolean);
  return list.length > 0 ? list.join(', ') : 'aucun';
}

/**
 * Snapshot of everything a SAS commit can touch. `row` = the `reservations` row; `extras` carries the
 * derived facts the row alone can't express (which catalogue upsells are attached, the billed lines).
 */
function buildSasSnapshot(row, extras = {}) {
  const r = row || {};
  return {
    cautionReceived: yesNo(r.cautionReceived),
    cautionReturned: yesNo(r.cautionReturned),
    cleaningOption: takenOrNot(extras.cleaningPresent),
    bathLinenOption: takenOrNot(extras.bathLinenPresent),
    // specs/sas-breakfast-and-catering-upsell.md §3.5 — the prestations the check-in sold (petit
    // déjeuner, restauration), so the fiche history says what was added and for how much.
    soldOptions: itemsText(extras.soldOptionLines),
    complementAmount: money(r.complementAmount),
    complementPaid: yesNo(r.complementPaid),
    complementDeferredToCheckout: yesNo(r.complementDeferredToCheckout),
    endOfStayComplementAmount: money(r.endOfStayComplementAmount),
    endOfStayComplementPaid: yesNo(r.endOfStayComplementPaid),
    endOfStayComplementDetail: itemsText(extras.endOfStayLines),
    breakfast: breakfastText(r),
    breakfastTime: textOrDash(r.breakfastTime),
    breakfastNote: textOrDash(r.breakfastNote),
    departureHandoverNote: textOrDash(r.departureHandoverNote),
    extinguisherSealOkAtArrival: sealText(r.extinguisherSealOkAtArrival),
    extinguisherSealOkAtDeparture: sealText(r.extinguisherSealOkAtDeparture),
    linenItems: itemsText(extras.linenLines),
  };
}

/** Labeled diff of two SAS snapshots, in the declared field order. Empty when nothing moved. */
function computeSasChanges(before, after) {
  const changes = [];
  for (const field of Object.keys(SAS_FIELD_LABELS)) {
    const from = before ? before[field] : undefined;
    const to = after ? after[field] : undefined;
    if (from === to) continue;
    changes.push({ field, label: SAS_FIELD_LABELS[field], fromText: from ?? '—', toText: to ?? '—' });
  }
  return changes;
}

module.exports = { SAS_FIELD_LABELS, buildSasSnapshot, computeSasChanges };
