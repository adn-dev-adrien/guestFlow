/**
 * DepartureMiniRow — departure tile on PlanningPage.
 *
 * Compact counterpart to `ReservationCard`. Renders the DÉPART badge + the time pill +
 * the property name + the client name. When a tight transition triggered an alert
 * (`alertInfo.cleaningDisplay` set), an extra prominent red block surfaces the
 * cleaning duration. NO family breakdown, NO notes (Adrien 2026-06-06: keep the
 * departure tile compact, family + notes belong on the arrival).
 *
 * Click anywhere on the body (except the done checkbox) fires `onOpen(reservation.id)`.
 *
 * Extracted from `pages/PlanningPage.js` on 2026-06-06 alongside `ReservationCard`,
 * for direct Vitest coverage.
 *
 * Props:
 *   reservation — { id, firstName, lastName, propertyName, checkOutTime, checkOutDone }
 *   onToggleDone — `(reservation) => void`. Required. Called when the operator ticks
 *     the done checkbox; `stopPropagation` is applied so the card's click doesn't fire.
 *   onOpen — `(reservationId) => void`. Optional. When provided, the whole Card body
 *     becomes clickable with cursor + hover affordance.
 *   alertInfo — { type, explanation?, cleaningDisplay? } | undefined. Symmetric with
 *     `ReservationCard`'s prop. The `cleaningDisplay` field drives the red Ménage block.
 */

