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
const { bookedBucketSplit, netOfTtc, TTC_SPLIT_FALLBACK } = require('../legacyBucketSplit');
const { roundMoneyOrZero: round2 } = require('../../pricing/money');

// `create({ accountPlan })` — the plugin's account plan: the account numbers a role maps to, shared with the other exporters.
function createCsvJournal({ accountPlan }) {
  const {
    BUCKET_TO_ACCOUNT, REVENUE_ACCOUNTS, vatAccountForRate, buildClientAccount, PASS_THROUGH_ACCOUNTS, SALES_JOURNAL_CODE, DISCOUNT_ACCOUNT,
    DEFAULT_CANCELLATION_COMPENSATION_ACCOUNT, TIP_ACCOUNT, PLATFORM_PENALTY_ACCOUNT, planMapper,
  } = accountPlan;

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


  // Build the rows of one encaissement entry (debit + credits). Returns an array of tuples
  // matching CSV_HEADERS. Σ credits is guaranteed equal to Σ debits.
  //
  // accounting-platform-commission-and-no-deposit.md §3.5–§3.6:
  //   - DÉBIT CCLIENT = encaissementNetTtc (= bank movement = what the owner banks).
  //   - DÉBIT compte commission HT (6226xx) + optional DÉBIT 44566000 (VAT) for non-direct
  //     platforms with `entry.commission` populated. Σ debits = encaissement GROSS TTC.
  //   - CREDITS unchanged in shape — revenue 70xxx + VAT 44571xxx (scaled to GROSS by the
  //     model upstream) + tax pass-through 46710000. Σ credits = encaissement GROSS TTC.
  function rowsAtDefaults(entry, splitFrom = TTC_SPLIT_FALLBACK) {
    // Remboursements (specs/reservation-refunds.md §3.4): the very same money shape, sides swapped.
    if (entry && entry.direction === 'refund') return refundEntryToRows(entry);
    // Indemnités d'annulation (specs/cancellation-compensation.md §3.3 rule 16).
    if (entry && entry.direction === 'compensation') return compensationEntryToRows(entry);
    // specs/arrival-payment-detail-and-adjustment.md §3.4 — the two faces of « what the guest actually
    // handed over » for a single arrival payment.
    if (entry && entry.direction === 'discount') return discountEntryToRows(entry);
    if (entry && entry.direction === 'tip') return tipEntryToRows(entry);
    // Pénalité plateforme (reconciliation-assisted-matching.md rule 28).
    if (entry && entry.direction === 'penalty') return penaltyEntryToRows(entry);
    if (entry && entry.direction === 'standalone') return standaloneEntryToRows(entry);
    const { day, month, year } = splitIsoDate(entry.paidDate);
    const libelle = libelleFor(entry);
    const clientAccount = buildClientAccount(entry.client.lastName);
    const piece = ''; // empty until Adrien provides a numbering scheme; see spec §3.4 rule 13b.

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
      // specs/accountant-accounting-export.md rule 32 — the bucket's TTC share is prorated first, then
      // split at its rate: HT = TTC ÷ (1 + rate), VAT = TTC − HT. Prorating HT and VAT separately left a
      // cent between the journal and the accountant's own check (129,00 € at 10 % → 117,28 / 11,72).
      // A whole bucket (fraction 1) keeps its own HT and VAT, those of the stay's lines.
      // Rules 33, 35 — only from `splitFrom`: a month the accountant may already have imported keeps the
      // cents it was exported with.
      const rate = Number(bucket.ratePercent) || 0;
      const { ht, vat } = bookedBucketSplit(entry, bucket, splitFrom);
      if (ht > 0) revenueLines.push({ account, amount: ht, rate });
      if (vat > 0) vatByRate.set(rate, (vatByRate.get(rate) || 0) + vat);
    }

    const vatLines = [...vatByRate.entries()].map(([rate, amount]) => ({
      account: vatAccountForRate(rate),
      amount: round2(amount),
      rate,
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
    // encaissement TTC" — that catches the 2026-06-05 stale-quote bug (stale quote → -87,80 €
    // residue → negative VAT). The warning was removed for prod (2026-06-05) because it fires on
    // legitimate legacy entries too: one legacy reservation produced 75,61 € / 176,39 € residues on
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
          commission: commission ? round2(commission.ttc) : '',
        }
      : { plateforme: '', prixPayéClient: '', commission: '' };

    const rows = [];

    // 1) Debit on the client auxiliary account — anchor row, carries platform info.
    rows.push(tagRow(zerofyMoneyColumns([
      day, month, year,
      SALES_JOURNAL_CODE, piece,
      libelle,
      clientAccount,
      netDebitTtc, '',
      platformInfo.plateforme, platformInfo.prixPayéClient, platformInfo.commission,
    ]), 'client'));

    // 2) Commission debit lines (§3.5). Inserted right after the CCLIENT debit so the
    // accountant reads them as the offset to the net bank movement.
    for (const line of commissionLines) {
      rows.push(tagRow(zerofyMoneyColumns([
        day, month, year, SALES_JOURNAL_CODE, piece, libelle, line.account, line.amount, '', '', '', '',
      ]), line.account === commission.vatAccount ? 'commissionVat' : 'commission'));
    }

    // 3..N) Credit lines: revenue, then VAT, then tax pass-through.
    for (const line of revenueLines) {
      rows.push(tagRow(zerofyMoneyColumns([
        day, month, year, SALES_JOURNAL_CODE, piece, libelle, line.account, '', line.amount, '', '', '',
      ]), 'revenue', line.rate));
    }
    for (const line of vatLines) {
      rows.push(tagRow(zerofyMoneyColumns([
        day, month, year, SALES_JOURNAL_CODE, piece, libelle, line.account, '', line.amount, '', '', '',
      ]), 'vat', line.rate));
    }
    for (const line of taxLines) {
      rows.push(tagRow(zerofyMoneyColumns([
        day, month, year, SALES_JOURNAL_CODE, piece, libelle, line.account, '', line.amount, '', '', '',
      ]), 'touristTax'));
    }

    return rows;
  }

  // Un « avoir » : the exact mirror of an encaissement (specs/reservation-refunds.md §3.4 rule 22).
  //   - 1 CREDIT on the client auxiliary account for the full refunded TTC (the money leaves to them);
  //   - N DEBIT lines on the revenue accounts (70xxx), one per bucket, at their frozen HT;
  //   - M DEBIT lines on the VAT accounts (44571xxx), one per rate;
  //   - 1 DEBIT on 46710000 when part of the refund gives back tourist tax.
  // No commission line ever: the owner refunds the guest from their own bank account, whatever the
  // platform of the original sale. Σ debits == credit, the rounding residue absorbed on the last debit
  // (the sale path absorbs it on the last credit).
  // specs/mixed-method-payments.md rule 56 — a refund closing a split stay's books (`entry.closing`, set by the model)
  // debits what is left on each sale account instead of its buckets: a rabais left on 70900000 is credited back.
  function refundEntryToRows(entry) {
    const { day, month, year } = splitIsoDate(entry.paidDate);
    const libelle = libelleFor(entry);
    const clientAccount = buildClientAccount(entry.client.lastName);
    const piece = '';
    const creditTtc = round2(entry.encaissementTtc);
    const closing = entry.closing || null;
    const closingTax = closing ? closing.find((leg) => leg.role === 'touristTax') : null;
    const taxTtc = closing ? round2(closingTax ? closingTax.amount : 0) : round2(entry.taxTtc || 0);

    const revenueLines = [];
    const vatByRate = new Map();
    for (const leg of closing || []) {
      if (leg.role === 'revenue') revenueLines.push({ account: leg.account, amount: round2(leg.amount), rate: Number(leg.ratePercent) || 0, role: 'revenue' });
      if (leg.role === 'vat') vatByRate.set(Number(leg.ratePercent) || 0, round2((vatByRate.get(Number(leg.ratePercent) || 0) || 0) + leg.amount));
    }
    for (const bucket of closing ? [] : entry.buckets || []) {
      const account = BUCKET_TO_ACCOUNT[bucket.name];
      if (!account) continue;
      const ht = round2(bucket.ht || 0);
      const vat = round2(bucket.vat || 0);
      const rate = Number(bucket.ratePercent) || 0;
      if (ht > 0) revenueLines.push({ account, amount: ht, rate, role: 'revenue' });
      if (vat > 0) vatByRate.set(rate, (vatByRate.get(rate) || 0) + vat);
    }
    // specs/reservation-refunds.md rule 48 — given back from a cancelled stay's indemnity: the indemnity account
    // is debited, at the rate it was credited with (0 % by default, so no VAT line).
    const indemnity = entry.indemnity || null;
    if (indemnity) {
      const ht = round2(indemnity.ht || 0);
      const rate = Number(indemnity.ratePercent) || 0;
      if (ht > 0) revenueLines.push({ account: indemnity.account || DEFAULT_CANCELLATION_COMPENSATION_ACCOUNT, amount: ht, rate, role: 'revenue' });
      const vat = round2(indemnity.vat || 0);
      if (vat > 0) vatByRate.set(rate, (vatByRate.get(rate) || 0) + vat);
    }
    const vatLines = [...vatByRate.entries()].map(([rate, amount]) => ({
      account: vatAccountForRate(rate),
      amount: round2(amount),
      rate,
      role: 'vat',
    }));
    const taxLines = taxTtc > 0 || (closing && taxTtc !== 0)
      ? [{ account: PASS_THROUGH_ACCOUNTS.TOURIST_TAX, amount: taxTtc, role: 'touristTax' }]
      : [];

    const allDebits = [...revenueLines, ...vatLines, ...taxLines];
    if (allDebits.length > 0) {
      const sum = round2(allDebits.reduce((a, l) => a + l.amount, 0));
      const residue = round2(creditTtc - sum);
      if (residue !== 0) {
        allDebits[allDebits.length - 1].amount = round2(allDebits[allDebits.length - 1].amount + residue);
      }
    }

    const rows = [];
    // 1) Credit on the client auxiliary account — anchor row. A refund has no platform money to
    // report (no commission, no guest-paid gross), so the three extension columns stay empty.
    rows.push(tagRow(zerofyMoneyColumns([
      day, month, year,
      SALES_JOURNAL_CODE, piece,
      libelle,
      clientAccount,
      '', creditTtc,
      '', '', '',
    ]), 'client'));
    // 2..N) Debit lines: revenue, then VAT, then the tourist-tax pass-through (a closing refund's negative leg: a credit).
    for (const line of allDebits) {
      rows.push(tagRow(zerofyMoneyColumns([
        day, month, year, SALES_JOURNAL_CODE, piece, libelle, line.account,
        line.amount < 0 ? '' : line.amount, line.amount < 0 ? round2(-line.amount) : '', '', '', '',
      ]), line.role, line.rate == null ? null : line.rate));
    }
    return rows;
  }

  // Une indemnité d'annulation (specs/cancellation-compensation.md §3.3 rule 16): argent qui entre,
  // sans séjour en face.
  //   - 1 DÉBIT on the client auxiliary account for the amount actually wired (the bank movement);
  //   - 1 CRÉDIT on the configured produit account (75880000 by default) for the HT;
  //   - 1 CRÉDIT on the VAT account ONLY when the operator made the indemnity taxable (rate > 0).
  // No commission line (the amount recorded is already the net wired) and no tourist-tax line
  // (a cancelled stay generates none). The residue lands on the last credit so Σ = Σ, to the cent.
  function compensationEntryToRows(entry) {
    const { day, month, year } = splitIsoDate(entry.paidDate);
    const libelle = libelleFor(entry);
    const clientAccount = buildClientAccount(entry.client?.lastName);
    const piece = '';
    const config = entry.compensation || {};
    const account = config.account || DEFAULT_CANCELLATION_COMPENSATION_ACCOUNT;
    const debitTtc = round2(entry.encaissementTtc);

    const credits = [];
    const compensationRate = Number(config.ratePercent) || 0;
    const ht = round2(config.ht != null ? config.ht : debitTtc);
    if (ht > 0) credits.push({ account, amount: ht, role: 'revenue' });
    const vat = round2(config.vat || 0);
    if (vat > 0) credits.push({ account: vatAccountForRate(config.ratePercent), amount: vat, role: 'vat' });
    if (credits.length > 0) {
      const sum = round2(credits.reduce((a, l) => a + l.amount, 0));
      const residue = round2(debitTtc - sum);
      if (residue !== 0) credits[credits.length - 1].amount = round2(credits[credits.length - 1].amount + residue);
    }

    // The platform is worth reporting (it tells the accountant who paid); there is no guest-paid
    // gross and no commission to put in the two other extension columns.
    const platformLabel = entry.platform && entry.platform !== 'direct' ? entry.platform : '';

    const rows = [tagRow(zerofyMoneyColumns([
      day, month, year,
      SALES_JOURNAL_CODE, piece,
      libelle,
      clientAccount,
      debitTtc, '',
      platformLabel, '', '',
    ]), 'client')];
    for (const line of credits) {
      rows.push(tagRow(zerofyMoneyColumns([
        day, month, year, SALES_JOURNAL_CODE, piece, libelle, line.account, '', line.amount, '', '', '',
      ]), line.role, compensationRate));
    }
    return rows;
  }

  // Une réduction accordée à la porte (specs/arrival-payment-detail-and-adjustment.md rule 24) :
  // l'inverse d'une vente, sur le compte de rabais.
  //   - 1 DÉBIT sur 70900000 pour le HT — le produit diminue, il n'est pas « plus petit » ;
  //   - 1 DÉBIT sur le compte de TVA pour la TVA de la remise (la TVA due baisse d'autant) ;
  //   - 1 CRÉDIT sur le compte client pour le TTC : l'écriture de vente a débité le brut, celle-ci
  //     ramène le débit client au montant réellement encaissé.
  // Aucune ligne de commission (la remise ne change pas ce que la plateforme prélève) et aucune ligne
  // de taxe de séjour : le plancher garantit que la remise ne mord jamais dessus.
  function discountEntryToRows(entry) {
    const { day, month, year } = splitIsoDate(entry.paidDate);
    const libelle = libelleFor(entry);
    const clientAccount = buildClientAccount(entry.client?.lastName);
    const piece = '';
    const ttc = round2(entry.encaissementTtc);
    const debits = [];
    const discountRate = Number(entry.discount?.ratePercent) || 0;
    const ht = round2(entry.discount?.ht != null ? entry.discount.ht : ttc);
    if (ht > 0) debits.push({ account: entry.discount?.account || DISCOUNT_ACCOUNT, amount: ht, role: 'revenue' });
    const vat = round2(entry.discount?.vat || 0);
    if (vat > 0) debits.push({ account: vatAccountForRate(entry.discount?.ratePercent), amount: vat, role: 'vat' });
    if (debits.length > 0) {
      const sum = round2(debits.reduce((a, l) => a + l.amount, 0));
      const residue = round2(ttc - sum);
      if (residue !== 0) debits[debits.length - 1].amount = round2(debits[debits.length - 1].amount + residue);
    }
    const rows = debits.map((line) => tagRow(zerofyMoneyColumns([
      day, month, year, SALES_JOURNAL_CODE, piece, libelle, line.account, line.amount, '', '', '', '',
    ]), line.role, discountRate));
    rows.push(tagRow(zerofyMoneyColumns([
      day, month, year, SALES_JOURNAL_CODE, piece, libelle, clientAccount, '', ttc, '', '', '',
    ]), 'client'));
    return rows;
  }

  // Un pourboire (rule 25) : de l'argent qui entre sans prestation en face.
  //   - 1 DÉBIT sur le compte client pour ce qui a été remis ;
  //   - 1 CRÉDIT sur le produit divers de gestion courante, hors TVA (un don n'est pas taxable).
  function tipEntryToRows(entry) {
    const { day, month, year } = splitIsoDate(entry.paidDate);
    const libelle = libelleFor(entry);
    const clientAccount = buildClientAccount(entry.client?.lastName);
    const piece = '';
    const ttc = round2(entry.encaissementTtc);
    return [
      tagRow(zerofyMoneyColumns([
        day, month, year, SALES_JOURNAL_CODE, piece, libelle, clientAccount, ttc, '', '', '', '',
      ]), 'client'),
      tagRow(zerofyMoneyColumns([
        day, month, year, SALES_JOURNAL_CODE, piece, libelle, entry.tipAccount || TIP_ACCOUNT, '', ttc, '', '', '',
      ]), 'revenue', 0),
    ];
  }

  // Une pénalité plateforme (reconciliation-assisted-matching.md rule 28) : de l'argent que la plateforme
  // a gardé sur un versement, sans prestation en face et sans TVA.
  //   - 1 DÉBIT sur le compte de pénalités ;
  //   - 1 CRÉDIT sur le compte client : l'écriture de vente l'a débité du net du relevé, ce crédit le ramène
  //     à l'argent réellement versé.
  function penaltyEntryToRows(entry) {
    const { day, month, year } = splitIsoDate(entry.paidDate);
    const libelle = libelleFor(entry);
    const clientAccount = buildClientAccount(entry.client?.lastName);
    const piece = '';
    const ttc = round2(entry.encaissementTtc);
    return [
      tagRow(zerofyMoneyColumns([
        day, month, year, SALES_JOURNAL_CODE, piece, libelle, entry.penaltyAccount || PLATFORM_PENALTY_ACCOUNT, ttc, '', '', '', '',
      ]), 'penalty'),
      tagRow(zerofyMoneyColumns([
        day, month, year, SALES_JOURNAL_CODE, piece, libelle, clientAccount, '', ttc, '', '', '',
      ]), 'client'),
    ];
  }

  // specs/resource-booking-pricing-and-invoicing.md rules 21-22 — a sale made outside any stay (a walk-in nordic bath):
  //   - 1 DÉBIT client of its part on the books;
  //   - 1 CRÉDIT « Activité diverse » of its HT, 1 CRÉDIT TVA of its frozen rate (none when sold without VAT).
  // « Pièce » is the invoice number Qonto gave it, empty when no invoice was issued.
  function standaloneEntryToRows(entry) {
    const { day, month, year } = splitIsoDate(entry.paidDate);
    const libelle = libelleFor(entry);
    const clientAccount = buildClientAccount(entry.client?.lastName);
    const piece = entry.piece || '';
    const ttc = round2(entry.encaissementTtc);
    const rate = entry.vatRatePercent === null || entry.vatRatePercent === undefined ? 0 : Number(entry.vatRatePercent);
    const ht = netOfTtc(ttc, rate);
    const vat = round2(ttc - ht);
    const rows = [
      tagRow(zerofyMoneyColumns([day, month, year, SALES_JOURNAL_CODE, piece, libelle, clientAccount, ttc, '', '', '', '']), 'client'),
      tagRow(zerofyMoneyColumns([day, month, year, SALES_JOURNAL_CODE, piece, libelle, REVENUE_ACCOUNTS.ACTIVITIES, '', ht, '', '', '']), 'revenue', rate),
    ];
    if (vat > 0) {
      rows.push(tagRow(zerofyMoneyColumns([day, month, year, SALES_JOURNAL_CODE, piece, libelle, vatAccountForRate(rate), '', vat, '', '', '']), 'vat', rate));
    }
    return rows;
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
    __test: { splitIsoDate, round2, libelleFor, zerofyMoneyColumns, refundEntryToRows, compensationEntryToRows },
  };
}

module.exports = { create: createCsvJournal };
