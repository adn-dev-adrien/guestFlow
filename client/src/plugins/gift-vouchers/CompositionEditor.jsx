/**
 * CompositionEditor — what a voucher contains (specs/gift-voucher-campaigns.md rules 4, 46): one hourly resource with its tariff mode and included minutes, and any
 * options with a quantity, all picked in the server's catalogue. Used by the campaign editor and by « Sur mesure ». It holds no price and judges nothing: the modes, their
 * rates, hours and following-hours rate, the elements that cannot be sold and the refusal of a value all come from the server.
 *
 * Props:
 *   value     { resourceId, band, minutes, options: [{ articleRef, qty }] } | null
 *   onChange  (composition) => void
 *   elements  the server's catalogue elements (`GET /catalogue`)
 *   errors?   [{ field, message }] — the server's refusals; those under `<prefix>.` are shown on their field
 *   prefix?   field prefix of the refusals (default 'composition')
 */
import React, { useMemo, useState } from 'react';
import {
  Box, Button, Card, CardContent, Chip, Dialog, DialogContent, DialogTitle, IconButton, InputAdornment, List, ListItemButton, ListItemText, ListSubheader,
  Radio, Stack, TextField, Tooltip, Typography, useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import SearchIcon from '@mui/icons-material/Search';
import { QuantityField } from '../sdk';
import { formatCents } from './giftVoucherFormat';
import { COMPOSITION_TEXTS as T } from './giftVoucherTexts';

const MAX_QTY = 20;

function groupsOf(elements, query) {
  const needle = query.trim().toLowerCase();
  const groups = new Map();
  elements.filter((e) => !needle || e.label.toLowerCase().includes(needle)).forEach((e) => {
    const name = e.kind === 'resource' ? T.resourcesGroup : (e.category || T.optionsGroup);
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(e);
  });
  return [...groups.entries()];
}

function ElementPicker({
  open, onClose, elements, onPick,
}) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const [query, setQuery] = useState('');
  const groups = useMemo(() => groupsOf(elements, query), [elements, query]);

  return (
    <Dialog open={open} onClose={onClose} fullScreen={fullScreen} fullWidth maxWidth="sm" TransitionProps={{ onExited: () => setQuery('') }}>
      <DialogTitle>{T.pickerTitle}</DialogTitle>
      <DialogContent>
        <TextField
          autoFocus fullWidth size="small" label={T.search} value={query} onChange={(e) => setQuery(e.target.value)} sx={{ mb: 1 }}
          slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> } }}
        />
        {groups.length === 0 ? <Typography variant="body2" color="text.secondary">{T.noResult}</Typography> : null}
        <List dense disablePadding>
          {groups.map(([name, items]) => (
            <li key={name}>
              <ul style={{ padding: 0 }}>
                <ListSubheader disableSticky sx={{ lineHeight: '32px' }}>{name}</ListSubheader>
                {items.map((e) => (
                  <ListItemButton
                    key={e.articleRef} disabled={!e.sellable} onClick={() => { onPick(e); onClose(); }} sx={{ minHeight: 44, alignItems: 'flex-start' }}
                  >
                    <ListItemText
                      primary={e.label}
                      secondary={e.sellable ? e.priceTypeLabel : `${e.priceTypeLabel} · ${e.reason}`}
                      slotProps={{ secondary: { sx: { overflowWrap: 'anywhere' } } }}
                    />
                  </ListItemButton>
                ))}
              </ul>
            </li>
          ))}
        </List>
        <Box sx={{ mt: 2, textAlign: 'right' }}><Button onClick={onClose} sx={{ minHeight: 44 }}>{T.close}</Button></Box>
      </DialogContent>
    </Dialog>
  );
}

function ModeChoice({ mode, selected, onSelect }) {
  return (
    <Box
      component="label"
      sx={{
        display: 'flex', alignItems: 'flex-start', gap: 1, p: 1, minHeight: 44, border: '1px solid', borderRadius: 1, cursor: mode.sellable ? 'pointer' : 'default',
        borderColor: selected ? 'primary.main' : 'divider', opacity: mode.sellable ? 1 : 0.55,
      }}
    >
      <Radio checked={selected} disabled={!mode.sellable} onChange={onSelect} size="small" sx={{ p: 0.5 }} slotProps={{ input: { 'aria-label': mode.label } }} />
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="body2" fontWeight={600}>{`${mode.label} · ${formatCents(mode.rateCents)} ${T.perHour}`}</Typography>
        <Typography variant="caption" color="text.secondary" component="div">{T.hours(mode.from, mode.to)}</Typography>
        {mode.followingText ? <Typography variant="caption" color="text.secondary" component="div">{mode.followingText}</Typography> : null}
        {!mode.sellable && mode.reason ? <Typography variant="caption" color="error" component="div">{mode.reason}</Typography> : null}
      </Box>
    </Box>
  );
}

