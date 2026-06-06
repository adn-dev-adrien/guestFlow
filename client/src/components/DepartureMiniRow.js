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
  Box, Typography, Card, CardContent, Checkbox, Chip, Tooltip,
} from '@mui/material';
import { grey } from '@mui/material/colors';
import HomeWorkIcon from '@mui/icons-material/HomeWork';
import PersonIcon from '@mui/icons-material/Person';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import FlightTakeoffIcon from '@mui/icons-material/FlightTakeoff';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import CleaningServicesIcon from '@mui/icons-material/CleaningServices';

const DEPARTURE_BG = grey[100]; // #F5F5F5 — quieter than the arrival peach on purpose.

export default function DepartureMiniRow({ reservation, onToggleDone, onOpen, alertInfo }) {
  const done = Boolean(reservation.checkOutDone);
  const clickable = typeof onOpen === 'function';
  const handleCardClick = clickable ? () => onOpen(reservation.id) : undefined;
  const stop = (e) => e.stopPropagation();
  // Symmetric alert background with `ReservationCard`: when there's a tight transition,
  // the operator sees the same coloured pull on the departure as on the next arrival.
  let alertBgColor = DEPARTURE_BG;
  if (alertInfo?.type === 'red') alertBgColor = 'rgba(244, 67, 54, 0.14)';
  else if (alertInfo?.type === 'orange') alertBgColor = 'rgba(244, 67, 54, 0.10)';
  else if (alertInfo?.type === 'blue') alertBgColor = 'rgba(33, 150, 243, 0.08)';
  const checkOutTime = reservation.checkOutTime || '10:00';
  return (
    <Card
      variant="outlined"
      onClick={handleCardClick}
      sx={{
        mb: 1.5,
        borderRadius: 2,
        borderColor: done ? 'success.main' : 'divider',
        bgcolor: done ? 'rgba(76,175,80,0.06)' : alertBgColor,
        opacity: done ? 0.75 : 1,
        transition: 'all 0.2s',
        cursor: clickable ? 'pointer' : 'default',
        '&:hover': clickable ? { boxShadow: 2, borderColor: 'primary.light' } : undefined,
      }}
    >
      <CardContent sx={{ p: { xs: 1.5, sm: 2 }, '&:last-child': { pb: { xs: 1.5, sm: 2 } } }}>
        {/* Top row: checkbox + DÉPART badge vertically centred */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75 }} onClick={stop}>
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
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {reservation.firstName} {reservation.lastName}
            </Typography>
          </Box>

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
      </CardContent>
    </Card>
  );
}
