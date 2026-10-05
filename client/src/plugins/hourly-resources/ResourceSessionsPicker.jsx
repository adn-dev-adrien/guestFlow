// The session editor of a resource sold by the hour, under its line on the fiche
// (specs/plugins-phase-3c-hourly-resources.md rule 21; the feature is specs/resource-hourly-scheduling.md
// §3.2): sessions on the stay's days, slot-stepped, priced by the server.
import React from 'react';
import {
  Box, Typography, Stack, Button, TextField, MenuItem, IconButton,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import { enumerateStayDates, timeOptions, toMinutes, minutesToTime } from './resourceSessions';

// French day-of-week + date label (e.g. « lun. 7 juil. »).
function dateLabel(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ''))) return iso || '';
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
}

export default function ResourceSessionsPicker({ resource, sessions: given, stay, onSessionsChange, disabled }) {
  const sessions = Array.isArray(given) ? given : [];
  const days = enumerateStayDates(stay.startDate, stay.endDate);
  const times = timeOptions(resource.openTime, resource.closeTime, resource.slotDuration);
  const minMinutes = Math.max(0, Number(resource.minimumUsageMinutes || 0));
  const slot = Math.max(1, Number(resource.slotDuration || 30));
  // The mandatory first whole hour: the minimum gap between start and end (≥ 1 h).
  const firstDur = minMinutes > 0 ? minMinutes : 60;
  const closeMin = toMinutes(resource.closeTime || '22:00');
  // End of a session given its start: start + the first whole hour, clamped to the closing time.
  const endForStart = (start) => minutesToTime(Math.min(closeMin, toMinutes(start) + firstDur));

  const updateSession = (idx, patch) => onSessionsChange(sessions.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  const removeSession = (idx) => onSessionsChange(sessions.filter((_, i) => i !== idx));
  // Picking a start auto-sets the end to start + 1 h (the first whole hour).
  const setStart = (idx, start) => updateSession(idx, { start, end: endForStart(start) });
  const addSession = () => {
    const date = days[0] || stay.startDate;
    const start = (times[0]) || resource.openTime || '12:00';
    onSessionsChange([...sessions, { date, start, end: endForStart(start) }]);
  };
  const isInvalid = (s) => {
    const dur = toMinutes(s.end) - toMinutes(s.start);
    return dur <= 0 || (minMinutes > 0 && dur < minMinutes);
  };

  return (
    <Box sx={{ mt: 1, pt: 1, borderTop: '1px solid', borderColor: 'divider' }}>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
        <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600 }}>Séances</Typography>
        <Typography variant="caption" color="text.secondary">{resource.openTime}–{resource.closeTime} • pas {slot} min</Typography>
      </Stack>
      <Stack spacing={1}>
        {sessions.length === 0 && (
          <Typography variant="caption" color="text.secondary">Aucune séance.</Typography>
        )}
        {sessions.map((s, idx) => (
          <Stack key={idx} direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'center' } }}>
            <TextField
              select size="small" label="Jour" value={days.includes(s.date) ? s.date : ''}
              onChange={(e) => updateSession(idx, { date: e.target.value })}
              disabled={disabled} sx={{ minWidth: 150 }}
            >
              {days.map((d) => <MenuItem key={d} value={d} sx={{ textTransform: 'capitalize' }}>{dateLabel(d)}</MenuItem>)}
            </TextField>
            <TextField
              select size="small" label="Début" value={times.includes(s.start) ? s.start : ''}
              onChange={(e) => setStart(idx, e.target.value)}
              disabled={disabled} sx={{ width: 110 }}
            >
              {/* A start that can't fit the first whole hour before closing is disabled. */}
              {times.map((t) => <MenuItem key={t} value={t} disabled={toMinutes(t) + firstDur > closeMin}>{t}</MenuItem>)}
            </TextField>
            <TextField
              select size="small" label="Fin" value={times.includes(s.end) ? s.end : ''}
              onChange={(e) => updateSession(idx, { end: e.target.value })}
              error={isInvalid(s)}
              helperText={isInvalid(s) ? `min. ${Math.round(minMinutes / 60 * 10) / 10} h` : ''}
              disabled={disabled} sx={{ width: 110 }}
            >
              {/* End options before « début + 1 h » are greyed out; the Select opens centred on the
                  current value (MUI scrolls the selected item into view). */}
              {times.map((t) => <MenuItem key={t} value={t} disabled={toMinutes(t) < toMinutes(s.start) + firstDur}>{t}</MenuItem>)}
            </TextField>
            <IconButton size="small" color="error" onClick={() => removeSession(idx)} disabled={disabled} aria-label="Retirer la séance">
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Stack>
        ))}
        <Button size="small" startIcon={<AddIcon />} onClick={addSession} disabled={disabled || days.length === 0} sx={{ alignSelf: 'flex-start' }}>
          Ajouter une séance
        </Button>
      </Stack>
    </Box>
  );
}
