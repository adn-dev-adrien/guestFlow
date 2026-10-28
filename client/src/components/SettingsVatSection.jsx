/**
 * SettingsVatSection — the « TVA » card of Paramètres → TVA & exercice.
 *
 * The regime in force (specs/vat-optional-mode.md §6.1): under VAT, one rate applied to every revenue
 * stream (specs/single-vat-rate.md §6.1); without VAT, the legal mention printed on the documents. Both
 * save with the page's Save. « Changer de régime… » opens the switch, which never goes through that Save.
 * The commission and cancellation-indemnity rates are edited on Plan comptable, next to the accounts that
 * use them (specs/settings-rationalization.md rule 14).
 *
 * Props:
 *   values:    { regime, rate, legalMention } — the settings draft
 *   errors:    { vatRate?, legalMention? }
 *   onChange:  (key, value) => void   // 'rate' | 'legalMention'
 *   disabled:  boolean
 *   regime:    useVatRegime().state — { inForce, periods, mentions }, null while loading
 *   onSwitch:  () => void            // opens the switch dialog
 *   onUndo:    (period) => void      // asks to undo an unused period
 */
import React from 'react';
import { Button, Card, CardContent, Stack, Typography, TextField, Box, MenuItem } from '@mui/material';
import StatusBadge from './StatusBadge';
import VatPeriodHistory from './VatPeriodHistory';
import { VAT_TEXTS, regimeLabel } from '../constants/vatRegime';

export default function SettingsVatSection({
  values,
  errors = {},
  onChange,
  disabled = false,
  regime = null,
  onSwitch,
  onUndo,
}) {
  const v = values || {};
  const notSubject = v.regime === 'not_subject';
  const mentions = (regime && regime.mentions) || [];
  const mention = mentions.find((m) => m.key === v.legalMention);
  return (
    <Card variant="outlined" sx={{ bgcolor: 'background.paper', mb: 3 }}>
      <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
        <Stack spacing={2}>
          <Box>
            <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}>
              <Typography variant="sectionHeader">{VAT_TEXTS.cardTitle}</Typography>
              {regime && regime.inForce && (
                <StatusBadge status={notSubject ? 'neutral' : 'success'} label={regimeLabel(regime.inForce)} />
              )}
            </Stack>
            <Typography variant="body2" color="text.secondary">
              {notSubject ? VAT_TEXTS.notSubjectSub : VAT_TEXTS.subjectSub}
            </Typography>
          </Box>

          {notSubject ? (
            <TextField
              select
              label="Mention légale"
              value={v.legalMention || ''}
              onChange={(e) => onChange('legalMention', e.target.value)}
              fullWidth
              disabled={disabled || !mentions.length}
              error={Boolean(errors.legalMention)}
              helperText={errors.legalMention || (mention ? `Imprimée sur les devis : « ${mention.label} ».` : ' ')}
              sx={{ maxWidth: { sm: 420 } }}
            >
              {mentions.map((m) => <MenuItem key={m.key} value={m.key}>{m.label}</MenuItem>)}
            </TextField>
          ) : (
            <TextField
              label="Taux de TVA (%)"
              type="number"
              value={v.rate ?? 10}
              onChange={(e) => onChange('rate', e.target.value === '' ? '' : Number(e.target.value))}
              fullWidth
              disabled={disabled}
              error={Boolean(errors.vatRate)}
              helperText={errors.vatRate || VAT_TEXTS.rateHelp}
              sx={{ maxWidth: { sm: 320 } }}
              slotProps={{
                htmlInput: { min: 0, max: 100, step: 0.5 }
              }}
            />
          )}

          {regime && (
            <>
              <Box>
                <Button variant="outlined" onClick={onSwitch} disabled={disabled} sx={{ minHeight: 44, width: { xs: '100%', sm: 'auto' } }}>
                  {VAT_TEXTS.switchButton}
                </Button>
              </Box>
              <Box>
                <Typography variant="subtitle2" sx={{ mb: 0.5 }}>{VAT_TEXTS.historyTitle}</Typography>
                <VatPeriodHistory
                  periods={regime.periods}
                  inForceId={regime.inForce ? regime.inForce.id : null}
                  onUndo={onUndo}
                  disabled={disabled}
                />
              </Box>
            </>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}
