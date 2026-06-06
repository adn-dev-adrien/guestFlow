/**
 * BreakfastDayCard — pure renderer for the per-day breakfast list on PlanningPage
 * (specs/breakfast-option-and-planning-card.md §6.1).
 *
 * Sits under the day header of every cell where ≥1 reservation has the breakfast
 * option enabled AND the customer is present in the morning. One row per contributing
 * reservation, formatted as `🏠 {propertyName} • {clientName} : {N} petit(s) déjeuner(s)`
 * (Adrien 2026-06-06: same HomeWorkIcon as on the departure cards, bigger header
 * croissant, property → client → count order). A divider + a total line at the bottom.
 *
 * Returns `null` when `data` is missing or carries no items — the server still emits
 * the empty days uniformly; the silence is a client decision (rule 7 of the spec,
 * same pattern as `LaundryDayCard`).
 *
 * Props:
 *   data — { items: [{ reservationId, clientName, propertyName, persons }],
 *            totalPersons: number }
 *     Pass `undefined` / `null` → renders nothing.
 *   onItemClick — `(reservationId: number) => void`. Optional. When provided, each row
 *     becomes clickable (cursor pointer + hover highlight) and triggers the handler.
 *     Used by `PlanningPage` to navigate to the reservation form. The card-level "click
 *     anywhere" approach doesn't fit here because each row maps to a different
 *     reservation; the operator needs row-level granularity.
 */
import React from 'react';
import { Card, CardContent, Box, Typography, Stack, Divider } from '@mui/material';
import { amber } from '@mui/material/colors';
import BreakfastDiningIcon from '@mui/icons-material/BreakfastDining';
import HomeWorkIcon from '@mui/icons-material/HomeWork';

// Breakfast-themed palette. Amber reads as "morning / warm / pastry" — distinct from the
// cyan laundry card so the operator's eye picks them apart at a glance. Same 3-tone
// cascade as the laundry card (subtle bg / defined border / saturated accent).
const BREAKFAST_BG = amber[50];      // #FFF8E1
const BREAKFAST_BORDER = amber[200]; // #FFE082
const BREAKFAST_ACCENT = amber[800]; // #FF8F00

function pluraliseBreakfasts(n) {
  return n > 1 ? 'petits déjeuners' : 'petit déjeuner';
}

export default function BreakfastDayCard({ data, onItemClick }) {
  if (!data || !Array.isArray(data.items) || data.items.length === 0) return null;
  const total = Number(data.totalPersons || 0);
  const clickable = typeof onItemClick === 'function';

  return (
    <Card variant="outlined" sx={{ mb: 1.25, bgcolor: BREAKFAST_BG, borderColor: BREAKFAST_BORDER }}>
      <CardContent sx={{ py: 1.25, px: 2, '&:last-child': { pb: 1.25 } }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          {/* Header croissant sized up per Adrien 2026-06-06 ("plus gros que l'actuel"). */}
          <BreakfastDiningIcon sx={{ fontSize: 28, color: BREAKFAST_ACCENT }} />
          <Typography variant="subtitle1" sx={{ fontWeight: 700, color: BREAKFAST_ACCENT }}>
            Petit déjeuner
          </Typography>
        </Box>
        <Stack spacing={0.5}>
          {data.items.map((item) => {
            const breakfasts = `${item.persons} ${pluraliseBreakfasts(item.persons)}`;
            return (
              <Box
                key={item.reservationId}
                role={clickable ? 'button' : undefined}
                tabIndex={clickable ? 0 : undefined}
                onClick={clickable ? () => onItemClick(item.reservationId) : undefined}
                onKeyDown={clickable ? (e) => {
                  // Keyboard affordance for accessibility — Enter / Space activate the row.
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onItemClick(item.reservationId);
                  }
                } : undefined}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 0.75,
                  flexWrap: 'wrap',
                  cursor: clickable ? 'pointer' : 'default',
                  borderRadius: 1,
                  px: clickable ? 0.5 : 0,
                  mx: clickable ? -0.5 : 0,
                  py: 0.25,
                  transition: 'background-color 0.15s',
                  '&:hover': clickable ? { bgcolor: 'rgba(0, 0, 0, 0.04)' } : undefined,
                  '&:focus-visible': clickable ? { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 1 } : undefined,
                }}
              >
                {/* House icon — same one used on the departure / arrival cards so the
                    operator scans them all with the same eye anchor. */}
                <HomeWorkIcon sx={{ fontSize: 18, color: 'primary.main', flexShrink: 0 }} />
                {item.propertyName && (
                  <Typography variant="body2" sx={{ fontWeight: 700, color: 'primary.main' }}>
                    {item.propertyName}
                  </Typography>
                )}
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>•</Typography>
                <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.primary' }}>
                  {item.clientName}
                </Typography>
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>:</Typography>
                <Typography variant="body2" sx={{ fontWeight: 700, color: 'text.primary' }}>
                  {breakfasts}
                </Typography>
              </Box>
            );
          })}
        </Stack>
        <Divider sx={{ my: 1 }} />
        <Typography variant="body2" sx={{ fontWeight: 700, color: 'text.primary' }}>
          Total : {total} {pluraliseBreakfasts(total)}
        </Typography>
      </CardContent>
    </Card>
  );
}
