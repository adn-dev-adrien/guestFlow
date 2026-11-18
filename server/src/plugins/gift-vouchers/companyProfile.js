/**
 * What the printed cards say of the company (specs/gift-voucher-campaigns.md rule 50): its name, its town and its logo, read from the company settings the operator already
 * filled — never typed a second time. The town is the last line of the address, without its postcode.
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const LOGO_BOX = 800;

/** « 12 rue des Lilas\n46330 Saint-Cirq-Lapopie » → « Saint-Cirq-Lapopie »; no address, no town. */
function townOf(address) {
  const lines = String(address || '').split('\n').map((line) => line.trim()).filter(Boolean);
  const last = lines[lines.length - 1] || '';
  return lines.length > 1 || /^\d{4,5}\s/.test(last) ? last.replace(/^\d{4,5}\s*/, '').trim() : '';
}

/** The stored logo as a PNG the PDF reads, or null: a missing or undecodable logo leaves the name in its place, never a refusal. */
async function logoOf(storedLogoPath, uploadsDir) {
  if (!storedLogoPath) return null;
  try {
    const bytes = fs.readFileSync(path.join(uploadsDir, path.basename(String(storedLogoPath))));
    return await sharp(bytes).rotate().resize({ width: LOGO_BOX, height: LOGO_BOX, fit: 'inside', withoutEnlargement: true }).png().toBuffer();
  } catch {
    return null;
  }
}

module.exports = { townOf, logoOf };
