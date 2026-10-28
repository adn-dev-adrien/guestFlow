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
 *   values:    { regime, rate, legalMention, franchiseThreshold, franchise: { setAt } } — the settings draft
 *   errors:    { vatRate?, legalMention?, vatFranchiseThreshold? }
 *   onChange:  (key, value) => void   // 'rate' | 'legalMention' | 'franchiseThreshold'
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
import { vatThresholdInputError } from '../utils/validation';
import { displayDate } from '../utils/formatters';

// A valid typed amount becomes a number on leaving the field, shown with its thousands separator.
const thresholdText = (value) => (typeof value === 'number' ? new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(value) : (value ?? ''));
const parsedThreshold = (text) => Number(String(text).replace(/[\s\u00a0\u202f]/g, '').replace(',', '.'));

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
  // Rule 35 — only the franchise en base has a threshold; the draft mention decides, so the field follows the select.
  const franchiseField = notSubject && v.legalMention === 'art_293_b';
  const thresholdError = errors.vatFranchiseThreshold || vatThresholdInputError(v.franchiseThreshold);
  const setAt = v.franchise && v.franchise.setAt;
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
              {mentions.map((m) => <MenuItem key={m.key} value={m.key}>{m.short}</MenuItem>)}
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

          {franchiseField && (
            <TextField
              label={VAT_TEXTS.thresholdLabel}
              value={thresholdText(v.franchiseThreshold)}
              onChange={(e) => onChange('franchiseThreshold', e.target.value)}
              onBlur={() => {
                const typed = v.franchiseThreshold;
                if (typeof typed === 'string' && typed.trim() !== '' && !vatThresholdInputError(typed)) onChange('franchiseThreshold', parsedThreshold(typed));
              }}
              fullWidth
              disabled={disabled}
              error={Boolean(thresholdError)}
              helperText={thresholdError || (setAt ? VAT_TEXTS.thresholdSetOn(displayDate(setAt)) : VAT_TEXTS.thresholdHint)}
              sx={{ maxWidth: { sm: 320 } }}
              slotProps={{ htmlInput: { inputMode: 'decimal', autoComplete: 'off' }, input: { endAdornment: <Box component="span" sx={{ color: 'text.secondary', ml: 1 }}>€</Box> } }}
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
