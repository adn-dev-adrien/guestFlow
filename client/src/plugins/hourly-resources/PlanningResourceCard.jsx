// One timed card of the hourly resources on the planning (specs/plugins-phase-3c-hourly-resources.md
// rule 14): the ignition of a resource, a session of a stay, or a booking made outside a stay.
import React, { useState } from 'react';
import {
  Box, Card, CardContent, Chip, Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import Inventory2Icon from '@mui/icons-material/Inventory2';
import { api, OptionDayCard, useToast } from '../sdk';

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

function BookingCard({ booking }) {
  const turnover = Number(booking.turnoverMinutes || 0);
  return (
    <Card variant="outlined" sx={(t) => ({ mb: 1.5, borderRadius: 2, borderColor: 'info.light', bgcolor: alpha(t.palette.info.main, 0.04) })}>
      <CardContent sx={{ p: { xs: 1.5, sm: 2 }, '&:last-child': { pb: { xs: 1.5, sm: 2 } } }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          <Inventory2Icon sx={{ fontSize: 16, color: 'info.main' }} />
          <Typography variant="caption" sx={{ fontWeight: 700, color: 'info.dark' }}>
            {booking.resourceName || 'Ressource'}
          </Typography>
          {booking.paid && <Chip label="Payé" size="small" color="success" sx={{ height: 18, fontSize: 10 }} />}
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <Chip
            label={`${booking.startTime}–${booking.endTime}`}
            size="small"
            sx={{ height: 22, fontSize: 11, fontWeight: 700, bgcolor: booking.paid ? 'success.light' : 'info.light' }}
          />
          <Typography variant="body2" sx={{ fontWeight: 600 }}>{booking.displayName}</Typography>
          {booking.propertyName && <Typography variant="caption" color="text.secondary">· {booking.propertyName}</Typography>}
          {booking.clientPhone && <Typography variant="caption" color="text.secondary">· {booking.clientPhone}</Typography>}
        </Box>
        {turnover > 0 && (
          <Typography variant="caption" sx={{ color: 'error.main', fontWeight: 700, mt: 1, display: 'block' }}>
            Remise en état : +{turnover} min (jusqu'à {toTime(toMinutes(booking.endTime) + turnover)})
          </Typography>
        )}
      </CardContent>
    </Card>
  );
}

export default function PlanningResourceCard({ entry, reload, onOpenReservation }) {
  const { showError } = useToast();
  const [done, setDone] = useState(Boolean(entry.item.done));
  if (entry.kind === 'booking') return <BookingCard booking={entry.item} />;

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
