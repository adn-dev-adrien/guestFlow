/**
 * ReservationLinkLine — the identity line of a row about ONE reservation, drawn as a link to its fiche
 * (specs/planning/mobile-dashboard-exercise-cash.md rule 5). Used by every subject of the home that lists reservations
 * and exposed to plugins through the SDK, so they do not re-implement it.
 *
 * Props:
 *   reservationId  number|string   the fiche to open (`/reservations/:id`, coming back to `from`)
 *   clientName?    string          names the link for assistive technology: « Ouvrir la fiche de {clientName} »
 *   children       ReactNode       the line itself (client · logement · platform, dates…); wraps on two lines
 *                                  rather than truncating, the chevron stays at the end of the first line
 *   from?          string          where « Retour » lands (default the home, `/`)
 *   disabled?      boolean         the fiche no longer exists: the line is drawn, not linked
 *   sx?            object          extra styles on the link
 *
 * The row's own buttons (Relancer, Reporter…) stay outside this component: tapping one never navigates.
 */
import React from 'react';
import { Box } from '@mui/material';
import { Link as RouterLink, useInRouterContext } from 'react-router';
import { withFrom } from '../utils/navigation';

export default function ReservationLinkLine({ reservationId, clientName, children, from = '/', disabled = false, sx }) {
  const inRouter = useInRouterContext();
  const body = <Box sx={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere', py: '12px' }}>{children}</Box>;
  if (disabled) return <Box sx={{ minHeight: 44, display: 'flex', ...sx }}>{body}</Box>;

  const path = withFrom(`/reservations/${reservationId}`, from);
  return (
    <Box
      {...(inRouter ? { component: RouterLink, to: path } : { component: 'a', href: path })}
      aria-label={clientName ? `Ouvrir la fiche de ${clientName}` : 'Ouvrir la fiche'}
      sx={{
        display: 'flex', alignItems: 'flex-start', gap: 1, minHeight: 44, borderRadius: 1, px: 1, mx: -1,
        color: 'inherit', textDecoration: 'none',
        '&:hover': { bgcolor: 'action.hover' },
        '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: -2 },
        ...sx,
      }}
    >
      {body}
      {/* An inline chevron rather than the icon package: this line ships in the SDK, on every first load. */}
      <Box component="svg" viewBox="0 0 24 24" aria-hidden sx={{ width: 20, height: 20, mt: '12px', flexShrink: 0, fill: 'currentColor', color: 'action.active' }}>
        <path d="M10 6 8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z" />
      </Box>
    </Box>
  );
}
