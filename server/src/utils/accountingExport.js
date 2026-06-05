/**
 * Pure accounting-export engine.
 *
 * Given a list of encaissement entries (one per deposit/balance/complement that hit the bank
 * in a given month — shape produced by `accountingModel.encaissementsByMonth`), produces the
 * balanced double-entry journal lines expected by the accountant.
 *
 * Column layout (set 2026-06-01 from Adrien's accountant `Exemple export ventes SOLIO.csv`):
 *
 *   Jour ; Mois  ; Année ; Journal ; Pièce ; Libellé de l'écriture ; Compte ; Débit ; Crédit
 *   then a GuestFlow-specific extension: Plateforme ; Prix payé client ; Commission
 *
 * The first 9 columns are byte-aligned with the accountant's example (header `Mois ` has the
 * trailing space exactly as in the file). The trailing 3 columns are platform info, kept so
 * Adrien can still inspect commission data; the accountant can ignore them.
 *
 * For each encaissement (one debit + N credits):
 *   - 1 debit on the client auxiliary account `C+LASTNAME` for the full TTC (revenue + tax).
 *   - N credit lines on revenue accounts (70xxx), one per bucket, pro-rated by
 *     `encaissementTtc / finalPrice` in the legacy path or already pre-applied in the
 *     contrib-driven path (`fraction = 1`).
 *   - M credit lines on VAT accounts (44571xxx) per rate.
 *   - 1 credit line on `46710000` (pass-through) for the tourist-tax portion of the
 *     encaissement, when > 0.
 *
 * Rounding: to the cent. The last credit line absorbs the residue so each entry's
 * Σ credits == debit, exactly.
 *
 * Libellé: uppercased "FIRSTNAME LASTNAME" (or `Réservation #ID` fallback). Matches the
 * accountant's example style (`CLAIRE NOTIN`, `RELAIS PETITE ENFANCE TOURNON`).
 *
 * Empty money cells (Débit or Crédit): rendered as literal `0`, not empty — the accountant's
 * software ingests these columns as numeric and reads empty as ambiguous. Non-money cells
 * stay empty when not applicable (e.g. the `Pièce` column is empty until a numbering scheme
 * is decided — see spec §3.4 rule 13b).
 *
 * Pièce: empty for every line for now (Adrien's accountant hasn't communicated a numbering
 * scheme yet, and we don't want to fabricate one that might collide later). The column stays
 * in the header so the structure matches the example.
 *
 * Turnover basis = NET (the owner-received `finalPrice`). For platform sales, gross +
 * commission ride only in the trailing info columns. See specs/accountant-accounting-export.md §9.
 */

const {
  BUCKET_TO_ACCOUNT,
  vatAccountForRate,
  buildClientAccount,
  accountLabel,
  PASS_THROUGH_ACCOUNTS,
  SALES_JOURNAL_CODE,
} = require('../constants/accounting');

// Header order is fixed and aligned with the accountant's example file. The trailing space
// after `Mois` is intentional (it's in the example header byte-for-byte) — DO NOT trim it.
const CSV_HEADERS = [
  'Jour', 'Mois ', 'Année',
  'Journal', 'Pièce',
  "Libellé de l'écriture",
  'Compte',
  'Débit', 'Crédit',
  // GuestFlow extension columns — appear only on the debit (anchor) row of each entry.
  'Plateforme', 'Prix payé client', 'Commission',
];

// Indices in the row tuple for the debit/credit columns — used to swap empty with the
// literal `0` per the accountant's expected format.
const DEBIT_INDEX = 7;
const CREDIT_INDEX = 8;

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

// Parse 'YYYY-MM-DD' into { day, month, year } integers (no Date object → no timezone surprises).
function splitIsoDate(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return { day: '', month: '', year: '' };
  return { day: Number(m[3]), month: Number(m[2]), year: Number(m[1]) };
}

// Libellé: uppercased "FIRSTNAME LASTNAME" (the accountant's example style). Falls back to
// a stable identifier when the client name is empty (rare — iCal import without summary).
function libelleFor(entry) {
  const first = String(entry.client?.firstName || '').trim();
  const last = String(entry.client?.lastName || '').trim();
  const joined = `${first} ${last}`.trim();
  if (joined) return joined.toUpperCase();
  return `RÉSERVATION #${entry.reservationId}`;
}

// Replace empty money cells (Débit / Crédit columns) with a literal `0`. Other columns stay
// untouched — the accountant's example shows `0` only in the two money columns.
function zerofyMoneyColumns(row) {
  const next = [...row];
  if (next[DEBIT_INDEX] === '' || next[DEBIT_INDEX] == null) next[DEBIT_INDEX] = 0;
  if (next[CREDIT_INDEX] === '' || next[CREDIT_INDEX] == null) next[CREDIT_INDEX] = 0;
  return next;
}

