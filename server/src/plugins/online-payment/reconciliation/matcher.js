/**
 * Proposals of the bank reconciliation (specs/qonto-bank-reconciliation.md rules 11–17, 29–32).
 *
 * Pure: credits × open receipts × the operator's discards → for each credit, the best proposal and its
 * alternatives. A proposal is never a decision (rule 11). No platform puts the booking number in its
 * transfer (§1), so the matching is by platform, amount and date; every figure of the fiche stays the
 * core ledger's.
 */

const CONFIDENCE_RANK = { sur: 3, probable: 2, verifier: 1 };
const MAX_SUBSET = 6;
const MAX_CANDIDATES = 22;
const MAX_NODES = 250000;
const MAX_EARLY_DAYS = 400;
const MS_DAY = 24 * 60 * 60 * 1000;

const DEFAULT_PATTERNS = Object.freeze({
  Booking: ['booking.com'],
  Airbnb: ['airbnb'],
  GitesDeFrance: ['gites de france', 'gites de fr'],
  Greengo: ['greengo'],
  Abracadaroom: ['mangopay+domainesolio'],
  Abritel: ['abritel'],
  Lodgify: ['ref=stripe'],
});
const DEFAULT_BATCH_PLATFORMS = Object.freeze(['Lodgify']);

const normalize = (s) => String(s == null ? '' : s)
  .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9.=+]+/g, ' ').trim();
const { day } = require('./dates');

// A platform is the same whatever its stored spelling (`Airbnb` / `AirBnb`, `GitesDeFrance` /
// `Gitesdefrance`): patterns, batch list and receipts are compared by slug, never by exact name.
const platformSlug = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const dayNumber = (iso) => (iso ? Math.floor(Date.parse(`${iso}T00:00:00Z`) / MS_DAY) : null);
const daysBetween = (a, b) => (day(a) && day(b) ? dayNumber(day(b)) - dayNumber(day(a)) : null);

const textOf = (tx) => normalize([tx.counterpartyName, tx.label, tx.reference, tx.note].join(' '));
// A payment-link payout is net of the acquirer's rounding; every other channel must match to the cent.
const toleranceOf = (r) => (r.channel === 'link' ? 1 : 0);
const keyOf = (r) => `${r.reservationId}|${r.ledgerKey}`;

/** `a+b` = both substrings; `ref=x` = the reference, normalised, equals x. */
function patternMatches(pattern, tx) {
  const text = textOf(tx);
  return String(pattern).split('+').every((part) => {
    const p = part.trim().toLowerCase();
    if (p.startsWith('ref=')) return normalize(tx.reference) === normalize(p.slice(4));
    return text.includes(normalize(p));
  });
}

function classify(tx, settings) {
  const patterns = settings.patterns || DEFAULT_PATTERNS;
  for (const [platform, list] of Object.entries(patterns)) {
    if ((list || []).some((p) => patternMatches(p, tx))) {
      // A cancellation compensation (« … ANNUL ») is not a stay's payout (spec §8).
      return /\bannul/.test(normalize(tx.reference)) ? { kind: 'other' } : { kind: 'platform', platform };
    }
  }
  if (tx.operationType === 'card_acquirer_payout' || /mollie/.test(textOf(tx))) return { kind: 'acquiring' };
  const m = /paiements?-en-personne-(\d{2})-(\d{2})-(\d{4})/i.exec(String(tx.reference || ''));
  if (m) return { kind: 'cardBatch', date: `${m[3]}-${m[2]}-${m[1]}` };
  return { kind: 'other' };
}

/** The smallest combination (≤ MAX_SUBSET) of items whose sum is within `tolerance` of `target`. */
function smallestSubset(items, target, tolerance) {
  const list = [...items].sort((a, b) => b.cents - a.cents).slice(0, MAX_CANDIDATES);
  let nodes = 0;
  let best = null;
  const walk = (start, chosen, sum) => {
    if (best && chosen.length >= best.length) return;
    if (chosen.length > 0 && Math.abs(sum - target) <= tolerance(chosen)) { best = chosen; return; }
    if (chosen.length >= MAX_SUBSET || nodes > MAX_NODES) return;
    for (let i = start; i < list.length; i += 1) {
      nodes += 1;
      if (sum + list[i].cents > target + tolerance([...chosen, list[i]])) continue;
      walk(i + 1, [...chosen, list[i]], sum + list[i].cents);
    }
  };
  walk(0, [], 0);
  return best;
}

