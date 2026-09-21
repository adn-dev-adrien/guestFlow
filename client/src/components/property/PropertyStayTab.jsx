/**
 * PropertyStayTab — « Séjour » tab of the property page (specs/settings-rationalization.md
 * rules 17c, 21): the facts the guest emails read (parking distance, wifi, coffee maker) and the
 * early-arrival / late-departure options. The J-7 hook is edited in the J-7 template (Emails), not
 * here.
 *
 * Props:
 *   form, errors, updateField(field, value), onZeroFocus(event)
 *   timedOptions: { early, late }, updateTimedOptionField(kind, field, value), timeOptions (string[])
 */
import React from 'react';
import {
  Box, Card, CardContent, FormControl, FormControlLabel, InputLabel, MenuItem, Select, Switch, TextField, Typography,
} from '@mui/material';

const TIMED = [
  { key: 'early', title: 'Arrivée anticipée', hint: "Ajoutée automatiquement si arrivée avant l'heure par défaut.", threshold: '10:00' },
  { key: 'late', title: 'Départ tardif', hint: "Ajoutée automatiquement si départ après l'heure par défaut.", threshold: '17:00' },
];

export default function PropertyStayTab({
  form, errors = {}, updateField, onZeroFocus, timedOptions, updateTimedOptionField, timeOptions,
}) {
  return (
    <>
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="sectionHeader" sx={{ display: 'block' }}>Équipements &amp; accès</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Repris dans les mails clients (affaires à prévoir, conseils d&apos;arrivée). L&apos;accroche du
            mail J-7 se règle dans le modèle J-7, dans Emails.
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <TextField
              label="Distance du parking (m)"
              type="number"
              value={form.parkingDistanceMeters ?? 0}
              onChange={(e) => updateField('parkingDistanceMeters', e.target.value)}
              onFocus={onZeroFocus}
              error={Boolean(errors.parkingDistanceMeters)}
              helperText={errors.parkingDistanceMeters || "0 si l'on se gare devant. Sinon, les mails conseillent de voyager léger."}
              size="small"
              fullWidth
              slotProps={{ htmlInput: { min: 0, step: 50 } }}
            />
            <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, gap: { xs: 0, sm: 3 } }}>
              <FormControlLabel
                control={<Switch checked={Boolean(form.hasWifi)} onChange={(e) => updateField('hasWifi', e.target.checked)} />}
                label="Wifi dans le logement"
                sx={{ minHeight: 44 }}
              />
              <FormControlLabel
                control={<Switch checked={Boolean(form.hasFilterCoffeeMaker)} onChange={(e) => updateField('hasFilterCoffeeMaker', e.target.checked)} />}
                label="Cafetière familiale (café moulu)"
                sx={{ minHeight: 44 }}
              />
            </Box>
          </Box>
        </CardContent>
      </Card>

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="sectionHeader" gutterBottom sx={{ display: 'block' }}>Arrivée anticipée &amp; départ tardif</Typography>
          {TIMED.map((entry) => {
            const option = timedOptions[entry.key];
            if (!option) return null;
            const fixed = (option.autoPricingMode || 'fixed') === 'fixed';
            return (
              <Box key={entry.key} sx={{ mb: 2, p: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
                  <Box>
                    <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{entry.title}</Typography>
                    <Typography variant="caption" color="text.secondary">{entry.hint}</Typography>
                  </Box>
                  <FormControlLabel
                    control={<Switch checked={Boolean(option.autoEnabled)} onChange={(e) => updateTimedOptionField(entry.key, 'autoEnabled', e.target.checked)} />}
                    label={option.autoEnabled ? 'Actif' : 'Inactif'}
                  />
                </Box>
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr 1fr' }, gap: 1.5, mt: 1 }}>
                  <FormControl size="small" fullWidth>
                    <InputLabel>Tarification</InputLabel>
                    <Select
                      value={option.autoPricingMode || 'fixed'}
                      label="Tarification"
                      onChange={(e) => updateTimedOptionField(entry.key, 'autoPricingMode', e.target.value)}
                    >
                      <MenuItem value="fixed">Prix fixe</MenuItem>
                      <MenuItem value="proportional">Proportionnel au prix de nuit</MenuItem>
                    </Select>
                  </FormControl>
                  <TextField
                    size="small"
                    type="number"
                    label="Prix fixe (€)"
                    value={option.price ?? 0}
                    onChange={(e) => updateTimedOptionField(entry.key, 'price', e.target.value)}
                    disabled={!fixed}
                    fullWidth
                    slotProps={{ htmlInput: { min: 0, step: 1 } }}
                  />
                  <FormControl size="small" fullWidth>
                    <InputLabel>Seuil nuit complète</InputLabel>
                    <Select
                      value={option.autoFullNightThreshold || entry.threshold}
                      label="Seuil nuit complète"
                      onChange={(e) => updateTimedOptionField(entry.key, 'autoFullNightThreshold', e.target.value)}
                    >
                      {timeOptions.map((time) => <MenuItem key={`${entry.key}-${time}`} value={time}>{time}</MenuItem>)}
                    </Select>
                  </FormControl>
                </Box>
              </Box>
            );
          })}
        </CardContent>
      </Card>
    </>
  );
}
