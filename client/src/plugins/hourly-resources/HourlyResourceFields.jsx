// The hourly block of the resource form (specs/plugins-phase-3c-hourly-resources.md rule 21), drawn
// under the base fields through the `resources.fields` slot, for a resource sold by the hour: the
// slots, the opening, the heat-up, the planning card and its evening and external rates.
import React from 'react';
import {
  Box, Typography, FormControlLabel, Switch, FormControl, InputLabel, Select, MenuItem,
  TextField, FormGroup, Checkbox,
} from '@mui/material';

const SLOT_DURATION_OPTIONS = [
  { value: 5, label: '5 min' },
  { value: 10, label: '10 min' },
  { value: 15, label: '15 min' },
  { value: 30, label: '30 min' },
  { value: 60, label: '1 heure' },
  { value: 120, label: '2 heures' },
];

const DAY_OPTIONS = [
  { value: 1, label: 'Lun' },
  { value: 2, label: 'Mar' },
  { value: 3, label: 'Mer' },
  { value: 4, label: 'Jeu' },
  { value: 5, label: 'Ven' },
  { value: 6, label: 'Sam' },
  { value: 0, label: 'Dim' },
];

export default function HourlyResourceFields({ draft, onChange }) {
  const openDays = Array.isArray(draft.openDays) ? draft.openDays : [0, 1, 2, 3, 4, 5, 6];
  const toggleDay = (dayNum) => onChange({
    openDays: openDays.includes(dayNum) ? openDays.filter((d) => d !== dayNum) : [...openDays, dayNum],
  });
  const minutes = (value) => Math.max(0, Number(value) || 0);
  const rate = (value) => Math.max(0, Number(value) || 0);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
      <FormControl fullWidth size="small">
        <InputLabel>Temps minimum d'utilisation</InputLabel>
        <Select
          value={draft.minimumUsageMinutes || 60}
          label="Temps minimum d'utilisation"
          onChange={(e) => onChange({ minimumUsageMinutes: Number(e.target.value) || 0 })}
        >
          {SLOT_DURATION_OPTIONS.map((o) => <MenuItem key={`min-${o.value}`} value={o.value}>{o.label}</MenuItem>)}
        </Select>
      </FormControl>
      <FormControlLabel
        control={<Switch checked={Boolean(draft.isComplex)} onChange={(e) => onChange({ isComplex: e.target.checked })} />}
        label={<Typography variant="body2" fontWeight={600}>Ressource à créneaux (bain nordique, salle…)</Typography>}
      />
      {draft.isComplex && (
        <Box sx={{ pl: 2, display: 'flex', flexDirection: 'column', gap: 2, borderLeft: '3px solid', borderColor: 'primary.light' }}>
          <FormControl fullWidth size="small">
            <InputLabel>Durée minimale</InputLabel>
            <Select
              value={draft.slotDuration || 5}
              label="Durée minimale"
              onChange={(e) => onChange({ slotDuration: e.target.value })}
            >
              {SLOT_DURATION_OPTIONS.map((o) => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
            </Select>
          </FormControl>
          <Box sx={{ display: 'flex', gap: 2 }}>
            <TextField
              label="Heure d'ouverture"
              type="time"
              size="small"
              value={draft.openTime || '08:00'}
              onChange={(e) => onChange({ openTime: e.target.value })}
              sx={{ flex: 1 }}
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <TextField
              label="Heure de fermeture"
              type="time"
              size="small"
              value={draft.closeTime || '22:00'}
              onChange={(e) => onChange({ closeTime: e.target.value })}
              sx={{ flex: 1 }}
              slotProps={{ inputLabel: { shrink: true } }}
            />
          </Box>
          <TextField
            label="Temps de remise en état (min)"
            type="number"
            size="small"
            value={draft.turnoverMinutes || 0}
            onChange={(e) => onChange({ turnoverMinutes: minutes(e.target.value) })}
            helperText="Entre deux passages, quand la ressource est déjà prête"
            fullWidth
            slotProps={{ htmlInput: { min: 0, step: 5 } }}
          />
          {/* Thermal model (specs/hourly-resource-quantity-and-sas-scheduling.md §3.3 rule 11). Left
              at 0 the resource behaves exactly as before: only the opening window, the capacity and
              the turnover gate a slot. */}
          <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, gap: 2 }}>
            <TextField
              label="Montée en chauffe (min)"
              type="number"
              size="small"
              value={draft.heatUpMinutes || 0}
              onChange={(e) => onChange({ heatUpMinutes: minutes(e.target.value) })}
              helperText="Temps pour rendre la ressource utilisable à froid (bain nordique : 240)"
              fullWidth
              slotProps={{ htmlInput: { min: 0, step: 15 } }}
            />
            <TextField
              label="Reste chaude (min)"
              type="number"
              size="small"
              value={draft.heatRetentionMinutes || 0}
              onChange={(e) => onChange({ heatRetentionMinutes: minutes(e.target.value) })}
              helperText="Durée d'utilisation sans réchauffer après un passage (bain nordique : 480)"
              fullWidth
              slotProps={{ htmlInput: { min: 0, step: 30 } }}
            />
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary" gutterBottom display="block">Jours d'ouverture</Typography>
            <FormGroup row>
              {DAY_OPTIONS.map((d) => (
                <FormControlLabel
                  key={d.value}
                  control={<Checkbox size="small" checked={openDays.includes(d.value)} onChange={() => toggleDay(d.value)} />}
                  label={<Typography variant="caption">{d.label}</Typography>}
                  sx={{ mr: 1 }}
                />
              ))}
            </FormGroup>
          </Box>

          {/* Hourly scheduling + time-banded grid (specs/resource-hourly-scheduling.md §3.1): the
              planning card + the day/evening + external grid. */}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, borderTop: '1px dashed', borderColor: 'divider', pt: 1.5 }}>
            <FormControlLabel
              control={<Switch checked={Boolean(draft.showsPlanningCard)} onChange={(e) => onChange({ showsPlanningCard: e.target.checked })} />}
              label={<Typography variant="body2" fontWeight={600}>Planification par séances + tarif horaire (carte planning)</Typography>}
            />
            {draft.showsPlanningCard && (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                <Typography variant="caption" color="text.secondary">
                  Tarif de jour : le prix général ({draft.price || 0} €/h).
                </Typography>
                <Box sx={{ display: 'flex', gap: 2, flexDirection: { xs: 'column', sm: 'row' } }}>
                  <TextField
                    label="Heure de bascule soir"
                    type="time"
                    size="small"
                    value={draft.hourlyEveningStart || ''}
                    onChange={(e) => onChange({ hourlyEveningStart: e.target.value })}
                    sx={{ flex: 1 }}
                    slotProps={{ inputLabel: { shrink: true } }}
                  />
                  <TextField
                    label="Tarif horaire soir (€/h)"
                    type="number"
                    size="small"
                    value={draft.hourlyEveningRate ?? 0}
                    onChange={(e) => onChange({ hourlyEveningRate: rate(e.target.value) })}
                    sx={{ flex: 1 }}
                    slotProps={{ htmlInput: { min: 0, step: '0.5' } }}
                  />
                </Box>
                <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
                  Tarif extérieurs (sans réservation logement)
                </Typography>
                <Box sx={{ display: 'flex', gap: 2, flexDirection: { xs: 'column', sm: 'row' } }}>
                  <TextField
                    label="Tarif jour extérieurs (€/h)"
                    type="number"
                    size="small"
                    value={draft.hourlyExternalDayRate ?? 0}
                    onChange={(e) => onChange({ hourlyExternalDayRate: rate(e.target.value) })}
                    helperText="Vide / 0 = tarif invité"
                    sx={{ flex: 1 }}
                    slotProps={{ htmlInput: { min: 0, step: '0.5' } }}
                  />
                  <TextField
                    label="Tarif soir extérieurs (€/h)"
                    type="number"
                    size="small"
                    value={draft.hourlyExternalEveningRate ?? 0}
                    onChange={(e) => onChange({ hourlyExternalEveningRate: rate(e.target.value) })}
                    helperText="Vide / 0 = tarif invité"
                    sx={{ flex: 1 }}
                    slotProps={{ htmlInput: { min: 0, step: '0.5' } }}
                  />
                </Box>
              </Box>
            )}
          </Box>
        </Box>
      )}
    </Box>
  );
}
