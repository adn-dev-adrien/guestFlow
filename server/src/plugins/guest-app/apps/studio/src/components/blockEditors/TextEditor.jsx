/** `text` (rule 18): rich text in FR and EN, typed in the studio's light notation (utils/richText.js). */
import { useState } from 'react';
import BilingualField from '../BilingualField';
import { toHtml, toNotation } from '../../utils/richText';

export default function TextEditor({ data, onChange }) {
  const [notation, setNotation] = useState(() => ({ fr: toNotation(data.html && data.html.fr), en: toNotation(data.html && data.html.en) }));
  return (
    <BilingualField
      value={notation}
      multiline
      minRows={3}
      required
      maxLength={20000}
      onChange={(next) => { setNotation(next); onChange({ html: { fr: toHtml(next.fr), en: toHtml(next.en) } }); }}
      helperText="**gras**, *italique*, [lien](https://…) ou [Appeler](tel:+33…). Une ligne vide sépare deux paragraphes ; « - » en début de ligne fait une liste."
    />
  );
}
