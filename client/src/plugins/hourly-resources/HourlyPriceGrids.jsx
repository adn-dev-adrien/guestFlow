/**
 * HourlyPriceGrids — every price of an hourly resource, in the « Prix » section of the resource editor (contribution `resources.priceFields`,
 * specs/gift-vouchers/gift-voucher-week-weekend-and-print.md rule 1). Two grids, rows « Journée » / « Soirée (dès hh:mm) », columns « 1re heure » / « Heures suivantes »:
 *   - « Clients logés » — the day first hour is the resource's `price`;
 *   - « Prix pour les extérieurs » — shown when the resource is sold outside a stay, a « Semaine » and a « Week-end » group of the same columns.
 * Props: `draft` (the resource form), `onChange(patch)`, `errors` ({ field: sentence }). Every field is required, none falls back to another; the server's sentence is drawn under its field.
 * On a phone each block is its own stack of fields.
 */
import React from 'react';
import { Box, FormHelperText, TextField, Typography } from '@mui/material';

function PriceField({ field, label, draft, onChange, errors }) {
  const error = errors[field];
  return (
    <TextField
      size="small"
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

/** One audience-and-period block: rows of the bands, the two columns. `rows`: [{ name, label, first, next }] with the form field of each cell. */
function Block({ title, rows, draft, onChange, errors }) {
  return (
    <Box role="group" aria-label={title} sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>{title}</Typography>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '72px 1fr 1fr', sm: '140px 1fr 1fr' }, columnGap: 1.5, rowGap: 1.5, alignItems: 'start' }}>
        <span />
        <Typography variant="caption" color="text.secondary">1re heure</Typography>
        <Typography variant="caption" color="text.secondary">Heures suivantes</Typography>
        {rows.map((row) => (
          <React.Fragment key={row.name}>
            <Typography variant="body2" sx={{ pt: 1 }}>{row.label}</Typography>
            <PriceField field={row.first} label={`${title} · ${row.name} · 1re heure`} draft={draft} onChange={onChange} errors={errors} />
            <PriceField field={row.next} label={`${title} · ${row.name} · heures suivantes`} draft={draft} onChange={onChange} errors={errors} />
          </React.Fragment>
        ))}
      </Box>
    </Box>
  );
}

export default function HourlyPriceGrids({ draft, onChange, errors = {} }) {
  const evening = Boolean(draft.hourlyEveningStart);
  const eveningLabel = evening ? `Soirée (dès ${draft.hourlyEveningStart})` : 'Soirée';
  const rowsOf = (day, evenings) => [
    { name: 'Journée', label: 'Journée', ...day },
    ...(evening ? [{ name: 'Soirée', label: eveningLabel, ...evenings }] : []),
  ];
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
      <Block
        title="Clients logés"
        draft={draft}
        onChange={onChange}
        errors={errors}
        rows={rowsOf({ first: 'price', next: 'hourlyNextDayRate' }, { first: 'hourlyEveningRate', next: 'hourlyNextEveningRate' })}
      />
      {draft.sellableExternally && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Typography variant="body2" fontWeight={600}>Prix pour les extérieurs</Typography>
          <Block
            title="Extérieurs · Semaine"
            draft={draft}
            onChange={onChange}
            errors={errors}
            rows={rowsOf({ first: 'hourlyExternalDayRate', next: 'hourlyExternalNextDayRate' }, { first: 'hourlyExternalEveningRate', next: 'hourlyExternalNextEveningRate' })}
          />
          <Block
            title="Extérieurs · Week-end"
            draft={draft}
            onChange={onChange}
            errors={errors}
            rows={rowsOf(
              { first: 'hourlyExternalWeekendDayRate', next: 'hourlyExternalWeekendNextDayRate' },
              { first: 'hourlyExternalWeekendEveningRate', next: 'hourlyExternalWeekendNextEveningRate' },
            )}
          />
          <FormHelperText sx={{ mt: -1 }}>
            {`Week-end : du vendredi ${draft.hourlyEveningStart || 'soir'} au dimanche soir, et les jours fériés.`}
          </FormHelperText>
        </Box>
      )}
    </Box>
  );
}
