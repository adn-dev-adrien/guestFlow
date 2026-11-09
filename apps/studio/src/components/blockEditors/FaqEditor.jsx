/** `faq` (rule 18): questions and answers, an accordion in the app. */
import { Box } from '@mui/material';
import BilingualField from '../BilingualField';
import RepeatedRows from './RepeatedRows';

export default function FaqEditor({ data, onChange }) {
  return (
    <RepeatedRows
      rows={data.items || []}
      onChange={(items) => onChange({ items })}
      newRow={() => ({ question: { fr: '', en: '' }, answer: { fr: '', en: '' } })}
      addLabel="Ajouter une question"
      max={50}
      rowLabel={(i) => `la question ${i + 1}`}
      renderRow={(row, index, update) => (
        <Box sx={{ display: 'grid', gap: 1 }}>
          <BilingualField label={`Question ${index + 1}`} value={row.question} required maxLength={240} onChange={(question) => update({ question })} />
          <BilingualField label="Réponse" value={row.answer} multiline required maxLength={2000} onChange={(answer) => update({ answer })} />
        </Box>
      )}
    />
  );
}
