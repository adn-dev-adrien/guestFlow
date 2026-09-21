/**
 * PropertyTariffTab — « Tarifs » tab of the property page (specs/settings-rationalization.md
 * rules 21-22): the seasons (recipe or manual) with the entry to « Gestion tarifaire », the
 * extra-guest price, the tourist tax, and a pointer to the stay VAT rate.
 *
 * When a tariff recipe is attached the extra-guest fields are read-only: the recipe sets them season
 * by season, and its seasons override the property values (pricing.js). The table then shows each
 * season's own extra-guest price.
 *
 * Props:
 *   property, form, errors, updateField(field, value), onZeroFocus(event), canManage,
 *   onOpenTariffs() — navigates to the pricing page; getSortedSeasonRanges(rule)
 */
import React from 'react';
import { Link as RouterLink } from 'react-router';
import {
  Alert, Box, Button, Card, CardContent, FormControl, FormHelperText, InputLabel, Link, MenuItem, Select,
  TableBody, TableCell, TableHead, TableRow, TextField, Typography,
} from '@mui/material';
import TableCard from '../TableCard';
import { displayDate, formatCurrency } from '../../utils/formatters';

export default function PropertyTariffTab({
  property, form, errors = {}, updateField, onZeroFocus, canManage, onOpenTariffs, getSortedSeasonRanges,
}) {
  const recipe = property.tariffRecipeId;
  const seasons = [...(property.pricingRules || [])]
    .sort((a, b) => String(a.startDate || '').localeCompare(String(b.startDate || '')));
  const number = (field, label, helperText, step = 0.01) => (
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
      slotProps={{ htmlInput: { min: 0, step } }}
    />
  );

  return (
    <>
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: { xs: 'stretch', sm: 'center' }, gap: 1.5, mb: 1.5, flexDirection: { xs: 'column', sm: 'row' } }}>
            <Box>
              <Typography variant="sectionHeader" sx={{ display: 'block' }}>Saisons et prix</Typography>
              <Typography variant="body2" color="text.secondary">
                {recipe
                  ? <>Recette <strong>{recipe}{property.tariffRecipeVersion ? ` (v${property.tariffRecipeVersion})` : ''}</strong> : elle fixe les saisons, les prix, les séjours minimum et le supplément voyageur.</>
                  : 'Saisons saisies à la main.'}
              </Typography>
            </Box>
            <Button variant="contained" onClick={onOpenTariffs} disabled={!canManage}>Ouvrir la gestion tarifaire</Button>
          </Box>
          <TableCard minWidth={640}>
            <TableHead>
              <TableRow>
                <TableCell>Saison</TableCell>
                <TableCell>Dates</TableCell>
                <TableCell>Type</TableCell>
                <TableCell>Tarif base</TableCell>
                <TableCell>Min nuits</TableCell>
                {recipe && <TableCell>Voyageur suppl.</TableCell>}
              </TableRow>
            </TableHead>
            <TableBody>
              {seasons.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Box sx={{ width: 12, height: 12, borderRadius: '50%', flex: '0 0 auto', bgcolor: (t) => r.color || t.palette.primary.main }} />
                      {r.label}
                    </Box>
                  </TableCell>
                  <TableCell>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
                      {getSortedSeasonRanges(r).map((range, index) => (
                        <Typography key={`${r.id}-range-${index}`} variant="body2" sx={{ lineHeight: 1.25 }}>
                          {displayDate(range.startDate)} → {displayDate(range.endDate)}
                        </Typography>
                      ))}
                    </Box>
                  </TableCell>
                  <TableCell>{(r.pricingMode || 'fixed') === 'progressive' ? 'Dégressif' : 'Fixe'}</TableCell>
                  <TableCell>{formatCurrency(Number(r.pricePerNight || 0))}</TableCell>
                  <TableCell>{r.minNights}</TableCell>
                  {recipe && <TableCell>{r.extraGuestPrice ? formatCurrency(Number(r.extraGuestPrice)) : '—'}</TableCell>}
                </TableRow>
              ))}
              {seasons.length === 0 && (
                <TableRow><TableCell colSpan={recipe ? 6 : 5} align="center">Aucune saison tarifaire</TableCell></TableRow>
              )}
            </TableBody>
          </TableCard>
        </CardContent>
      </Card>

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="sectionHeader" gutterBottom sx={{ display: 'block' }}>Voyageurs supplémentaires</Typography>
          {recipe ? (
            <Alert severity="info" variant="outlined">
              Fixé par la recette, saison par saison (colonne « Voyageur suppl. » ci-dessus) : se modifie dans la gestion tarifaire.
            </Alert>
          ) : (
            <Box sx={{ display: 'flex', gap: 2, flexDirection: { xs: 'column', sm: 'row' } }}>
              {number('basePriceIncludedGuests', 'Personnes incluses dans le prix', 'Au-delà, le supplément s\'applique.', 1)}
              {number('extraGuestPrice', 'Supplément par personne (€)', '0 = pas de supplément.')}
              <FormControl fullWidth size="small">
                <InputLabel id="extra-guest-unit-label">Unité du supplément</InputLabel>
                <Select
                  labelId="extra-guest-unit-label"
                  label="Unité du supplément"
                  value={form.extraGuestPriceUnit ?? 'per_stay'}
                  onChange={(e) => updateField('extraGuestPriceUnit', e.target.value)}
                >
                  <MenuItem value="per_stay">par séjour</MenuItem>
                  <MenuItem value="per_night">par nuit</MenuItem>
                </Select>
                <FormHelperText>« par nuit » suit la dégressivité de la saison</FormHelperText>
              </FormControl>
            </Box>
          )}
        </CardContent>
      </Card>

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="sectionHeader" gutterBottom sx={{ display: 'block' }}>Taxe de séjour</Typography>
          <FormControl fullWidth size="small" sx={{ mt: 1, mb: 2 }}>
            <InputLabel>Mode de calcul</InputLabel>
            <Select
              label="Mode de calcul"
              value={form.touristTaxMode ?? 'per_day_per_person'}
              onChange={(e) => updateField('touristTaxMode', e.target.value)}
            >
              <MenuItem value="per_day_per_person">Par jour et par adulte</MenuItem>
              <MenuItem value="percentage_accommodation">% du montant hébergement</MenuItem>
              <MenuItem value="percentage_and_fixed">% + montant fixe</MenuItem>
            </Select>
          </FormControl>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            {form.touristTaxMode === 'per_day_per_person' && number('touristTaxPerDayPerPerson', 'Taxe (€/jour/adulte)')}
            {form.touristTaxMode !== 'per_day_per_person' && (
              <>
                {number('touristTaxPercentage', 'Pourcentage commune (%)', 'Appliqué au prix moyen HT de la nuit par occupant')}
                {number('touristTaxDepartmentPercentage', 'Pourcentage additionnel départemental (%)', 'Pourcentage additionnel appliqué sur la part communale')}
              </>
            )}
            {form.touristTaxMode === 'percentage_and_fixed' && number('touristTaxFixedAmount', 'Montant fixe (€)', 'Montant fixe par nuit et par adulte, ajouté au pourcentage')}
          </Box>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
            Qui collecte la taxe sur chaque plateforme se règle dans{' '}
            <Link component={RouterLink} to="/settings/plateformes">Plateformes</Link>. Tous les montants
            sont TTC ; le taux de TVA des séjours se règle dans{' '}
            <Link component={RouterLink} to="/settings/tva-exercice">TVA &amp; exercice</Link>.
          </Typography>
        </CardContent>
      </Card>
    </>
  );
}
