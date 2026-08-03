/**
 * ReservationCard — arrival tile on PlanningPage.
 *
 * Renders one upcoming arrival: client + property + time pill, family + bed breakdown,
 * catalog options, resources, notes. Click anywhere on the body (except the ready
 * checkbox) fires `onOpen(reservation.id)`.
 *
 * Extracted from `pages/PlanningPage.js` on 2026-06-06 to allow direct Vitest coverage
 * without spinning up the whole planning page. Pure renderer + a small co-located
 * `BedVisual` helper that draws the {double/simple/baby} chips with their fixed colour
 * palette.
 *
 * Props:
 *   reservation — { id, firstName, lastName, propertyName, checkInTime, checkInReady,
 *                   adults, children, teens, babies, doubleBeds, singleBeds, babyBeds,
 *                   options: [...], resources: [...], notes }
 *   onToggleReady — `(reservation) => void`. Required. Called when the operator ticks
 *     the ready checkbox; `stopPropagation` is applied so the card's click doesn't fire.
 *   alertInfo — { type: 'red'|'orange'|'blue', explanation: string } | undefined.
 *     When set, recolors the card bg + shows the explanation next to the property name.
 *   onOpen — `(reservationId) => void`. Optional. When provided, the whole Card body
 *     becomes clickable with cursor + hover affordance.
 */

import React from 'react';
import {
  Box, Typography, Card, CardContent, Checkbox, Chip, Tooltip, IconButton, Link, useMediaQuery,
} from '@mui/material';
import { useTheme, alpha } from '@mui/material/styles';
import HomeWorkIcon from '@mui/icons-material/HomeWork';
import PersonIcon from '@mui/icons-material/Person';
import ChecklistIcon from '@mui/icons-material/Checklist';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import ExtensionIcon from '@mui/icons-material/Extension';
import EuroIcon from '@mui/icons-material/Euro';
import ShieldOutlinedIcon from '@mui/icons-material/ShieldOutlined';
import NoteIcon from '@mui/icons-material/Note';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import FlightLandIcon from '@mui/icons-material/FlightLand';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import BedIcon from './BedIcon';
import { getPlatformColor, formatPlatformLabel } from '../constants/platforms';
import { formatCurrency } from '../utils/formatters';

// Private helper. Draws the {🛏 double / 🛏 simple / BÉBÉ ×N} bed chips. Single/double use the
// BedIcon (single narrower than double, per Adrien 2026-06-10) instead of a text label; baby keeps
// a short text label. Neutral « Maison » chips (paper bg + divider border) — the bed SHAPES carry
// the distinction, not decorative colors (ds-sweep-planning rule 16). Returns null when every
// count is 0 — the parent gate keeps it out of the DOM altogether in that case.
function BedVisual({ doubleBeds, singleBeds, babyBeds }) {
  const dbl = Number(doubleBeds || 0);
  const sgl = Number(singleBeds || 0);
  const bby = Number(babyBeds || 0);
  if (dbl === 0 && sgl === 0 && bby === 0) return null;

  const beds = [];
  if (dbl > 0) beds.push({ type: 'double', count: dbl, label: 'Lit double' });
  if (sgl > 0) beds.push({ type: 'single', count: sgl, label: 'Lit simple' });
  if (bby > 0) beds.push({ type: 'baby', count: bby, label: 'Lit bébé' });

  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center', mt: 0.5 }}>
      {beds.map((bed, idx) => (
        <Tooltip key={idx} title={`${bed.label} ×${bed.count}`}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', borderRadius: 1, px: 1, py: 0.5 }}>
            {bed.type === 'baby' ? (
              <Typography variant="caption" sx={{ fontWeight: 900, color: 'text.primary', fontSize: '11px', letterSpacing: '0.5px' }}>BÉBÉ</Typography>
            ) : (
              <BedIcon type={bed.type} height={18} title={bed.label} />
            )}
            <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.primary' }}>×{bed.count}</Typography>
          </Box>
        </Tooltip>
      ))}
    </Box>
  );
}

