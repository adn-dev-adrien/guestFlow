/** The preview's language, kept while the operator moves between screens (rule 49: FR / EN side by side). */
import { useState } from 'react';

let remembered = 'fr';

export function usePreviewLang() {
  const [lang, setLang] = useState(remembered);
  return [lang, (next) => { remembered = next; setLang(next); }];
}
