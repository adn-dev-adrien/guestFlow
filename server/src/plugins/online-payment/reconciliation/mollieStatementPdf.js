/**
 * The statement of a Mollie settlement (specs/mollie-settlement-receipts.md rules 1, 5, 6): what the credit on the Qonto
 * account is made of, written from Mollie's own balance transactions. `shapeStatement` is pure; `renderStatementPdf`
 * draws its result (A4 portrait, the app's embedded faces, French).
 */

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { isReleaseType } = require('./mollieSettlements');
const { computeSplit } = require('./molliePaymentSplits');
const { day } = require('./dates');

const FONT_DIR = path.join(__dirname, '..', '..', '..', 'assets', 'fonts');
const FACES = Object.freeze({
  regular: { name: 'StatementSans', file: path.join(FONT_DIR, 'SourceSans3-Regular.otf.woff2'), standard: 'Helvetica' },
  bold: { name: 'StatementSansBold', file: path.join(FONT_DIR, 'SourceSans3-Semibold.otf.woff2'), standard: 'Helvetica-Bold' },
});

const KIND_LABELS = Object.freeze({ payment: 'Paiement', release: 'Libération de retenue' });

const formatEuros = (cents) => {
  const abs = Math.abs(Math.round(Number(cents) || 0));
  const whole = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${cents < 0 ? '-' : ''}${whole},${String(abs % 100).padStart(2, '0')} €`;
};
const frDay = (iso) => { const d = day(iso); return d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : ''; };

/**
 * Rule 6 — one line per composition row, in date order, and the totals. Fees of a payment are the deductions less the
 * reserve held (the split's own reserve, else the configured rate); a release has no gross and no fees, its net is the
 * reserve.
 *
 * @param {object[]} composition  `compositionOf(settlementId)`
 * @param {(paymentId: string) => ({ reserveCents: number|null, guest: string, reservationNumber: string }|null)} lookup
 * @param {number} ratePercent
 */
function shapeStatement({ composition, lookup, ratePercent }) {
  const lines = composition.map((t) => {
    const known = lookup(t.paymentId) || {};
    const base = { at: t.createdAt, paymentId: t.paymentId, description: t.description || '', guest: known.guest || '', reservationNumber: known.reservationNumber || '' };
    if (isReleaseType(t.type)) return { ...base, kind: 'release', grossCents: null, reserveCents: null, feeCents: null, netCents: t.resultCents };
    const deductions = Math.max(0, Number(t.deductionsCents) || 0);
    const held = known.reserveCents != null ? Number(known.reserveCents) : computeSplit({ grossCents: t.initialCents, ratePercent }).reserveCents;
    const reserveCents = Math.min(deductions, Math.max(0, held));
    return { ...base, kind: 'payment', grossCents: t.initialCents, reserveCents, feeCents: deductions - reserveCents, netCents: t.resultCents };
  });
  const sum = (pick) => lines.reduce((total, l) => total + (pick(l) || 0), 0);
  const totals = {
    grossCents: sum((l) => l.grossCents), reserveHeldCents: sum((l) => l.reserveCents),
    reserveReleasedCents: sum((l) => (l.kind === 'release' ? l.netCents : 0)), feeCents: sum((l) => l.feeCents), netCents: sum((l) => l.netCents),
  };
  return { lines, totals };
}

function registerFaces(doc) {
  const names = {};
  Object.entries(FACES).forEach(([role, face]) => {
    try {
      if (!fs.existsSync(face.file)) throw new Error('missing font file');
      doc.registerFont(face.name, face.file);
      doc.font(face.name);
      names[role] = face.name;
    } catch {
      names[role] = face.standard;
    }
  });
  return names;
}

const COLUMNS = [
  { key: 'date', title: 'Date', width: 52 },
  { key: 'kind', title: 'Nature', width: 66 },
  { key: 'payment', title: 'Paiement Mollie', width: 112 },
  { key: 'guest', title: 'Client · réservation', width: 105, },
  { key: 'gross', title: 'Brut', width: 46, right: true },
  { key: 'reserve', title: 'Retenue', width: 46, right: true },
  { key: 'fee', title: 'Frais', width: 40, right: true },
  { key: 'net', title: 'Net', width: 48, right: true },
];
const MARGIN = 40;
const PAGE_BOTTOM = 790;

/**
 * Draws the statement. `settlement` is the stored Mollie settlement (`id`, `reference`), `credit` the Qonto credit.
 * `now` is the statement's own date (the first attempt): it feeds the footer and the document's dates, and pdfkit derives the
 * file ID from them, so the same inputs give the same bytes. Resolves with the PDF bytes.
 */
function renderStatementPdf({ shape, settlement, credit, companyName = '', now = new Date() }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: MARGIN, info: { Title: `Relevé de versement Mollie ${settlement.reference}`, CreationDate: now, ModDate: now } });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    const face = registerFaces(doc);
    const ink = '#27251F';
    const muted = '#6E6A5E';

    if (companyName) doc.font(face.regular).fontSize(9).fillColor(muted).text(companyName, MARGIN, MARGIN);
    doc.font(face.bold).fontSize(18).fillColor(ink).text('Relevé de versement Mollie', MARGIN, doc.y + 2);
    doc.moveDown(0.5);
    const facts = [
      ['Référence du règlement', settlement.reference],
      ['Règlement Mollie', settlement.id],
      ['Date du virement', frDay(credit.settledAt)],
      ['Référence Qonto', credit.reference || credit.id],
      ['Montant crédité', formatEuros(credit.amountCents)],
    ];
    facts.forEach(([label, value]) => {
      const y = doc.y;
      doc.font(face.regular).fontSize(9).fillColor(muted).text(label, MARGIN, y, { width: 130 });
      doc.font(face.bold).fontSize(9).fillColor(ink).text(String(value), MARGIN + 135, y, { width: 380 });
    });
    doc.moveDown(1);

    const header = () => {
      let x = MARGIN;
      const y = doc.y;
      COLUMNS.forEach((c) => {
        doc.font(face.bold).fontSize(7.5).fillColor(muted).text(c.title, x, y, { width: c.width - 4, align: c.right ? 'right' : 'left' });
        x += c.width;
      });
      doc.moveTo(MARGIN, y + 11).lineTo(MARGIN + 515, y + 11).strokeColor('#DDD6C8').lineWidth(0.5).stroke();
      doc.y = y + 15;
    };
    const row = (cells, { bold = false } = {}) => {
      let x = MARGIN;
      const y = doc.y;
      const height = Math.max(...COLUMNS.map((c) => doc.font(bold ? face.bold : face.regular).fontSize(7.5).heightOfString(String(cells[c.key] || ' '), { width: c.width - 4 })));
      if (y + height > PAGE_BOTTOM) { doc.addPage(); header(); return row(cells, { bold }); }
      COLUMNS.forEach((c) => {
        doc.font(bold ? face.bold : face.regular).fontSize(7.5).fillColor(ink).text(String(cells[c.key] || ''), x, y, { width: c.width - 4, align: c.right ? 'right' : 'left' });
        x += c.width;
      });
      doc.y = y + height + 4;
      return undefined;
    };

    header();
    shape.lines.forEach((l) => row({
      date: frDay(l.at), kind: KIND_LABELS[l.kind],
      payment: [l.paymentId, l.description].filter(Boolean).join('\n'),
      guest: [l.guest, l.reservationNumber && `Réservation ${l.reservationNumber}`].filter(Boolean).join('\n'),
      gross: l.grossCents == null ? '' : formatEuros(l.grossCents),
      reserve: l.reserveCents == null ? '' : formatEuros(l.reserveCents),
      fee: l.feeCents == null ? '' : formatEuros(l.feeCents),
      net: formatEuros(l.netCents),
    }));
    doc.moveTo(MARGIN, doc.y).lineTo(MARGIN + 515, doc.y).strokeColor(ink).lineWidth(0.5).stroke();
    doc.y += 4;
    const t = shape.totals;
    row({
      date: 'Total', kind: '', payment: t.reserveReleasedCents > 0 ? `dont retenue libérée : ${formatEuros(t.reserveReleasedCents)}` : '', guest: '',
      gross: formatEuros(t.grossCents), reserve: formatEuros(t.reserveHeldCents), fee: formatEuros(t.feeCents), net: formatEuros(t.netCents),
    }, { bold: true });

    if (doc.y + 40 > PAGE_BOTTOM) doc.addPage();
    doc.font(face.regular).fontSize(8).fillColor(muted).text(
      `Établi par GuestFlow à partir des données de l'API Mollie — ${frDay(now.toISOString())} ${now.toISOString().slice(11, 16)} UTC`,
      MARGIN, Math.min(doc.y + 14, PAGE_BOTTOM + 10), { width: 515 },
    );
    doc.end();
  });
}

module.exports = { shapeStatement, renderStatementPdf, formatEuros, KIND_LABELS };
