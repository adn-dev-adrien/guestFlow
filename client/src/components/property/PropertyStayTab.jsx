/**
 * PropertyStayTab — « Séjour » tab of the property page (specs/settings-rationalization.md
 * rules 17c, 21): the facts the guest emails read (parking distance, wifi), the arrival facts of the
 * J-2 (specs/guest-email-texts-made-simple.md rules 1–2) and the early-arrival / late-departure
 * options. The property's own texts and its J-7 hook are written on « Textes des emails », linked
 * from here (rule 12).
 *
 * Props:
 *   form, errors, updateField(field, value), onZeroFocus(event)
 *   timedOptions: { early, late }, updateTimedOptionField(kind, field, value), timeOptions (string[])
 *   propertyId — null for a property not created yet (its texts come once it exists)
 *   arrival — { draft, saved, errors, onChange } of the « Arrivée » block, held by the page (rule 35)
 *
 * Cleaning, towels and bed linen (specs/guest-email-texts-made-simple.md rule 28): « Selon les options » leaves
 * the emails to the options; empty means not said yet, and the emails stay silent on it. The pool
 * season (rule 34) is the property's: off, no pool sentence at all.
 */
import React from 'react';
import { Link as RouterLink } from 'react-router';
import PropertyArrivalFacts from './PropertyArrivalFacts';
import MonthDayField from '../MonthDayField';
import SegmentedSelect from '../SegmentedSelect';
import {
  Box, Card, CardContent, FormControl, FormControlLabel, FormHelperText, InputLabel, Link, MenuItem, Select, Switch, TextField, Typography,
} from '@mui/material';

const TIMED = [
  { key: 'early', title: 'Arrivée anticipée', hint: "Ajoutée automatiquement si arrivée avant l'heure par défaut.", threshold: '10:00' },
  { key: 'late', title: 'Départ tardif', hint: "Ajoutée automatiquement si départ après l'heure par défaut.", threshold: '17:00' },
];

export default function PropertyStayTab({
  form, errors = {}, updateField, onZeroFocus, timedOptions, updateTimedOptionField, timeOptions, propertyId = null,
  arrival = null,
}) {
  const choice = (field, label, options) => (
    <FormControl size="small" fullWidth error={Boolean(errors[field])}>
      <InputLabel id={`${field}-label`} shrink>{label}</InputLabel>
      <Select
        labelId={`${field}-label`}
        label={label}
        value={form[field] ?? ''}
        displayEmpty
        notched
        onChange={(e) => updateField(field, e.target.value)}
        renderValue={(v) => (v === '' ? <Box component="span" sx={{ color: 'text.disabled' }}>À préciser</Box> : options.find((o) => o.value === v)?.label)}
      >
        {options.map((o) => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
      </Select>
      <FormHelperText>{errors[field] || (form[field] === '' ? 'Vide : rien n’est dit aux voyageurs.' : ' ')}</FormHelperText>
    </FormControl>
  );
  const poolMode = form.poolSeasonMode || 'none';
  return (
    <>
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="sectionHeader" sx={{ display: 'block' }}>Équipements &amp; accès</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Repris dans les mails clients (affaires à prévoir, conseils d&apos;arrivée).
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
            </Box>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
              {choice('cleaningIncluded', 'Ménage de fin de séjour', [
                { value: '1', label: 'Compris' },
                { value: '0', label: 'Non compris' },
                { value: 'options', label: 'Selon les options' },
              ])}
              {choice('towelsProvided', 'Linge de toilette', [
                { value: '1', label: 'Fourni' },
                { value: '0', label: 'À apporter' },
                { value: 'options', label: 'Selon les options' },
              ])}
              {choice('bedLinenProvided', 'Linge de lit', [
                { value: '1', label: 'Fourni' },
                { value: '0', label: 'À apporter' },
                { value: 'options', label: 'Selon les options' },
              ])}
            </Box>
            <FormControlLabel
              control={(
                <Switch
                  checked={poolMode !== 'none'}
                  onChange={(e) => updateField('poolSeasonMode', e.target.checked ? 'allYear' : 'none')}
                />
              )}
              label="Piscine"
              sx={{ minHeight: 44 }}
            />
            {poolMode !== 'none' && (
              <SegmentedSelect
                label="Ouverture de la piscine"
                options={[{ value: 'allYear', label: "Toute l'année" }, { value: 'season', label: 'Saison' }]}
                value={poolMode}
                onChange={(next) => updateField('poolSeasonMode', next)}
              />
            )}
            {poolMode === 'season' && (
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
                <MonthDayField label="Ouverte du" value={form.poolSeasonStart} onChange={(v) => updateField('poolSeasonStart', v)} error={errors.poolSeasonStart} />
                <MonthDayField label="Au" value={form.poolSeasonEnd} onChange={(v) => updateField('poolSeasonEnd', v)} error={errors.poolSeasonEnd} />
              </Box>
            )}
          </Box>
        </CardContent>
      </Card>

      {propertyId && arrival && (
        <PropertyArrivalFacts
          propertyId={propertyId}
          hasWifi={Boolean(form.hasWifi)}
          draft={arrival.draft}
          saved={arrival.saved}
          errors={arrival.errors}
          onChange={arrival.onChange}
        />
      )}

      {propertyId && (
        <Card sx={{ mb: 3 }}>
          <CardContent>
            <Typography variant="sectionHeader" sx={{ display: 'block' }}>Textes</Typography>
            <Link component={RouterLink} to={`/settings/emails/textes?propertyId=${propertyId}#j7`}>
              Accroche et textes propres à ce logement
            </Link>
          </CardContent>
        </Card>
      )}

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
