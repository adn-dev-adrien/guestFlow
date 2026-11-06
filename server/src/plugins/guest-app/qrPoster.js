/**
 * The A4 poster of one lodging's QR code (specs/guest-app.md rules 1, 48): the app's name, the lodging, the
 * code a phone scans to open `https://<guest host>/l/<lodgingCode>`, and one line in French and in English.
 * Regenerating the code makes every printed poster of that lodging obsolete: print a new one.
 */

const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');

const A4 = Object.freeze({ width: 595.28, height: 841.89 });
const QR_SIZE = 340;
const INK = '#1f2a24';
const MUTED = '#5c665f';

/** The URL a lodging's QR code opens (the visitor mode, rule 3). */
const lodgingUrl = (guestHost, lodgingCode) => `https://${guestHost}/l/${lodgingCode}`;

/** The URL of a stay's own link (rule 1). */
const stayLinkUrl = (guestHost, stayToken) => `https://${guestHost}/s/${stayToken}`;

/** → a Buffer holding the PDF. */
async function renderQrPoster({ appName, lodgingName, url }) {
  const qr = await QRCode.toBuffer(url, { type: 'png', width: 1200, margin: 1, errorCorrectionLevel: 'M' });
  const doc = new PDFDocument({ size: 'A4', margin: 56, info: { Title: `${appName} — ${lodgingName}` } });
  const chunks = [];
  doc.on('data', (chunk) => chunks.push(chunk));
  const done = new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  const width = A4.width - 112;
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(30).text(appName, 56, 90, { width, align: 'center' });
  doc.fillColor(MUTED).font('Helvetica').fontSize(18).text(lodgingName, { width, align: 'center' });
  doc.image(qr, (A4.width - QR_SIZE) / 2, 220, { width: QR_SIZE, height: QR_SIZE });
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(18)
    .text('Scannez pour ouvrir votre livret d’accueil', 56, 220 + QR_SIZE + 40, { width, align: 'center' });
  doc.fillColor(MUTED).font('Helvetica').fontSize(14)
    .text('Scan to open your welcome booklet', { width, align: 'center' });
  doc.end();
  return done;
}

module.exports = { lodgingUrl, renderQrPoster, stayLinkUrl };
