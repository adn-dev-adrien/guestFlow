/**
 * LaundryDayCard — pure renderer for the weekly bed-linen summary on PlanningPage
 * (specs/weekly-bed-linen-tracking.md §6.1).
 *
 * Sits under the day header of every laundry-day cell. Two blocks side by side: "À apporter"
 * (sheets used since the previous laundry day) + "À récupérer" (the previous batch coming back
 * from the laundry). Stacks vertically on `xs`.
 *
 * Returns `null` when both sides are zero (rule 13: no visual noise on a quiet week). The
 * server still emits zero-everywhere days uniformly — the silence is a client decision.
 *
 * Props:
 *   data — { dropOff: { singleBeds, doubleBeds, babyBeds }, pickUp: same } from the server.
 *   Pass `undefined` / `null` → renders nothing.
 */
import React from 'react';
import { Card, CardContent, Box, Typography, Stack } from '@mui/material';
import { cyan } from '@mui/material/colors';
import LocalLaundryServiceIcon from '@mui/icons-material/LocalLaundryService';

// Laundry-themed palette (2026-06-02). Cyan reads as "fresh / water / linen" without leaning
// clinical or flashy. Three tones cascade — bg subtle → border just defined enough to pop off
// the page → icon + title saturated enough to draw the eye to the actionable info.
const LAUNDRY_BG = cyan[50];      // #E0F7FA
const LAUNDRY_BORDER = cyan[200]; // #80DEEA
const LAUNDRY_ACCENT = cyan[800]; // #00838F

function totalSheets(side) {
  if (!side) return 0;
  return Number(side.singleBeds || 0) + Number(side.doubleBeds || 0) + Number(side.babyBeds || 0);
}

function totalTowels(side) {
  if (!side) return 0;
  return Number(side.largeTowels || 0) + Number(side.mediumTowels || 0) + Number(side.smallTowels || 0);
}

