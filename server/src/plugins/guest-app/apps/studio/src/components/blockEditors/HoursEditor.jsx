/** `hours` (rule 18): an opening-hours table — a day, its hours — under an optional title. */
import { Box } from '@mui/material';
import BilingualField from '../BilingualField';
import RepeatedRows from './RepeatedRows';

export default function HoursEditor({ data, onChange }) {
  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <BilingualField label="Titre (facultatif)" value={data.title} maxLength={120} onChange={(title) => onChange({ ...data, title })} />
      <RepeatedRows
        rows={data.rows || []}
        onChange={(rows) => onChange({ ...data, rows })}
        newRow={() => ({ label: { fr: '', en: '' }, value: { fr: '', en: '' } })}
        addLabel="Ajouter une ligne"
        max={14}
        renderRow={(row, index, update) => (
          <Box sx={{ display: 'grid', gap: 1 }}>
            <BilingualField label={`Jour ${index + 1}`} value={row.label} required maxLength={60} placeholder={{ fr: 'Lundi', en: 'Monday' }} onChange={(label) => update({ label })} />
            <BilingualField label="Horaire" value={row.value} required maxLength={120} placeholder={{ fr: '8 h – 12 h', en: '8 am – 12 pm' }} onChange={(value) => update({ value })} />
          </Box>
        )}
      />
    </Box>
  );
}
