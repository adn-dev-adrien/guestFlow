/**
 * BreakfastDayCard — pure renderer for the per-day breakfast list on PlanningPage
 * (specs/breakfast-option-and-planning-card.md §6.1).
 *
 * Sits under the day header of every cell where ≥1 reservation has the breakfast
 * option enabled AND the customer is present in the morning. One row per contributing
 * reservation: `{clientName} ({propertyName}) : {N} pers.`. A divider + a total line at
 * the bottom.
 *
 * Returns `null` when `data` is missing or carries no items — the server still emits
 * the empty days uniformly; the silence is a client decision (rule 7 of the spec,
 * same pattern as `LaundryDayCard`).
 *
 * Props:
 *   data — { items: [{ reservationId, clientName, propertyName, persons }],
 *            totalPersons: number }
 *     Pass `undefined` / `null` → renders nothing.
 */
import React from 'react';
import { Card, CardContent, Box, Typography, Stack, Divider } from '@mui/material';
import { amber } from '@mui/material/colors';
import BreakfastDiningIcon from '@mui/icons-material/BreakfastDining';

// Breakfast-themed palette. Amber reads as "morning / warm / pastry" — distinct from the
// cyan laundry card so the operator's eye picks them apart at a glance. Same 3-tone
// cascade as the laundry card (subtle bg / defined border / saturated accent).
const BREAKFAST_BG = amber[50];      // #FFF8E1
const BREAKFAST_BORDER = amber[200]; // #FFE082
const BREAKFAST_ACCENT = amber[800]; // #FF8F00

function pluralisePersons(n) {
  return n > 1 ? 'pers.' : 'pers.';
}

function pluraliseBreakfasts(n) {
  return n > 1 ? 'petits déjeuners' : 'petit déjeuner';
}

export default function BreakfastDayCard({ data }) {
  if (!data || !Array.isArray(data.items) || data.items.length === 0) return null;
  const total = Number(data.totalPersons || 0);

  return (
    <Card variant="outlined" sx={{ mb: 1.25, bgcolor: BREAKFAST_BG, borderColor: BREAKFAST_BORDER }}>
      <CardContent sx={{ py: 1.25, px: 2, '&:last-child': { pb: 1.25 } }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          <BreakfastDiningIcon fontSize="small" sx={{ color: BREAKFAST_ACCENT }} />
          <Typography variant="subtitle2" sx={{ fontWeight: 700, color: BREAKFAST_ACCENT }}>
            Petit déjeuner
          </Typography>
        </Box>
        <Stack spacing={0.5}>
          {data.items.map((item) => (
            <Typography key={item.reservationId} variant="body2" sx={{ color: 'text.primary' }}>
              <Box component="span" sx={{ fontWeight: 600 }}>{item.clientName}</Box>
              {item.propertyName && (
                <Box component="span" sx={{ color: 'text.secondary', ml: 0.5 }}>
                  ({item.propertyName})
                </Box>
              )}
              <Box component="span" sx={{ color: 'text.secondary' }}> : </Box>
              <Box component="span" sx={{ fontWeight: 600 }}>{item.persons} {pluralisePersons(item.persons)}</Box>
            </Typography>
          ))}
        </Stack>
        <Divider sx={{ my: 1 }} />
        <Typography variant="body2" sx={{ fontWeight: 700, color: 'text.primary' }}>
          Total : {total} {pluraliseBreakfasts(total)}
        </Typography>
      </CardContent>
    </Card>
  );
}