function formatSheets(side) {
  // Returns a human-readable summary: "2 doubles · 1 simple · 3 bébé" — keeps only non-zero
  // segments so the line stays compact.
  if (!side) return null;
  const parts = [];
  const dbl = Number(side.doubleBeds || 0);
  const sgl = Number(side.singleBeds || 0);
  const bby = Number(side.babyBeds || 0);
  if (dbl > 0) parts.push(`${dbl} double${dbl > 1 ? 's' : ''}`);
  if (sgl > 0) parts.push(`${sgl} simple${sgl > 1 ? 's' : ''}`);
  if (bby > 0) parts.push(`${bby} bébé`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

function formatTowels(side) {
  // Per-type towel counts (specs §3.5.ter). Operator configures `towelLargePerPerson`,
  // `towelMediumPerPerson`, `towelSmallPerPerson` on the option; any size at 0 is omitted from
  // the rendered line so the card stays compact. All three at zero → return null + the SideBlock
  // falls back to the em-dash placeholder.
  if (!side) return null;
  const lg = Number(side.largeTowels  || 0);
  const md = Number(side.mediumTowels || 0);
  const sm = Number(side.smallTowels  || 0);
  if (lg === 0 && md === 0 && sm === 0) return null;
  const parts = [];
  if (lg > 0) parts.push(`${lg} grande${lg > 1 ? 's' : ''}`);
  if (md > 0) parts.push(`${md} moyenne${md > 1 ? 's' : ''}`);
  if (sm > 0) parts.push(`${sm} petite${sm > 1 ? 's' : ''}`);
  return parts.join(' · ');
}

function SideBlock({ title, side }) {
  const sheetsLine = formatSheets(side);
  const towelsLine = formatTowels(side);
  // Both null → render the em-dash placeholder so the visual symmetry holds when only the
  // other side has something to show.
  const hasAny = sheetsLine || towelsLine;
  return (
    <Box sx={{ flex: 1, minWidth: 0 }}>
      <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {title}
      </Typography>
      {!hasAny && (
        <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.primary', mt: 0.25 }}>—</Typography>
      )}
      {sheetsLine && (
        <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.primary', mt: 0.25 }}>
          <Box component="span" sx={{ color: 'text.secondary', fontWeight: 500, mr: 0.5 }}>Draps :</Box>
          {sheetsLine}
        </Typography>
      )}
      {towelsLine && (
        <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.primary', mt: 0.25 }}>
          <Box component="span" sx={{ color: 'text.secondary', fontWeight: 500, mr: 0.5 }}>Serviettes :</Box>
          {towelsLine}
        </Typography>
      )}
    </Box>
  );
}

// Third block — "Disponible après ce dépôt" (specs/linen-inventory-shortage-tracking.md §6.2).
// Prop `inventoryAfter` is the per-type `clean` snapshot at end-of-day on this laundry day.
// Each type with stock > 0 (i.e. tracked at all — server emits only those) gets a chip; values
// < 0 render in red with the math-minus prefix (`−2 bébé`).
function formatInventoryParts(byType, typeKeys, labels) {
  if (!byType) return [];
  const out = [];
  for (const t of typeKeys) {
    if (!(t in byType)) continue;
    const n = Number(byType[t]);
    const label = labels[t];
    const isShortage = n < 0;
    out.push({
      key: t,
      text: isShortage ? `−${Math.abs(n)} ${label(Math.abs(n))}` : `${n} ${label(n)}`,
      isShortage,
    });
  }
  return out;
}

const BED_LABELS = {
  double: (n) => (n > 1 ? 'doubles' : 'double'),
  single: (n) => (n > 1 ? 'simples' : 'simple'),
  baby: () => 'bébé',
};
const TOWEL_LABELS = {
  large: (n) => (n > 1 ? 'grandes' : 'grande'),
  medium: (n) => (n > 1 ? 'moyennes' : 'moyenne'),
  small: (n) => (n > 1 ? 'petites' : 'petite'),
};

function InventoryLine({ label, parts }) {
  if (parts.length === 0) return null;
  return (
    <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.primary', mt: 0.25 }}>
      <Box component="span" sx={{ color: 'text.secondary', fontWeight: 500, mr: 0.5 }}>{label}</Box>
      {parts.map((p, idx) => (
        <Box
          key={p.key}
          component="span"
          sx={{ color: p.isShortage ? 'error.main' : 'inherit', fontWeight: p.isShortage ? 700 : 600 }}
        >
          {idx > 0 && <Box component="span" sx={{ color: 'text.disabled', fontWeight: 400 }}> · </Box>}
          {p.text}
        </Box>
      ))}
    </Typography>
  );
}

export default function LaundryDayCard({ data, inventoryAfter }) {
  if (!data) return null;
  // Hide the card when everything is zero on BOTH sides (no sheets and no towels at all). Per
  // spec rule 13 — keeps a quiet week silent.
  const dropTotal = totalSheets(data.dropOff) + totalTowels(data.dropOff);
  const pickTotal = totalSheets(data.pickUp) + totalTowels(data.pickUp);
  if (dropTotal === 0 && pickTotal === 0) return null;

  // §3.5 — third block: post-drop available stock. Hidden when no inventory data is provided
  // (e.g. stock untracked = nothing to display).
  const bedParts = formatInventoryParts(inventoryAfter, ['double', 'single', 'baby'], BED_LABELS);
  const towelParts = formatInventoryParts(inventoryAfter, ['large', 'medium', 'small'], TOWEL_LABELS);
  const hasInventoryLine = bedParts.length + towelParts.length > 0;

  return (
    <Card variant="outlined" sx={{ mb: 1.25, bgcolor: LAUNDRY_BG, borderColor: LAUNDRY_BORDER }}>
      <CardContent sx={{ py: 1.25, px: 2, '&:last-child': { pb: 1.25 } }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          <LocalLaundryServiceIcon fontSize="small" sx={{ color: LAUNDRY_ACCENT }} />
          <Typography variant="subtitle2" sx={{ fontWeight: 700, color: LAUNDRY_ACCENT }}>
            Linge à la blanchisserie
          </Typography>
        </Box>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1.5}
          divider={<Box sx={{ display: { xs: 'none', sm: 'block' }, borderLeft: '1px solid', borderColor: 'divider' }} />}
        >
          <SideBlock title="À apporter" side={data.dropOff} />
          <SideBlock title="À récupérer" side={data.pickUp} />
        </Stack>
        {hasInventoryLine && (
          <Box sx={{ mt: 1.5, pt: 1, borderTop: '1px solid', borderColor: 'divider' }}>
            <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Disponible après ce dépôt
            </Typography>
            <InventoryLine label="Draps :" parts={bedParts} />
            <InventoryLine label="Serviettes :" parts={towelParts} />
          </Box>
        )}
      </CardContent>
    </Card>
  );
}
