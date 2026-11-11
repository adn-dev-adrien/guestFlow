/**
 * The app's own words, FR / EN (specs/guest-app.md rule 19). Booklet content, item titles, prices and every
 * order label come from the server in the session's language; these are only the chrome around them.
 */
import { createContext, useContext } from 'react';
import fr from './fr.json';
import en from './en.json';

const STRINGS = { fr, en };

export const LANGS = Object.freeze(['fr', 'en']);

/** `translate('en', 'home.hello', { name: 'Marie' })`; `{ n: 1 }` picks the `_one` form when there is one. */
export function translate(lang, key, vars = {}) {
  const table = STRINGS[lang] || fr;
  const oneKey = vars.n === 1 ? `${key}_one` : null;
  const text = (oneKey && table[oneKey]) || table[key] || fr[key] || key;
  return text.replace(/\{(\w+)\}/g, (_, name) => (vars[name] === undefined ? `{${name}}` : String(vars[name])));
}

export const LangContext = createContext('fr');

/** `const t = useT(); t('cart.total')` — in the language the app shows. */
export function useT() {
  const lang = useContext(LangContext);
  return (key, vars) => translate(lang, key, vars);
}

export const useLang = () => useContext(LangContext);
