/**
 * Pure accounting-export engine.
 *
 * Given a list of encaissement entries (one per deposit/balance that hit the bank in a given month —
 * shape produced by `accountingModel.encaissementsByMonth`), produces the balanced double-entry
 * journal lines expected by the accountant (spec §3.4 rule 12):
 *
 *   - 1 debit line on the client auxiliary account `C+LASTNAME` for the encaissement TTC.
 *   - N credit lines on the revenue accounts (70xxx), one per bucket (accommodation / complementary /
 *     activities), pro-rated by `encaissementTtc / finalPrice`.
 *   - M credit lines on the VAT accounts (44571100 / 44571200) by rate, pro-rated similarly.
 *
 * **Rounding** is to the cent. The last credit line absorbs the rounding residue so each entry's
 * Σ credits == debit, exactly.
 *
 * **Turnover basis** = NET (the owner-received `finalPrice`). For platform sales, the brut +
 * commission ride only in the trailing info columns (Plateforme / Prix payé client / Commission).
 * See specs/accountant-accounting-export.md §9 (decision pending the accountant's example CSV).
 */

const {
  BUCKET_TO_ACCOUNT,
  vatAccountForRate,
  buildClientAccount,
  accountLabel,
} = require('../constants/accounting');

const CSV_HEADERS = [
  'Jour', 'Mois', 'Année',
  'Compte', 'Libellé',
  'Débit', 'Crédit',
  'Plateforme', 'Prix payé client', 'Commission',
];

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

// Parse 'YYYY-MM-DD' into [day, month, year] integers (no Date object → no timezone surprises).
function splitIsoDate(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return { day: '', month: '', year: '' };
  return { day: Number(m[3]), month: Number(m[2]), year: Number(m[1]) };
}

// Build the rows of one encaissement entry (debit + credits). Returns an array of arrays matching
// CSV_HEADERS. Σ credits is guaranteed equal to debit.
function entryToRows(entry) {
  const { day, month, year } = splitIsoDate(entry.paidDate);
  const libelle = `${entry.client.firstName || ''} ${entry.client.lastName || ''}`.trim() || `Réservation #${entry.reservationId}`;
  const clientAccount = buildClientAccount(entry.client.lastName);

  const fraction = entry.fraction;
  const debitTtc = round2(entry.encaissementTtc);

  // Group credits: by bucket (revenue) and by VAT rate.
  // We compute per-bucket pro-rated HT and VAT, then aggregate the VAT by rate (10 vs 20).
  const revenueLines = []; // { account, amount }
  const vatByRate = new Map(); // ratePercent → cumulative amount

  for (const bucket of entry.buckets) {
    const account = BUCKET_TO_ACCOUNT[bucket.name];
    if (!account) continue;
    const ht = round2((bucket.ht || 0) * fraction);
    const vat = round2((bucket.vat || 0) * fraction);
    if (ht > 0) revenueLines.push({ account, amount: ht });
    if (vat > 0) {
      const rate = Number(bucket.ratePercent) || 0;
      vatByRate.set(rate, (vatByRate.get(rate) || 0) + vat);
    }
  }

  const vatLines = [...vatByRate.entries()].map(([rate, amount]) => ({
    account: vatAccountForRate(rate),
    amount: round2(amount),
  }));

  // Rounding residue: nudge the last credit so Σ credits == debit (to the cent).
  const allCredits = [...revenueLines, ...vatLines];
  if (allCredits.length > 0) {
    const sum = round2(allCredits.reduce((a, l) => a + l.amount, 0));
    const residue = round2(debitTtc - sum);
    if (residue !== 0) {
      allCredits[allCredits.length - 1].amount = round2(allCredits[allCredits.length - 1].amount + residue);
    }
  }

  const platformInfo = (entry.platform && entry.platform !== 'direct')
    ? {
        plateforme: entry.platform,
        prixPayéClient: entry.clientGrossAmount == null ? null : Number(entry.clientGrossAmount),
        commission: entry.clientGrossAmount == null ? null
          : Math.max(0, round2(Number(entry.clientGrossAmount) - Number(entry.finalPrice))),
      }
    : { plateforme: '', prixPayéClient: '', commission: '' };

  const rows = [];
  // Debit: client account. Platform-info columns appear ONLY on this row (the anchor row of the
  // entry), to avoid repeating per-line.
  rows.push([
    day, month, year,
    clientAccount, libelle,
    debitTtc, '',
    platformInfo.plateforme,
    platformInfo.prixPayéClient,
    platformInfo.commission,
  ]);

  for (const line of revenueLines) {
    rows.push([day, month, year, line.account, libelle, '', line.amount, '', '', '']);
  }
  for (const line of vatLines) {
    rows.push([day, month, year, line.account, libelle, '', line.amount, '', '', '']);
  }
  return rows;
}

function buildRows(entries) {
  const rows = [];
  for (const entry of entries || []) {
    for (const row of entryToRows(entry)) rows.push(row);
  }
  return rows;
}

// Same data as the CSV but in a structured, render-friendly shape (one object per encaissement, lines
// already classified by type so the UI can colour them). Guarantees the rendered preview = the CSV
// content: each entry's lines are produced from the same `entryToRows` walk so any future change to
// the export (e.g. an extra commission-as-charge line) appears in both at once.
function entryToStructured(entry) {
  const rows = entryToRows(entry); // array-of-arrays matching CSV_HEADERS
  if (rows.length === 0) return null;
  const [day, month, year] = rows[0];
  const platformInfo = (entry.platform && entry.platform !== 'direct')
    ? {
        platform: entry.platform,
        gross: entry.clientGrossAmount == null ? null : Number(entry.clientGrossAmount),
        commission: entry.clientGrossAmount == null ? null
          : Math.max(0, round2(Number(entry.clientGrossAmount) - Number(entry.finalPrice))),
      }
    : { platform: null, gross: null, commission: null };

  const lines = rows.map(([d, m, y, compte, libelle, debit, credit]) => ({
    compte: String(compte),
    accountLabel: accountLabel(compte),
    libelle: String(libelle),
    debit: typeof debit === 'number' ? debit : null,
    credit: typeof credit === 'number' ? credit : null,
    type: classifyLine(compte),
  }));

  const sumDebits = round2(lines.reduce((s, l) => s + (l.debit || 0), 0));
  const sumCredits = round2(lines.reduce((s, l) => s + (l.credit || 0), 0));
  const balanced = sumDebits === sumCredits;

  return {
    reservationId: entry.reservationId,
    kind: entry.kind, // 'deposit' | 'balance'
    day, month, year,
    paidDate: entry.paidDate,
    client: entry.client,
    libelle: rows[0][4], // already-computed display libellé
    clientAccount: rows[0][3], // C+NAME
    encaissementTtc: round2(entry.encaissementTtc),
    finalPrice: round2(entry.finalPrice),
    fraction: entry.fraction,
    platform: platformInfo,
    lines,
    sumDebits,
    sumCredits,
    balanced,
  };
}

// 'client' = auxiliary debit (C…) — 'revenue' = comptes 70xxx — 'vat' = comptes 44571xxx.
function classifyLine(compte) {
  const s = String(compte);
  if (s.startsWith('C')) return 'client';
  if (s.startsWith('70')) return 'revenue';
  if (s.startsWith('44571')) return 'vat';
  return 'other';
}

function buildStructuredEntries(entries) {
  return (entries || []).map(entryToStructured).filter(Boolean);
}

module.exports = {
  CSV_HEADERS,
  entryToRows,
  buildRows,
  entryToStructured,
  buildStructuredEntries,
  __test: { splitIsoDate, round2, classifyLine },
};
