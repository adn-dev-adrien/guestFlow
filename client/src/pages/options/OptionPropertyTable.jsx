/**
 * OptionPropertyTable — « Logements et prix » of the option editor (specs/options-resources-ux.md
 * rule 14): one line per property with « Proposée » (the option's scope), « Prix » (the per-property
 * price; blank = the base price, shown as placeholder; 0 = free), « Inclus » (added to new reservations)
 * and « Offert » (included at 0 €, only once « Inclus »).
 *
 * Turning « Proposée » off greys the line and clears its default. A free option has no « Prix »
 * column; an option with auto-timed pricing has no « Inclus » / « Offert »; a progressive one shows its
 * tier editor under the table (tiers are global). On `xs` each property becomes a block with
 * label / control lines instead of a table that would scroll.
 *
 * Props:
 *   form        the option form (propertyIds, propertyPrices, propertyDefaults, priceType, price, autoEnabled)
 *   setForm     (form) => void
 *   properties  Array<{ id, name }>
 *   errors?     { [`propertyPrices.<id>`]: message }
 */
import React from 'react';
import { Box, FormHelperText, Switch, TextField, Typography } from '@mui/material';
import { ProgressivePricingFields } from './OptionSpecialSections';
import { hasPropertyPrice, isBlank } from './optionForm';


function Labelled({ label, children }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: { xs: 'space-between', sm: 'center' }, gap: 1, minHeight: 44 }}>
      <Typography variant="body2" color="text.secondary" sx={{ display: { xs: 'block', sm: 'none' } }}>{label}</Typography>
      {children}
    </Box>
  );
}

export default function OptionPropertyTable({ form, setForm, properties, errors = {} }) {
  const percent = form.priceType === 'percent_of_stay';
  const showPrice = hasPropertyPrice(form.priceType);
  const showDefaults = Number(form.autoEnabled) !== 1;
  const proposed = new Set((form.propertyIds || []).map(Number));
  const prices = form.propertyPrices || {};
  const defaults = form.propertyDefaults || {};
  const base = form.price;

  const setProposed = (pid, on) => {
    const ids = on ? [...new Set([...proposed, pid])] : [...proposed].filter((id) => id !== pid);
    const nextDefaults = { ...defaults };
    if (!on) delete nextDefaults[pid];
    setForm({ ...form, propertyIds: ids, propertyDefaults: nextDefaults });
  };
  const setPrice = (pid, text) => setForm({ ...form, propertyPrices: { ...prices, [pid]: text } });
  const setIncluded = (pid, on) => {
    const next = { ...defaults };
    if (on) next[pid] = { default: true, offered: Boolean(next[pid] && next[pid].offered) };
    else delete next[pid];
    setForm({ ...form, propertyDefaults: next });
  };
  const setOffered = (pid, on) => setForm({ ...form, propertyDefaults: { ...defaults, [pid]: { default: true, offered: on } } });

  if ((properties || []).length === 0) {
    return <FormHelperText>Aucun logement.</FormHelperText>;
  }

  const columns = {
    xs: '1fr',
    sm: ['minmax(0,1.4fr)', '84px', showPrice ? 'minmax(96px,1fr)' : '', showDefaults ? '70px 70px' : ''].filter(Boolean).join(' '),
  };
  const labels = ['Logement', 'Proposée', ...(showPrice ? ['Prix'] : []), ...(showDefaults ? ['Inclus', 'Offert'] : [])];
  const header = (
    <Box sx={{ display: { xs: 'none', sm: 'grid' }, gridTemplateColumns: columns, gap: 1, px: 0.5, pb: 0.5, borderBottom: '1px solid', borderColor: 'divider' }}>
      {labels.map((label, i) => (
        <Typography key={label} variant="caption" color="text.secondary" fontWeight={600} sx={{ textAlign: i === 0 ? 'left' : 'center' }}>{label}</Typography>
      ))}
    </Box>
  );

  return (
    <Box>
      {header}
      {(properties || []).map((property) => {
        const pid = property.id;
        const on = proposed.has(Number(pid));
        const d = defaults[pid];
        const included = Boolean(d && d.default);
        const error = errors[`propertyPrices.${pid}`];
        return (
          <Box
            key={pid}
            role="group"
            aria-label={property.name}
            sx={{
              display: 'grid', gridTemplateColumns: columns, gap: { xs: 0, sm: 1 }, alignItems: 'start',
              py: 1, px: 0.5, borderBottom: '1px solid', borderColor: 'divider',
            }}
          >
            <Typography variant="body2" fontWeight={600} sx={{ overflowWrap: 'anywhere', py: { sm: 1.25 }, opacity: on ? 1 : 0.55 }}>{property.name}</Typography>
            <Labelled label="Proposée">
              <Switch checked={on} onChange={(e) => setProposed(pid, e.target.checked)} slotProps={{ input: { 'aria-label': `Proposée · ${property.name}` } }} />
            </Labelled>
            {showPrice && (
              <Labelled label="Prix">
                <TextField
                  size="small"
                  value={prices[pid] ?? ''}
                  placeholder={isBlank(base) ? '' : String(base)}
                  disabled={!on}
                  error={Boolean(error)}
                  helperText={error || undefined}
                  onChange={(e) => setPrice(pid, e.target.value)}
                  slotProps={{
                    htmlInput: { inputMode: 'decimal', 'aria-label': `${percent ? 'Pourcentage' : 'Prix'} · ${property.name}`, style: { textAlign: 'right', fontVariantNumeric: 'tabular-nums' } },
                    formHelperText: { sx: { textAlign: 'right', mx: 0 } },
                  }}
                  sx={{ width: { xs: 140, sm: '100%' }, '& input': { fontSize: 16 } }}
                />
              </Labelled>
            )}
            {showDefaults && (
              <>
                <Labelled label="Inclus par défaut">
                  <Switch checked={included} disabled={!on} onChange={(e) => setIncluded(pid, e.target.checked)} slotProps={{ input: { 'aria-label': `Inclus · ${property.name}` } }} />
                </Labelled>
                <Labelled label="Offert">
                  <Switch checked={Boolean(d && d.offered)} disabled={!on || !included} onChange={(e) => setOffered(pid, e.target.checked)} slotProps={{ input: { 'aria-label': `Offert · ${property.name}` } }} />
                </Labelled>
              </>
            )}
          </Box>
        );
      })}
      {form.priceType === 'per_participant_progressive' && <ProgressivePricingFields form={form} setForm={setForm} />}
    </Box>
  );
}
