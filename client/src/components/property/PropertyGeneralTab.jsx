/**
 * PropertyGeneralTab — « Général » tab of the property page (specs/settings-rationalization.md
 * rule 21): name + article, photo, capacity, beds, check-in / check-out times, cleaning time.
 *
 * Props:
 *   property, form, errors ({ field: message }), updateField(field, value), onZeroFocus(event)
 *   isNew, photoFile, photoValidationError, onPhotoChange(event), nameArticles (string[]),
 *   previewWithArticle(name, article), photoFormatsText, timeOptions (string[])
 */
import React from 'react';
import {
  Box, Button, Card, CardContent, FormControl, InputLabel, MenuItem, Select, TextField, Typography,
} from '@mui/material';
import UploadIcon from '@mui/icons-material/Upload';

export default function PropertyGeneralTab({
  property, form, errors = {}, updateField, onZeroFocus, isNew,
  photoFile, photoValidationError, onPhotoChange, nameArticles, previewWithArticle, photoFormatsText, timeOptions,
}) {
  const number = (field, label, helperText, inputProps = { min: 0 }) => (
    <TextField
      label={label}
      type="number"
      value={form[field] ?? 0}
      onChange={(e) => updateField(field, e.target.value)}
      onFocus={onZeroFocus}
      fullWidth
      size="small"
      error={Boolean(errors[field])}
      helperText={errors[field] || helperText}
      slotProps={{ htmlInput: inputProps }}
    />
  );
  const preview = previewWithArticle(form.name, form.nameArticle);

  return (
    <>
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="sectionHeader" gutterBottom sx={{ display: 'block' }}>Identité</Typography>
          <Box sx={{ display: 'flex', gap: 2, flexDirection: { xs: 'column', sm: 'row' }, alignItems: 'flex-start', mb: 2 }}>
            <TextField
              label="Nom du logement"
              value={form.name || ''}
              onChange={(e) => updateField('name', e.target.value)}
              fullWidth
              size="small"
              autoFocus={isNew}
              error={Boolean(errors.name)}
              helperText={errors.name || ''}
            />
            <TextField
              select
              label="Article du nom (emails clients)"
              value={form.nameArticle || 'au'}
              onChange={(e) => updateField('nameArticle', e.target.value)}
              size="small"
              fullWidth
              helperText={preview ? `Aperçu : « votre séjour ${preview} »` : 'Utilisé pour « votre séjour … » dans les emails clients.'}
            >
              {nameArticles.map((a) => <MenuItem key={a} value={a}>{a}</MenuItem>)}
            </TextField>
          </Box>
          {property.photo && <Box component="img" src={property.photo} alt={property.name} sx={{ width: '100%', maxHeight: 200, objectFit: 'cover', borderRadius: 2, mb: 2 }} />}
          <Button variant="outlined" component="label" startIcon={<UploadIcon />}>
            {property.photo ? 'Changer la photo' : 'Ajouter une photo'}
            <input type="file" hidden accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" onChange={onPhotoChange} />
          </Button>
          {photoFile && <Typography variant="body2" sx={{ mt: 1 }}>{photoFile.name}</Typography>}
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>{photoFormatsText}</Typography>
          {photoValidationError && <Typography variant="body2" color="error" sx={{ mt: 0.75 }}>{photoValidationError}</Typography>}
        </CardContent>
      </Card>

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="sectionHeader" gutterBottom sx={{ display: 'block' }}>Capacité</Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Box sx={{ display: 'flex', gap: 2, flexDirection: { xs: 'column', sm: 'row' } }}>
              {number('maxGuests', 'Max voyageurs', 'Adultes, ados et enfants de plus de 2 ans')}
              {number('maxBabies', 'Max bébés', '0 à 2 ans, ne comptent pas dans la capacité')}
            </Box>
            <Box sx={{ display: 'flex', gap: 2, flexDirection: { xs: 'column', sm: 'row' } }}>
              {number('doubleBeds', 'Lits doubles', '2 couchages chacun')}
              {number('singleBeds', 'Lits simples', '1 couchage chacun')}
            </Box>
          </Box>
        </CardContent>
      </Card>

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="sectionHeader" gutterBottom sx={{ display: 'block' }}>Horaires &amp; ménage</Typography>
          <Box sx={{ display: 'flex', gap: 2, flexDirection: { xs: 'column', sm: 'row' } }}>
            <FormControl fullWidth size="small">
              <InputLabel>Heure d'arrivée</InputLabel>
              <Select value={form.defaultCheckIn || '15:00'} label="Heure d'arrivée" onChange={(e) => updateField('defaultCheckIn', e.target.value)}>
                {timeOptions.map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}
              </Select>
            </FormControl>
            <FormControl fullWidth size="small">
              <InputLabel>Heure de départ</InputLabel>
              <Select value={form.defaultCheckOut || '10:00'} label="Heure de départ" onChange={(e) => updateField('defaultCheckOut', e.target.value)}>
                {timeOptions.map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}
              </Select>
            </FormControl>
            {number('cleaningHours', 'Temps de ménage (heures)', 'Réserve le créneau entre deux séjours.', { min: 0, step: 0.5 })}
          </Box>
        </CardContent>
      </Card>
    </>
  );
}
