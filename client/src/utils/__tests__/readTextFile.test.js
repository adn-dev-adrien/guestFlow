// specs/guest-email-texts-made-simple.md rule 23 — a CSV saved by Excel as Windows-1252 keeps its
// accents; a UTF-8 one is read as is.
import readTextFile from '../readTextFile';

const fileOf = (bytes) => ({ arrayBuffer: () => Promise.resolve(Uint8Array.from(bytes).buffer) });

test('rule 23: UTF-8 is read as UTF-8', async () => {
  expect(await readTextFile(fileOf([0x43, 0x61, 0x66, 0xc3, 0xa9]))).toBe('Café');
});

test('rule 23: Windows-1252 (Excel « CSV point-virgule ») keeps its accents', async () => {
  expect(await readTextFile(fileOf([0x43, 0x61, 0x66, 0xe9, 0x3b, 0xe0]))).toBe('Café;à');
});

test('rule 23: a file in another encoding (C1 control characters left) is refused, not read wrong', async () => {
  // 0x8F is « è » in MacRoman and unassigned in Windows-1252.
  await expect(readTextFile(fileOf([0x43, 0x61, 0x66, 0x8f]))).rejects.toThrow('Fichier mal encodé : l’enregistrer en « CSV UTF-8 ».');
});
