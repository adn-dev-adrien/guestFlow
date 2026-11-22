/**
 * The embedded faces of the PDFs (the devis and the documents of plugins): shared so every document is drawn with the same fonts.
 */

const path = require('path');
const fs = require('fs');

// specs/ui-review-2026-10-19-operations.md rules 17, 27-29 — every word of the document is drawn by an
// embedded face (SIL Open Font License, © Adobe, upstream release files unmodified): the serif of the
// app (Source Serif 4 Semibold) for the titles, its sister Source Sans 3 for the body. Each is ONE
// full file covering Latin, Latin Extended A/B, Vietnamese, Greek and Cyrillic, so « Łukasz Wójcik »,
// « Çağrı Yılmaz », « Nguyễn » or « Анастасия » print as typed; PDFKit embeds only the glyphs used.
// The PDF standard fonts (WinAnsi only) are the last resort of a missing file, never the norm.
// CFF-flavoured (.otf) files on purpose: fontkit 2 cannot subset the composite glyphs of the TrueType
// flavour (it throws when the document ends).
const FONT_DIR = path.join(__dirname, '..', 'assets', 'fonts');
const FACES = Object.freeze({
  serif: { name: 'MaisonSerif', file: path.join(FONT_DIR, 'SourceSerif4-Semibold.otf.woff2'), standard: 'Times-Bold' },
  regular: { name: 'MaisonSans', file: path.join(FONT_DIR, 'SourceSans3-Regular.otf.woff2'), standard: 'Helvetica' },
  bold: { name: 'MaisonSansBold', file: path.join(FONT_DIR, 'SourceSans3-Semibold.otf.woff2'), standard: 'Helvetica-Bold' },
  italic: { name: 'MaisonSansItalic', file: path.join(FONT_DIR, 'SourceSans3-It.otf.woff2'), standard: 'Helvetica-Oblique' },
});

// Registers the embedded faces on a document and answers the name to draw each role with. A file
// that is missing, empty, truncated or not a font falls back to that role's standard face (rule 27):
// `registerFont` only stores the path, so each face is opened here, where a bad file can still be
// caught, rather than at its first use in the middle of the document. Leaves the body face current.
function registerFaces(doc, faces = FACES) {
  const names = {};
  for (const [role, face] of Object.entries(faces)) {
    try {
      if (!fs.existsSync(face.file)) throw new Error('missing font file');
      doc.registerFont(face.name, face.file);
      doc.font(face.name);
      names[role] = face.name;
    } catch {
      names[role] = face.standard;
    }
  }
  doc.font(names.regular || FACES.regular.standard);
  return names;
}

module.exports = { FACES, registerFaces };
