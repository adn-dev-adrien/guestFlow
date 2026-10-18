/**
 * ConsoleNav — the console's top menu (specs/control-plane-plans-and-access.md rule 36). On a phone
 * the first two entries stay in the bar and the others go under « Plus », which takes the name of
 * the open page when it is one of them. Specific to the console.
 *
 * Props:
 *   pathname: string — the current location's path (required)
 */
import React, { useState } from 'react';
import { Link } from 'react-router';
import { Box, Button, Menu, MenuItem, useMediaQuery } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';

const NAV = [
  { to: '/', label: 'Clients', match: (p) => p === '/' || p.startsWith('/clients') },
  { to: '/versions', label: 'Versions', match: (p) => p.startsWith('/versions') },
  { to: '/catalogue', label: 'Catalogue', match: (p) => p.startsWith('/catalogue') },
  { to: '/emails', label: 'Emails', match: (p) => p.startsWith('/emails') },
  { to: '/registre', label: 'Registre', match: (p) => p.startsWith('/registre') },
  { to: '/parametres/paiements', label: 'Réglages', match: (p) => p.startsWith('/parametres') },
  { to: '/profil', label: 'Profil', match: (p) => p.startsWith('/profil') },
];
const PHONE_BAR = 2;

const navSx = (current) => ({ minHeight: 44, fontWeight: 600, opacity: current ? 1 : 0.75, borderBottom: current ? 2 : 0, borderRadius: 0, whiteSpace: 'nowrap', flexShrink: 0 });

export default function ConsoleNav({ pathname }) {
  const theme = useTheme();
  const phone = useMediaQuery(theme.breakpoints.down('sm'));
  const [anchor, setAnchor] = useState(null);
  const shown = phone ? NAV.slice(0, PHONE_BAR) : NAV;
  const more = phone ? NAV.slice(PHONE_BAR) : [];
  const moreCurrent = more.some((n) => n.match(pathname));
  return (
    <Box component="nav" aria-label="Console" sx={{ display: 'flex', gap: 0.5, flex: 1, minWidth: 0 }}>
      {shown.map((n) => (
        <Button key={n.to} component={Link} to={n.to} color="inherit" aria-current={n.match(pathname) ? 'page' : undefined} sx={navSx(n.match(pathname))}>
          {n.label}
        </Button>
      ))}
      {more.length > 0 && (
        <>
          <Button color="inherit" endIcon={<ExpandMoreIcon />} aria-haspopup="menu" aria-expanded={Boolean(anchor)}
            onClick={(e) => setAnchor(e.currentTarget)} sx={navSx(moreCurrent)}>
            {moreCurrent ? more.find((n) => n.match(pathname)).label : 'Plus'}
          </Button>
          <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
            {more.map((n) => (
              <MenuItem key={n.to} component={Link} to={n.to} selected={n.match(pathname)} onClick={() => setAnchor(null)} sx={{ minHeight: 44 }}>
                {n.label}
              </MenuItem>
            ))}
          </Menu>
        </>
      )}
    </Box>
  );
}
