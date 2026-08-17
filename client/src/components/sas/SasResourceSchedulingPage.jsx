import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Box, Card, CardContent, Chip, IconButton, Stack, Typography, Divider, Button, Skeleton, Alert,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
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

/**
 * The day strip of a long stay does not fit on a phone — a fortnight is 14 chips for ~3 visible.
 * It has always scrolled, but nothing said so: the last visible chip sat flush against the edge and
 * read as « that's all there is ». This adds the affordances that make the swipe discoverable —
 * a fade on whichever side still has days, and an arrow that jumps a screenful for the desktop
 * operator with no touchpad gesture. The selected day is also kept scrolled into view, so a day
 * picked far down the stay does not vanish when the slots refresh.
 */
function DayStrip({ days, activeDate, onPick }) {
  const scrollerRef = useRef(null);
  const activeRef = useRef(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  const measure = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setEdges({ left: el.scrollLeft > 4, right: el.scrollLeft < max - 4 });
  }, []);

  useEffect(() => {
    measure();
    const el = scrollerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure, days.length]);

  useEffect(() => {
    // Guarded: scroll APIs are absent under jsdom, and a missing one must not take the step down.
    const chip = activeRef.current;
    if (typeof chip?.scrollIntoView === 'function') {
      chip.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
    measure();
  }, [activeDate, measure]);

  const nudge = (direction) => {
    const el = scrollerRef.current;
    if (typeof el?.scrollBy !== 'function') return;
    el.scrollBy({ left: direction * Math.max(160, el.clientWidth * 0.8), behavior: 'smooth' });
  };

  const fade = (side) => ({
    position: 'absolute',
    top: 0,
    bottom: 8,
    [side]: 0,
    width: 32,
    pointerEvents: 'none',
    zIndex: 1,
    background: (t) => `linear-gradient(to ${side === 'left' ? 'right' : 'left'}, ${t.palette.background.paper}, transparent)`,
  });

  return (
    <Box sx={{ position: 'relative', mb: 1 }}>
      <Box
        ref={scrollerRef}
        onScroll={measure}
        sx={{
          display: 'flex',
          gap: 1,
          overflowX: 'auto',
          pb: 1,
          scrollSnapType: 'x proximity',
          WebkitOverflowScrolling: 'touch',
          scrollbarWidth: 'none',
          '&::-webkit-scrollbar': { display: 'none' },
        }}
      >
        {days.map((d) => {
          const hasFree = d.slots.some((s) => s.state === 'free');
          const selected = d.date === activeDate;
          return (
            <Chip
              key={d.date}
              ref={selected ? activeRef : undefined}
              label={dayLabel(d)}
              onClick={() => onPick(d.date)}
              variant={selected ? 'filled' : 'outlined'}
              color={selected ? 'primary' : 'default'}
              aria-current={selected ? 'true' : undefined}
              sx={{
                minHeight: 48, borderRadius: 1.5, flexShrink: 0,
                scrollSnapAlign: 'start',
                textTransform: 'capitalize',
                opacity: hasFree ? 1 : 0.55, // dimmed, still selectable: the operator must see WHY
              }}
            />
          );
        })}
      </Box>

      {edges.left && <Box sx={fade('left')} />}
      {edges.right && <Box sx={fade('right')} />}

      {edges.left && (
        <IconButton
          size="small" aria-label="Jours précédents" onClick={() => nudge(-1)}
          sx={{ position: 'absolute', left: -6, top: 6, zIndex: 2, bgcolor: 'background.paper', boxShadow: 1, '&:hover': { bgcolor: 'background.paper' } }}
        >
          <ChevronLeftIcon fontSize="small" />
        </IconButton>
      )}
      {edges.right && (
        <IconButton
          size="small" aria-label="Jours suivants" onClick={() => nudge(1)}
          sx={{ position: 'absolute', right: -6, top: 6, zIndex: 2, bgcolor: 'background.paper', boxShadow: 1, '&:hover': { bgcolor: 'background.paper' } }}
        >
          <ChevronRightIcon fontSize="small" />
        </IconButton>
      )}
    </Box>
  );
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

        <DayStrip days={days} activeDate={day?.date} onPick={setActiveDate} />

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
