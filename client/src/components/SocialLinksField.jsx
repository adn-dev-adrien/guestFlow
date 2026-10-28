/**
 * SocialLinksField — an ordered list of social-network links, for the e-mail settings
 * (specs/settings-input-guards.md rules 35, 37, 38). One row per link: a network picker, the URL, and
 * up / down / remove. The network catalogue and the validation belong to the server; this component
 * only edits the list and shows the server's messages under the right row.
 *
 * Specific to the e-mail settings (one list, one meaning) — not a generic component.
 *
 * Props:
 *   - links: Array<{ network, url }>     — the list, in the operator's order.
 *   - networks: Array<{ value, label }>  — the catalogue the server sends.
 *   - onChange: (links) => void
 *   - errors?: { [key]: string }         — server messages keyed `socialLinks.<index>.<network|url>`
 *       and `socialLinks` for the list as a whole.
 *   - max?: number (default 8)           — most links; « Ajouter un réseau » is disabled at the limit
 *       or when every network is already in the list.
 *   - disabled?: boolean
 */
import React from 'react';
import { Box, Button, FormControl, FormHelperText, IconButton, InputLabel, MenuItem, Select, TextField, Tooltip, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import CloseIcon from '@mui/icons-material/Close';

const iconButtonSx = { minWidth: 44, minHeight: 44 };

export default function SocialLinksField({ links = [], networks = [], onChange, errors = {}, max = 8, disabled = false }) {
  const used = new Set(links.map((l) => l.network));
  const nextFree = networks.find((n) => !used.has(n.value));
  const canAdd = !disabled && links.length < max && Boolean(nextFree);

  const patch = (index, change) => onChange(links.map((l, i) => (i === index ? { ...l, ...change } : l)));
  const move = (index, delta) => {
    const next = [...links];
    [next[index], next[index + delta]] = [next[index + delta], next[index]];
    onChange(next);
  };
  const remove = (index) => onChange(links.filter((_, i) => i !== index));

  return (
    <Box>
      <Typography variant="subtitle2" component="h3">Réseaux sociaux</Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
        {errors.socialLinks || 'Proposés dans le mail de remerciement (J+1).'}
      </Typography>
      <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        {links.map((link, index) => {
          const networkError = errors[`socialLinks.${index}.network`];
          return (
            <Box
              component="li"
              key={link.network}
              sx={{
                display: 'grid',
                gap: 1,
                alignItems: 'start',
                gridTemplateColumns: { xs: 'minmax(0, 1fr) auto', sm: '140px minmax(0, 1fr) auto' },
                gridTemplateAreas: { xs: '"network actions" "url url"', sm: '"network url actions"' },
              }}
            >
              <FormControl size="small" error={Boolean(networkError)} disabled={disabled} sx={{ gridArea: 'network' }}>
                <InputLabel id={`social-network-${index}`}>Réseau</InputLabel>
                <Select
                  labelId={`social-network-${index}`}
                  label="Réseau"
                  value={link.network}
                  onChange={(e) => patch(index, { network: e.target.value })}
                >
                  {networks.map((n) => (
                    <MenuItem key={n.value} value={n.value} disabled={n.value !== link.network && used.has(n.value)}>{n.label}</MenuItem>
                  ))}
                </Select>
                {networkError && <FormHelperText>{networkError}</FormHelperText>}
              </FormControl>
              <TextField
                size="small"
                label="Adresse du lien"
                value={link.url}
                onChange={(e) => patch(index, { url: e.target.value })}
                error={Boolean(errors[`socialLinks.${index}.url`])}
                helperText={errors[`socialLinks.${index}.url`] || undefined}
                disabled={disabled}
                slotProps={{ htmlInput: { inputMode: 'url', autoCapitalize: 'none', spellCheck: false } }}
                sx={{ gridArea: 'url' }}
              />
              <Box sx={{ gridArea: 'actions', display: 'flex' }}>
                <Tooltip title="Monter">
                  <span><IconButton aria-label="Monter" onClick={() => move(index, -1)} disabled={disabled || index === 0} sx={iconButtonSx}><ArrowUpwardIcon fontSize="small" /></IconButton></span>
                </Tooltip>
                <Tooltip title="Descendre">
                  <span><IconButton aria-label="Descendre" onClick={() => move(index, 1)} disabled={disabled || index === links.length - 1} sx={iconButtonSx}><ArrowDownwardIcon fontSize="small" /></IconButton></span>
                </Tooltip>
                <Tooltip title="Retirer">
                  <span><IconButton aria-label="Retirer" onClick={() => remove(index)} disabled={disabled} sx={iconButtonSx}><CloseIcon fontSize="small" /></IconButton></span>
                </Tooltip>
              </Box>
            </Box>
          );
        })}
      </Box>
      <Button
        startIcon={<AddIcon />}
        onClick={() => onChange([...links, { network: nextFree.value, url: '' }])}
        disabled={!canAdd}
        sx={{ mt: links.length ? 1.5 : 0, minHeight: 44 }}
      >
        Ajouter un réseau
      </Button>
    </Box>
  );
}
