/**
 * HourlyPriceGrids — every price of an hourly resource, in the « Prix » section of the resource editor (contribution `resources.priceFields`,
 * specs/gift-vouchers/gift-voucher-week-weekend-and-print.md rule 1). Two grids, rows « Journée » / « Soirée (dès hh:mm) », columns « 1re heure » / « Heures suivantes »:
 *   - « Clients logés » — the day first hour is the resource's `price`;
 *   - « Prix pour les extérieurs » — shown when the resource is sold outside a stay, a « Semaine » and a « Week-end » group of the same columns.
 * Props: `draft` (the resource form), `onChange(patch)`, `errors` ({ field: sentence }), `lodgingLines` (node drawn under the guests' grid). Every field is required, none falls back to
 * another; the server's sentence is drawn under its field. On a phone (xs) every price field has its own row, its refusal sentence the full width.
 */
import React from 'react';
import { Box, FormHelperText, TextField, Typography } from '@mui/material';

// What the week-end is (rule 6): from Friday's evening switch when the resource has one, else Saturday and Sunday; public holidays either way.
const WEEKEND_RULE = Object.freeze({
  evening: 'Week-end : du vendredi {from} au dimanche soir, et les jours fériés.',
  day: 'Week-end : le samedi, le dimanche et les jours fériés.',
});

function PriceField({ field, label, draft, onChange, errors }) {
  const error = errors[field];
  return (
    <TextField
      size="small"
      sx={{ width: { xs: '100%', sm: 'auto' } }}
      value={draft[field] ?? ''}
      onChange={(e) => onChange({ [field]: e.target.value })}
      error={Boolean(error)}
      helperText={error || undefined}
      required
      slotProps={{
        htmlInput: { inputMode: 'decimal', 'aria-label': label, style: { textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: 16 } },
        input: { endAdornment: <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap', ml: 0.5 }}>€</Typography> },
      }}
    />
  );
}

/**
 * One audience-and-period block: rows of the bands, the two columns. `rows`: [{ name, label, first, next }] with the form field of each cell. From `sm` the fields sit in two columns
 * under « 1re heure » / « Heures suivantes »; on a phone each field has its own row with its own caption, so a refusal sentence has the whole width.
 */
function Block({ title = null, ariaTitle = title, rows, draft, onChange, errors }) {
  return (
    <Box role="group" aria-label={ariaTitle} sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      {title ? <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>{title}</Typography> : null}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'max-content 1fr 1fr' }, columnGap: 1.5, rowGap: { xs: 1, sm: 1.5 }, alignItems: 'start' }}>
        <Box component="span" sx={{ display: { xs: 'none', sm: 'block' } }} />
        <Typography variant="caption" color="text.secondary" sx={{ display: { xs: 'none', sm: 'block' } }}>1re heure</Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: { xs: 'none', sm: 'block' } }}>Heures suivantes</Typography>
        {rows.map((row) => (
          <React.Fragment key={row.name}>
            <Typography variant="body2" sx={{ pt: { sm: 1 }, fontWeight: { xs: 600, sm: 400 } }}>{row.label}</Typography>
            {[['first', '1re heure'], ['next', 'Heures suivantes']].map(([which, caption]) => (
              <Box key={which}>
                <Typography variant="caption" color="text.secondary" sx={{ display: { xs: 'block', sm: 'none' }, mb: 0.5 }}>{caption}</Typography>
                <PriceField field={row[which]} label={`${ariaTitle} · ${row.name} · ${caption.toLowerCase()}`} draft={draft} onChange={onChange} errors={errors} />
              </Box>
            ))}
          </React.Fragment>
        ))}
      </Box>
    </Box>
  );
}

/**
 * `lodgingLines` is the core's « Heure offerte par logement » list, drawn right under the guests' grid (the validated mock); `WEEKEND_RULE` the sentence that says what the week-end is, worded by whether the resource has an evening switch.
 */
export default function HourlyPriceGrids({
  draft, onChange, errors = {}, lodgingLines = null,
}) {
  const evening = Boolean(draft.hourlyEveningStart);
  const eveningLabel = evening ? `Soirée (dès ${draft.hourlyEveningStart})` : 'Soirée';
  const rowsOf = (day, evenings) => [
    { name: 'Journée', label: 'Journée', ...day },
    ...(evening ? [{ name: 'Soirée', label: eveningLabel, ...evenings }] : []),
  ];
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        <Typography variant="subtitle2" component="h3">Clients logés</Typography>
        <Block
          ariaTitle="Clients logés"
          draft={draft}
          onChange={onChange}
          errors={errors}
          rows={rowsOf({ first: 'price', next: 'hourlyNextDayRate' }, { first: 'hourlyEveningRate', next: 'hourlyNextEveningRate' })}
        />
        {lodgingLines}
      </Box>
      {draft.sellableExternally && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Typography variant="subtitle2" component="h3">Prix pour les extérieurs</Typography>
          <Block
            title="Semaine"
            ariaTitle="Extérieurs · Semaine"
            draft={draft}
            onChange={onChange}
            errors={errors}
            rows={rowsOf({ first: 'hourlyExternalDayRate', next: 'hourlyExternalNextDayRate' }, { first: 'hourlyExternalEveningRate', next: 'hourlyExternalNextEveningRate' })}
          />
          <Block
            title="Week-end"
            ariaTitle="Extérieurs · Week-end"
            draft={draft}
            onChange={onChange}
            errors={errors}
            rows={rowsOf(
              { first: 'hourlyExternalWeekendDayRate', next: 'hourlyExternalWeekendNextDayRate' },
              { first: 'hourlyExternalWeekendEveningRate', next: 'hourlyExternalWeekendNextEveningRate' },
            )}
          />
          <FormHelperText sx={{ mt: -1 }}>{evening ? WEEKEND_RULE.evening.replace('{from}', draft.hourlyEveningStart) : WEEKEND_RULE.day}</FormHelperText>
        </Box>
      )}
    </Box>
  );
}
