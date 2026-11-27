/**
 * What the printed cards say of the company (specs/gift-vouchers/gift-voucher-campaigns.md rule 50): its name, its town and its logo, read from the company settings the operator already
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

const DEPARTMENTS = Object.freeze({
  '01': 'Ain', '02': 'Aisne', '03': 'Allier', '04': 'Alpes-de-Haute-Provence', '05': 'Hautes-Alpes', '06': 'Alpes-Maritimes', '07': 'Ardèche', '08': 'Ardennes', '09': 'Ariège', 10: 'Aube',
  11: 'Aude', 12: 'Aveyron', 13: 'Bouches-du-Rhône', 14: 'Calvados', 15: 'Cantal', 16: 'Charente', 17: 'Charente-Maritime', 18: 'Cher', 19: 'Corrèze', 21: 'Côte-d’Or', 22: 'Côtes-d’Armor',
  23: 'Creuse', 24: 'Dordogne', 25: 'Doubs', 26: 'Drôme', 27: 'Eure', 28: 'Eure-et-Loir', 29: 'Finistère', 30: 'Gard', 31: 'Haute-Garonne', 32: 'Gers', 33: 'Gironde', 34: 'Hérault',
  35: 'Ille-et-Vilaine', 36: 'Indre', 37: 'Indre-et-Loire', 38: 'Isère', 39: 'Jura', 40: 'Landes', 41: 'Loir-et-Cher', 42: 'Loire', 43: 'Haute-Loire', 44: 'Loire-Atlantique', 45: 'Loiret',
  46: 'Lot', 47: 'Lot-et-Garonne', 48: 'Lozère', 49: 'Maine-et-Loire', 50: 'Manche', 51: 'Marne', 52: 'Haute-Marne', 53: 'Mayenne', 54: 'Meurthe-et-Moselle', 55: 'Meuse', 56: 'Morbihan',
  57: 'Moselle', 58: 'Nièvre', 59: 'Nord', 60: 'Oise', 61: 'Orne', 62: 'Pas-de-Calais', 63: 'Puy-de-Dôme', 64: 'Pyrénées-Atlantiques', 65: 'Hautes-Pyrénées', 66: 'Pyrénées-Orientales',
  67: 'Bas-Rhin', 68: 'Haut-Rhin', 69: 'Rhône', 70: 'Haute-Saône', 71: 'Saône-et-Loire', 72: 'Sarthe', 73: 'Savoie', 74: 'Haute-Savoie', 75: 'Paris', 76: 'Seine-Maritime', 77: 'Seine-et-Marne',
  78: 'Yvelines', 79: 'Deux-Sèvres', 80: 'Somme', 81: 'Tarn', 82: 'Tarn-et-Garonne', 83: 'Var', 84: 'Vaucluse', 85: 'Vendée', 86: 'Vienne', 87: 'Haute-Vienne', 88: 'Vosges', 89: 'Yonne',
  90: 'Territoire de Belfort', 91: 'Essonne', 92: 'Hauts-de-Seine', 93: 'Seine-Saint-Denis', 94: 'Val-de-Marne', 95: 'Val-d’Oise',
});

/** « 07120 Ruoms » → « Ardèche »: the department the postcode of the address belongs to (specs/gift-vouchers/gift-voucher-week-weekend-and-print.md rule 18); none when it names none. */
function departmentOf(address) {
  const postcode = /(?:^|\n)\s*(\d{5})\b/.exec(String(address || ''));
  if (!postcode) return '';
  const code = postcode[1];
  if (code.startsWith('20')) return Number(code) < 20200 ? 'Corse-du-Sud' : 'Haute-Corse';
  return DEPARTMENTS[code.slice(0, 2)] || '';
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

module.exports = { townOf, departmentOf, logoOf };