import React from 'react';
import {
  Box, Typography, Card, CardContent, Checkbox, Chip, Tooltip, IconButton, Link, useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { grey } from '@mui/material/colors';
import HomeWorkIcon from '@mui/icons-material/HomeWork';
import PersonIcon from '@mui/icons-material/Person';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import FlightTakeoffIcon from '@mui/icons-material/FlightTakeoff';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import CleaningServicesIcon from '@mui/icons-material/CleaningServices';
import ChecklistIcon from '@mui/icons-material/Checklist';

const DEPARTURE_BG = grey[100]; // #F5F5F5 — quieter than the arrival peach on purpose.

export default function DepartureMiniRow({ reservation, onToggleDone, alertInfo, onOpenReservation, onOpenSas, onOpenClient }) {
  const done = Boolean(reservation.checkOutDone);
  const sasDone = !!reservation.departureSasDoneAt;
  const theme = useTheme();
  // On mobile the two action buttons move to a dedicated bottom row (rendered once, not duplicated).
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const stop = (e) => e.stopPropagation();
  // Symmetric alert background with `ReservationCard`: when there's a tight transition,
  // the operator sees the same coloured pull on the departure as on the next arrival.
  let alertBgColor = DEPARTURE_BG;
  if (alertInfo?.type === 'red') alertBgColor = 'rgba(244, 67, 54, 0.14)';
  else if (alertInfo?.type === 'orange') alertBgColor = 'rgba(244, 67, 54, 0.10)';
  else if (alertInfo?.type === 'blue') alertBgColor = 'rgba(33, 150, 243, 0.08)';
  const checkOutTime = reservation.checkOutTime || '10:00';
  // The card action is the check-out (SAS) launcher — a LARGE icon for an easy tap target on mobile.
  // The whole card opens the reservation fiche (no separate « open » icon); this button stops the click.
  const actionButtons = onOpenSas ? (
    <Tooltip title={sasDone ? 'Revoir / modifier le check-out' : 'Check-out (SAS départ)'}>
      <span>
        <IconButton
          color={sasDone ? 'success' : 'primary'}
          onClick={(e) => { stop(e); onOpenSas(reservation.id); }}
          aria-label={sasDone ? 'Revoir / modifier le check-out' : 'Check-out (SAS départ)'}
          sx={{ p: 1 }}
        >
          {sasDone ? <CheckCircleIcon sx={{ fontSize: 40 }} /> : <ChecklistIcon sx={{ fontSize: 40 }} />}
        </IconButton>
      </span>
    </Tooltip>
  ) : null;
  return (
    <Card
      variant="outlined"
      onClick={() => onOpenReservation && onOpenReservation(reservation.id)}
      sx={{
        mb: 1.5,
        borderRadius: 2,
        borderColor: done ? 'success.main' : 'divider',
        bgcolor: done ? 'rgba(76,175,80,0.06)' : alertBgColor,
        opacity: done ? 0.75 : 1,
        transition: 'all 0.2s',
        cursor: onOpenReservation ? 'pointer' : 'default',
        '&:hover': onOpenReservation ? { boxShadow: 2 } : undefined,
      }}
    >
      <CardContent sx={{ p: { xs: 1.5, sm: 2 }, '&:last-child': { pb: { xs: 1.5, sm: 2 } } }}>
        {/* Top row: checkbox + DÉPART badge vertically centred. The whole card opens the fiche; the
            checkbox + SAS button stop the click. */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75 }}>
          <Tooltip title={done ? 'Départ validé' : 'Valider le départ'}>
            <Checkbox
              icon={<RadioButtonUncheckedIcon sx={{ fontSize: 32, color: 'text.disabled' }} />}
              checkedIcon={<CheckCircleIcon sx={{ fontSize: 32, color: 'success.main' }} />}
              checked={done}
              onChange={() => onToggleDone(reservation)}
              onClick={stop}
              sx={{ p: 0, flexShrink: 0 }}
            />
          </Tooltip>
          {/* DÉPART badge — FlightTakeoff (plane lifting off) = symmetric counterpart
              to the ARRIVÉE Land icon. Same airport-board family, distinct silhouette. */}
          <Chip
            icon={<FlightTakeoffIcon sx={{ fontSize: 18, color: 'white !important' }} />}
            label="DÉPART"
            size="small"
            sx={{
              height: 26,
              fontSize: 12,
              fontWeight: 800,
              color: 'white',
              bgcolor: done ? 'success.main' : 'warning.main',
              px: 0.5,
              '& .MuiChip-icon': { ml: 0.75, mr: -0.25 },
            }}
          />
          {/* Time pill — symmetric with the arrival card (Adrien 2026-06-06). */}
          <Chip
            icon={<AccessTimeIcon sx={{ fontSize: 16, color: 'white !important' }} />}
            label={checkOutTime}
            size="small"
            sx={{
              height: 22,
              fontSize: 13,
              fontWeight: 800,
              borderRadius: 1.5,
              color: 'white',
              bgcolor: done ? 'success.main' : 'warning.main',
              '& .MuiChip-icon': { ml: 0.5, mr: -0.25 },
            }}
          />
          {done && <Chip label="Effectué" size="small" color="success" sx={{ height: 20, fontSize: 11 }} />}
          <Box sx={{ flexGrow: 1 }} />
          {/* Actions top-right on tablet/desktop; on mobile they move to the bottom row below. */}
          {!isMobile && (
            <Box sx={{ display: 'flex', alignItems: 'center' }}>
              {actionButtons}
            </Box>
          )}
        </Box>

        {/* Detail block indented to align with the left edge of the DÉPART badge */}
        <Box sx={{ pl: '40px' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.5, flexWrap: 'wrap' }}>
            <HomeWorkIcon sx={{ fontSize: 18, color: 'primary.main', flexShrink: 0 }} />
            <Typography variant="subtitle1" sx={{ fontWeight: 700, color: 'primary.main', lineHeight: 1.2 }}>
              {reservation.propertyName}
            </Typography>
            {alertInfo?.explanation && (
              <Typography
                variant="caption"
                sx={{
                  fontWeight: 600,
                  color: alertInfo.type === 'blue' ? 'info.dark' : 'error.dark',
                  lineHeight: 1.3,
                }}
              >
                {alertInfo.explanation}
              </Typography>
            )}
          </Box>

          {/* Second-line block reduced to the client name. Clock + "Départ HH:MM"
              duplicate of the top time pill is removed (Adrien 2026-06-06). */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
            <PersonIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
            {onOpenClient && reservation.clientId ? (
              <Link
                component="button"
                type="button"
                underline="hover"
                onClick={(e) => { stop(e); onOpenClient(reservation.clientId); }}
                sx={{ textAlign: 'left', fontWeight: 600 }}
              >
                {reservation.firstName} {reservation.lastName}
              </Link>
            ) : (
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {reservation.firstName} {reservation.lastName}
              </Typography>
            )}
          </Box>

          {/* Handover note authored at check-in (specs/sas-breakfast-and-handover-note.md) — shown
              read-only here so the operator sees the arrival-time instructions at departure. */}
          {reservation.departureHandoverNote && (
            <Box sx={{
              mt: 0.5, p: 0.75, borderRadius: 1,
              bgcolor: 'rgba(255, 193, 7, 0.12)', border: '1px solid', borderColor: 'warning.light',
            }}>
              <Typography variant="caption" sx={{ fontWeight: 700, color: 'warning.dark', display: 'block' }}>
                Note d'arrivée
              </Typography>
              <Typography variant="body2">{reservation.departureHandoverNote}</Typography>
            </Box>
          )}

          {/* Prominent Ménage block — sits where the (removed) Famille chips used to
              live. Shown only when a tight transition triggered the alert
              (= alertInfo.cleaningDisplay is set). */}
          {alertInfo?.cleaningDisplay && (
            <Box sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              mt: 0.5,
              p: 0.75,
              borderRadius: 1,
              bgcolor: 'rgba(244, 67, 54, 0.06)',
              border: '1px solid',
              borderColor: 'error.light',
            }}>
              <CleaningServicesIcon sx={{ fontSize: 24, color: 'error.main', flexShrink: 0 }} />
              <Typography variant="body2" sx={{ fontWeight: 700, color: 'error.dark' }}>
                Ménage : {alertInfo.cleaningDisplay}
              </Typography>
            </Box>
          )}

          {/* Notes intentionally NOT rendered on the departure tile (Adrien 2026-06-06):
              they're already shown on the arrival side of the reservation, and the
              departure card is meant to stay compact ("checkout time + cleaning"). */}
        </Box>

        {/* Mobile-only action row: keeps the two buttons in-frame when the « Effectué » chip is present. */}
        {isMobile && (
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 0.5, mt: 1 }}>
            {actionButtons}
          </Box>
        )}
      </CardContent>
    </Card>
  );
}
