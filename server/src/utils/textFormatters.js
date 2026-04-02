function sentenceCase(value) {
  if (value === null || value === undefined) return '';
  const trimmed = String(value).trim();
  if (!trimmed) return '';

  const lower = trimmed.toLocaleLowerCase('fr-FR');
  const firstLetterIndex = lower.search(/\p{L}/u);
  if (firstLetterIndex === -1) return lower;

  return `${lower.slice(0, firstLetterIndex)}${lower.charAt(firstLetterIndex).toLocaleUpperCase('fr-FR')}${lower.slice(firstLetterIndex + 1)}`;
}

module.exports = {
  sentenceCase,
};