const proposal = (tx, items, confidence, source, reason, extra = {}) => ({
  id: `${tx.id}:${items.map((i) => keyOf(i.receipt)).join(',')}`,
  transactionId: tx.id, confidence, source, reason,
  allocations: items.map((i) => ({ reservationId: i.receipt.reservationId, ledgerKey: i.receipt.ledgerKey, amountCents: i.allocCents })),
  ...extra,
});

/** Rules 13, 14, 32 — a recognised platform payout. */
function platformProposals(tx, platform, receipts, settings) {
  const settled = day(tx.settledAt);
  const mine = receipts.filter((r) => String(r.channel || '').startsWith('platform:')
    && platformSlug(String(r.channel).slice('platform:'.length)) === platformSlug(platform) && r.openCents > 0);
  // A fiche is often typed after the money moved, so its creation date says nothing: the window is
  // anchored on the expected date alone (Abracadaroom pays at booking time, months before the stay).
  const inWindow = (r) => {
    if (!settled) return true;
    const anchor = r.expectedDate || r.dueDate;
    const delta = anchor ? daysBetween(anchor, settled) : 0;
    return delta <= 30 && delta >= -MAX_EARLY_DAYS;
  };
  const candidates = mine.filter(inWindow);
  const out = [];
  const recorded = candidates.filter((r) => r.payoutRecorded);
  const batch = (settings.batchPlatforms || DEFAULT_BATCH_PLATFORMS).some((b) => platformSlug(b) === platformSlug(platform));

  if (batch) {
    const recent = mine.filter((r) => {
      const at = r.paidDate || r.expectedDate;
      const d = settled && at ? daysBetween(at, settled) : 0;
      return d >= -3 && d <= 10;
    });
    const fee = (Number(settings.cardFeePercent) || 0) / 100;
    const items = recent.map((r) => ({ receipt: r, cents: r.payoutRecorded ? r.openCents : Math.round(r.openCents * (1 - fee)), estimated: !r.payoutRecorded }));
    const found = smallestSubset(items, tx.remainingCents, (chosen) => (chosen.some((c) => c.estimated)
      ? Math.round(tx.remainingCents * 0.01) : chosen.length));
    if (found) {
      const single = found.length === 1 && !found[0].estimated;
      out.push(proposal(tx, found.map((f) => ({ receipt: f.receipt, allocCents: f.cents })), single ? 'sur' : 'probable', 'platform-batch',
        found.length === 1 ? `Lot de ${platform} : un seul paiement correspond` : `Lot de ${platform} : ${found.length} paiements de la semaine`));
    }
    return out;
  }

  const exact = recorded.filter((r) => Math.abs(r.openCents - tx.remainingCents) <= toleranceOf(r));
  exact.forEach((r) => out.push(proposal(tx, [{ receipt: r, allocCents: tx.remainingCents }], exact.length === 1 ? 'sur' : 'verifier', 'platform',
    exact.length === 1 ? `Seul versement ${platform} de ce montant` : `Plusieurs séjours ${platform} au même montant`)));
  if (exact.length === 0) {
    const subset = smallestSubset(recorded.map((r) => ({ receipt: r, cents: r.openCents })), tx.remainingCents, () => 0);
    if (subset && subset.length > 1) {
      out.push(proposal(tx, subset.map((s) => ({ receipt: s.receipt, allocCents: s.cents })), 'probable', 'platform',
        `Versement groupé de ${subset.length} séjours ${platform}`));
    }
  }
  // Rule 32 — a payout the fiche does not carry yet is still a candidate, behind the recorded ones.
  const rate = (Number((settings.commissionRates || {})[platform]) || 0) / 100;
  candidates.filter((r) => !r.payoutRecorded).forEach((r) => {
    const guesses = [r.grossCents, Math.round(r.grossCents * (1 - rate))];
    if (guesses.some((g) => g > 0 && Math.abs(g - tx.remainingCents) <= Math.round(g * 0.01))) {
      out.push(proposal(tx, [{ receipt: r, allocCents: tx.remainingCents }], 'verifier', 'platform-unrecorded',
        'Versement non saisi sur la fiche', { unrecordedPayout: true }));
    }
  });
  return out;
}

