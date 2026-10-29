/**
 * ClientDirectoryRow — one client of the Clients directory (specs/clients-upcoming-past-directory.md
 * rules 14, 15, 18, 22). Renders what the server shaped: initials, name, `whenLabel`, the qualifying
 * stay (property · dates · nights · platform), « N séjours », and the e-mail / phone as links.
 *
 * The whole row opens the client: the name is the one real button, stretched over the row, so the
 * `mailto:` / `tel:` links stay separate interactive elements (no nested controls). Any name, property
 * or e-mail truncates to one line with the full value in `title`.
 *
 * Props:
 *   client    { id, lastName, firstName, email, phone, whenLabel, inStay, stayCount,
 *               stay: { propertyName, datesLabel, nights, platform } | null }
 *   onOpen    (client) => void
 */
import React, { useId } from 'react';
import { Box, ButtonBase, IconButton, Link, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import PhoneIcon from '@mui/icons-material/PhoneOutlined';
import PlatformChip from './PlatformChip';
import StatusBadge from './StatusBadge';
import { TEXTS } from '../constants/clientsDirectory';

const ellipsis = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 };

function initialsOf(client) {
  const letters = [client.lastName, client.firstName]
    .map((part) => String(part || '').trim().charAt(0).toUpperCase())
    .join('');
  return letters || '?';
}

const chipSx = { flex: 'none', height: 20, fontSize: '0.6875rem' };

// On touch the two links are 44 px tall each and share a line when they fit: stacked 20 px links
// 24 px apart cannot give two 44 px hit areas without covering each other or the row above.
const contactBoxSx = { minWidth: 0, maxWidth: '100%' };
const contactListSx = {
  minWidth: 0, display: { xs: 'none', md: 'flex' }, flexDirection: 'column', alignItems: 'flex-end',
  '@media (pointer: coarse)': { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'center', columnGap: 1.5 },
};

const contactLinkSx = {
  display: 'inline-block', maxWidth: '100%', verticalAlign: 'top', color: 'text.secondary', textDecoration: 'none', fontSize: '0.8125rem',
  position: 'relative', zIndex: 1, '&:hover': { color: 'primary.main', textDecoration: 'underline' },
  '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2, borderRadius: 0.5 },
  '@media (pointer: coarse)': { display: 'flex', alignItems: 'center', minHeight: 44, '&::after': { display: 'none' } },
};

export default function ClientDirectoryRow({ client, onOpen }) {
  const { stay } = client;
  const detailId = useId();
  const fullName = [client.lastName, client.firstName].filter((p) => String(p || '').trim()).join(' ');
  const { inStay } = client;
  return (
    <Box
      data-testid="client-row"
      sx={{
        position: 'relative', display: 'grid', alignItems: 'center', columnGap: 1.75, rowGap: 0.25,
        px: { xs: 1.5, md: 2.25 }, py: 1.5, minHeight: { md: 72 },
        gridTemplateColumns: { xs: '40px minmax(0, 1fr) 44px', md: '40px minmax(0, 1.25fr) minmax(0, 1.35fr) minmax(0, 1fr)' },
        transition: 'background-color 150ms',
        '&:hover': { bgcolor: 'action.hover' },
        '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
      }}
    >
      <Box
        aria-hidden
        sx={(t) => ({
          width: 40, height: 40, borderRadius: '12px', display: 'grid', placeItems: 'center',
          bgcolor: alpha(t.palette.primary.main, 0.1), color: 'primary.main', fontWeight: 600, fontSize: '0.875rem',
          gridRow: { xs: '1 / span 3', md: 'auto' },
        })}
      >
        {initialsOf(client)}
      </Box>

      <Box sx={{ minWidth: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
          <ButtonBase
            onClick={() => onOpen(client)}
            title={fullName}
            aria-describedby={detailId}
            sx={{
              ...ellipsis, display: 'block', position: 'static', textAlign: 'left', font: 'inherit', fontWeight: 600, borderRadius: 1,
              '&::after': { content: '""', position: 'absolute', inset: 0 },
              '&.Mui-focusVisible::after': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: -2, borderRadius: 'inherit' },
            }}
          >
            {fullName || '—'}
          </ButtonBase>
          {client.stayCount >= 2 && (
            <Box sx={{ flex: 'none' }}>
              <StatusBadge status="neutral" label={TEXTS.stays(client.stayCount)} />
            </Box>
          )}
        </Box>
        <Typography
          id={detailId}
          variant="body2"
          title={client.whenLabel}
          sx={{ ...ellipsis, fontSize: '0.8125rem', color: inStay ? 'success.text' : 'text.secondary', fontWeight: inStay ? 600 : 400 }}
        >
          {client.whenLabel}
        </Typography>
      </Box>

      {stay && (
        <Box sx={{ minWidth: 0, gridColumn: { xs: 2, md: 'auto' }, gridRow: { xs: 2, md: 'auto' } }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
            <Typography variant="body2" title={stay.propertyName} sx={{ ...ellipsis, fontWeight: 500 }}>
              {stay.propertyName}
            </Typography>
            <PlatformChip platform={stay.platform} sx={{ ...chipSx, display: { xs: 'inline-flex', md: 'none' } }} />
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, color: 'text.secondary', fontSize: '0.8125rem' }}>
            <Box component="span" sx={{ ...ellipsis, fontVariantNumeric: 'tabular-nums' }}>
              {stay.datesLabel} · {TEXTS.nights(stay.nights)}
            </Box>
            <PlatformChip platform={stay.platform} sx={{ ...chipSx, display: { xs: 'none', md: 'inline-flex' } }} />
          </Box>
        </Box>
      )}

      <Box sx={{ ...contactListSx, gridColumn: { md: stay ? 'auto' : '3 / span 2' } }}>
        {client.email && <Box sx={contactBoxSx}><Link href={`mailto:${client.email}`} title={client.email} underline="none" sx={contactLinkSx}><Box component="span" sx={{ ...ellipsis, display: 'block' }}>{client.email}</Box></Link></Box>}
        {client.phone && <Box sx={contactBoxSx}><Link href={`tel:${client.phone}`} title={client.phone} underline="none" sx={contactLinkSx}><Box component="span" sx={{ ...ellipsis, display: 'block' }}>{client.phone}</Box></Link></Box>}
      </Box>

      {client.phone && (
        <IconButton
          component="a"
          href={`tel:${client.phone}`}
          aria-label={TEXTS.callLabel(fullName)}
          sx={{
            display: { xs: 'inline-flex', md: 'none' }, gridColumn: 3, gridRow: '1 / span 3', width: 44, height: 44,
            border: '1px solid', borderColor: 'divider', borderRadius: '12px', color: 'primary.main', position: 'relative', zIndex: 1,
          }}
        >
          <PhoneIcon fontSize="small" />
        </IconButton>
      )}
    </Box>
  );
}
