/**
 * Latin-1 text for the accountant's CSV (specs/accountant-accounting-export.md rule 31).
 *
 * The export is ISO-8859-1 (rule 16): `Buffer.from(text, 'latin1')` keeps only the low byte of a
 * character outside that range, so « ’ » (U+2019, typed by every iPhone in O’Neil) became the control
 * byte 0x19 and « Œ » became « R ». Each such character is transliterated first: typographic quotes and
 * dashes to their ASCII form, the ligatures spelled out, a decomposable letter stripped of its accent,
 * anything else « ? ». Latin-1 characters (é, ç, Ë…) are left as they are.
 */

const MAP = new Map(Object.entries({
  '‘': "'", '’': "'", '‚': "'", '‛': "'", '′': "'", 'ʼ': "'",
  '“': '"', '”': '"', '„': '"', '‟': '"', '″': '"',
  '‐': '-', '‑': '-', '‒': '-', '–': '-', '—': '-', '―': '-', '−': '-',
  '…': '...',
  'Œ': 'OE', 'œ': 'oe', 'Ÿ': 'Y', 'Ĳ': 'IJ', 'ĳ': 'ij',
  'Ł': 'L', 'ł': 'l', 'Đ': 'D', 'đ': 'd', 'ı': 'i', 'Ħ': 'H', 'ħ': 'h',
  '€': 'EUR',
  ' ': ' ', ' ': ' ', ' ': ' ', '​': '',
}));

function toLatin1Text(value) {
  let out = '';
  for (const ch of String(value == null ? '' : value)) {
    if (ch.codePointAt(0) <= 0xff) { out += ch; continue; }
    if (MAP.has(ch)) { out += MAP.get(ch); continue; }
    const base = ch.normalize('NFKD').replace(/[̀-ͯ]/g, '');
    out += base && [...base].every((c) => c.codePointAt(0) <= 0xff) ? base : '?';
  }
  return out;
}

module.exports = { toLatin1Text };
