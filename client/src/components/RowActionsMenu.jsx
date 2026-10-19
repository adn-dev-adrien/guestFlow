/**
 * RowActionsMenu — the « ⋯ » menu of a list row (specs/ui-review-2026-10-19-operations.md rules 6-7).
 *
 * One control per row instead of a strip of icons: the row itself opens the item, the menu holds the
 * rest, and a destructive item sits last in the error colour. An action used daily can stay visible
 * beside « ⋯ » from a breakpoint up; below it, it moves into the menu (on top of the items).
 * Clicks never reach the row underneath.
 *
 * Props:
 *   label          string     accessible name of the « ⋯ » button (« Actions du devis 2026-09-007 »)
 *   items          Array<{ label, onClick, icon?, danger?, hidden? }>   menu entries, in order
 *   pinned?        Array<{ label, onClick, icon }>   actions shown as icon buttons from `pinnedFrom`
 *   pinnedFrom?    'sm' | 'md' | 'lg'   breakpoint from which `pinned` is visible (default 'md')
 */
import React, { useState } from 'react';
import {
  Box, IconButton, Menu, MenuItem, ListItemIcon, ListItemText, Tooltip, Divider, useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import MoreHorizIcon from '@mui/icons-material/MoreHoriz';

const BUTTON_SX = { width: 44, height: 44 };

export default function RowActionsMenu({ label, items = [], pinned = [], pinnedFrom = 'md' }) {
  const theme = useTheme();
  const showPinned = useMediaQuery(theme.breakpoints.up(pinnedFrom));
  const [anchor, setAnchor] = useState(null);

  const visibleItems = items.filter((it) => !it.hidden);
  const regular = visibleItems.filter((it) => !it.danger);
  const danger = visibleItems.filter((it) => it.danger);
  const menuItems = [...(showPinned ? [] : pinned), ...regular];

  const stop = (e) => e.stopPropagation();
  const run = (action) => (e) => {
    e.stopPropagation();
    setAnchor(null);
    action.onClick();
  };

  return (
    <Box onClick={stop} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
      {showPinned && pinned.map((action) => (
        <Tooltip key={action.label} title={action.label} enterDelay={500}>
          <IconButton aria-label={action.label} onClick={run(action)} sx={BUTTON_SX}>{action.icon}</IconButton>
        </Tooltip>
      ))}
      <IconButton
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={Boolean(anchor)}
        onClick={(e) => { e.stopPropagation(); setAnchor(e.currentTarget); }}
        sx={BUTTON_SX}
      >
        <MoreHorizIcon />
      </IconButton>
      <Menu
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={(e) => { if (e?.stopPropagation) e.stopPropagation(); setAnchor(null); }}
        onClick={stop}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        {menuItems.map((action) => (
          <MenuItem key={action.label} onClick={run(action)} sx={{ minHeight: 44 }}>
            {action.icon && <ListItemIcon>{action.icon}</ListItemIcon>}
            <ListItemText>{action.label}</ListItemText>
          </MenuItem>
        ))}
        {danger.length > 0 && menuItems.length > 0 && <Divider />}
        {danger.map((action) => (
          <MenuItem key={action.label} onClick={run(action)} sx={{ minHeight: 44, color: 'error.main' }}>
            {action.icon && <ListItemIcon sx={{ color: 'error.main' }}>{action.icon}</ListItemIcon>}
            <ListItemText>{action.label}</ListItemText>
          </MenuItem>
        ))}
      </Menu>
    </Box>
  );
}
