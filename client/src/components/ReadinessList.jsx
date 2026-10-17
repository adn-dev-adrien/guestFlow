/**
 * ReadinessList — the generic « À compléter » list (specs/guest-email-texts-made-simple.md rules 6–7):
 * what the server found missing, each item a link to where it is fixed. Renders nothing when the list
 * is empty, unless `doneLabel` asks to say so.
 *
 * Props:
 *   items       [{ id, label, target: { path, search?, hash? } }]
 *   title       string — default « À compléter »
 *   doneLabel   string — shown instead of nothing when `items` is empty
 *   onOpen      (target) => void — default: navigate to the target
 *   sx
 */
import React from 'react';
import { Alert, AlertTitle, Box, Link } from '@mui/material';
import { useNavigate } from 'react-router';

export const targetUrl = (target) => `${target.path}${target.search ? `?${target.search}` : ''}${target.hash ? `#${target.hash}` : ''}`;

export default function ReadinessList({ items = [], title = 'À compléter', doneLabel, onOpen, sx }) {
  const navigate = useNavigate();
  if (!items.length) {
    return doneLabel ? <Alert severity="success" sx={sx}>{doneLabel}</Alert> : null;
  }
  const open = onOpen || ((target) => navigate(targetUrl(target)));
  return (
    <Alert severity="warning" sx={sx} aria-label={title}>
      <AlertTitle>{`${title} (${items.length})`}</AlertTitle>
      <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
        {items.map((item) => (
          <li key={item.id}>
            <Link component="button" type="button" onClick={() => open(item.target)} sx={{ textAlign: 'left', minHeight: 32 }}>
              {item.label}
            </Link>
          </li>
        ))}
      </Box>
    </Alert>
  );
}
