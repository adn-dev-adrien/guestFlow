// One timed card of the hourly resources on the planning (specs/plugins-phase-3c-hourly-resources.md
// rule 14): the ignition of a resource, a session of a stay, or a booking made outside a stay.
import React, { useState } from 'react';
import {
  Box, Card, CardContent, Chip, Typography, Button,
} from '@mui/material';
import { useNavigate } from 'react-router';
import Inventory2Icon from '@mui/icons-material/Inventory2';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import HomeWorkIcon from '@mui/icons-material/HomeWork';
import PersonIcon from '@mui/icons-material/Person';
import EuroIcon from '@mui/icons-material/Euro';
import { api, OptionDayCard, useToast, formatCurrency } from '../sdk';
import { localIsoDate } from './localDate';

// « pour demain 09:00 » / « 22:00 → pour demain 06:00 » — the « démarrer » card says what it prepares
// (specs/resource-ignition-task.md §3 rule 5). A night-time ignition carries no hour of its own: the
// card sits at the end of the evening, which IS the instruction.
function ignitionLabel(item) {
  const when = Number(item.dayOffset) === 1 ? 'demain' : `dans ${Number(item.dayOffset) || 2} jours`;
  const target = `pour ${when} ${item.sessionStart}`;
  return item.time ? `${item.time} → ${target}` : target;
}

const toMinutes = (time) => {
  const [h, m] = String(time || '0:0').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};
const toTime = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

// The planning's check-in card is the model (components/ReservationCard.jsx): a badge and a time pill on the first
// row, then the logement, the client, what is to collect, the note. The same sizes, the same order, for what this
// card knows.
const softChip = (status) => (t) => ({
  bgcolor: t.palette[status].soft,
  color: t.palette[status].text,
  '& .MuiChip-icon': { color: 'inherit' },
});

// Calendrier › Ressources, on this booking's week, with its editor open (amendment 2026-11-13).
const resourceBookingPath = (booking) => `/resource-planning?${new URLSearchParams({
  booking: String(booking.id), resource: String(booking.resourceId), date: booking.date,
}).toString()}`;