/** Rule 15 — the acquirer's payout of payment links, net of its fee. */
function acquiringProposals(tx, receipts, settings) {
  const settled = day(tx.settledAt);
  const fee = settings.acquiringFee || { percent: 1.4, fixedCents: 25 };
  const netOf = (c) => c - Math.round(c * (Number(fee.percent) || 0) / 100) - (Number(fee.fixedCents) || 0);
  const links = receipts.filter((r) => r.channel === 'link' && r.openCents > 0 && r.linkPaidAt && settled
    && daysBetween(r.linkPaidAt, settled) >= 0 && daysBetween(r.linkPaidAt, settled) <= 7);
  const found = smallestSubset(links.map((r) => ({ receipt: r, cents: netOf(r.openCents) })), tx.remainingCents, (chosen) => chosen.length);
  if (!found) return [];
  const gap = tx.remainingCents - found.reduce((s, f) => s + f.cents, 0);
  return [proposal(tx, found.map((f, i) => ({ receipt: f.receipt, allocCents: f.cents + (i === 0 ? gap : 0) })),
    found.length === 1 ? 'sur' : 'probable', 'acquiring', 'Versement du prestataire de paiement, net de ses frais')];
}

/** Rule 31 — the day's on-site card payments, one batch. */
function cardBatchProposals(tx, date, receipts) {
  const paidThatDay = receipts.filter((r) => r.channel === 'direct' && r.paid && r.paidDate === date && r.openCents > 0);
  const total = paidThatDay.reduce((s, r) => s + r.openCents, 0);
  if (paidThatDay.length === 0) return [];
  if (total <= tx.remainingCents) {
    return [proposal(tx, paidThatDay.map((r) => ({ receipt: r, allocCents: r.openCents })), 'probable', 'card-batch',
      'Paiements par carte sur place du jour')];
  }
  const found = smallestSubset(paidThatDay.map((r) => ({ receipt: r, cents: r.openCents })), tx.remainingCents, () => 0);
  return found ? [proposal(tx, found.map((f) => ({ receipt: f.receipt, allocCents: f.cents })), 'probable', 'card-batch',
    'Paiements par carte sur place du jour')] : [];
}

const nameMatches = (lastName, tx) => {
  const tokens = normalize(lastName).split(' ').filter((t) => t.length >= 3);
  return tokens.length > 0 && tokens.every((t) => textOf(tx).includes(t));
};

/** Rule 16 — a guest's own transfer or cheque, and rule 13 — a reservation number in the label. */
function directProposals(tx, receipts) {
  const settled = day(tx.settledAt);
  const text = ` ${textOf(tx)} `;
  const out = [];
  const byReservation = new Map();
  receipts.filter((r) => (r.channel === 'direct' || r.channel === 'link') && r.openCents > 0).forEach((r) => {
    if (!byReservation.has(r.reservationId)) byReservation.set(r.reservationId, []);
    byReservation.get(r.reservationId).push(r);
  });
  byReservation.forEach((list) => {
    const first = list[0];
    const number = normalize(first.reservation.reservationNumber);
    if (number.length >= 4 && text.includes(` ${number} `)) {
      const match = list.find((r) => Math.abs(r.openCents - tx.remainingCents) <= 1) || list[0];
      out.push(proposal(tx, [{ receipt: match, allocCents: Math.min(match.openCents, tx.remainingCents) }],
        Math.abs(match.openCents - tx.remainingCents) <= 1 ? 'sur' : 'probable', 'identifier', 'Numéro de réservation dans le virement'));
    }
  });
  if (out.length > 0) return out;

  const near = (r) => {
    const anchor = r.expectedDate || r.dueDate;
    if (!settled || !anchor) return true;
    return Math.abs(daysBetween(anchor, settled)) <= 30;
  };
  byReservation.forEach((list) => {
    const candidates = list.filter(near);
    const named = nameMatches(candidates[0] ? candidates[0].reservation.lastName : '', tx);
    const single = candidates.filter((r) => Math.abs(r.openCents - tx.remainingCents) <= toleranceOf(r));
    single.forEach((r) => out.push(proposal(tx, [{ receipt: r, allocCents: tx.remainingCents }], named ? 'probable' : 'verifier', 'direct',
      named ? 'Montant exact et nom du client dans le virement' : 'Montant exact, nom différent')));
    if (single.length === 0 && named && candidates.length > 0) {
      const next = [...candidates].sort((a, b) => String(a.dueDate || a.expectedDate || '').localeCompare(String(b.dueDate || b.expectedDate || '')))[0];
      const known = out.some((p) => p.allocations.some((a) => a.reservationId === next.reservationId && a.ledgerKey === next.ledgerKey));
      if (!known) {
        out.push(proposal(tx, [{ receipt: next, allocCents: Math.min(next.openCents, tx.remainingCents) }], 'verifier', 'direct',
          'Nom du client dans le virement, montant différent'));
      }
    }
    if (single.length === 0 && candidates.length > 1) {
      const found = smallestSubset(candidates.map((r) => ({ receipt: r, cents: r.openCents })), tx.remainingCents, () => 0);
      if (found && found.length > 1) {
        out.push(proposal(tx, found.map((f) => ({ receipt: f.receipt, allocCents: f.cents })), named ? 'probable' : 'verifier', 'direct',
          'Tout le séjour réglé en un virement'));
      }
    }
  });
  return out;
}