export default function CompositionEditor({
  value, onChange, elements, errors = [], prefix = 'composition',
}) {
  const [picking, setPicking] = useState(false);
  const [secondResource, setSecondResource] = useState(false);
  const errorOf = (path) => (errors.find((e) => e.field === `${prefix}.${path}`) || {}).message;
  const resource = value ? elements.find((e) => e.kind === 'resource' && e.id === value.resourceId) : null;
  const options = (value && value.options) || [];
  const byRef = (ref) => elements.find((e) => e.articleRef === ref);
  const mode = resource ? resource.modes.find((m) => m.band === value.band) : null;
  const step = mode ? mode.slotMinutes : 60;

  function pick(element) {
    if (element.kind === 'resource') {
      if (value && value.resourceId) { setSecondResource(true); return; }
      const first = element.modes.find((m) => m.sellable) || element.modes[0];
      onChange({
        resourceId: element.id, band: first ? first.band : 'day', minutes: first ? first.minimumMinutes : 60, options,
      });
      return;
    }
    setSecondResource(false);
    if (options.some((o) => o.articleRef === element.articleRef)) return;
    onChange({ ...(value || { resourceId: null, band: 'day', minutes: 60 }), options: [...options, { articleRef: element.articleRef, qty: 1 }] });
  }

  const setOption = (index, patch) => onChange({ ...value, options: options.map((o, i) => (i === index ? { ...o, ...patch } : o)) });
  const removeOption = (index) => onChange({ ...value, options: options.filter((_, i) => i !== index) });

  return (
    <Stack spacing={1.5}>
      {!resource && options.length === 0 ? <Typography variant="body2" color="text.secondary">{T.empty}</Typography> : null}
      {errorOf('resourceId') ? <Typography variant="body2" color="error" role="alert">{errorOf('resourceId')}</Typography> : null}

      {resource ? (
        <Card variant="outlined">
          <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
            <Stack spacing={1.5}>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
                <Typography fontWeight={600} sx={{ overflowWrap: 'anywhere' }}>{resource.label}</Typography>
                <Tooltip title={T.remove}>
                  <IconButton aria-label={`${T.remove} ${resource.label}`} onClick={() => onChange({ ...value, resourceId: null })} sx={{ width: 44, height: 44 }}><DeleteOutlineIcon /></IconButton>
                </Tooltip>
              </Stack>
              <Stack spacing={1} role="radiogroup" aria-label={T.modes}>
                {resource.modes.map((m) => (
                  <ModeChoice key={m.key} mode={m} selected={m.band === value.band} onSelect={() => onChange({ ...value, band: m.band })} />
                ))}
              </Stack>
              {errorOf('band') ? <Typography variant="body2" color="error" role="alert">{errorOf('band')}</Typography> : null}
              <QuantityField
                label={T.minutes} value={value.minutes} step={step} min={0} size="small"
                onCommit={(minutes) => onChange({ ...value, minutes })} error={Boolean(errorOf('minutes'))}
                helperText={errorOf('minutes') || (mode ? T.minutesHelp(mode.slotMinutes, mode.minimumMinutes) : undefined)} sx={{ maxWidth: 260 }}
              />
            </Stack>
          </CardContent>
        </Card>
      ) : null}
      {secondResource ? <Typography variant="body2" color="error" role="alert">{T.secondResource}</Typography> : null}

      {options.map((option, index) => {
        const element = byRef(option.articleRef);
        const problem = errorOf(`options[${index}].articleRef`) || errorOf(`options[${index}].qty`);
        return (
          <Card key={option.articleRef} variant="outlined">
            <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}>
                <Box sx={{ minWidth: 0 }}>
                  <Typography fontWeight={600} sx={{ overflowWrap: 'anywhere' }}>{element ? element.label : option.articleRef}</Typography>
                  {element ? <Chip size="small" label={element.priceTypeLabel} sx={{ mt: 0.5 }} /> : null}
                </Box>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
                  <QuantityField
                    label={T.quantity} value={option.qty} min={1} max={MAX_QTY} size="small" onCommit={(qty) => setOption(index, { qty })}
                    error={Boolean(problem)} sx={{ maxWidth: 170 }}
                  />
                  <Tooltip title={T.remove}>
                    <IconButton aria-label={`${T.remove} ${element ? element.label : option.articleRef}`} onClick={() => removeOption(index)} sx={{ width: 44, height: 44 }}><DeleteOutlineIcon /></IconButton>
                  </Tooltip>
                </Stack>
              </Stack>
              {problem ? <Typography variant="body2" color="error" role="alert" sx={{ mt: 0.5 }}>{problem}</Typography> : null}
            </CardContent>
          </Card>
        );
      })}

      <Box><Button startIcon={<AddIcon />} variant="outlined" onClick={() => setPicking(true)} sx={{ minHeight: 44 }}>{T.add}</Button></Box>
      <ElementPicker open={picking} onClose={() => setPicking(false)} elements={elements} onPick={pick} />
    </Stack>
  );
}
