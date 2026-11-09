/**
 * `steps` (rule 18): one step per line, in FR and EN. A step's photo, when it has one, stays with the step of the
 * same rank.
 */
import { useState } from 'react';
import BilingualField from '../BilingualField';

const linesOf = (text) => String(text || '').split('\n').map((l) => l.trim()).filter(Boolean);

export default function StepsEditor({ data, onChange }) {
  const steps = data.steps || [];
  const [text, setText] = useState(() => ({
    fr: steps.map((s) => (s.text && s.text.fr) || '').join('\n'),
    en: steps.map((s) => (s.text && s.text.en) || '').join('\n'),
  }));
  const update = (next) => {
    setText(next);
    const fr = linesOf(next.fr);
    const en = linesOf(next.en);
    onChange({
      steps: fr.map((line, i) => ({
        text: { fr: line, en: en[i] || '' },
        ...(steps[i] && steps[i].mediaId ? { mediaId: steps[i].mediaId } : {}),
      })),
    });
  };
  return (
    <BilingualField
      value={text}
      multiline
      minRows={3}
      required
      onChange={update}
      helperText="Une étape par ligne, dans le même ordre en anglais. « Titre — détail » pour ajouter une précision."
    />
  );
}
