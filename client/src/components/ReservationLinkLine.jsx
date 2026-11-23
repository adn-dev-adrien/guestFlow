/**
 * ReservationLinkLine — the identity line of a row about ONE reservation, drawn as a link to its fiche
 * (specs/mobile-dashboard-exercise-cash.md rule 5). Used by every subject of the home that lists reservations
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
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
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
      <ChevronRightIcon fontSize="small" color="action" aria-hidden sx={{ mt: '12px', flexShrink: 0 }} />
    </Box>
  );
}
