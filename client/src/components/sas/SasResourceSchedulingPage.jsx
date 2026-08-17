import React, { useEffect, useMemo, useState } from 'react';
import {
  Box, Card, CardContent, Chip, IconButton, Stack, Typography, Divider, Button, Skeleton, Alert,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import SlotPickerGrid from '../SlotPickerGrid';
import api from '../../api';

/**
 * Arrival SAS — « Planifier les ressources »
 * (specs/hourly-resource-quantity-and-sas-scheduling.md §3.4).
 *
 * The guest bought N hours of an hourly resource on the quote; this is where they are placed on real
 * slots, with the guest present. One sub-card per resource: the hours still owed, the day's existing
 * bookings (times only — the guest is standing there), and the slot grid.
 *
 * Every classification comes from the server. Placing a block re-fetches, sending the in-run blocks as
 * `pending`, so a second session can legitimately sit right after the first — still warm, only the
 * remise en état to wait.
 *
 * Nothing is written here: the blocks live in the parent's memory until the single commit at the recap.
 */

function formatHours(hours) {
  const value = Math.round(Number(hours || 0) * 100) / 100;
  return Number.isInteger(value) ? `${value} h` : `${value} h`;
}

function dayLabel(day) {
  return day.weekdayLabel || day.date;
}

function ResourceCard({ reservationId, resource, blocks, onAdd, onRemove }) {
  const [days, setDays] = useState(resource.days || []);
  const [activeDate, setActiveDate] = useState((resource.days || [])[0]?.date || '');
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const ownBlocks = useMemo(
    () => blocks.filter((b) => Number(b.resourceId) === Number(resource.resourceId)),
    [blocks, resource.resourceId],
  );
  const placedMinutes = ownBlocks.reduce((sum, b) => sum + Number(b.durationMinutes || 0), 0);
  const remaining = Math.max(0, Math.round((resource.hoursRemaining - placedMinutes / 60) * 100) / 100);

  const refresh = async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const payload = await api.getResourceFreeSlots({
        resourceId: resource.resourceId,
        reservationId,
        pending: ownBlocks.map((b) => ({ date: b.date, start: b.start, end: b.end })),
      });
      setDays(payload?.days || []);
    } catch {
      // A failed refresh must SURFACE. An empty grid would read as « tout est libre » and invite a
      // double booking (specs/ds-sweep-planning.md rule 9).
      setLoadError(true);
      setDays([]);
    } finally {
      setLoading(false);
    }
  };

  // Re-classify after every placement/removal: the blocks just placed are occupancy for the next one.
  useEffect(() => {
    if (ownBlocks.length === 0 && days === resource.days) return;
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownBlocks.length]);

  const day = days.find((d) => d.date === activeDate) || days[0];
  const canPlace = remaining > 0;

  return (
    <Card variant="outlined" sx={{ borderRadius: 2 }}>
      <CardContent sx={{ p: { xs: 1.5, sm: 2 }, '&:last-child': { pb: { xs: 1.5, sm: 2 } } }}>
        <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
          <Typography sx={{ fontWeight: 600 }}>{resource.name}</Typography>
          <Chip
            size="small"
            color={remaining > 0 ? 'warning' : 'success'}
            variant={remaining > 0 ? 'filled' : 'outlined'}
            label={remaining > 0 ? `${formatHours(remaining)} à planifier` : 'Tout est planifié'}
          />
        </Stack>

        {/* Day selector — horizontally scrollable so it never widens the page on a phone. */}
        <Box sx={{ display: 'flex', gap: 1, overflowX: 'auto', pb: 1, mb: 1 }}>
          {days.map((d) => {
            const hasFree = d.slots.some((s) => s.state === 'free');
            return (
              <Chip
                key={d.date}
                label={dayLabel(d)}
                onClick={() => setActiveDate(d.date)}
                variant={d.date === (day?.date) ? 'filled' : 'outlined'}
                color={d.date === (day?.date) ? 'primary' : 'default'}
                sx={{
                  minHeight: 48, borderRadius: 1.5, flexShrink: 0,
                  textTransform: 'capitalize',
                  opacity: hasFree ? 1 : 0.55, // dimmed, still selectable: the operator must see WHY
                }}
              />
            );
          })}
        </Box>

        {loadError && (
          <Alert severity="error" sx={{ mb: 1 }} action={<Button size="small" onClick={refresh}>Réessayer</Button>}>
            Créneaux indisponibles — ne pas réserver à l'aveugle.
          </Alert>
        )}

        {loading && <Skeleton variant="rounded" height={120} sx={{ mb: 1 }} />}

        {!loading && !loadError && day && (
          <>
            <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600, display: 'block', mb: 0.5 }}>
              Déjà réservé ce jour
            </Typography>
            {day.occupancy.length === 0 ? (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                Aucune réservation ce jour.
              </Typography>
            ) : (
              <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.5, mb: 1 }}>
                {day.occupancy.map((o) => (
                  <Chip key={`${o.start}-${o.end}`} size="small" variant="outlined" label={`${o.start} – ${o.end}`} />
                ))}
              </Stack>
            )}

            <Divider sx={{ my: 1 }} />

            {canPlace ? (
              <SlotPickerGrid
                slots={day.slots}
                selected={ownBlocks.filter((b) => b.date === day.date).map((b) => b.start)}
                onPick={(slot) => onAdd({
                  resourceId: resource.resourceId,
                  date: day.date,
                  // The server's French label, carried along so the placed-block list reads
                  // « ven. 11 sept. · 20:00–21:00 » like the day chips, not a raw ISO date.
                  dayLabel: dayLabel(day),
                  start: slot.start,
                  end: slot.end,
                  supplement: Number(slot.supplement || 0),
                  durationMinutes: resource.minimumUsageMinutes || resource.slotDuration || 60,
                })}
                emptyLabel="Aucun créneau disponible ce jour."
              />
            ) : (
              <Typography variant="caption" color="text.secondary">
                Toutes les heures achetées sont placées.
              </Typography>
            )}
          </>
        )}

        {ownBlocks.length > 0 && (
          <>
            <Divider sx={{ my: 1.5 }} />
            <Stack spacing={0.5}>
              {ownBlocks.map((b, idx) => (
                <Stack key={`${b.date}-${b.start}`} direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
                  <Typography variant="body2" sx={{ textTransform: 'capitalize' }}>
                    {b.dayLabel || b.date} · {b.start}–{b.end}
                    {b.supplement > 0 && (
                      <Typography component="span" variant="caption" sx={{ color: 'warning.dark', ml: 0.5 }}>
                        +{b.supplement} €
                      </Typography>
                    )}
                  </Typography>
                  <IconButton size="small" color="error" aria-label="Retirer le créneau" onClick={() => onRemove(idx, b)}>
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Stack>
              ))}
            </Stack>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default function SasResourceSchedulingPage({ reservationId, scheduling, blocks, onAdd, onRemove }) {
  const resources = (scheduling?.resources || []).filter((r) => r.hoursRemaining > 0);
  const totalSupplement = blocks.reduce((sum, b) => sum + Number(b.supplement || 0), 0);

  return (
    <Stack spacing={2}>
      {resources.map((resource) => (
        <ResourceCard
          key={resource.resourceId}
          reservationId={reservationId}
          resource={resource}
          blocks={blocks}
          onAdd={onAdd}
          onRemove={onRemove}
        />
      ))}
      {totalSupplement > 0 && (
        <Typography variant="body2" sx={{ textAlign: 'right', fontWeight: 600 }}>
          Supplément soirée : {Math.round(totalSupplement * 100) / 100} €
        </Typography>
      )}
    </Stack>
  );
}