function BookingCard({ booking, openable }) {
  const navigate = useNavigate();
  const open = () => navigate(resourceBookingPath(booking));
  const turnover = Number(booking.turnoverMinutes || 0);
  // specs/resource-booking-pricing-and-invoicing.md rule 28 — a guest with no stay arrives from his card, on his day.
  const canArrive = booking.external === true && !booking.arrived && booking.date === localIsoDate();
  const tone = booking.paid ? 'success' : 'info';
  return (
    <Card
      variant="outlined"
      {...(openable ? {
        role: 'button',
        tabIndex: 0,
        'aria-label': `Ouvrir la réservation ${booking.resourceName || 'Ressource'} ${booking.startTime}–${booking.endTime}`,
        onClick: open,
        onKeyDown: (e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); open(); } },
      } : {})}
      sx={{
        mb: 1.5,
        borderRadius: 2,
        borderColor: 'divider',
        ...(openable && { cursor: 'pointer', '&:hover': { borderColor: 'primary.main' }, '&:focus-visible': { outline: 2, outlineColor: 'primary.main' } }),
      }}
    >
      <CardContent sx={{ p: { xs: 1.5, sm: 2 }, '&:last-child': { pb: { xs: 1.5, sm: 2 } } }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1, flexWrap: 'wrap' }}>
          <Chip
            icon={<Inventory2Icon sx={{ fontSize: 18 }} />}
            label={(booking.resourceName || 'Ressource').toUpperCase()}
            size="small"
            sx={[softChip(tone), { height: 26, fontSize: 12, fontWeight: 800, px: 0.5, '& .MuiChip-icon': { ml: 1, mr: -0.25 } }]}
          />
          <Chip
            icon={<AccessTimeIcon sx={{ fontSize: 16 }} />}
            label={`${booking.startTime}–${booking.endTime}`}
            size="small"
            sx={[softChip(tone), { height: 22, fontSize: 13, fontWeight: 800, borderRadius: 1.5, '& .MuiChip-icon': { ml: 0.5, mr: -0.25 } }]}
          />
          <Box sx={{ flexGrow: 1 }} />
          {canArrive && (
            <Button size="small" variant="outlined" onClick={(e) => { e.stopPropagation(); navigate(`/resource-planning?arrival=${booking.id}`); }} sx={{ minHeight: 44 }}>
              Arrivée
            </Button>
          )}
        </Box>
        {/* The detail block is indented like the check-in card's, which leaves the checkbox's width at the left. */}
        <Box sx={{ pl: '40px' }}>
          {booking.propertyName && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.5, minWidth: 0, maxWidth: '100%' }}>
              <HomeWorkIcon sx={{ fontSize: 18, color: 'primary.main', flexShrink: 0 }} />
              <Typography variant="subtitle1" sx={{ fontWeight: 700, color: 'primary.main', lineHeight: 1.2, minWidth: 0 }}>
                {booking.propertyName}
              </Typography>
            </Box>
          )}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
            <PersonIcon sx={{ fontSize: 16, color: 'text.secondary', flexShrink: 0 }} />
            <Typography variant="body1" sx={{ fontWeight: 600 }}>{booking.displayName}</Typography>
            {booking.clientPhone && <Typography variant="body2" color="text.secondary">· {booking.clientPhone}</Typography>}
          </Box>
          {(booking.paid || booking.external === true) && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 1, flexWrap: 'wrap' }}>
              <EuroIcon sx={{ fontSize: 16, color: booking.paid ? 'success.main' : 'error.main', flexShrink: 0 }} />
              <Chip
                label={`${booking.paid ? 'Payé' : 'À encaisser'}${Number(booking.totalPrice) > 0 ? ` : ${formatCurrency(booking.totalPrice)}` : ''}`}
                size="small"
                sx={[softChip(booking.paid ? 'success' : 'error'), { height: 22, fontSize: 12, fontWeight: 700 }]}
              />
            </Box>
          )}
          {turnover > 0 && (
            <Typography variant="caption" sx={{ color: 'error.main', fontWeight: 700, mt: 1, display: 'block' }}>
              Remise en état : +{turnover} min (jusqu'à {toTime(toMinutes(booking.endTime) + turnover)})
            </Typography>
          )}
        </Box>
      </CardContent>
    </Card>
  );
}

export default function PlanningResourceCard({ entry, reload, onOpenReservation }) {
  const { showError } = useToast();
  const [done, setDone] = useState(Boolean(entry.item.done));
  // The reception role has no Calendrier › Ressources: its card stays inert, like its reservation cards.
  if (entry.kind === 'booking') return <BookingCard booking={entry.item} openable={Boolean(onOpenReservation)} />;

  const item = entry.item;
  const isIgnition = entry.kind === 'ignition';
  // Ticking « préparé » (or « démarré ») — optimistic, reverted on failure; the day's counter follows
  // once the cards are reloaded.
  const toggle = async (_, nextDone) => {
    setDone(nextDone);
    try {
      await api.setPlanningResourceCardDone({
        reservationId: item.reservationId, resourceId: item.resourceId, date: item.date, start: item.start, done: nextDone, kind: item.kind,
      });
      reload();
    } catch (e) {
      setDone(!nextDone);
      showError(e.message || 'Impossible de mettre à jour la session.');
    }
  };

  return (
    <OptionDayCard
      theme="resource"
      data={{
        items: [{
          ...item,
          done,
          optionId: item.resourceId,
          title: isIgnition ? `Démarrer ${item.name}` : item.name,
          time: isIgnition ? ignitionLabel(item) : (item.end ? `${item.start}–${item.end}` : item.start),
        }],
      }}
      onItemClick={onOpenReservation}
      onToggleDone={toggle}
    />
  );
}