export default function ReservationCard({ reservation, onToggleReady, alertInfo, onOpenReservation, onOpenSas, onOpenClient }) {
  const r = reservation;
  const theme = useTheme();
  // On mobile the two action buttons move to a dedicated bottom row (rendered once, not duplicated).
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  // The card is no longer clickable as a whole: explicit actions are the two buttons (open the
  // reservation / run the arrival SAS) + the clickable client name. `stop` guards the checkbox.
  const stop = (e) => e.stopPropagation();
  const done = !!r.checkInReady;
  const sasDone = !!r.arrivalSasDoneAt;
  const adults = Number(r.adults || 0);
  const children = Number(r.children || 0);
  const teens = Number(r.teens || 0);
  const babies = Number(r.babies || 0);
  // Effective billed quantity is computed server-side (billedUnits); the client only renders it.
  const formatQty = (item) => {
    const value = Number(item.billedUnits ?? item.quantity ?? 0);
    return Number.isInteger(value) ? value : Number(value.toFixed(2));
  };

  // Default bg = warm « Maison » tint (warning.soft) so the arrival card stands out from the page
  // (was MUI orange[50]). Alert overlays still override.
  let alertBgColor = theme.palette.warning.soft;
  if (alertInfo?.type === 'orange') {
    alertBgColor = alpha(theme.palette.error.main, 0.10);
  } else if (alertInfo?.type === 'red') {
    alertBgColor = alpha(theme.palette.error.main, 0.14);
  } else if (alertInfo?.type === 'blue') {
    alertBgColor = alpha(theme.palette.info.main, 0.08);
  }

  const optionsText = (r.options || []).map((o) => `${o.title} ×${formatQty(o)}`);
  const resourcesText = (r.resources || []).map((rr) => `${rr.name} ×${formatQty(rr)}`);

  // The card action is the check-in (SAS) launcher — a LARGE icon so it's an easy tap target on mobile.
  // The whole card opens the reservation fiche (no separate « open » icon); this button stops the click.
  const actionButtons = onOpenSas ? (
    <Tooltip title={sasDone ? 'Revoir / modifier le check-in' : 'Check-in (SAS arrivée)'}>
      <span>
        <IconButton
          color={sasDone ? 'success' : 'primary'}
          onClick={(e) => { stop(e); onOpenSas(r.id); }}
          aria-label={sasDone ? 'Revoir / modifier le check-in' : 'Check-in (SAS arrivée)'}
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
      onClick={() => onOpenReservation && onOpenReservation(r.id)}
      sx={{
        mb: 1.5,
        borderRadius: 2,
        borderColor: done ? 'success.main' : 'divider',
        bgcolor: done ? alpha(theme.palette.success.main, 0.06) : alertBgColor,
        opacity: done ? 0.75 : 1,
        transition: 'all 0.2s',
        cursor: onOpenReservation ? 'pointer' : 'default',
        '&:hover': onOpenReservation ? { boxShadow: 2 } : undefined,
      }}
    >
      <CardContent sx={{ p: { xs: 1.5, sm: 2 }, '&:last-child': { pb: { xs: 1.5, sm: 2 } } }}>
        {/* Top row: checkbox + ARRIVÉE badge vertically centred. The whole card opens the fiche; the
            checkbox + SAS button stop the click, so the badge/time area still opens the fiche. */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          <Tooltip title={done ? 'Logement prêt ✓' : 'Marquer comme prêt'}>
            <Checkbox
              icon={<RadioButtonUncheckedIcon sx={{ fontSize: 32, color: 'text.disabled' }} />}
              checkedIcon={<CheckCircleIcon sx={{ fontSize: 32, color: 'success.main' }} />}
              checked={done}
              onChange={() => onToggleReady(r)}
              onClick={stop}
              sx={{ p: 0, flexShrink: 0 }}
            />
          </Tooltip>
          {/* ARRIVÉE badge — FlightLand (plane touching down) for the universal
              "arrival" semantic. Bigger height + solid bg + white text for max pop. */}
          <Chip
            icon={<FlightLandIcon sx={{ fontSize: 18 }} />}
            label="ARRIVÉE"
            size="small"
            sx={{
              height: 26,
              fontSize: 12,
              fontWeight: 800,
              color: 'common.white',
              bgcolor: done ? 'success.main' : 'warning.main',
              px: 0.5,
              '& .MuiChip-icon': { ml: 1, mr: -0.25, color: 'common.white' },
            }}
          />
          {/* Time pill — promoted to the top row (Adrien 2026-06-06: "met moi l'heure
              juste à droite du de Arrivée [...] avec un encadrement arrondi et en gras
              que ce soit visible" + "rajoute ta petite horloge à gauche de l'heure").
              The duplicate clock + "Arrivée HH:MM" block on the line below is removed. */}
          <Chip
            icon={<AccessTimeIcon sx={{ fontSize: 16 }} />}
            label={r.checkInTime || '15:00'}
            size="small"
            sx={{
              height: 22,
              fontSize: 13,
              fontWeight: 800,
              borderRadius: 1.5,
              color: 'common.white',
              bgcolor: done ? 'success.main' : 'warning.main',
              '& .MuiChip-icon': { ml: 0.5, mr: -0.25, color: 'common.white' },
            }}
          />
          {done && <Chip label="Prêt" size="small" color="success" sx={{ height: 20, fontSize: 11 }} />}
          <Box sx={{ flexGrow: 1 }} />
          {/* Actions top-right on tablet/desktop; on mobile they move to the bottom row below. */}
          {!isMobile && (
            <Box sx={{ display: 'flex', alignItems: 'center' }}>
              {actionButtons}
            </Box>
          )}
        </Box>

        {/* Detail block indented to align with the left edge of the ARRIVÉE badge (checkbox 32px + gap 8px) */}
        <Box sx={{ pl: '40px' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5, flexWrap: 'wrap' }}>
            <HomeWorkIcon sx={{ fontSize: 18, color: 'primary.main', flexShrink: 0 }} />
            <Typography variant="subtitle1" sx={{ fontWeight: 700, color: 'primary.main', lineHeight: 1.2 }}>
              {r.propertyName}
            </Typography>
            {r.platform && (
              <Box
                component="span"
                sx={{
                  px: 1,
                  py: 0.5,
                  border: '1.5px solid',
                  borderColor: getPlatformColor(r.platform),
                  color: getPlatformColor(r.platform),
                  bgcolor: 'transparent',
                  borderRadius: 1,
                  fontSize: 14,
                  fontWeight: 800,
                  lineHeight: 1.4,
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                }}
              >
                {formatPlatformLabel(r.platform)}
              </Box>
            )}
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

          {/* Second-line block reduced to the client name. The clock icon + "Arrivée
              HH:MM" duplicate of the top time pill is removed (Adrien 2026-06-06). */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
            <PersonIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
            {/* Client name → client fiche (the rest of the card is non-clickable; the buttons above
                open the reservation / SAS). */}
            {onOpenClient && r.clientId ? (
              <Link
                component="button"
                type="button"
                underline="hover"
                onClick={(e) => { stop(e); onOpenClient(r.clientId); }}
                sx={{ textAlign: 'left', fontWeight: 600 }}
              >
                {r.firstName} {r.lastName}
              </Link>
            ) : (
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {r.firstName} {r.lastName}
              </Typography>
            )}
          </Box>

          {/* Famille row — only the non-zero categories surface (Adrien 2026-06-06). */}
          {(adults + children + teens + babies > 0) && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 0.5 }}>
              <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 700 }}>
                Famille:
              </Typography>
              {adults > 0 && (
                <Chip label={`Adultes: ${adults}`} size="small" variant="outlined" sx={{ height: 22, fontSize: 12 }} />
              )}
              {children > 0 && (
                <Chip label={`Enfants: ${children}`} size="small" variant="outlined" sx={{ height: 22, fontSize: 12 }} />
              )}
              {teens > 0 && (
                <Chip label={`Ados: ${teens}`} size="small" variant="outlined" sx={{ height: 22, fontSize: 12 }} />
              )}
              {babies > 0 && (
                <Chip label={`Bébés: ${babies}`} size="small" variant="outlined" sx={{ height: 22, fontSize: 12 }} />
              )}
            </Box>
          )}

          {/* Lits row — gated on (doubleBeds > 0 OR singleBeds > 0) per Adrien 2026-06-06. */}
          {(Number(r.doubleBeds || 0) > 0 || Number(r.singleBeds || 0) > 0) && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
              <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 700 }}>
                Lits:
              </Typography>
              <BedVisual doubleBeds={r.doubleBeds} singleBeds={r.singleBeds} babyBeds={r.babyBeds} />
            </Box>
          )}

          {/* Bed-linen alert (specs/planning-arrival-alerts.md §3 rule 6). Server-computed flag
              (`bedLinenAlert`): the guest didn't take the bed-linen option, or the bed configuration
              sleeps fewer people than the booking. Never set for linen-by-default properties. */}
          {r.bedLinenAlert && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 1, flexWrap: 'wrap' }}>
              <WarningAmberIcon sx={{ fontSize: 16, color: 'warning.dark', flexShrink: 0 }} />
              <Chip
                label={r.bedLinenAlert.type === 'no_linen'
                  ? 'Linge de lit non pris'
                  : `Linge de lit insuffisant : ${r.bedLinenAlert.capacity} couchage${r.bedLinenAlert.capacity > 1 ? 's' : ''} pour ${r.bedLinenAlert.required} pers.`}
                size="small"
                color="warning"
                variant="filled"
                sx={{ height: 22, fontSize: 12, fontWeight: 700 }}
              />
            </Box>
          )}

          {optionsText.length > 0 && (
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.5, mt: 1, flexWrap: 'wrap' }}>
              <ExtensionIcon sx={{ fontSize: 16, color: 'text.secondary', mt: 0.25, flexShrink: 0 }} />
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                {optionsText.map((label, i) => (
                  <Chip key={i} label={label} size="small" variant="outlined" sx={{ height: 22, fontSize: 12 }} />
                ))}
              </Box>
            </Box>
          )}

          {resourcesText.length > 0 && (
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.5, mt: 1, flexWrap: 'wrap' }}>
              <ExtensionIcon sx={{ fontSize: 16, color: 'info.main', mt: 0.25, flexShrink: 0 }} />
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                {resourcesText.map((label, i) => (
                  <Chip key={i} label={label} size="small" variant="outlined" sx={{ height: 22, fontSize: 12 }} />
                ))}
              </Box>
            </Box>
          )}

          {/* Complément à percevoir (specs/force-extras-complement-on-platform.md). On platform/iCal
              reservations the options are collected on arrival — surface the amount + status so the
              host knows what to collect at check-in. */}
          {Number(r.complementAmount || 0) > 0 && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 1, flexWrap: 'wrap' }}>
              <EuroIcon sx={{ fontSize: 16, color: r.complementPaid ? 'success.main' : 'error.main', flexShrink: 0 }} />
              <Chip
                /* specs/defer-arrival-complement-to-checkout.md §3.2 rule 10 — deferred at check-in
                   → collected at the door, with the end-of-stay complement. */
                label={`${r.complementDeferredToCheckout && !r.complementPaid ? 'Complément (fin de séjour)' : 'Complément à percevoir'} : ${formatCurrency(r.complementAmount)}${r.complementPaid ? ' (perçu)' : ''}`}
                size="small"
                color={r.complementPaid ? 'success' : 'error'}
                variant={r.complementPaid ? 'outlined' : 'filled'}
                sx={{ height: 22, fontSize: 12, fontWeight: 700 }}
              />
            </Box>
          )}

          {/* Caution à percevoir — when the security deposit has NOT been received yet, surface the
              amount to collect from the guest at check-in, in orange with a shield icon. The complement
              block above uses red (money the host must collect for sure); the caution is a refundable
              hold, hence the softer orange. Hidden once the caution is received. */}
          {Number(r.cautionAmount || 0) > 0 && !r.cautionReceived && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 1, flexWrap: 'wrap' }}>
              <ShieldOutlinedIcon sx={{ fontSize: 16, color: 'warning.main', flexShrink: 0 }} />
              <Chip
                label={`Caution à percevoir : ${formatCurrency(r.cautionAmount)}`}
                size="small"
                color="warning"
                variant="filled"
                sx={{ height: 22, fontSize: 12, fontWeight: 700 }}
              />
            </Box>
          )}

          {r.notes && (
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.5, mt: 1 }}>
              <NoteIcon sx={{ fontSize: 16, color: 'warning.main', mt: 0.25, flexShrink: 0 }} />
              <Typography variant="body2" sx={{ color: 'text.secondary', fontStyle: 'italic', lineHeight: 1.4 }}>
                {r.notes}
              </Typography>
            </Box>
          )}
        </Box>

        {/* Mobile-only action row: keeps the two buttons in-frame when the « Prêt » chip is present. */}
        {isMobile && (
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 0.5, mt: 1 }}>
            {actionButtons}
          </Box>
        )}
      </CardContent>
    </Card>
  );
}
