/**
 * RepeatedRows — the rows of a block that holds a list (gallery photos, questions, opening hours): each row with
 * its « Retirer », then « Ajouter … » under the list, up to `max`.
 *
 * Props: `rows`, `onChange(rows)`, `renderRow(row, index, update)`, `newRow()`, `addLabel`, `max`, `rowLabel(index)`.
 */
import { Box, Button, IconButton, Tooltip } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import CloseIcon from '@mui/icons-material/Close';

export default function RepeatedRows({
  rows, onChange, renderRow, newRow, addLabel, max = 30, rowLabel = (i) => `la ligne ${i + 1}`,
}) {
  return (
    <Box sx={{ display: 'grid', gap: 1.5 }}>
      {rows.map((row, index) => (
        // eslint-disable-next-line react/no-array-index-key
        <Box key={index} sx={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 44px', gap: 1, alignItems: 'start', pb: 1.5, borderBottom: 1, borderColor: 'divider' }}>
          <Box sx={{ minWidth: 0 }}>{renderRow(row, index, (patch) => onChange(rows.map((r, i) => (i === index ? { ...r, ...patch } : r))))}</Box>
          <Tooltip title="Retirer">
            <IconButton aria-label={`Retirer ${rowLabel(index)}`} onClick={() => onChange(rows.filter((_, i) => i !== index))} sx={{ width: 44, height: 44 }}>
              <CloseIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      ))}
      <Box>
        <Button startIcon={<AddIcon />} disabled={rows.length >= max} onClick={() => onChange([...rows, newRow()])} sx={{ minHeight: 44 }}>{addLabel}</Button>
      </Box>
    </Box>
  );
}
