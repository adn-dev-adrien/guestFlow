/**
 * The text of a file the operator picked (specs/guest-email-texts-made-simple.md rule 23). Excel's
 * « CSV (point-virgule) » writes Windows-1252, not UTF-8: read as UTF-8 it would turn every accent
 * into « � ». UTF-8 is tried strictly first, then Windows-1252. A file that still decodes to C1
 * control characters (U+0080–U+009F) is in some other encoding (MacRoman…) and is refused rather than
 * read wrong.
 */
export const ENCODING_MESSAGE = 'Fichier mal encodé : l’enregistrer en « CSV UTF-8 ».';

export default async function readTextFile(file) {
  const bytes = await file.arrayBuffer();
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    const text = new TextDecoder('windows-1252').decode(bytes);
    if (/[\u0080-\u009F]/.test(text)) throw new Error(ENCODING_MESSAGE);
    return text;
  }
}