/**
 * @param {object} p
 * @param {object[]} p.transactions  credits with `remainingCents` > 0 (not outside, EUR)
 * @param {object[]} p.receipts      receipts with `openCents` (expected minus what is reconciled)
 * @param {Set<string>} p.discarded  `transactionId|reservationId|ledgerKey`
 * @param {object} p.settings        `{ patterns, batchPlatforms, acquiringFee, cardFeePercent, commissionRates }`
 * @returns {{ byTransaction: Object<string, {kind: string, proposal: object|null, alternatives: object[]}> }}
 */
function buildProposals({ transactions, receipts, discarded = new Set(), settings = {} }) {
  const all = [];
  const kinds = {};
  transactions.forEach((tx) => {
    if (tx.currency && tx.currency !== 'EUR') { kinds[tx.id] = { kind: 'other' }; return; }
    const cls = classify(tx, settings);
    kinds[tx.id] = cls;
    let found = [];
    if (cls.kind === 'platform') found = platformProposals(tx, cls.platform, receipts, settings);
    else if (cls.kind === 'acquiring') found = acquiringProposals(tx, receipts, settings);
    else if (cls.kind === 'cardBatch') found = cardBatchProposals(tx, cls.date, receipts);
    else found = directProposals(tx, receipts);
    found.forEach((p) => {
      if (p.allocations.some((a) => discarded.has(`${tx.id}|${a.reservationId}|${a.ledgerKey}`))) return;
      all.push(p);
    });
  });

  const dist = (p) => {
    const tx = transactions.find((t) => t.id === p.transactionId);
    const first = receipts.find((r) => keyOf(r) === `${p.allocations[0].reservationId}|${p.allocations[0].ledgerKey}`);
    const anchor = first && (first.expectedDate || first.dueDate);
    const d = tx && anchor ? daysBetween(anchor, day(tx.settledAt)) : 0;
    return Math.abs(d == null ? 0 : d);
  };
  const ordered = [...all].sort((a, b) => CONFIDENCE_RANK[b.confidence] - CONFIDENCE_RANK[a.confidence] || dist(a) - dist(b));
  const taken = new Set();
  const chosenTx = new Set();
  const byTransaction = {};
  transactions.forEach((tx) => { byTransaction[tx.id] = { kind: (kinds[tx.id] || { kind: 'other' }).kind, platform: (kinds[tx.id] || {}).platform || null, proposal: null, alternatives: [] }; });
  ordered.forEach((p) => {
    const slot = byTransaction[p.transactionId];
    const keys = p.allocations.map((a) => `${a.reservationId}|${a.ledgerKey}`);
    if (!chosenTx.has(p.transactionId) && keys.every((k) => !taken.has(k))) {
      slot.proposal = p;
      chosenTx.add(p.transactionId);
      keys.forEach((k) => taken.add(k));
    } else slot.alternatives.push(p);
  });
  return { byTransaction };
}

module.exports = { buildProposals, classify, smallestSubset, normalize, textOf, nameMatches, daysBetween, DEFAULT_PATTERNS, DEFAULT_BATCH_PLATFORMS, CONFIDENCE_RANK };