// Build the rows of one encaissement entry (debit + credits). Returns an array of tuples
// matching CSV_HEADERS. Σ credits is guaranteed equal to Σ debits.
//
// accounting-platform-commission-and-no-deposit.md §3.5–§3.6:
//   - DÉBIT CCLIENT = encaissementNetTtc (= bank movement = what the owner banks).
//   - DÉBIT compte commission HT (6226xx) + optional DÉBIT 44566000 (VAT) for non-direct
//     platforms with `entry.commission` populated. Σ debits = encaissement GROSS TTC.
//   - CREDITS unchanged in shape — revenue 70xxx + VAT 44571xxx (scaled to GROSS by the
//     model upstream) + tax pass-through 46710000. Σ credits = encaissement GROSS TTC.
function entryToRows(entry) {
  const { day, month, year } = splitIsoDate(entry.paidDate);
  const libelle = libelleFor(entry);
  const clientAccount = buildClientAccount(entry.client.lastName);
  const piece = ''; // empty until Adrien provides a numbering scheme; see spec §3.4 rule 13b.

  const fraction = entry.fraction;
  const grossDebitTtc = round2(entry.encaissementTtc);
  // The CCLIENT debit defaults to the net (= bank movement). When `encaissementNetTtc` is
  // not provided (legacy entries built without the commission spec), fall back to gross so
  // the entry remains balanced — identical to pre-spec output.
  const netDebitTtc = entry.encaissementNetTtc != null
    ? round2(entry.encaissementNetTtc)
    : grossDebitTtc;
  const taxTtc = round2(entry.taxTtc || 0);
  const commission = entry.commission || null;

  // Group credits: by bucket (revenue) and by VAT rate. We compute per-bucket pro-rated HT
  // and VAT, then aggregate the VAT by rate (10 vs 20).
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

  // Tourist tax credit on the pass-through account (46710000). The customer paid it (it's in
  // the debit total) but it isn't owner revenue. Emitted only when > 0.
  const taxLines = taxTtc > 0
    ? [{ account: PASS_THROUGH_ACCOUNTS.TOURIST_TAX, amount: taxTtc }]
    : [];

  // Rounding residue: nudge the last credit so Σ credits == gross debit (to the cent).
  //
  // A few cents of residue is legitimate (per-bucket HT and VAT are independently rounded
  // to the cent, so the sum drifts by ±0.01–0.02 € on a typical entry). Absorbing that drift
  // onto the last credit line keeps the entry balanced for the accountant.
  //
  // A previous iteration (PR #125) emitted a `console.warn` whenever the residue exceeded 1 €,
  // on the theory that "anything larger means the buckets don't actually account for the
  // encaissement TTC" — that catches the 2026-06-05 Chloé bug (stale quote → -87,80 € residue
  // → negative VAT). The warning was removed for prod (2026-06-05) because it fires on
  // legitimate legacy entries too: reservation #12078 produced 75,61 € / 176,39 € residues on
  // the deposit + balance pro-ratas, which are mathematically right under their own logic but
  // far outside the 1 € ceiling. The signal-to-noise didn't justify keeping the log.
  //
  // The silent-absorb behaviour was always the production output; we only dropped the log.
  // If a future bug produces a comptablement-aberrant negative VAT line, the regression test
  // `accounting-export-legacy-path-stale-quote` catches it via the actual VAT amount, not via
  // the side effect of a log line.
  const allCredits = [...revenueLines, ...vatLines, ...taxLines];
  if (allCredits.length > 0) {
    const sum = round2(allCredits.reduce((a, l) => a + l.amount, 0));
    const residue = round2(grossDebitTtc - sum);
    if (residue !== 0) {
      allCredits[allCredits.length - 1].amount = round2(allCredits[allCredits.length - 1].amount + residue);
    }
  }

  // Commission debit lines (§3.5). One HT line on the platform's compte commission, plus
  // optionally one VAT line on 44566000 when the platform's row has hasVatOnCommission = 1.
  const commissionLines = [];
  if (commission && commission.ttc > 0) {
    if (commission.ht > 0) commissionLines.push({ account: commission.account, amount: round2(commission.ht) });
    if (commission.hasVat && commission.vat > 0) {
      commissionLines.push({ account: commission.vatAccount, amount: round2(commission.vat) });
    }
    // Absorb any rounding residue on the LAST commission line so Σ debits == grossDebitTtc.
    const debitSum = round2(netDebitTtc + commissionLines.reduce((a, l) => a + l.amount, 0));
    const debitResidue = round2(grossDebitTtc - debitSum);
    if (debitResidue !== 0 && commissionLines.length > 0) {
      commissionLines[commissionLines.length - 1].amount = round2(commissionLines[commissionLines.length - 1].amount + debitResidue);
    }
  }

  // Platform info columns appear ONLY on the debit (anchor) row to avoid repeating.
  const platformInfo = (entry.platform && entry.platform !== 'direct')
    ? {
        plateforme: entry.platform,
        prixPayéClient: entry.clientGrossAmount == null ? '' : Number(entry.clientGrossAmount),
        commission: commission ? round2(commission.ttc)
          : (entry.clientGrossAmount == null ? ''
              : Math.max(0, round2(Number(entry.clientGrossAmount) - Number(entry.finalPrice)))),
      }
    : { plateforme: '', prixPayéClient: '', commission: '' };

  const rows = [];

  // 1) Debit on the client auxiliary account — anchor row, carries platform info.
  rows.push(zerofyMoneyColumns([
    day, month, year,
    SALES_JOURNAL_CODE, piece,
    libelle,
    clientAccount,
    netDebitTtc, '',
    platformInfo.plateforme, platformInfo.prixPayéClient, platformInfo.commission,
  ]));

  // 2) Commission debit lines (§3.5). Inserted right after the CCLIENT debit so the
  // accountant reads them as the offset to the net bank movement.
  for (const line of commissionLines) {
    rows.push(zerofyMoneyColumns([
      day, month, year, SALES_JOURNAL_CODE, piece, libelle, line.account, line.amount, '', '', '', '',
    ]));
  }

  // 3..N) Credit lines: revenue, then VAT, then tax pass-through.
  for (const line of revenueLines) {
    rows.push(zerofyMoneyColumns([
      day, month, year, SALES_JOURNAL_CODE, piece, libelle, line.account, '', line.amount, '', '', '',
    ]));
  }
  for (const line of vatLines) {
    rows.push(zerofyMoneyColumns([
      day, month, year, SALES_JOURNAL_CODE, piece, libelle, line.account, '', line.amount, '', '', '',
    ]));
  }
  for (const line of taxLines) {
    rows.push(zerofyMoneyColumns([
      day, month, year, SALES_JOURNAL_CODE, piece, libelle, line.account, '', line.amount, '', '', '',
    ]));
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

// Same data as the CSV but in a structured, render-friendly shape (one object per encaissement,
// lines already classified by type so the UI can colour them). Guarantees the rendered preview
// = the CSV content: each entry's lines are produced from the same `entryToRows` walk so any
// future change to the export (e.g. an extra commission-as-charge line) appears in both at once.
function entryToStructured(entry) {
  const rows = entryToRows(entry);
  if (rows.length === 0) return null;
  const [day, month, year] = rows[0];

  const platformInfo = (entry.platform && entry.platform !== 'direct')
    ? {
        platform: entry.platform,
        gross: entry.clientGrossAmount == null ? null : Number(entry.clientGrossAmount),
        commission: entry.commission ? round2(entry.commission.ttc)
          : (entry.clientGrossAmount == null ? null
              : Math.max(0, round2(Number(entry.clientGrossAmount) - Number(entry.finalPrice)))),
        commissionAccount: entry.commission ? entry.commission.account : null,
        commissionHt: entry.commission ? entry.commission.ht : null,
        commissionVat: entry.commission ? entry.commission.vat : null,
        commissionHasVat: entry.commission ? entry.commission.hasVat : null,
      }
    : { platform: null, gross: null, commission: null, commissionAccount: null, commissionHt: null, commissionVat: null, commissionHasVat: null };

  // Position indices follow CSV_HEADERS exactly.
  const lines = rows.map((row) => {
    const [,, , , , libelle, compte, debit, credit] = row;
    const debitVal = typeof debit === 'number' ? debit : null;
    const creditVal = typeof credit === 'number' ? credit : null;
    return {
      compte: String(compte),
      accountLabel: accountLabel(compte),
      libelle: String(libelle),
      // Map literal-0 placeholders back to null so the preview shows a blank cell on the
      // counter-side (the user sees `100,00 / —` not `100,00 / 0,00`).
      debit: debitVal === 0 ? null : debitVal,
      credit: creditVal === 0 ? null : creditVal,
      type: classifyLine(compte),
    };
  });

  const sumDebits = round2(lines.reduce((s, l) => s + (l.debit || 0), 0));
  const sumCredits = round2(lines.reduce((s, l) => s + (l.credit || 0), 0));
  const balanced = sumDebits === sumCredits;

  return {
    reservationId: entry.reservationId,
    kind: entry.kind,
    day, month, year,
    paidDate: entry.paidDate,
    client: entry.client,
    libelle: rows[0][5],          // libellé column
    clientAccount: rows[0][6],    // compte column on the debit row
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

// 'client' = auxiliary debit (C…) — 'revenue' = comptes 70xxx — 'vat' = comptes 44571xxx —
// 'tax_pass_through' = compte 46710000 (taxe de séjour pass-through, see spec
// accountant-accounting-export.md §3.4 rule 14) — 'commission_charge' = compte 6226xx
// (debit line on the platform's compte commission) — 'commission_vat' = compte 44566000
// (debit line for the deductible VAT on commission). See accounting-platform-commission-
// and-no-deposit.md §3.5–§3.6.
function classifyLine(compte) {
  const s = String(compte);
  if (s.startsWith('C')) return 'client';
  if (s.startsWith('70')) return 'revenue';
  if (s.startsWith('44571')) return 'vat';
  if (s === PASS_THROUGH_ACCOUNTS.TOURIST_TAX) return 'tax_pass_through';
  if (s === '44566000') return 'commission_vat';
  if (s.startsWith('6226')) return 'commission_charge';
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
  __test: { splitIsoDate, round2, classifyLine, libelleFor, zerofyMoneyColumns },
};
