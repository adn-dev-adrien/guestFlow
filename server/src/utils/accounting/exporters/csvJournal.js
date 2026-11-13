/**
 * The CSV journal exporter: pure, formatting only (specs/pricing-components.md §3 rule 63).
 *
 * Given a list of encaissement entries (one per deposit/balance/complement that hit the bank
 * in a given month — shape produced by `accountingModel.encaissementsByMonth`), produces the
 * balanced double-entry journal lines expected by the accountant.
 *
 * « Format standard (CSV) » (specs/plugins-phase-p-productisation.md rule 29) — the column layout set
 * on 2026-06-01 from the accountant's example file:
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
 *
 * Refunds (specs/reservation-refunds.md) travel through the same pipe with `direction: 'refund'`:
 * one « avoir » = the mirror image of an encaissement (credit client / debit revenue + VAT), so the
 * CSV and the visual journal stay a single code path.
 *
 * Cancellation compensations (specs/cancellation-compensation.md) ride the same pipe with
 * `direction: 'compensation'`: money comes IN like an encaissement, but against no séjour — one
 * debit on the client account, one credit on the configured produit account (plus a VAT line only
 * if the operator made the indemnity taxable).
 */

const { serializeCsv } = require('../../csv');
const { toLatin1Text } = require('../latin1');
const { TTC_SPLIT_FALLBACK } = require('../legacyBucketSplit');
const journalLines = require('../journalLines');
const { roundMoneyOrZero: round2 } = require('../../pricing/money');

