/**
 * HeaderPill — the compact, tappable indicator of the top bar (specs/self-update-and-releases.md
 * §6.5). Soft semantic background + same-color icon and text, fully rounded — the `StatusBadge`
 * grammar, sized for the `AppBar` and made clickable.
 *
 * It exists because an icon-only `IconButton` in a white bar reads as decoration: the operator has
 * to already know something is there to look for it. A tinted pill announces itself.
 *
 * Props:
 *   icon:      ReactNode                                                  (required)
 *   tone?:     'primary' | 'success' | 'warning' | 'error' | 'info' | 'neutral'   (default 'primary')
 *   count?:    number      — rendered right after the icon
 *   label?:    string      — French, hidden on `xs` where the bar is tight
 *   title:     string      — French tooltip                               (required)
 *   onClick:   () => void                                                 (required)
 *   ariaLabel?: string     — defaults to `title`
 */
import React from 'react';
import { Box, ButtonBase, Tooltip } from '@mui/material';
import { alpha } from '@mui/material/styles';

export default function HeaderPill({ icon, tone = 'primary', count, label, title, onClick, ariaLabel }) {
  return (
    <Tooltip title={title}>
      <ButtonBase
        onClick={onClick}
        aria-label={ariaLabel || title}
        sx={(t) => {
          const color = tone === 'neutral' ? t.palette.text.secondary : t.palette[tone].main;
          return {
            position: 'relative',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 0.5,
            px: 1.25,
            py: 0.5,
            borderRadius: 999,
            fontSize: '0.75rem',
            fontWeight: 600,
            lineHeight: 1.4,
            color,
            bgcolor: alpha(color, 0.14),
            '&:hover': { bgcolor: alpha(color, 0.24) },
            '& svg': { fontSize: 18 },
            // The pill stays visually compact inside a 56 px bar; the touch target reaches the
            // 44 px floor through a transparent overlay instead of padding the visible shape.
            '&::after': { content: '""', position: 'absolute', inset: '-9px -6px' },
          };
        }}
      >
        {icon}
        {count !== undefined && <span>{count}</span>}
        {label && (
          <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' }, whiteSpace: 'nowrap' }}>
            {label}
          </Box>
        )}
      </ButtonBase>
    </Tooltip>
  );
}
