/**
 * The article a property's name takes in the guest emails — « au Gîte », « à la Bergerie »
 * (specs/guest-email-texts-made-simple.md rule 29). Pure.
 *
 * A name that already starts with an article contracts with it: « Le Fournil » with « au » reads
 * « au Fournil », « La Bergerie » with « à la » reads « à la Bergerie », « Les Pins » with « aux »
 * reads « aux Pins », « L'Oustal » with « à l' » reads « à l'Oustal ». Such a name says its own
 * article, so it is derived with certainty; a name starting with a vowel takes « à l' » as a guess;
 * any other name gives no clue.
 *
 *   ARTICLES                       the five articles a property accepts
 *   format(name, article, lang)    « au Fournil »; English has no article: the name alone
 *   derive(name)                   { article, certain } — the article to start from
 *   choices(name)                  [{ value, label }] — the articles worth offering for this name
 *                                  (a name holding its own article offers that one only)
 */

const ARTICLES = Object.freeze(['au', 'à la', "à l'", 'aux', 'à']);

const str = (v) => (v == null ? '' : String(v)).trim();

// The article a name starts with, the one it contracts into, and the name without it.
const LEADING = [
  { re: /^le\s+(.+)$/i, article: 'au' },
  { re: /^la\s+(.+)$/i, article: 'à la' },
  { re: /^les\s+(.+)$/i, article: 'aux' },
  { re: /^l['’]\s*(.+)$/i, article: "à l'" },
];

function leading(name) {
  const n = str(name);
  for (const { re, article } of LEADING) {
    const m = re.exec(n);
    if (m) return { article, rest: m[1] };
  }
  return null;
}

const startsWithVowel = (name) => /^[aeiouyhàâäéèêëîïôöùûü]/i.test(str(name));

function format(name, article, lang = 'fr') {
  const n = str(name);
  if (!n) return '';
  if (lang === 'en') return n;
  const a = str(article) || 'au';
  const own = leading(n);
  if (own && own.article === a) return a.endsWith("'") ? `${a}${own.rest}` : `${a} ${own.rest}`;
  return a.endsWith("'") ? `${a}${n}` : `${a} ${n}`;
}

function derive(name) {
  const own = leading(name);
  if (own) return { article: own.article, certain: true };
  if (startsWithVowel(name)) return { article: "à l'", certain: false };
  return { article: 'au', certain: false };
}

function choices(name) {
  const own = leading(name);
  let values;
  if (own) values = [own.article];
  else if (startsWithVowel(name)) values = ["à l'", 'aux', 'à'];
  else values = ['au', 'à la', 'aux', 'à'];
  return values.map((value) => ({ value, label: format(name, value) }));
}

module.exports = { ARTICLES, format, derive, choices };
