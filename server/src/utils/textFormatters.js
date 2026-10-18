function sentenceCase(value) {
  if (value === null || value === undefined) return '';
  const trimmed = String(value).trim();
  if (!trimmed) return '';

  const lower = trimmed.toLocaleLowerCase('fr-FR');
  const firstLetterIndex = lower.search(/\p{L}/u);
  if (firstLetterIndex === -1) return lower;

  return `${lower.slice(0, firstLetterIndex)}${lower.charAt(firstLetterIndex).toLocaleUpperCase('fr-FR')}${lower.slice(firstLetterIndex + 1)}`;
}

// Free text (notes, descriptions) keeps the operator's capitals: only the first letter is raised.
// specs/free-text-keeps-case.md
function capitalizeFirst(value) {
  if (value === null || value === undefined) return '';
  const trimmed = String(value).trim();
  if (!trimmed) return '';

  const firstLetterIndex = trimmed.search(/\p{L}/u);
  if (firstLetterIndex === -1) return trimmed;

  return `${trimmed.slice(0, firstLetterIndex)}${trimmed.charAt(firstLetterIndex).toLocaleUpperCase('fr-FR')}${trimmed.slice(firstLetterIndex + 1)}`;
}

// A person's name (specs/free-text-keeps-case.md rule 5). Typed all in one case (« jean-pierre »,
// « MARTIN-DUPONT ») → each word and each part after a hyphen or an apostrophe starts with a capital
// (« Jean-Pierre », « Martin-Dupont », « D'Arc »). Typed in mixed case (« McDonald », « Le Goff »,
// « de La Fontaine ») → kept as typed: the guest knows how their name is spelt.
function personNameCase(value) {
  if (value === null || value === undefined) return '';
  const trimmed = String(value).trim().replace(/\s+/g, ' ');
  if (!trimmed) return '';

  const lower = trimmed.toLocaleLowerCase('fr-FR');
  const upper = trimmed.toLocaleUpperCase('fr-FR');
  if (trimmed !== lower && trimmed !== upper) return trimmed;

  return lower.replace(/(^|[\s\-'’])(\p{L})/gu, (_, sep, letter) => `${sep}${letter.toLocaleUpperCase('fr-FR')}`);
}

module.exports = {
  sentenceCase,
  capitalizeFirst,
  personNameCase,
};