// `create({ accountPlan })` — the plugin's account plan: the account numbers a role maps to, shared with the other exporters.
function createCsvJournal({ accountPlan }) {
  const {
    BUCKET_TO_ACCOUNT, REVENUE_ACCOUNTS, vatAccountForRate, buildClientAccount, PASS_THROUGH_ACCOUNTS, SALES_JOURNAL_CODE, DISCOUNT_ACCOUNT,
    DEFAULT_CANCELLATION_COMPENSATION_ACCOUNT, TIP_ACCOUNT, PLATFORM_PENALTY_ACCOUNT, planMapper,
  } = accountPlan;
  const { entryLines, accountOf: accountOfLine } = journalLines.create({ accountPlan });

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

  // specs/accounting-synthesis.md rule 3 — what each row of the journal IS (its role, and the VAT rate of a
  // revenue or VAT line), carried beside the row and never in it: the CSV cells stay byte-identical, the
  // synthesis reads the very rows the export writes.
  const ROW_META = Symbol('accountingRowMeta');
  function tagRow(row, role, ratePercent = null) {
    Object.defineProperty(row, ROW_META, { value: { role, ratePercent }, enumerable: false });
    return row;
  }
  const metaOf = (row) => (row && row[ROW_META]) || { role: 'other', ratePercent: null };

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
    // A compensation outlives its reservation, so the id fallback names the compensation itself.
    if (entry.direction === 'compensation') return `INDEMNITÉ ANNULATION #${entry.compensationId}`;
    if (entry.direction === 'standalone') return 'VENTE HORS SÉJOUR';
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


  const metaRoleOf = (line) => (line.role === 'customer' ? 'client' : line.role.split(':')[0]);

  // The platform columns sit on the customer row only: a sale reports its platform, gross and commission, a compensation
  // its platform; every other entry leaves the three cells empty.
  function anchorColumns(entry) {
    if (entry.direction === 'compensation') return [entry.platform && entry.platform !== 'direct' ? entry.platform : '', '', ''];
    const sale = !['refund', 'discount', 'tip', 'penalty', 'standalone'].includes(entry.direction);
    if (!sale || !entry.platform || entry.platform === 'direct') return ['', '', ''];
    const commission = entry.commission || null;
    return [entry.platform, entry.clientGrossAmount == null ? '' : Number(entry.clientGrossAmount), commission ? round2(commission.ttc) : ''];
  }

  // The rows of one entry: its role lines (`journalLines`, where every amount is decided) as the CSV's tuples.
  // Σ credits is guaranteed equal to Σ debits by the lines themselves.
  function rowsAtDefaults(entry, splitFrom = TTC_SPLIT_FALLBACK) {
    const { day, month, year } = splitIsoDate(entry.paidDate);
    const libelle = libelleFor(entry);
    const clientAccount = buildClientAccount(entry.client?.lastName);
    // « Pièce » is empty until a numbering scheme is decided (spec §3.4 rule 13b), but for the invoice number of a sale made outside any stay.
    const piece = entry.direction === 'standalone' ? entry.piece || '' : '';
    return entryLines(entry, { splitFrom }).map((line) => {
      const debit = line.side === 'debit' ? line.amountCents / 100 : '';
      const credit = line.side === 'credit' ? line.amountCents / 100 : '';
      const extra = line.role === 'customer' ? anchorColumns(entry) : ['', '', ''];
      const rate = line.role.startsWith('revenue:') || line.role.startsWith('vat:') ? line.vatRate : null;
      return tagRow(zerofyMoneyColumns([
        day, month, year, SALES_JOURNAL_CODE, piece, libelle, accountOfLine(line, clientAccount), debit, credit, ...extra,
      ]), metaRoleOf(line), rate == null ? null : rate);
    });
  }

  // Column positions of the journal code and the account in a row (CSV_HEADERS).
  const JOURNAL_COLUMN = 3;
  const ACCOUNT_COLUMN = 6;

  /**
   * The rows of one entry, in the operator's account plan (specs/plugins-phase-p-productisation.md
   * rule 27). Without a plan, or with the defaults, the rows are exactly the engine's.
   */
  function entryToRows(entry, plan) {
    const rows = rowsAtDefaults(entry, (plan && plan.ttcSplitFrom) || TTC_SPLIT_FALLBACK);
    if (!plan) return rows;
    const mapper = planMapper(plan);
    return rows.map((row) => {
      const out = [...row];
      out[JOURNAL_COLUMN] = mapper.journal;
      out[ACCOUNT_COLUMN] = mapper.account(out[ACCOUNT_COLUMN]);
      const { role, ratePercent } = metaOf(row);
      return tagRow(out, role, ratePercent);
    });
  }

  /**
   * specs/accounting-synthesis.md rule 3 — the lines of one entry exactly as the CSV writes them (the plan's
   * accounts, the same cents), each with its role (client, revenue, vat, touristTax, commission,
   * commissionVat, penalty) and, on revenue and VAT lines, the VAT rate it was booked at.
   */
  function entryVentilation(entry, plan) {
    return entryToRows(entry, plan).map((row) => {
      const { role, ratePercent } = metaOf(row);
      return {
        account: String(row[ACCOUNT_COLUMN]),
        role,
        ratePercent: role === 'revenue' || role === 'vat' ? Number(ratePercent) || 0 : null,
        debit: round2(row[DEBIT_INDEX]),
        credit: round2(row[CREDIT_INDEX]),
      };
    });
  }

  function buildRows(entries, plan) {
    const rows = [];
    for (const entry of entries || []) {
      for (const row of entryToRows(entry, plan)) rows.push(row);
    }
    return rows;
  }

  // « Format standard (CSV) »: the file the accountant imports. ISO-8859-1 (latin1) without BOM, byte-for-byte the
  // accountant's example file: French accounting software (Sage/EBP/Cegid) defaults to latin1 and chokes on the UTF-8 BOM,
  // so the string is re-encoded into a latin1 Buffer once every cell's characters outside latin1 (’, Œ, …) have been
  // transliterated (specs/accountant-accounting-export.md rule 31), before the quoting, which a « ” » → « " » must go through.
  function exportFile(entries, { plan, period }) {
    const rows = buildRows(entries, plan);
    const latin1Rows = rows.map((row) => row.map((cell) => (typeof cell === 'string' ? toLatin1Text(cell) : cell)));
    const csv = serializeCsv(CSV_HEADERS, latin1Rows, { bom: false });
    const buffer = Buffer.from(csv, 'latin1');
    const mm = String(period.month).padStart(2, '0');
    return { filename: `ventes-${period.year}-${mm}.csv`, contentType: 'text/csv; charset=ISO-8859-1', body: buffer };
  }

  return {
    id: 'csvJournal',
    export: exportFile,
    CSV_HEADERS,
    entryToRows,
    entryVentilation,
    buildRows,
    round2,
    __test: { splitIsoDate, round2, libelleFor, zerofyMoneyColumns },
  };
}

module.exports = { create: createCsvJournal };
