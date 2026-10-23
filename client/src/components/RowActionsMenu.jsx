/**
 * RowActionsMenu — « ⋯ » icon button opening a menu of secondary row actions, for list cards where
 * the rare or destructive actions must stay one tap further away than the everyday ones
 * (specs/devis-list-mobile-card.md rule 4). Clicks never reach the card behind it.
 *
 * Props:
 *   items:    { label: string, icon?: ReactNode, onClick: () => void, color?: 'error' }[]   (falsy entries skipped)
 *   label?:   string   accessible name of the trigger (default « Plus d'actions »)
 */
import React, { useState } from 'react';
import { IconButton, ListItemIcon, ListItemText, Menu, MenuItem } from '@mui/material';
import MoreHorizIcon from '@mui/icons-material/MoreHoriz';

export default function RowActionsMenu({ items, label = "Plus d'actions" }) {
  const [anchor, setAnchor] = useState(null);
  const entries = (items || []).filter(Boolean);
  if (entries.length === 0) return null;

  const stop = (e) => e.stopPropagation();
  const close = () => setAnchor(null);

  return (
    <span onClick={stop}>
      <IconButton
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={Boolean(anchor)}
        onClick={(e) => { stop(e); setAnchor(e.currentTarget); }}
        sx={{ width: 44, height: 44 }}
      >
        <MoreHorizIcon />
      </IconButton>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={close} onClick={stop}>
        {entries.map((item) => (
          <MenuItem
            key={item.label}
            onClick={() => { close(); item.onClick(); }}
            sx={{ minHeight: 44, color: item.color === 'error' ? 'error.main' : undefined }}
          >
            {item.icon && <ListItemIcon sx={{ color: 'inherit' }}>{item.icon}</ListItemIcon>}
            <ListItemText>{item.label}</ListItemText>
          </MenuItem>
        ))}
      </Menu>
    </span>
  );
}
