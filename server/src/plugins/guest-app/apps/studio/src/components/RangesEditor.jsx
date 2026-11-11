/**
 * RangesEditor — up to three service ranges of one day (rule 40), each « 8 h 00 – 12 h 00 » picked in 30-minute
 * steps, with « Ajouter une plage » and a cross to remove one. The server judges overlaps and order.
 *
 * Props: `ranges` ([{ from, to }] in `HH:MM`), `onChange(ranges)`, `label` (the day, for the controls' names),
 *        `max` (default 3).
 */
import {
  Box, Button, IconButton, MenuItem, TextField, Tooltip,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import CloseIcon from '@mui/icons-material/Close';

export const TIMES = Array.from({ length: 48 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`).concat('23:59');
export const timeLabel = (hhmm) => (hhmm === '23:59' ? 'minuit' : `${Number(hhmm.slice(0, 2))} h ${hhmm.slice(3)}`);

function TimeSelect({ value, onChange, label }) {
  const options = TIMES.includes(value) ? TIMES : [value, ...TIMES];
  return (
    <TextField select size="small" value={value} onChange={(e) => onChange(e.target.value)} slotProps={{ htmlInput: { 'aria-label': label } }} sx={{ minWidth: 104 }}>
      {options.map((t) => <MenuItem key={t} value={t}>{timeLabel(t)}</MenuItem>)}
    </TextField>
  );
}

export default function RangesEditor({ ranges, onChange, label, max = 3 }) {
  const update = (index, patch) => onChange(ranges.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  const next = () => {
    const last = ranges[ranges.length - 1];
    if (!last) return { from: '08:00', to: '12:00' };
    const at = Math.min(TIMES.indexOf(last.to) + 2, TIMES.length - 3);
    return { from: TIMES[at], to: TIMES[Math.min(at + 4, TIMES.length - 1)] };
  };
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
      {ranges.map((r, i) => (
        // eslint-disable-next-line react/no-array-index-key
        <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 0.5, border: 1, borderColor: 'divider', borderRadius: 2, px: 1, py: 0.5 }}>
          <TimeSelect value={r.from} onChange={(from) => update(i, { from })} label={`${label}, plage ${i + 1}, début`} />
          <span aria-hidden="true">–</span>
          <TimeSelect value={r.to} onChange={(to) => update(i, { to })} label={`${label}, plage ${i + 1}, fin`} />
          <Tooltip title="Retirer la plage">
            <IconButton aria-label={`Retirer la plage ${i + 1} du ${label.toLowerCase()}`} onClick={() => onChange(ranges.filter((_, j) => j !== i))} sx={{ width: 44, height: 44 }}>
              <CloseIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      ))}
      {ranges.length < max ? (
        <Button variant="outlined" startIcon={<AddIcon />} onClick={() => onChange([...ranges, next()])} sx={{ minHeight: 44 }}>Ajouter une plage</Button>
      ) : null}
    </Box>
  );
}
