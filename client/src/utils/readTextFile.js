/**
 * The text of a file the operator picked (specs/guest-email-texts-made-simple.md rule 23). Excel's
 * « CSV (point-virgule) » writes Windows-1252 (MacRoman on old Macs), not UTF-8: read as UTF-8 it
 * would turn every accent into « � ». UTF-8 is tried strictly first, then Windows-1252.
 */
export default async function readTextFile(file) {
  const bytes = await file.arrayBuffer();
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}
