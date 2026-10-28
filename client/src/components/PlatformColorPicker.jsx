/**
 * PlatformColorPicker — a clickable colour swatch that opens a popover palette.
 *
 * Generic + reusable wherever a platform (or any display) colour is edited. Renders the current
 * colour as a small square; clicking it opens a popover with a preset palette + a free "Personnalisée"
 * native colour input. Picking a colour calls `onChange(hex)`.
 *
 * Props:
 *   - color:     string            current hex colour (e.g. '#FF5A5F')
 *   - onChange:  (hex) => void      called with the chosen colour
 *   - disabled?: boolean            when true the swatch is inert
 *   - size?:     number             swatch side in px (default 24)
 *   - label?:    ReactNode          optional content rendered right of the swatch (e.g. the platform name)
 *   - title?:    string             tooltip on the swatch (default "Changer la couleur")
 *   - error?:    string             the server's refusal of the colour, shown under the swatch
 *                                   (specs/calendar-property-parity.md rule 7)
 */

import React, { useState } from 'react';
import { Box, Popover, Tooltip, Typography, TextField } from '@mui/material';

// A curated palette: the built-in platform colours (each readable on the calendar, with white or ink text) +
// a few more accents that pass the same check. Operators pick from here for one-click consistency, or use
// the custom input for anything else — the server refuses a colour the calendar cannot print legibly.
const PRESET_COLORS = [
  '#2F5D46', '#C93848', '#1B3F8B', '#4FA3E0', '#8A55B2', '#8BC34A', '#F2CC3D', '#EF7D22',
  '#6E6A5E', '#9c27b0', '#795548', '#2e7d32', '#5e35b1', '#0F766E', '#B45309', '#7A3E65',
];

export default function PlatformColorPicker({ color, onChange, disabled = false, size = 24, label = null, title = 'Changer la couleur', showSwatch = true, error = null }) {
  const [anchorEl, setAnchorEl] = useState(null);
  // Draft for the native colour input: it fires `onChange` continuously while the user drags through
  // the gamut. Buffer locally and commit ONCE (on blur / popover close) so we don't emit a burst of
  // optimistic updates + network PUTs for a single pick.
  const [draft, setDraft] = useState(null);
  const open = Boolean(anchorEl);
  const current = color || '#6E6A5E';

  const commitDraft = () => {
    if (draft != null && draft !== current) onChange(draft);
    setDraft(null);
  };

  const closePopover = () => {
    commitDraft();
    setAnchorEl(null);
  };

  const pick = (hex) => {
    onChange(hex);
    setDraft(null);
    setAnchorEl(null);
  };

  const swatch = (
    <Box
      onClick={disabled ? undefined : (e) => setAnchorEl(e.currentTarget)}
      role="button"
      aria-label={title}
      tabIndex={disabled ? -1 : 0}
      onKeyDown={(e) => { if (!disabled && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setAnchorEl(e.currentTarget); } }}
      sx={{
        width: size,
        height: size,
        borderRadius: 1,
        bgcolor: current,
        border: '1px solid',
        borderColor: 'rgba(0,0,0,0.25)',
        cursor: disabled ? 'default' : 'pointer',
        flexShrink: 0,
        opacity: disabled ? 0.5 : 1,
        '&:hover': disabled ? {} : { boxShadow: 1 },
        // A finger gets a 44 × 44 hit area around the small swatch, without moving the layout
        // (specs/ds-components.md rule 21).
        '@media (pointer: coarse)': {
          position: 'relative',
          '&::after': { content: '""', position: 'absolute', inset: Math.min(0, (size - 44) / 2) },
        },
      }}
    />
  );

  return (
    <Box sx={{ display: 'inline-flex', flexDirection: 'column', gap: 0.5 }}>
      <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
        {showSwatch && <Tooltip title={disabled ? '' : title}>{swatch}</Tooltip>}
        {label != null && (
          // When the swatch is hidden the label IS the trigger → make it a proper button for a11y + tests.
          <Box
            onClick={disabled ? undefined : (e) => setAnchorEl(e.currentTarget)}
            role={disabled ? undefined : 'button'}
            aria-label={disabled ? undefined : title}
            tabIndex={disabled ? -1 : 0}
            onKeyDown={(e) => { if (!disabled && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setAnchorEl(e.currentTarget); } }}
            sx={{ cursor: disabled ? 'default' : 'pointer', display: 'inline-flex' }}
          >
            {label}
          </Box>
        )}
        <Popover
          open={open}
          anchorEl={anchorEl}
          onClose={closePopover}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        >
          <Box sx={{ p: 1.5, width: 200 }}>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
              Couleur sur le calendrier
            </Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 0.75, mb: 1.5 }}>
              {PRESET_COLORS.map((hex) => (
                <Box
                  key={hex}
                  onClick={() => pick(hex)}
                  role="button"
                  aria-label={hex}
                  sx={{
                    width: 18,
                    height: 18,
                    borderRadius: 0.5,
                    bgcolor: hex,
                    cursor: 'pointer',
                    border: hex.toLowerCase() === current.toLowerCase() ? '2px solid' : '1px solid',
                    borderColor: hex.toLowerCase() === current.toLowerCase() ? 'text.primary' : 'rgba(0,0,0,0.2)',
                    '&:hover': { transform: 'scale(1.15)' },
                  }}
                />
              ))}
            </Box>
            <TextField
              type="color"
              size="small"
              fullWidth
              label="Personnalisée"
              value={draft ?? current}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitDraft}
              InputLabelProps={{ shrink: true }}
            />
          </Box>
        </Popover>
      </Box>
    {error && (
      <Typography role="alert" variant="caption" color="error" sx={{ maxWidth: 220, lineHeight: 1.25 }}>{error}</Typography>
    )}
    </Box>
  );
}
